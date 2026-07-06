import * as THREE from 'three';
import type { LevelData } from '../shared/types';
import { SETTINGS } from '../shared/settings';
import { PALETTE } from '../shared/colors';
import { Board, Smash } from './Board';
import {
  ColumnView,
  BallQueueView,
  PopBurst,
  disposeMesh,
  makeConveyor,
} from './WallView';
import { Tweens, easeOutCubic, easeInOutCubic } from './Tween';
import { Hud } from './Hud';
import {
  BASE_Y,
  LAYER_H,
  QUEUE_PITCH,
  ballsYFor,
  conveyorYFor,
  layerY,
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
  /**
   * Until the layer wraps, it can only land in columns strictly to the right of
   * this index (its source column). Trailing layers spawn behind the source, so
   * columns at or before it must not pull them. Null once wrapped = all open.
   */
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
  private columnViews: ColumnView[] = [];
  private ballQueueViews: BallQueueView[] = [];
  private belt: BeltItem[] = [];
  private pendingDrops: number[] = []; // per column, in-flight drop meshes
  private smashQueue: Smash[] = [];
  private smashRunning = false;
  private smashLocked = new Set<number>(); // columns awaiting a smash animation
  private bursts: PopBurst[] = [];
  private conveyor: { group: THREE.Group; dispose(): void };
  private hud: Hud;

  private over = false;
  private shake = 0;
  private camBase = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private beltMaxX = 0;
  private beltSpan = 0;
  private columnCount: number;
  private beltCapacity: number;
  private conveyorY: number;
  private ballsY: number;

  private onPointerDown = (e: PointerEvent) => this.handleTap(e);

  constructor(private parent: HTMLElement, private opts: GameAppOptions) {
    this.board = new Board(opts.level);
    this.columnCount = opts.level.columns.length;
    this.beltCapacity = opts.level.conveyorCapacity ?? SETTINGS.conveyorCapacity;
    const tallest = Math.max(1, ...opts.level.columns.map((c) => c.length));
    this.conveyorY = conveyorYFor(tallest, opts.level.charge);
    this.ballsY = ballsYFor(this.conveyorY);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xe9ebf1);
    parent.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(2, 5, 7);
    this.scene.add(dir);

    // Columns
    for (let c = 0; c < this.columnCount; c++) {
      const view = new ColumnView();
      view.group.position.set(queueX(c, this.columnCount), BASE_Y, 0);
      this.board.columns[c].forEach((t, j) => view.addLayer(t, j));
      this.scene.add(view.group);
      this.columnViews.push(view);
      this.pendingDrops.push(0);
    }

    // Conveyor
    this.beltSpan = this.columnCount * QUEUE_PITCH + 2.6;
    this.beltMaxX = this.beltSpan / 2;
    this.conveyor = makeConveyor(this.beltSpan);
    this.conveyor.group.position.y = this.conveyorY;
    this.scene.add(this.conveyor.group);

    // Ball queues
    const qn = this.board.ballQueues.length;
    for (let q = 0; q < qn; q++) {
      this.ballQueueViews.push(
        new BallQueueView(this.scene, this.board.ballQueues[q], queueX(q, qn), this.ballsY)
      );
    }

    this.hud = new Hud(parent, {
      levelName: opts.level.name,
      totalBalls: this.board.totalBalls,
      conveyorCapacity: this.beltCapacity,
      onMenu: opts.onMenu,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
    });

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(parent);
    this.handleResize();
    this.camBase.copy(this.camTarget);

    // Levels may start with smashable groups — settle them up front.
    this.tweens.add(0.01, () => {}, { delay: 0.4, done: () => this.settleSmashes() });

    this.rafId = requestAnimationFrame(this.tick);
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

    for (let c = 0; c < this.columnCount; c++) {
      const view = this.columnViews[c];
      const hits = ray.intersectObjects(view.layerMeshes, false);
      if (hits.length === 0) continue;
      if (this.smashLocked.has(c)) return; // a ball is already inbound
      const group = this.board.topGroup(c);
      if (!group) return;
      const idx = view.layerMeshes.indexOf(hits[0].object as THREE.Mesh);
      if (idx < this.board.columns[c].length - group.count) {
        this.shakeDeny(view, c); // tapped below the top group
        return;
      }
      const n = Math.min(group.count, this.beltCapacity - this.belt.length);
      if (n <= 0) {
        this.shakeDeny(view, c); // belt is full
        return;
      }
      this.eject(c, n);
      return;
    }
  }

  private shakeDeny(view: ColumnView, c: number): void {
    const bx = queueX(c, this.columnCount);
    this.tweens.add(0.3, (k) => {
      view.group.position.x = bx + Math.sin(k * Math.PI * 4) * (1 - k) * 0.06;
    });
  }

  private eject(c: number, n: number): void {
    const removed = this.board.eject(c, n);
    if (!removed) return;
    const meshes = this.columnViews[c].detachTop(removed.count, this.scene);
    const cx = queueX(c, this.columnCount);
    meshes.forEach((mesh, i) => {
      const item: BeltItem = {
        mesh,
        type: removed.type,
        x: cx - i * 0.36,
        riding: false,
        block: c,
      };
      this.belt.push(item);
      const y0 = mesh.position.y;
      this.tweens.add(
        0.26,
        (k) => {
          mesh.position.x = item.x;
          mesh.position.y = y0 + (this.conveyorY - y0) * k + Math.sin(k * Math.PI) * 0.3;
        },
        {
          ease: easeInOutCubic,
          delay: i * 0.04,
          done: () => {
            mesh.position.y = this.conveyorY;
            item.riding = true;
          },
        }
      );
    });
    this.hud.setBelt(this.belt.length, this.belt.length >= this.beltCapacity);
    this.settleSmashes(); // ejecting may expose a buried >= charge group
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
        item.block = null; // a full loop re-opens the source column
      }
      for (let c = 0; c < this.columnCount; c++) {
        const cx = queueX(c, this.columnCount);
        const crossed = wrapped ? cx > prev || cx <= item.x : cx > prev && cx <= item.x;
        const open = item.block === null || c > item.block;
        if (crossed && open && this.board.canAccept(c, item.type)) {
          dropped.push(item);
          this.drop(item, c);
          break;
        }
      }
      if (!dropped.includes(item)) {
        item.mesh.position.x = item.x;
        item.mesh.position.y = this.conveyorY;
      }
    }
    if (dropped.length) {
      this.belt = this.belt.filter((it) => !dropped.includes(it));
      this.hud.setBelt(this.belt.length, this.belt.length >= this.beltCapacity);
    }
  }

  private drop(item: BeltItem, c: number): void {
    const index = this.board.accept(c, item.type);
    const target = new THREE.Vector3(queueX(c, this.columnCount), layerY(index), 0);
    const start = item.mesh.position.clone();
    start.x = item.x;
    this.pendingDrops[c]++;

    this.tweens.add(
      0.3,
      (k) => {
        item.mesh.position.lerpVectors(start, target, k);
        item.mesh.position.y += Math.sin(k * Math.PI) * 0.22;
      },
      {
        ease: easeInOutCubic,
        done: () => {
          this.columnViews[c].attachAt(item.mesh, index);
          this.pendingDrops[c]--;
          this.processSmashQueue();
        },
      }
    );

    this.settleSmashes(); // logic settles immediately; the view catches up
    this.checkDeadlock();
  }

  // ---- smashes ------------------------------------------------------------

  /** Run all available smashes in logic; queue their animations. */
  private settleSmashes(): void {
    let s = this.board.findSmash();
    while (s) {
      this.board.smash(s);
      this.smashQueue.push(s);
      this.smashLocked.add(s.col);
      s = this.board.findSmash();
    }
    this.processSmashQueue();
  }

  private processSmashQueue(): void {
    if (this.smashRunning || this.smashQueue.length === 0) return;
    const task = this.smashQueue[0];
    if (this.pendingDrops[task.col] > 0) return; // wait for in-flight layers to land
    this.smashQueue.shift();
    this.smashRunning = true;

    const view = this.columnViews[task.col];
    const ball = this.ballQueueViews[task.queue].takeLeader();
    const target = view.topGroupCenter(this.board.charge);
    const start = ball ? ball.position.clone() : target.clone();

    this.tweens.add(
      0.38,
      (k) => {
        if (!ball) return;
        ball.position.lerpVectors(start, target, k);
        ball.position.z += Math.sin(k * Math.PI) * 1.1; // arc out in front
        ball.scale.setScalar(1 + k * 0.3);
      },
      {
        ease: easeInOutCubic,
        done: () => {
          this.bursts.push(
            new PopBurst(this.scene, target, PALETTE[task.type % PALETTE.length])
          );
          this.shake = 0.3;
          for (const m of view.detachTop(this.board.charge, this.scene)) disposeMesh(m);
          if (ball) disposeMesh(ball);
          // Queue advances: remaining balls roll forward.
          const qv = this.ballQueueViews[task.queue];
          qv.ballMeshes.forEach((m, i) => {
            const from = m.position.clone();
            const fromScale = m.scale.x;
            const to = qv.slot(i);
            this.tweens.add(0.25, (k) => {
              m.position.lerpVectors(from, to.pos, k);
              m.scale.setScalar(fromScale + (to.scale - fromScale) * k);
            }, { ease: easeOutCubic });
          });
          this.hud.setSmashed(this.board.consumed);
          this.smashRunning = false;
          if (!this.smashQueue.some((t) => t.col === task.col)) {
            this.smashLocked.delete(task.col);
          }
          if (this.board.won) {
            this.over = true;
            this.tweens.add(0.01, () => {}, { delay: 0.8, done: () => this.hud.showWin() });
          } else {
            this.processSmashQueue();
            this.checkDeadlock();
          }
        },
      }
    );
  }

  // ---- lose ------------------------------------------------------------

  private checkDeadlock(): void {
    if (this.over) return;
    if (this.smashQueue.length > 0 || this.smashRunning) return;
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
    // Smooth camera refit toward the current target (stacks can grow).
    this.fitCamera();
    this.camBase.lerp(this.camTarget, Math.min(1, dt * 4));
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
    this.camera.lookAt(this.camLook);
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
    this.camBase.copy(this.camTarget);
    this.camera.updateProjectionMatrix();
  }

  private fitCamera(): void {
    const tallest = Math.max(1, ...this.board.columns.map((c) => c.length));
    const maxQueue = Math.max(1, ...this.board.ballQueues.map((q) => q.length));
    const width = this.columnCount * QUEUE_PITCH + 1.1;
    const top = Math.max(
      this.ballsY + maxQueue * BallQueueView.SPACING + 0.4,
      BASE_Y + tallest * LAYER_H + 0.6
    );
    const bottom = BASE_Y - 0.5;
    const height = top - bottom;
    const cy = (top + bottom) / 2;
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const d = Math.max(height / (2 * Math.tan(fovV / 2)), width / (2 * Math.tan(fovH / 2)));
    this.camTarget.set(0, cy, d + 1.4);
    this.camLook.set(0, cy, 0);
  }

  // ---- teardown ------------------------------------------------------------

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver.disconnect();
    this.tweens.clear();
    for (const v of this.columnViews) v.dispose();
    this.columnViews = [];
    for (const q of this.ballQueueViews) q.dispose();
    this.ballQueueViews = [];
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
