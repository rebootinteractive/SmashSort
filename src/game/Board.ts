import type { LevelData, LayerType } from '../shared/types';
import { sliceQueue } from './layout';

let nextContainerId = 1;

export interface ContainerState {
  id: number;
  capacity: number;
  /** Bottom-to-top. Free space is above the last element. */
  layers: LayerType[];
}

export interface QueueState {
  /** Index 0 = leader (topmost, adjacent to the conveyor). */
  containers: ContainerState[];
}

export interface TopGroup {
  type: LayerType;
  count: number;
}

/** Pure game state + rules. No three.js, no DOM — the views mirror this. */
export class Board {
  readonly queues: QueueState[];
  readonly capacity: number;
  readonly totalContainers: number;
  destroyed = 0;

  constructor(level: LevelData) {
    this.capacity = level.capacity;
    this.queues = level.queues.map((flat) => {
      const slices = sliceQueue(flat, level.capacity);
      slices.reverse(); // topmost slice becomes index 0 (the leader)
      return {
        containers: slices.map((layers) => ({
          id: nextContainerId++,
          capacity: level.capacity,
          layers: [...layers],
        })),
      };
    });
    this.totalContainers = this.queues.reduce((n, q) => n + q.containers.length, 0);
  }

  leader(q: number): ContainerState | undefined {
    return this.queues[q].containers[0];
  }

  /** Top contiguous same-type run of a container, or null when empty. */
  topGroup(c: ContainerState): TopGroup | null {
    if (c.layers.length === 0) return null;
    const type = c.layers[c.layers.length - 1];
    let count = 0;
    for (let i = c.layers.length - 1; i >= 0 && c.layers[i] === type; i--) count++;
    return { type, count };
  }

  /**
   * Remove up to maxCount layers of the leader's top group (partial eject).
   * Returns what was actually removed, or null when nothing could be.
   */
  eject(q: number, maxCount: number): TopGroup | null {
    const leader = this.leader(q);
    if (!leader) return null;
    const group = this.topGroup(leader);
    if (!group || maxCount <= 0) return null;
    const count = Math.min(group.count, maxCount);
    leader.layers.length -= count;
    return { type: group.type, count };
  }

  /** Can a layer of `type` enter queue q's leader right now? */
  canAccept(q: number, type: LayerType): boolean {
    const leader = this.leader(q);
    if (!leader || leader.layers.length >= leader.capacity) return false;
    if (leader.layers.length === 0) return true; // empty container accepts any color
    return leader.layers[leader.layers.length - 1] === type;
  }

  /** Push a layer into queue q's leader. Returns the container and the slot index used. */
  accept(q: number, type: LayerType): { container: ContainerState; index: number } {
    const leader = this.leader(q)!;
    leader.layers.push(type);
    return { container: leader, index: leader.layers.length - 1 };
  }

  isPoppable(c: ContainerState): boolean {
    return (
      c.layers.length === c.capacity && c.layers.every((t) => t === c.layers[0])
    );
  }

  /** Remove the leader of queue q (it popped). The queue advances. */
  popLeader(q: number): ContainerState {
    const popped = this.queues[q].containers.shift()!;
    this.destroyed++;
    return popped;
  }

  get won(): boolean {
    return this.destroyed >= this.totalContainers;
  }

  /**
   * Soft-lock prevention: refill an emptied queue by moving the bottom
   * (never the leader) container from the most crowded queue. Ties break
   * toward more total layers. Returns null when no queue can donate.
   */
  relocateBottomContainer(toQ: number): { container: ContainerState; fromQ: number } | null {
    if (this.queues[toQ].containers.length > 0) return null;
    const layerCount = (q: number) =>
      this.queues[q].containers.reduce((n, c) => n + c.layers.length, 0);
    let best = -1;
    for (let q = 0; q < this.queues.length; q++) {
      if (q === toQ || this.queues[q].containers.length < 2) continue;
      if (
        best < 0 ||
        this.queues[q].containers.length > this.queues[best].containers.length ||
        (this.queues[q].containers.length === this.queues[best].containers.length &&
          layerCount(q) > layerCount(best))
      ) {
        best = q;
      }
    }
    if (best < 0) return null;
    const container = this.queues[best].containers.pop()!;
    this.queues[toQ].containers.push(container);
    return { container, fromQ: best };
  }

  /** True when some queue can accept a layer of this type. */
  anyAccept(type: LayerType): boolean {
    for (let q = 0; q < this.queues.length; q++) {
      if (this.canAccept(q, type)) return true;
    }
    return false;
  }
}
