/** Shared world-layout constants for the wall + conveyor (game and editor preview). */

export const LAYER_W = 0.86;
export const LAYER_H = 0.2;
export const LAYER_D = 0.55;

/** Horizontal distance between queue centers. */
export const QUEUE_PITCH = 1.0;

/** Vertical gap between containers (separator slab lives here). */
export const SEP_GAP = 0.3;

/** World y of the top edge of every leader container. */
export const TOP_Y = 0;

/** World y layers ride at on the conveyor. */
export const CONVEYOR_Y = TOP_Y + 0.72;

export function containerHeight(capacity: number): number {
  return capacity * LAYER_H;
}

/** Vertical distance between the tops of two stacked containers. */
export function containerPitch(capacity: number): number {
  return containerHeight(capacity) + SEP_GAP;
}

/** Center x of queue q out of queueCount queues. */
export function queueX(q: number, queueCount: number): number {
  return (q - (queueCount - 1) / 2) * QUEUE_PITCH;
}

/** Top-edge y of the container at depth i (0 = leader). */
export function containerTopY(i: number, capacity: number): number {
  return TOP_Y - i * containerPitch(capacity);
}

/** y of layer slot j (bottom-to-top) relative to the container group origin (bottom center). */
export function layerLocalY(j: number): number {
  return (j + 0.5) * LAYER_H;
}

/** Slice a flat bottom-to-top queue into containers of `capacity` (bottom slice first). */
export function sliceQueue(flat: number[], capacity: number): number[][] {
  const out: number[][] = [];
  for (let s = 0; s < flat.length; s += capacity) out.push(flat.slice(s, s + capacity));
  return out;
}
