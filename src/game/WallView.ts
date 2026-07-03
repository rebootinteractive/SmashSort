import * as THREE from 'three';
import { PALETTE } from '../shared/colors';
import {
  LAYER_W,
  LAYER_H,
  LAYER_D,
  containerHeight,
  layerLocalY,
} from './layout';

// Shared, never-mutated geometries — safe as module statics (page-session lifetime).
const layerGeo = new THREE.BoxGeometry(LAYER_W, LAYER_H * 0.9, LAYER_D);
const shardGeo = new THREE.BoxGeometry(0.14, 0.1, 0.14);

const FRAME_COLOR = 0xb4b9c4;
const FRAME_DARK = 0x9599a4;

/** Fresh material per layer — pop/fade animations mutate materials, so no sharing. */
export function makeLayerMesh(type: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE[type % PALETTE.length],
    roughness: 0.45,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(layerGeo, mat);
  mesh.userData.type = type;
  return mesh;
}

export function disposeMesh(mesh: THREE.Mesh): void {
  mesh.parent?.remove(mesh);
  (mesh.material as THREE.Material).dispose();
  // geometry is shared/static — not disposed here
}

/**
 * One container: back panel + separator slab + the layer meshes.
 * Group origin = bottom center of the layer stack.
 */
export class ContainerView {
  readonly group = new THREE.Group();
  readonly layerMeshes: THREE.Mesh[] = [];
  private ownGeos: THREE.BufferGeometry[] = [];
  private ownMats: THREE.Material[] = [];

  constructor(readonly id: number, readonly capacity: number) {
    const capH = containerHeight(capacity);

    const backGeo = new THREE.BoxGeometry(LAYER_W + 0.1, capH + 0.08, 0.08);
    const backMat = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.85 });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.set(0, capH / 2, -LAYER_D / 2 - 0.05);
    this.group.add(back);

    const sepGeo = new THREE.BoxGeometry(LAYER_W + 0.12, 0.16, LAYER_D + 0.1);
    const sepMat = new THREE.MeshStandardMaterial({ color: FRAME_DARK, roughness: 0.8 });
    const sep = new THREE.Mesh(sepGeo, sepMat);
    sep.position.set(0, -0.13, 0);
    this.group.add(sep);

    this.ownGeos.push(backGeo, sepGeo);
    this.ownMats.push(backMat, sepMat);
  }

  /** Attach an existing mesh at slot index (local coordinates). */
  attachAt(mesh: THREE.Mesh, index: number): void {
    this.group.add(mesh);
    mesh.position.set(0, layerLocalY(index), 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(1);
    if (this.layerMeshes.length <= index) this.layerMeshes[index] = mesh;
    else this.layerMeshes.splice(index, 0, mesh);
  }

  /** Create + attach a fresh mesh at slot index. */
  addLayer(type: number, index: number): THREE.Mesh {
    const mesh = makeLayerMesh(type);
    this.attachAt(mesh, index);
    return mesh;
  }

  /**
   * Detach the top n layer meshes, re-parented to `root` with world transforms
   * preserved. Returned top-first (last = deepest).
   */
  detachTop(n: number, root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (let i = 0; i < n && this.layerMeshes.length > 0; i++) {
      const mesh = this.layerMeshes.pop()!;
      const world = new THREE.Vector3();
      mesh.getWorldPosition(world);
      this.group.remove(mesh);
      root.add(mesh);
      mesh.position.copy(world);
      out.push(mesh);
    }
    return out;
  }

  /** World-space center of the layer stack (for bursts). */
  center(): THREE.Vector3 {
    const c = new THREE.Vector3(0, containerHeight(this.capacity) / 2, 0);
    return this.group.localToWorld(c);
  }

  /** World-space position of slot index. */
  slotWorld(index: number): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(0, layerLocalY(index), 0));
  }

  dispose(): void {
    for (const m of [...this.layerMeshes]) disposeMesh(m);
    this.layerMeshes.length = 0;
    for (const g of this.ownGeos) g.dispose();
    for (const m of this.ownMats) m.dispose();
    this.group.parent?.remove(this.group);
  }
}

/** The two conveyor rails spanning the belt. Returns group + dispose. */
export function makeConveyor(span: number): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.055, 0.055, span, 12);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b6fd4, roughness: 0.4 });
  for (const dy of [-0.24, 0.24]) {
    const rail = new THREE.Mesh(geo, mat);
    rail.rotation.z = Math.PI / 2;
    rail.position.y = dy;
    group.add(rail);
  }
  return {
    group,
    dispose() {
      geo.dispose();
      mat.dispose();
      group.parent?.remove(group);
    },
  };
}

interface Shard {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

/** Particle burst for a container smash. One shared (burst-scoped) material, faded out. */
export class PopBurst {
  private shards: Shard[] = [];
  private mat: THREE.MeshStandardMaterial;
  private life = 0;
  private readonly maxLife = 0.75;

  constructor(private scene: THREE.Scene, center: THREE.Vector3, colorHex: number) {
    this.mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.4,
      transparent: true,
    });
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(shardGeo, this.mat);
      mesh.position.copy(center).add(
        new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.8, 0)
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1.5,
        (Math.random() - 0.2) * 3
      );
      const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      scene.add(mesh);
      this.shards.push({ mesh, vel, spin });
    }
  }

  /** Returns false once finished. */
  update(dt: number): boolean {
    this.life += dt;
    const k = this.life / this.maxLife;
    if (k >= 1) return false;
    this.mat.opacity = 1 - k * k;
    for (const s of this.shards) {
      s.vel.y -= 12 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
    }
    return true;
  }

  dispose(): void {
    for (const s of this.shards) this.scene.remove(s.mesh);
    this.mat.dispose();
    this.shards.length = 0;
  }
}
