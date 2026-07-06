import * as THREE from 'three';
import type { LevelData, LayerType } from '../shared/types';
import { MAX_TYPES, colorHexCss } from '../shared/colors';
import { SETTINGS } from '../shared/settings';
import {
  ballsPerType,
  generateBallQueues,
  generateColumns,
  mulberry32,
  runsFeasible,
} from '../shared/generate';
import { ColumnView, BallQueueView, makeConveyor, makeLayerMesh } from '../game/WallView';
import {
  BASE_Y,
  LAYER_H,
  QUEUE_PITCH,
  ballsYFor,
  conveyorYFor,
  layerY,
  queueX,
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
  fromCol: number;
  fromIdx: number;
  ghost: THREE.Group;
  ghostMeshes: THREE.Mesh[];
  target: { col: number; idx: number } | null;
}

export class EditorApp {
  // three
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rafId = 0;
  private resizeObserver: ResizeObserver;
  private views: ColumnView[] = [];
  private ballViews: BallQueueView[] = [];
  private layerMeshes: THREE.Mesh[] = [];
  private conveyor: { group: THREE.Group; dispose(): void } | null = null;
  private marker: THREE.Mesh;
  private markerMat: THREE.MeshBasicMaterial;

  // level state
  private levelId: string;
  private name: string;
  private typeCount = 4;
  private groupCount = 8;
  private charge = 8;
  private columnCount = 5;
  private queueCount = 2;
  private beltCapacity = SETTINGS.conveyorCapacity;
  private minGroup = 2;
  private ballQueues: LayerType[][] | null = null;
  private columns: LayerType[][] | null = null;
  private poolSig = '';
  private ballsSig = '';
  private layersSig = '';
  private mode: Mode = 'group';
  private seed = 1;
  private selectedBall: { q: number; i: number } | null = null;

  // dom
  private root: HTMLDivElement;
  private setupPanel!: HTMLDivElement;
  private ballsPanel!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private toolbarEl!: HTMLDivElement;
  private bottomEl!: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;
  private drag: DragState | null = null;

  private onPointerDown = (e: PointerEvent) => this.pointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.pointerMove(e);
  private onPointerUp = (e: PointerEvent) => this.pointerUp(e);

  constructor(private parent: HTMLElement, private opts: EditorAppOptions) {
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

    if (opts.initial) {
      const lv = opts.initial;
      this.levelId = lv.id;
      this.name = lv.name;
      this.charge = lv.charge;
      this.beltCapacity = lv.conveyorCapacity ?? SETTINGS.conveyorCapacity;
      this.minGroup = lv.minGroup ?? 2;
      this.ballQueues = lv.ballQueues.map((q) => [...q]);
      this.columns = lv.columns.map((c) => [...c]);
      this.queueCount = lv.ballQueues.length;
      this.columnCount = lv.columns.length;
      this.groupCount = lv.ballQueues.reduce((n, q) => n + q.length, 0);
      const distinct = new Set<number>();
      for (const q of lv.ballQueues) for (const t of q) distinct.add(t);
      this.typeCount = Math.max(2, distinct.size);
    } else {
      this.levelId = `custom-${Date.now()}`;
      this.name = 'My Level';
    }
    this.poolSig = this.sigPool();
    this.ballsSig = this.sigBalls();
    this.layersSig = this.sigLayers();

    this.root = document.createElement('div');
    this.root.className = 'overlay';
    parent.appendChild(this.root);
    this.buildChrome();
    this.buildSetupPanel();
    this.buildBallsPanel();
    if (opts.initial) this.enterLayers();
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

  private sigPool(): string {
    return `${this.typeCount}|${this.groupCount}`;
  }
  private sigBalls(): string {
    return `${this.sigPool()}|${this.queueCount}`;
  }
  private sigLayers(): string {
    return `${this.sigPool()}|${this.charge}|${this.columnCount}|${this.minGroup}`;
  }
  private genParams() {
    return {
      typeCount: this.typeCount,
      groupCount: this.groupCount,
      charge: this.charge,
      columnCount: this.columnCount,
      queueCount: this.queueCount,
      minGroup: this.minGroup,
    };
  }
  private nextRand(): () => number {
    this.seed = ((this.seed * 1103515245 + 12345) >>> 0) ^ (Date.now() & 0xffff);
    return mulberry32(this.seed);
  }

  // ---- step 1: setup ---------------------------------------------------------

  private buildSetupPanel(): void {
    this.setupPanel = document.createElement('div');
    this.setupPanel.className = 'setup-panel';
    this.root.appendChild(this.setupPanel);
    this.renderSetup();
  }

  private renderSetup(): void {
    this.setupPanel.innerHTML = `
      <div class="menu-title">Level Setup</div>
      <div class="menu-sub">Step 1 of 3 — define the pool. A group = 1 ball + charge layers.</div>
      <div class="ed-card">
        <div class="ed-row"><span class="ed-label">Name</span>
          <input class="mini-num" style="width:160px" data-f="name" type="text" /></div>
        <div class="ed-row"><span class="ed-label">Colors</span>
          <input class="mini-num" data-f="types" type="number" min="2" max="${MAX_TYPES}" /></div>
        <div class="ed-row"><span class="ed-label">Groups</span>
          <input class="mini-num" data-f="groups" type="number" min="1" max="64" /></div>
        <div class="ed-row"><span class="ed-label">Charge</span>
          <input class="mini-num" data-f="charge" type="number" min="2" max="20" /></div>
        <div class="ed-row"><span class="ed-label">Columns</span>
          <input class="mini-num" data-f="columns" type="number" min="1" max="9" /></div>
        <div class="ed-row"><span class="ed-label">Ball queues</span>
          <input class="mini-num" data-f="queues" type="number" min="1" max="6" /></div>
        <div class="ed-row"><span class="ed-label">Belt</span>
          <input class="mini-num" data-f="belt" type="number" min="1" max="30" /></div>
        <div class="ed-row"><span class="ed-label">Min group</span>
          <input class="mini-num" data-f="min" type="number" min="1" max="19" /></div>
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
    f('charge').value = String(this.charge);
    f('columns').value = String(this.columnCount);
    f('queues').value = String(this.queueCount);
    f('belt').value = String(this.beltCapacity);
    f('min').value = String(this.minGroup);

    const readBack = () => {
      this.name = f('name').value || 'My Level';
      this.typeCount = clampInt(f('types').value, 2, MAX_TYPES, 4);
      this.groupCount = clampInt(f('groups').value, 1, 64, 8);
      this.charge = clampInt(f('charge').value, 2, 20, 8);
      this.columnCount = clampInt(f('columns').value, 1, 9, 5);
      this.queueCount = clampInt(f('queues').value, 1, 6, 2);
      this.beltCapacity = clampInt(f('belt').value, 1, 30, SETTINGS.conveyorCapacity);
      this.minGroup = clampInt(f('min').value, 1, 19, 2);
      this.updateSetupSummary();
    };
    for (const k of ['name', 'types', 'groups', 'charge', 'columns', 'queues', 'belt', 'min']) {
      f(k).addEventListener('input', readBack);
    }
    this.updateSetupSummary();

    this.setupPanel
      .querySelector('[data-act="exit"]')!
      .addEventListener('click', () => this.opts.onExit());
    this.setupPanel.querySelector('[data-act="continue"]')!.addEventListener('click', () => {
      readBack();
      if (this.sigPool() !== this.poolSig) {
        this.ballQueues = null;
        this.columns = null;
      } else {
        if (this.sigBalls() !== this.ballsSig) this.ballQueues = null;
        if (this.sigLayers() !== this.layersSig) this.columns = null;
      }
      this.poolSig = this.sigPool();
      this.ballsSig = this.sigBalls();
      this.layersSig = this.sigLayers();
      this.enterBalls();
    });
  }

  private updateSetupSummary(): void {
    const summary = this.setupPanel.querySelector('[data-el="summary"]') as HTMLElement;
    const warn = this.setupPanel.querySelector('[data-el="warn"]') as HTMLElement;
    const per = ballsPerType(this.genParams());
    const dots = per
      .map((g, t) => `<span style="color:${colorHexCss(t)}">●</span>${g}`)
      .join('  ');
    summary.innerHTML =
      `${this.groupCount} balls · ${this.groupCount * this.charge} layers · ` +
      `balls per color: ${dots}`;
    const warns: string[] = [];
    per.forEach((b, t) => {
      if (b > 0 && !runsFeasible(b * this.charge, this.minGroup, this.charge)) {
        warns.push(
          `Min group ${this.minGroup} is impossible for a color with ${b} ball(s) at charge ${this.charge}.`
        );
      }
    });
    if (this.groupCount < this.queueCount)
      warns.push('More ball queues than balls — some queues will start empty.');
    warn.textContent = warns.join(' ');
  }

  private showSetup(): void {
    this.setupPanel.style.display = 'flex';
    this.ballsPanel.style.display = 'none';
    this.toolbarEl.style.display = 'none';
    this.statusEl.style.display = 'none';
    this.bottomEl.style.display = 'none';
  }

  // ---- step 2: balls ---------------------------------------------------------

  private buildBallsPanel(): void {
    this.ballsPanel = document.createElement('div');
    this.ballsPanel.className = 'setup-panel';
    this.root.appendChild(this.ballsPanel);
    this.ballsPanel.style.display = 'none';
  }

  private enterBalls(): void {
    if (!this.ballQueues) this.ballQueues = generateBallQueues(this.genParams(), this.nextRand());
    this.selectedBall = null;
    this.setupPanel.style.display = 'none';
    this.ballsPanel.style.display = 'flex';
    this.toolbarEl.style.display = 'none';
    this.statusEl.style.display = 'none';
    this.bottomEl.style.display = 'none';
    this.renderBalls();
  }

  private renderBalls(): void {
    const sel = this.selectedBall;
    this.ballsPanel.innerHTML = `
      <div class="menu-title">Ball Queues</div>
      <div class="menu-sub">Step 2 of 3 — front ball (left) is the leader. Tap a ball, then tap
      where it should go (another ball to insert before it, or ⊕ to append).</div>
      <div data-el="rows"></div>
      <div class="setup-summary" data-el="hint">${
        sel ? 'Now tap a destination — or the same ball to cancel.' : 'Tap a ball to pick it up.'
      }</div>
      <div class="menu-footer" style="display:flex;gap:10px">
        <button class="btn ghost" data-act="back">← Setup</button>
        <button class="btn ghost" data-act="distribute">🎲 Distribute</button>
        <button class="btn" style="flex:1" data-act="continue">Continue →</button>
      </div>`;

    const rows = this.ballsPanel.querySelector('[data-el="rows"]') as HTMLElement;
    this.ballQueues!.forEach((queue, q) => {
      const card = document.createElement('div');
      card.className = 'ed-card';
      const row = document.createElement('div');
      row.className = 'ed-row';
      const label = document.createElement('span');
      label.className = 'ed-label';
      label.textContent = `Queue ${q + 1} ▸`;
      row.appendChild(label);
      queue.forEach((t, i) => {
        const dot = document.createElement('button');
        dot.className = 'color-dot' + (sel && sel.q === q && sel.i === i ? ' active' : '');
        dot.style.background = colorHexCss(t);
        dot.title = i === 0 ? 'leader' : `#${i + 1}`;
        dot.addEventListener('click', () => this.ballClicked(q, i));
        row.appendChild(dot);
      });
      const plus = document.createElement('button');
      plus.className = 'color-dot';
      plus.style.background = 'transparent';
      plus.style.border = '2px dashed #8b91a6';
      plus.textContent = '';
      plus.title = 'append here';
      plus.addEventListener('click', () => this.ballAppend(q));
      row.appendChild(plus);
      card.appendChild(row);
      rows.appendChild(card);
    });

    this.ballsPanel.querySelector('[data-act="back"]')!.addEventListener('click', () => {
      this.renderSetup();
      this.showSetup();
    });
    this.ballsPanel
      .querySelector('[data-act="distribute"]')!
      .addEventListener('click', () => {
        this.ballQueues = generateBallQueues(this.genParams(), this.nextRand());
        this.selectedBall = null;
        this.renderBalls();
      });
    this.ballsPanel
      .querySelector('[data-act="continue"]')!
      .addEventListener('click', () => this.enterLayers());
  }

  private ballClicked(q: number, i: number): void {
    const sel = this.selectedBall;
    if (!sel) {
      this.selectedBall = { q, i };
    } else if (sel.q === q && sel.i === i) {
      this.selectedBall = null;
    } else {
      const [ball] = this.ballQueues![sel.q].splice(sel.i, 1);
      let target = i;
      if (sel.q === q && sel.i < i) target--; // removal shifted the target left
      this.ballQueues![q].splice(target, 0, ball);
      this.selectedBall = null;
    }
    this.renderBalls();
  }

  private ballAppend(q: number): void {
    const sel = this.selectedBall;
    if (!sel) return;
    const [ball] = this.ballQueues![sel.q].splice(sel.i, 1);
    this.ballQueues![q].push(ball);
    this.selectedBall = null;
    this.renderBalls();
  }

  // ---- step 3: layers ---------------------------------------------------------

  private buildChrome(): void {
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'editor-toolbar';
    this.toolbarEl.innerHTML = `
      <button class="tool-btn" data-act="setup">⚙ Setup</button>
      <button class="tool-btn" data-act="balls">● Balls</button>
      <button class="tool-btn" data-act="distribute">🎲</button>
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
      .querySelector('[data-act="balls"]')!
      .addEventListener('click', () => this.enterBalls());
    this.toolbarEl
      .querySelector('[data-act="exit"]')!
      .addEventListener('click', () => this.opts.onExit());
    this.toolbarEl.querySelector('[data-act="distribute"]')!.addEventListener('click', () => {
      this.columns = generateColumns(this.genParams(), this.nextRand());
      this.rebuild();
      this.updateStatus();
    });
    for (const mode of ['group', 'layer'] as Mode[]) {
      this.toolbarEl.querySelector(`[data-mode="${mode}"]`)!.addEventListener('click', () => {
        this.mode = mode;
        this.syncModeButtons();
        this.updateStatus();
      });
    }
    this.bottomEl.querySelector('[data-act="test"]')!.addEventListener('click', () => {
      if (this.columns && this.ballQueues) this.opts.onTestPlay(this.snapshot());
    });
    this.bottomEl
      .querySelector('[data-act="copy"]')!
      .addEventListener('click', () => this.showJsonModal());
    this.bottomEl
      .querySelector('[data-act="download"]')!
      .addEventListener('click', () => this.downloadJson());
    this.bottomEl.querySelector('[data-act="save"]')!.addEventListener('click', () => {
      if (!this.columns || !this.ballQueues) return;
      saveCustomLevel(this.snapshot());
      this.flashStatus('Saved to Your Levels ✓');
    });
  }

  private enterLayers(): void {
    if (!this.ballQueues) this.ballQueues = generateBallQueues(this.genParams(), this.nextRand());
    if (!this.columns) this.columns = generateColumns(this.genParams(), this.nextRand());
    this.setupPanel.style.display = 'none';
    this.ballsPanel.style.display = 'none';
    this.toolbarEl.style.display = 'flex';
    this.statusEl.style.display = 'block';
    this.bottomEl.style.display = 'flex';
    this.syncModeButtons();
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

  private conveyorY(): number {
    const tallest = Math.max(1, ...(this.columns ?? [[]]).map((c) => c.length));
    return conveyorYFor(tallest, this.charge);
  }

  private rebuild(): void {
    for (const v of this.views) v.dispose();
    this.views = [];
    this.layerMeshes = [];
    for (const b of this.ballViews) b.dispose();
    this.ballViews = [];
    this.conveyor?.dispose();
    this.conveyor = null;
    if (!this.columns || !this.ballQueues) return;

    for (let c = 0; c < this.columns.length; c++) {
      const view = new ColumnView();
      view.group.position.set(queueX(c, this.columnCount), BASE_Y, 0);
      this.columns[c].forEach((t, j) => {
        const mesh = view.addLayer(t, j);
        mesh.userData.col = c;
        mesh.userData.idx = j;
        this.layerMeshes.push(mesh);
      });
      this.scene.add(view.group);
      this.views.push(view);
    }

    const cy = this.conveyorY();
    this.conveyor = makeConveyor(this.columnCount * QUEUE_PITCH + 2.6);
    this.conveyor.group.position.y = cy;
    this.scene.add(this.conveyor.group);
    const by = ballsYFor(cy);
    const qn = this.ballQueues.length;
    for (let q = 0; q < qn; q++) {
      this.ballViews.push(new BallQueueView(this.scene, this.ballQueues[q], queueX(q, qn), by));
    }
    this.fitCamera();
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
    if (!this.columns || this.drag) return;
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
    const col = mesh.userData.col as number;
    const idx = mesh.userData.idx as number;
    const column = this.columns[col];

    let start = idx;
    let count = 1;
    if (this.mode === 'group') {
      const type = column[idx];
      start = idx;
      while (start > 0 && column[start - 1] === type) start--;
      let end = idx + 1;
      while (end < column.length && column[end] === type) end++;
      count = end - start;
    }

    const types = column.splice(start, count);
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
    this.drag = { types, fromCol: col, fromIdx: start, ghost, ghostMeshes, target: null };
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointerMove(e);
    this.updateStatus();
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.drag || !this.columns) return;
    const p = this.pointerWorld(e);
    if (!p) return;
    this.drag.ghost.position.set(p.x, p.y + 0.25, 0.4);

    let target: { col: number; idx: number } | null = null;
    for (let c = 0; c < this.columnCount; c++) {
      if (Math.abs(p.x - queueX(c, this.columnCount)) <= QUEUE_PITCH / 2) {
        const L = this.columns[c].length;
        let idx = 0;
        while (idx < L && layerY(idx) < p.y) idx++;
        target = { col: c, idx };
        break;
      }
    }
    this.drag.target = target;
    if (target) {
      this.marker.visible = true;
      const y = layerY(target.idx) - LAYER_H / 2;
      this.marker.position.set(queueX(target.col, this.columnCount), y, 0.1);
    } else {
      this.marker.visible = false;
    }
  }

  private pointerUp(e: PointerEvent): void {
    if (!this.drag || !this.columns) return;
    const d = this.drag;
    this.drag = null;
    this.marker.visible = false;
    this.scene.remove(d.ghost);
    for (const m of d.ghostMeshes) (m.material as THREE.Material).dispose();

    if (d.target) {
      this.columns[d.target.col].splice(d.target.idx, 0, ...d.types);
    } else {
      this.columns[d.fromCol].splice(d.fromIdx, 0, ...d.types);
    }
    this.rebuild();
    this.updateStatus();
  }

  // ---- status -------------------------------------------------------------------

  /** Top groups already >= charge (will smash or wait the moment the level loads). */
  private hotGroupCount(): number {
    if (!this.columns) return 0;
    let n = 0;
    for (const c of this.columns) {
      if (c.length === 0) continue;
      const t = c[c.length - 1];
      let run = 0;
      for (let i = c.length - 1; i >= 0 && c[i] === t; i--) run++;
      if (run >= this.charge) n++;
    }
    return n;
  }

  private updateStatus(): void {
    if (!this.columns) return;
    if (this.drag) {
      this.statusEl.textContent = 'Drop on a column to insert — release elsewhere to cancel.';
      this.statusEl.className = 'editor-status';
      return;
    }
    const hot = this.hotGroupCount();
    this.statusEl.textContent =
      `✓ ${this.groupCount} balls · charge ${this.charge} · drag to fine-tune (${this.mode} mode).` +
      (hot > 0 ? ` ⚠ ${hot} top group(s) will smash or wait at start.` : '');
    this.statusEl.className = 'editor-status ok';
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
      charge: this.charge,
      conveyorCapacity: this.beltCapacity,
      minGroup: this.minGroup,
      ballQueues: (this.ballQueues ?? []).map((q) => [...q]),
      columns: (this.columns ?? []).map((c) => [...c]),
    };
  }

  private showJsonModal(): void {
    if (!this.columns || this.modalEl) return;
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
    if (!this.columns) return;
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
    const cy2 = this.conveyorY();
    const by = ballsYFor(cy2);
    const maxQueue = Math.max(1, ...(this.ballQueues ?? [[]]).map((q) => q.length));
    const width = this.columnCount * QUEUE_PITCH + 1.1;
    const top = by + maxQueue * BallQueueView.SPACING + 0.9; // headroom under the toolbar
    const bottom = BASE_Y - 0.8;
    const height = top - bottom;
    const cy = (top + bottom) / 2;
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const d = Math.max(height / (2 * Math.tan(fovV / 2)), width / (2 * Math.tan(fovH / 2)));
    this.camera.position.set(0, cy, d + 1.4);
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
    for (const b of this.ballViews) b.dispose();
    this.ballViews = [];
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
