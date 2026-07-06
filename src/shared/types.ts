/** A layer's / ball's type is an index into the PALETTE (shared/colors.ts). */
export type LayerType = number;

export interface LevelData {
  id: string;
  name: string;
  /** Layers one ball destroys. Zero-sum: per type, layer total = balls x charge. */
  charge: number;
  /** Max layers on the conveyor. Falls back to SETTINGS.conveyorCapacity when absent. */
  conveyorCapacity?: number;
  /** Editor distribution constraint (min layers per group). Persisted for re-editing. */
  minGroup?: number;
  /** One entry per ball queue. Each is the ball colors in order, leader (front) first. */
  ballQueues: LayerType[][];
  /** One entry per column (left to right), layer types bottom-to-top. */
  columns: LayerType[][];
}

export function totalBalls(level: LevelData): number {
  return level.ballQueues.reduce((n, q) => n + q.length, 0);
}

/** Distinct types used by a level (balls + layers). */
export function typeCount(level: LevelData): number {
  const s = new Set<number>();
  for (const q of level.ballQueues) for (const t of q) s.add(t);
  for (const c of level.columns) for (const t of c) s.add(t);
  return s.size;
}
