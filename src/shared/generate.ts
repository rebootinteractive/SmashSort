import type { LayerType } from './types';

export interface GenParams {
  typeCount: number;
  /** A group = exactly one container's worth of layers. Total containers = groupCount. */
  groupCount: number;
  capacity: number;
  queueCount: number;
}

/** Deterministic PRNG (mulberry32) so built-in levels are stable across builds. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Groups distributed round-robin across types: type i gets groupsPerType[i] containers. */
export function groupsPerType(p: GenParams): number[] {
  const out = new Array<number>(p.typeCount).fill(0);
  for (let i = 0; i < p.groupCount; i++) out[i % p.typeCount]++;
  return out;
}

/**
 * Randomly scatter all layers into queues.
 * - Each queue receives a whole number of containers (every container starts full).
 * - Layers land in short same-color runs so the wall reads like the mockup.
 * - No container starts already-poppable (full monochrome) when typeCount >= 2.
 */
export function generateQueues(p: GenParams, rand: () => number): LayerType[][] {
  // Partition containers among queues (spread evenly, remainder to random queues).
  const perQueue = new Array<number>(p.queueCount).fill(
    Math.floor(p.groupCount / p.queueCount)
  );
  let rem = p.groupCount % p.queueCount;
  while (rem > 0) {
    const q = Math.floor(rand() * p.queueCount);
    perQueue[q]++;
    rem--;
  }

  // Build one long sequence of layers in random short runs, then slice per queue.
  const remaining = groupsPerType(p).map((g) => g * p.capacity);
  let total = remaining.reduce((a, b) => a + b, 0);
  const seq: LayerType[] = [];
  while (total > 0) {
    const avail = remaining
      .map((n, t) => ({ n, t }))
      .filter((e) => e.n > 0);
    const pick = avail[Math.floor(rand() * avail.length)];
    const runLen = Math.min(pick.n, 1 + Math.floor(rand() * Math.min(4, p.capacity - 1)));
    for (let i = 0; i < runLen; i++) seq.push(pick.t);
    remaining[pick.t] -= runLen;
    total -= runLen;
  }

  const queues: LayerType[][] = [];
  let cursor = 0;
  for (let q = 0; q < p.queueCount; q++) {
    const len = perQueue[q] * p.capacity;
    queues.push(seq.slice(cursor, cursor + len));
    cursor += len;
  }

  fixPoppableContainers(queues, p.capacity, rand);
  return queues;
}

/** Swap layers until no container starts full-monochrome. */
export function fixPoppableContainers(
  queues: LayerType[][],
  capacity: number,
  rand: () => number
): void {
  const types = new Set<number>();
  for (const q of queues) for (const t of q) types.add(t);
  if (types.size < 2) return;

  for (let pass = 0; pass < 20; pass++) {
    let fixed = true;
    for (let q = 0; q < queues.length; q++) {
      for (let s = 0; s + capacity <= queues[q].length; s += capacity) {
        const slice = queues[q].slice(s, s + capacity);
        if (!slice.every((t) => t === slice[0])) continue;
        // Monochrome container — swap its top layer with a different-type layer elsewhere.
        fixed = false;
        const swapCandidates: { q: number; i: number }[] = [];
        for (let q2 = 0; q2 < queues.length; q2++) {
          for (let i = 0; i < queues[q2].length; i++) {
            if (queues[q2][i] !== slice[0]) swapCandidates.push({ q: q2, i });
          }
        }
        if (swapCandidates.length === 0) return;
        const c = swapCandidates[Math.floor(rand() * swapCandidates.length)];
        const topIdx = s + capacity - 1;
        const tmp = queues[q][topIdx];
        queues[q][topIdx] = queues[c.q][c.i];
        queues[c.q][c.i] = tmp;
      }
    }
    if (fixed) return;
  }
}
