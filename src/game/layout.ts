/** Shared world-layout constants for the wall + conveyor + balls (game and editor). */

export const LAYER_W = 0.86;
export const LAYER_H = 0.2;
export const LAYER_D = 0.55;

/** Horizontal distance between column centers. */
export const QUEUE_PITCH = 1.0;

/** World y of every column's floor — stacks grow upward from here. */
export const BASE_Y = 0;

/** Center x of column (or ball queue) q out of `count`. */
export function queueX(q: number, count: number): number {
  return (q - (count - 1) / 2) * QUEUE_PITCH;
}

/** World y of layer slot idx (bottom-to-top). */
export function layerY(idx: number): number {
  return BASE_Y + (idx + 0.5) * LAYER_H;
}

/** Conveyor height for a level: clears the tallest starting stack plus headroom. */
export function conveyorYFor(tallestInitial: number, charge: number): number {
  return BASE_Y + (tallestInitial + Math.min(charge, 8)) * LAYER_H + 0.7;
}

/** Ball queues ride above the conveyor. */
export function ballsYFor(conveyorY: number): number {
  return conveyorY + 0.85;
}
