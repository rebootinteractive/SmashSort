import * as THREE from 'three';
import type { LevelData, LayerType } from '../shared/types';
import { MAX_TYPES, colorHexCss } from '../shared/colors';
import { SETTINGS } from '../shared/settings';
import { generateQueues, groupsPerType, mulberry32 } from '../shared/generate';
import { ContainerView, makeConveyor, makeLayerMesh } from '../game/WallView';
import {
  CONVEYOR_Y,
  LAYER_H,
  QUEUE_PITCH,
  TOP_Y,
  containerHeight,
  containerPitch,
  containerTopY,
  queueX,
  sliceQueue,
} from '../game/layout';
import { saveCustomLevel } from '../ui/storage';

export interface EditorAppOptions {
  initial?: LevelData;
  onExit(): void;
  onTestPlay(level: LevelData): void;
}

type Mode = 'group' | 'layer';

interface DragState {
  types: LayerType[];
  fromQ: number;
  fromIdx: number;
  ghost: THREE.Group;
  ghostMeshes: THREE.Mesh[];
  target: { q: number; idx: number } | null;
}

export class EditorApp {
  // three
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rafId = 0;
  private resizeObserver: ResizeObserver;
  private views: ContainerView[] = [];
  private layerMeshes: THREE.Mesh[] = [];
  private conveyor: { group: THREE.Group; dispose(): void } | null = null;
  private marker: THREE.Mesh;
  private markerMat: THREE.MeshBasicMaterial;

  // level state
  private levelId: string;
  private name: string;
  private typeCount = 4;
  private groupCount = 8;
  private capacity = SETTINGS.defaultCapacity;
  private conveyorCapacity = SETTINGS.conveyorCapacity;
  private queueCount = 5;
  private queues: LayerType[][] | null = null;
  private layoutSig = '';
  private mode: Mode = 'group';
  private seed = 1;

  // dom
  private root: HTMLDivElement;
  private setupPanel!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private toolbarEl!: HTMLDivElement;
  private bottomEl!: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;
  private drag: DragState | null = null;

  private onPointerDown = (e: PointerEvent) => this.pointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.pointerMove(e);
  private onPointerUp = (e: PointerEvent) => this.pointerUp(e);

  constructor(private parent: HTMLElement, private opts: EditorAppOptions) {
    // --- three setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xe9ebf1);
    parent.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(2, 5, 7);
    this.scene.add(dir);

    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.marker = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.7), this.markerMat);
    this.marker.visible = false;
    this.scene.add(this.marker);

    // --- level state
    if (opts.initial) {
      const lv = opts.initial;
      this.levelId = lv.id;
      this.name = lv.name;
      this.capacity = lv.capacity;
      this.conveyorCapacity = lv.conveyorCapacity ?? SETTINGS.conveyorCapacity;
      this.queues = lv.queues.map((q) => [...q]);
      this.queueCount = lv.queues.length;
      const total = lv.queues.reduce((n, q) => n + q.length, 0);
      this.groupCount = Math.max(1, Math.round(total / lv.capacity));
      const distinct = new Set<number>();
      for (const q of lv.queues) for (const t of q) distinct.add(t);
      this.typeCount = Math.max(2, distinct.size);
    } else {
      this.levelId = `custom-${Date.now()}`;
      this.name = 'My Level';
    }
    this.layoutSig = this.paramsSig();

    // --- dom shell
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    parent.appendChild(this.root);
    this.buildChrome();
    this.buildSetupPanel();
    if (opts.initial) this.enterLayout(false);
    else this.showSetup();

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(parent);
    this.handleResize();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private paramsSig(): string {
    return `${this.typeCount}|${this.groupCount}|${this.capacity}|${this.queueCount}`;
  }

  // ---- step 1: setup panel ------------------------------------------------

  private buildSetupPanel(): void {
    this.setupPanel = document.createElement('div');
    this.setupPanel.className = 'setup-panel';
    this.root.appendChild(this.setupPanel);
    this.renderSetup();
  }

  private renderSetup(): void {
    this.setupPanel.innerHTML = `
      <div class="menu-title">Level Setup</div>
      <div class="menu-sub">Step 1 of 2 — define the ingredients.</div>
      <div class="ed-card">
        <div class="ed-row"><span class="ed-label">Name</span>
          <input class="mini-num" style="width:160px" data-f="name" type="text" /></div>
        <div class="ed-row"><span class="ed-label">Colors</span>
          <input class="mini-num" data-f="types" type="number" min="2" max="${MAX_TYPES}" /></div>
        <div class="ed-row"><span class="ed-label">Groups</span>
          <input class="mini-num" data-f="groups" type="number" min="1" max="64" /></div>
        <div class="ed-row"><span class="ed-label">Capacity</span>
          <input class="mini-num" data-f="capacity" type="number" min="2" max="20" /></div>
        <div class="ed-row"><span class="ed-label">Queues</span>
          <input class="mini-num" data-f="queues" type="number" min="1" max="9" /></div>
        <div class="ed-row"><span class="ed-label">Belt</span>
          <input class="mini-num" data-f="belt" type="number" min="1" max="30" /></div>
      </div>
      <div class="setup-summary" data-el="summary"></div>
      <div class="setup-warn" data-el="warn"></div>
      <div class="menu-footer" style="display:flex;gap:10px">
        <button class="btn ghost" data-act="exit">← Menu</button>
        <button class="btn" style="flex:1" data-act="continue">Continue →</button>
      </div>`;

    const f = (k: string) => this.setupPanel.querySelector(`[data-f="${k}"]`) as HTMLInputElement;
    f('name').value = this.name;
    f('types').value = String(this.typeCount);
    f('groups').value = String(this.groupCount);
    f('capacity').value = String(this.capacity);
    f('queues').value = String(this.queueCount);
    f('belt').value = String(this.conveyorCapacity);

    const readBack = () => {
      this.name = f('name').value || 'My Level';
      this.typeCount = clampInt(f('types').value, 2, MAX_TYPES, 4);
      this.groupCount = clampInt(f('groups').value, 1, 64, 8);
      this.capacity = clampInt(f('capacity').value, 2, 20, SETTINGS.defaultCapacity);
      this.queueCount = clampInt(f('queues').value, 1, 9, 5);
      this.conveyorCapacity = clampInt(f('belt').value, 1, 30, SETTINGS.conveyorCapacity);
      this.updateSetupSummary();
    };
    for (const k of ['name', 'types', 'groups', 'capacity', 'queues', 'belt']) {
      f(k).addEventListener('input', readBack);
    }
    this.updateSetupSummary();

    this.setupPanel
      .querySelector('[data-act="exit"]')!
      .addEventListener('click', () => this.opts.onExit());
    this.setupPanel.querySelector('[data-act="continue"]')!.addEventListener('click', () => {
      readBack();
      this.enterLayout(this.paramsSig() !== this.layoutSig || !this.queues);
    });
  }

  private updateSetupSummary(): void {
    const summary = this.setupPanel.querySelector('[data-el="summary"]') as HTMLElement;
    const warn = this.setupPanel.querySelector('[data-el="warn"]') as HTMLElement;
    const per = groupsPerType({
      typeCount: this.typeCount,
      groupCount: this.groupCount,
      capacity: this.capacity,
      queueCount: this.queueCount,
    });
    const dots = per
      .map(
        (g, t) =>
          `<span style="color:${colorHexCss(t)}">●</span>${g}`
      )
      .join('  ');
    summary.innerHTML =
      `${this.groupCount * this.capacity} layers · ${this.groupCount} containers · ` +
      `groups per color: ${dots}`;
    warn.textContent =
      this.groupCount < this.queueCount
        ? 'More queues than containers — some queues will start empty.'
        : '';
  }

  private showSetup(): void {
    this.setupPanel.style.display = 'flex';
    this.toolbarEl.style.display = 'none';
    this.statusEl.style.display = 'none';
    this.bottomEl.style.display = 'none';
  }

  // ---- step 2: layout -------------------------------------------------------

  private buildChrome(): void {
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'editor-toolbar';
    this.toolbarEl.innerHTML = `
      <button class="tool-btn" data-act="setup">⚙ Setup</button>
      <button class="tool-btn" data-act="distribute">🎲 Distribute</button>
      <button class="tool-btn" data-mode="group">Group</button>
      <button class="tool-btn" data-mode="layer">Layer</button>
      <button class="tool-btn" data-act="exit">← Menu</button>`;
    this.root.appendChild(this.toolbarEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'editor-status';
    this.root.appendChild(this.statusEl);

    this.bottomEl = document.createElement('div');
    this.bottomEl.className = 'editor-bottom';
    this.bottomEl.style.marginTop = 'auto';
    this.bottomEl.innerHTML = `
      <button class="btn small" data-act="test">▶ Test</button>
      <button class="btn ghost small" data-act="copy">Copy JSON</button>
      <button class="btn ghost small" data-act="download">↓ Download</button>
      <button class="btn small" data-act="save">💾 Save</button>`;
    this.root.appendChild(this.bottomEl);

    this.toolbarEl.querySelector('[data-act="setup"]')!.addEventListener('click', () => {
      this.renderSetup();
      this.showSetup();
    });
    this.toolbarEl
      .querySelector('[data-act="exit"]')!
      .addEventListener('click', () => this.opts.onExit());
    this.toolbarEl.querySelector('[data-act="distribute"]')!.addEventListener('click', () => {
      this.distribute();
    });
    for (const mode of ['group', 'layer'] as Mode[]) {
      this.toolbarEl.querySelector(`[data-mode="${mode}"]`)!.addEventListener('click', () => {
        this.mode = mode;
        this.syncModeButtons();
      });
    }
    this.bottomEl
      .querySelector('[data-act="test"]')!
      .addEventListener('click', () => {
        if (this.isValid()) this.opts.onTestPlay(this.snapshot());
      });
    this.bottomEl
      .querySelector('[data-act="copy"]')!
      .addEventListener('click', () => this.showJsonModal());
    this.bottomEl
      .querySelector('[data-act="download"]')!
      .addEventListener('click', () => this.downloadJson());
    this.bottomEl.querySelector('[data-act="save"]')!.addEventListener('click', () => {
      if (!this.isValid()) return;
      saveCustomLevel(this.snapshot());
      this.flashStatus('Saved to Your Levels ✓');
    });
  }

  private enterLayout(needsDistribute: boolean): void {
    this.setupPanel.style.display = 'none';
    this.toolbarEl.style.display = 'flex';
    this.statusEl.style.display = 'block';
    this.bottomEl.style.display = 'flex';
    this.syncModeButtons();
    if (needsDistribute || !this.queues) this.distribute();
    else {
      this.rebuild();
      this.updateStatus();
    }
  }

  private distribute(): void {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0 || Date.now() >>> 0;
    this.queues = generateQueues(
      {
        typeCount: this.typeCount,
        groupCount: this.groupCount,
        capacity: this.capacity,
        queueCount: this.queueCount,
      },
      mulberry32(this.seed ^ (Date.now() & 0xffff))
    );
    this.layoutSig = this.paramsSig();
    this.rebuild();
    this.updateStatus();
  }

  private syncModeButtons(): void {
    for (const mode of ['group', 'layer'] as Mode[]) {
      this.toolbarEl
        .querySelector(`[data-mode="${mode}"]`)!
        .classList.toggle('active', this.mode === mode);
    }
  }

  // ---- scene ---------------------------------------------------------------

  private rebuild(): void {
    for (const v of this.views) v.dispose();
    this.views = [];
    this.layerMeshes = [];
    if (!this.queues) return;

    for (let q = 0; q < this.queues.length; q++) {
      const slices = sliceQueue(this.queues[q], this.capacity);
      const numSlices = slices.length;
      for (let s = 0; s < numSlices; s++) {
        const depth = numSlices - 1 - s;
        const view = new ContainerView(q * 1000 + s, this.capacity);
        view.group.position.set(
          queueX(q, this.queueCount),
          containerTopY(depth, this.capacity) - containerHeight(this.capacity),
          0
        );
        slices[s].forEach((t, j) => {
          const mesh = view.addLayer(t, j);
          mesh.userData.q = q;
          mesh.userData.flat = s * this.capacity + j;
          this.layerMeshes.push(mesh);
        });
        this.scene.add(view.group);
        this.views.push(view);
      }
    }

    if (!this.conveyor) {
      this.conveyor = makeConveyor(this.queueCount * QUEUE_PITCH + 2.6);
      this.conveyor.group.position.y = CONVEYOR_Y;
      this.scene.add(this.conveyor.group);
    }
    this.fitCamera();
  }

  /** Settled world y of the (existing or would-be) layer slot at flat index in queue q. */
  private slotWorldY(q: number, flat: number): number {
    const L = Math.max(this.queues![q].length, flat + 1);
    const numSlices = Math.max(1, Math.ceil(L / this.capacity));
    const s = Math.floor(flat / this.capacity);
    const depth = numSlices - 1 - s;
    return (
      containerTopY(depth, this.capacity) -
      containerHeight(this.capacity) +
      ((flat % this.capacity) + 0.5) * LAYER_H
    );
  }

  // ---- drag ------------------------------------------------------------------

  private pointerWorld(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const dz = ray.ray.direction.z;
    if (Math.abs(dz) < 1e-6) return null;
    const t = -ray.ray.origin.z / dz;
    return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.queues || this.drag) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.layerMeshes, false);
    if (hits.length === 0) return;
    const mesh = hits[0].object as THREE.Mesh;
    const q = mesh.userData.q as number;
    const flat = mesh.userData.flat as number;
    const queue = this.queues[q];

    let start = flat;
    let count = 1;
    if (this.mode === 'group') {
      // Contiguous same-type run, bounded by the container slice.
      const sliceStart = Math.floor(flat / this.capacity) * this.capacity;
      const sliceEnd = Math.min(sliceStart + this.capacity, queue.length);
      const type = queue[flat];
      start = flat;
      while (start > sliceStart && queue[start - 1] === type) start--;
      let end = flat + 1;
      while (end < sliceEnd && queue[end] === type) end++;
      count = end - start;
    }

    const types = queue.splice(start, count);
    this.rebuild();

    const ghost = new THREE.Group();
    const ghostMeshes: THREE.Mesh[] = [];
    types.forEach((t, i) => {
      const m = makeLayerMesh(t);
      m.position.y = i * LAYER_H;
      m.scale.setScalar(0.92);
      ghost.add(m);
      ghostMeshes.push(m);
    });
    this.scene.add(ghost);
    this.drag = { types, fromQ: q, fromIdx: start, ghost, ghostMeshes, target: null };
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointerMove(e);
    this.updateStatus();
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.drag || !this.queues) return;
    const p = this.pointerWorld(e);
    if (!p) return;
    this.drag.ghost.position.set(p.x, p.y + 0.25, 0.4);

    // Find target queue by x proximity.
    let target: { q: number; idx: number } | null = null;
    for (let q = 0; q < this.queueCount; q++) {
      if (Math.abs(p.x - queueX(q, this.queueCount)) <= QUEUE_PITCH / 2) {
        const L = this.queues[q].length;
        let idx = 0;
        while (idx < L && this.slotWorldY(q, idx) < p.y) idx++;
        target = { q, idx };
        break;
      }
    }
    this.drag.target = target;
    if (target) {
      this.marker.visible = true;
      const L = this.queues[target.q].length;
      const y =
        target.idx < L
          ? this.slotWorldY(target.q, target.idx) - LAYER_H / 2
          : this.slotWorldY(target.q, Math.max(0, L)) + (L > 0 ? -LAYER_H / 2 : 0);
      this.marker.position.set(queueX(target.q, this.queueCount), y, 0.1);
    } else {
      this.marker.visible = false;
    }
  }

  private pointerUp(e: PointerEvent): void {
    if (!this.drag || !this.queues) return;
    const d = this.drag;
    this.drag = null;
    this.marker.visible = false;
    this.scene.remove(d.ghost);
    for (const m of d.ghostMeshes) (m.material as THREE.Material).dispose();

    if (d.target) {
      this.queues[d.target.q].splice(d.target.idx, 0, ...d.types);
    } else {
      this.queues[d.fromQ].splice(d.fromIdx, 0, ...d.types);
    }
    this.rebuild();
    this.updateStatus();
  }

  // ---- validity + status -------------------------------------------------------

  private isValid(): boolean {
    if (!this.queues) return false;
    if (this.drag) return false;
    return this.queues.every((q) => q.length % this.capacity === 0);
  }

  private poppableCount(): number {
    if (!this.queues) return 0;
    let n = 0;
    for (const q of this.queues) {
      for (const slice of sliceQueue(q, this.capacity)) {
        if (slice.length === this.capacity && slice.every((t) => t === slice[0])) n++;
      }
    }
    return n;
  }

  private updateStatus(): void {
    if (!this.queues) return;
    const invalidQ = this.queues.findIndex((q) => q.length % this.capacity !== 0);
    let text: string;
    let cls = '';
    if (this.drag) {
      text = 'Drop on a queue to insert — release elsewhere to cancel.';
    } else if (invalidQ >= 0) {
      text = `Queue ${invalidQ + 1} has ${this.queues[invalidQ].length} layers — needs a multiple of ${this.capacity}.`;
      cls = 'bad';
    } else {
      const pops = this.poppableCount();
      text =
        `✓ Valid — ${this.groupCount} containers. Drag to fine-tune (${this.mode} mode).` +
        (pops > 0 ? ` ⚠ ${pops} container(s) will pop instantly at start.` : '');
      cls = 'ok';
    }
    this.statusEl.textContent = text;
    this.statusEl.className = `editor-status ${cls}`;

    const valid = this.isValid();
    for (const act of ['test', 'copy', 'download', 'save']) {
      (this.bottomEl.querySelector(`[data-act="${act}"]`) as HTMLButtonElement).disabled = !valid;
    }
  }

  private flashStatus(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusEl.className = 'editor-status ok';
    window.setTimeout(() => this.updateStatus(), 2200);
  }

  // ---- export ---------------------------------------------------------------------

  private snapshot(): LevelData {
    return {
      id: this.levelId,
      name: this.name,
      capacity: this.capacity,
      conveyorCapacity: this.conveyorCapacity,
      queues: (this.queues ?? []).map((q) => [...q]),
    };
  }

  private showJsonModal(): void {
    if (!this.isValid() || this.modalEl) return;
    const json = JSON.stringify(this.snapshot(), null, 2);
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal';
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.innerHTML = `<h2>Level JSON</h2>
      <p>Copy this, or use ↓ Download and drop the file into src/levels/contributed/.</p>`;
    const ta = document.createElement('textarea');
    ta.className = 'json';
    ta.value = json;
    card.appendChild(ta);
    const row = document.createElement('div');
    row.className = 'modal-actions';
    row.style.marginTop = '12px';
    const copy = document.createElement('button');
    copy.className = 'btn small';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      navigator.clipboard?.writeText(json);
      copy.textContent = 'Copied ✓';
    });
    const close = document.createElement('button');
    close.className = 'btn ghost small';
    close.textContent = 'Close';
    close.addEventListener('click', () => {
      this.modalEl?.remove();
      this.modalEl = null;
    });
    row.append(copy, close);
    card.appendChild(row);
    this.modalEl.appendChild(card);
    this.root.appendChild(this.modalEl);
  }

  private downloadJson(): void {
    if (!this.isValid()) return;
    const lv = this.snapshot();
    const json = JSON.stringify(lv, null, 2);
    const slug =
      (lv.name || lv.id || 'level')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'level';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.flashStatus('Downloaded — drop into src/levels/contributed/ to ship it.');
  }

  // ---- frame / sizing -----------------------------------------------------------------

  private tick = () => {
    this.rafId = requestAnimationFrame(this.tick);
    this.renderer.render(this.scene, this.camera);
  };

  private handleResize(): void {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.fitCamera();
    this.camera.updateProjectionMatrix();
  }

  private fitCamera(): void {
    const maxContainers = Math.max(
      1,
      ...(this.queues ?? [[]]).map((f) => Math.ceil(Math.max(f.length, 1) / this.capacity))
    );
    const width = this.queueCount * QUEUE_PITCH + 1.1;
    const top = CONVEYOR_Y + 1.6; // extra headroom under the toolbar
    const bottom = TOP_Y - maxContainers * containerPitch(this.capacity) - 0.8;
    const height = top - bottom;
    const cy = (top + bottom) / 2;
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const d = Math.max(height / (2 * Math.tan(fovV / 2)), width / (2 * Math.tan(fovH / 2)));
    this.camera.position.set(0, cy, d + 1.2);
    this.camera.lookAt(0, cy, 0);
  }

  // ---- teardown --------------------------------------------------------------------------

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerUp);
    this.resizeObserver.disconnect();
    for (const v of this.views) v.dispose();
    this.views = [];
    if (this.drag) {
      this.scene.remove(this.drag.ghost);
      for (const m of this.drag.ghostMeshes) (m.material as THREE.Material).dispose();
      this.drag = null;
    }
    (this.marker.geometry as THREE.BufferGeometry).dispose();
    this.markerMat.dispose();
    this.conveyor?.dispose();
    this.modalEl?.remove();
    this.modalEl = null;
    this.root.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
