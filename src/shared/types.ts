/** A layer's type is an index into the PALETTE (shared/colors.ts). */
export type LayerType = number;

export interface LevelData {
  id: string;
  name: string;
  /** Layers per container. Every container starts exactly full. */
  capacity: number;
  /**
   * One entry per queue (left to right). Each queue is a flat list of layer
   * types ordered bottom-to-top; containers are auto-sliced every `capacity`
   * layers from the bottom. The topmost slice is the leader container.
   */
  queues: LayerType[][];
}

/** Count of containers in a level. */
export function containerCount(level: LevelData): number {
  return level.queues.reduce((n, q) => n + Math.ceil(q.length / level.capacity), 0);
}

/** Distinct layer types used by a level. */
export function typeCount(level: LevelData): number {
  const s = new Set<number>();
  for (const q of level.queues) for (const t of q) s.add(t);
  return s.size;
}
