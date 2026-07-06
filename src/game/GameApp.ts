import * as THREE from 'three';
import type { LevelData } from '../shared/types';
import { SETTINGS } from '../shared/settings';
import { PALETTE } from '../shared/colors';
import { Board } from './Board';
import {
  ContainerView,
  PopBurst,
  disposeMesh,
  makeConveyor,
} from './WallView';
import { Tweens, easeOutCubic, easeInOutCubic } from './Tween';
import { Hud } from './Hud';
import {
  CONVEYOR_Y,
  QUEUE_PITCH,
  TOP_Y,
  containerHeight,
  containerPitch,
  containerTopY,
  queueX,
} from './layout';

export interface GameAppOptions {
  level: LevelData;
  onMenu(): void;
  onRestart(): void;
  onNext?: () => void;
}

interface BeltItem {
  mesh: THREE.Mesh;
  type: number;
  x: number;
  riding: boolean;
  /** Source container id — can't re-enter it until the belt wraps (cleared on wrap). */
  block: number | null;
}

export class GameApp {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rafId = 0;
  private clock = new THREE.Clock();
  private tweens = new Tweens();
  private resizeObserver: ResizeObserver;

  private board: Board;
  /** Per queue, leader-first — mirrors board (catches up after pop animations). */
  private queueViews: ContainerView[][] = [];
  private viewById = new Map<number, ContainerView>();
  private belt: BeltItem[] = [];
  private pendingDrops = new Map<number, number>();
  /** Containers logically popped, awaiting in-flight drops before the view pops. */
  private popWaiting = new Map<number, number>(); // containerId -> queue index
  /** Container views mid-relocation — excluded from queue-advance retargeting. */
  private relocating = new Set<number>();
  private bursts: PopBurst[] = [];
  private conveyor: { group: THREE.Group; dispose(): void };
  private hud: Hud;

  private over = false;
  private shake = 0;
  private camBase = new THREE.Vector3();
  private beltMaxX = 0;
  private beltSpan = 0;
  private queueCount: number;
  private capacity: number;
  private beltCapacity: number;

  private onPointerDown = (e: PointerEvent) => this.handleTap(e);

  constructor(private parent: HTMLElement, private opts: GameAppOptions) {
    this.board = new Board(opts.level);
    this.capacity = opts.level.capacity;
    this.queueCount = opts.level.queues.length;
    this.beltCapacity = opts.level.conveyorCapacity ?? SETTINGS.conveyorCapacity;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xe9ebf1);
    parent.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(2, 5, 7);
    this.scene.add(dir);

    // Build wall views from board state.
    for (let q = 0; q < this.queueCount; q++) {
      const views: ContainerView[] = [];
      const containers = this.board.queues[q].containers;
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        const view = new ContainerView(c.id, c.capacity);
        view.group.position.set(queueX(q, this.queueCount), this.settledGroupY(i), 0);
        for (let j = 0; j < c.layers.length; j++) view.addLayer(c.layers[j], j);
        this.scene.add(view.group);
        views.push(view);
        this.viewById.set(c.id, view);
      }
      this.queueViews.push(views);
    }

    const wallWidth = this.queueCount * QUEUE_PITCH;
    this.beltSpan = wallWidth + 2.6;
    this.beltMaxX = this.beltSpan / 2;
    this.conveyor = makeConveyor(this.beltSpan);
    this.conveyor.group.position.y = CONVEYOR_Y;
    this.scene.add(this.conveyor.group);

    this.hud = new Hud(parent, {
      levelName: opts.level.name,
      totalContainers: this.board.totalContainers,
      conveyorCapacity: this.beltCapacity,
      onMenu: opts.onMenu,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
    });

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(parent);
    this.handleResize();

    // Levels may start with already-poppable containers — resolve them up front.
    let delay = 0.35;
    for (let q = 0; q < this.queueCount; q++) {
      let leader = this.board.leader(q);
      while (leader && this.board.isPoppable(leader)) {
        const id = leader.id;
        this.board.popLeader(q);
        this.popWaiting.set(id, q);
        this.tweens.add(0.01, () => {}, { delay, done: () => this.runViewPop(id) });
        delay += 0.3;
        leader = this.board.leader(q);
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  }

  // ---- layout helpers -------------------------------------------------

  /** Settled group-origin y (bottom of layer stack) for container depth i. */
  private settledGroupY(i: number): number {
    return containerTopY(i, this.capacity) - containerHeight(this.capacity);
  }

  /** Settled world position of slot `index` in queue q's container at depth i. */
  private settledSlot(q: number, depth: number, index: number): THREE.Vector3 {
    return new THREE.Vector3(
      queueX(q, this.queueCount),
      this.settledGroupY(depth) + (index + 0.5) * 0.2,
      0
    );
  }

  // ---- input -----------------------------------------------------------

  private handleTap(e: PointerEvent): void {
    if (this.over) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);

    // Only leader containers are tappable.
    for (let q = 0; q < this.queueCount; q++) {
      const leader = this.board.leader(q);
      if (!leader) continue;
      const view = this.viewById.get(leader.id)!;
      const hits = ray.intersectObjects(view.layerMeshes, false);
      if (hits.length === 0) continue;
      const mesh = hits[0].object as THREE.Mesh;
      const idx = view.layerMeshes.indexOf(mesh);
      const group = this.board.topGroup(leader);
      if (!group) return;
      if (idx < leader.layers.length - group.count) {
        this.shakeDeny(view, q); // tapped below the leader group
        return;
      }
      const available = this.beltCapacity - this.belt.length;
      const n = Math.min(group.count, available);
      if (n <= 0) {
        this.shakeDeny(view, q); // belt is full
        return;
      }
      this.eject(q, n);
      return;
    }
  }

  private shakeDeny(view: ContainerView, q: number): void {
    const bx = queueX(q, this.queueCount);
    this.tweens.add(0.3, (k) => {
      view.group.position.x = bx + Math.sin(k * Math.PI * 4) * (1 - k) * 0.06;
    });
  }

  private eject(q: number, n: number): void {
    const removed = this.board.eject(q, n);
    if (!removed) return;
    const leader = this.board.leader(q)!;
    const view = this.viewById.get(leader.id)!;
    const meshes = view.detachTop(removed.count, this.scene);
    const qx = queueX(q, this.queueCount);
    meshes.forEach((mesh, i) => {
      const item: BeltItem = {
        mesh,
        type: removed.type,
        x: qx - i * 0.36,
        riding: false,
        block: leader.id,
      };
      this.belt.push(item);
      const y0 = mesh.position.y;
      this.tweens.add(
        0.26,
        (k) => {
          mesh.position.x = item.x;
          mesh.position.y = y0 + (CONVEYOR_Y - y0) * k + Math.sin(k * Math.PI) * 0.3;
        },
        {
          ease: easeInOutCubic,
          delay: i * 0.04,
          done: () => {
            mesh.position.y = CONVEYOR_Y;
            item.riding = true;
          },
        }
      );
    });
    this.hud.setBelt(this.belt.length, this.belt.length >= this.beltCapacity);
    this.checkDeadlock();
  }

  // ---- belt ------------------------------------------------------------

  private updateBelt(dt: number): void {
    const speed = SETTINGS.conveyorSpeed;
    const dropped: BeltItem[] = [];
    for (const item of this.belt) {
      if (!item.riding) continue;
      const prev = item.x;
      item.x += speed * dt;
      let wrapped = false;
      if (item.x > this.beltMaxX) {
        item.x -= this.beltSpan;
        wrapped = true;
        item.block = null; // a full loop re-opens the source container
      }
      for (let q = 0; q < this.queueCount; q++) {
        const qx = queueX(q, this.queueCount);
        const crossed = wrapped
          ? qx > prev || qx <= item.x
          : qx > prev && qx <= item.x;
        if (
          crossed &&
          this.board.leader(q)?.id !== item.block &&
          this.board.canAccept(q, item.type)
        ) {
          dropped.push(item);
          this.drop(item, q);
          break;
        }
      }
      if (!dropped.includes(item)) {
        item.mesh.position.x = item.x;
        item.mesh.position.y = CONVEYOR_Y;
      }
    }
    if (dropped.length) {
      this.belt = this.belt.filter((it) => !dropped.includes(it));
      this.hud.setBelt(this.belt.length, this.belt.length >= this.beltCapacity);
    }
  }

  private drop(item: BeltItem, q: number): void {
    const { container, index } = this.board.accept(q, item.type);
    const depth = this.board.queues[q].containers.indexOf(container);
    const target = this.settledSlot(q, depth, index);
    const start = item.mesh.position.clone();
    start.x = item.x;
    this.pendingDrops.set(container.id, (this.pendingDrops.get(container.id) ?? 0) + 1);

    this.tweens.add(
      0.3,
      (k) => {
        item.mesh.position.lerpVectors(start, target, k);
        item.mesh.position.y += Math.sin(k * Math.PI) * 0.22;
      },
      {
        ease: easeInOutCubic,
        done: () => {
          const view = this.viewById.get(container.id);
          if (view) view.attachAt(item.mesh, index);
          const left = (this.pendingDrops.get(container.id) ?? 1) - 1;
          this.pendingDrops.set(container.id, left);
          if (left === 0 && this.popWaiting.has(container.id)) {
            this.runViewPop(container.id);
          }
        },
      }
    );

    // Logic settles immediately; the view catches up.
    if (this.board.leader(q) === container && this.board.isPoppable(container)) {
      this.board.popLeader(q);
      this.popWaiting.set(container.id, q);
    }
    this.checkDeadlock();
  }

  // ---- pops ------------------------------------------------------------

  private runViewPop(containerId: number): void {
    const q = this.popWaiting.get(containerId);
    this.popWaiting.delete(containerId);
    const view = this.viewById.get(containerId);
    if (q === undefined || !view) return;

    const type = (view.layerMeshes[0]?.userData.type as number) ?? 0;
    this.bursts.push(new PopBurst(this.scene, view.center(), PALETTE[type % PALETTE.length]));
    this.shake = 0.3;

    // Scale-punch out, then remove and let the queue advance upward.
    const g = view.group;
    const baseScale = g.scale.x;
    this.tweens.add(
      0.16,
      (k) => g.scale.setScalar(baseScale * (1 + 0.25 * Math.sin(k * Math.PI) - k)),
      {
        done: () => {
          view.dispose();
          this.viewById.delete(containerId);
          const arr = this.queueViews[q];
          const at = arr.indexOf(view);
          if (at >= 0) arr.splice(at, 1);
          arr.forEach((v, i) => {
            if (this.relocating.has(v.id)) return;
            const fromY = v.group.position.y;
            const toY = this.settledGroupY(i);
            this.tweens.add(0.3, (k) => {
              v.group.position.y = fromY + (toY - fromY) * k;
            }, { ease: easeOutCubic, delay: 0.05 });
          });
        },
      }
    );

    this.hud.setSmashed(this.board.destroyed);

    if (this.board.won) {
      this.over = true;
      this.tweens.add(0.01, () => {}, { delay: 0.8, done: () => this.hud.showWin() });
    } else {
      this.refillEmptyQueues();
      this.checkDeadlock();
    }
  }

  /** Soft-lock prevention: emptied queues borrow the bottom container of the fullest queue. */
  private refillEmptyQueues(): void {
    for (let q = 0; q < this.queueCount; q++) {
      if (this.board.queues[q].containers.length > 0) continue;
      const moved = this.board.relocateBottomContainer(q);
      if (!moved) continue;
      const view = this.viewById.get(moved.container.id);
      if (!view) continue;
      const src = this.queueViews[moved.fromQ];
      const at = src.indexOf(view);
      if (at >= 0) src.splice(at, 1);
      this.queueViews[q].push(view);
      const from = view.group.position.clone();
      const to = new THREE.Vector3(queueX(q, this.queueCount), this.settledGroupY(0), 0);
      this.relocating.add(view.id);
      this.tweens.add(
        0.5,
        (k) => {
          view.group.position.lerpVectors(from, to, k);
          view.group.position.z = Math.sin(k * Math.PI) * 0.9; // lift in front of the wall
        },
        {
          ease: easeInOutCubic,
          delay: 0.25,
          done: () => {
            view.group.position.copy(to);
            this.relocating.delete(view.id);
          },
        }
      );
    }
  }

  // ---- lose ------------------------------------------------------------

  private checkDeadlock(): void {
    if (this.over) return;
    if (this.belt.length < this.beltCapacity) return;
    if (this.belt.some((it) => this.board.anyAccept(it.type))) return;
    this.over = true;
    this.tweens.add(0.01, () => {}, { delay: 0.6, done: () => this.hud.showLose() });
  }

  // ---- frame loop --------------------------------------------------------

  private tick = () => {
    this.rafId = requestAnimationFrame(this.tick);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.tweens.update(dt);
    this.updateBelt(dt);
    this.bursts = this.bursts.filter((b) => {
      const alive = b.update(dt);
      if (!alive) b.dispose();
      return alive;
    });
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.12;
      this.camera.position.set(
        this.camBase.x + (Math.random() - 0.5) * a,
        this.camBase.y + (Math.random() - 0.5) * a,
        this.camBase.z
      );
    } else {
      this.camera.position.copy(this.camBase);
    }
    this.renderer.render(this.scene, this.camera);
  };

  // ---- sizing ------------------------------------------------------------

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
      ...this.opts.level.queues.map((f) => Math.ceil(f.length / this.capacity))
    );
    const width = this.queueCount * QUEUE_PITCH + 1.1;
    const top = CONVEYOR_Y + 0.9;
    const bottom = TOP_Y - maxContainers * containerPitch(this.capacity) - 0.2;
    const height = top - bottom;
    const cy = (top + bottom) / 2;
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const d = Math.max(height / (2 * Math.tan(fovV / 2)), width / (2 * Math.tan(fovH / 2)));
    this.camBase.set(0, cy, d + 1.2);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, cy, 0);
  }

  // ---- teardown ------------------------------------------------------------

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver.disconnect();
    this.tweens.clear();
    for (const views of this.queueViews) for (const v of [...views]) v.dispose();
    this.queueViews = [];
    this.viewById.clear();
    for (const item of this.belt) disposeMesh(item.mesh);
    this.belt = [];
    for (const b of this.bursts) b.dispose();
    this.bursts = [];
    this.conveyor.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
