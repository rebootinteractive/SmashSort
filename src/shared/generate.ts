import type { LayerType } from './types';

export interface GenParams {
  typeCount: number;
  /** A group = one ball + `charge` layers of the same color. */
  groupCount: number;
  charge: number;
  columnCount: number;
  queueCount: number;
  /** Minimum layers per run during layer distribution. */
  minGroup: number;
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

/** Balls distributed round-robin across types: type i gets ballsPerType[i] balls. */
export function ballsPerType(p: GenParams): number[] {
  const out = new Array<number>(p.typeCount).fill(0);
  for (let i = 0; i < p.groupCount; i++) out[i % p.typeCount]++;
  return out;
}

/**
 * Can `total` layers be split into runs of size [min, charge-1]?
 * (Runs must stay under charge so nothing smashes or waits at level start.)
 */
export function runsFeasible(total: number, min: number, charge: number): boolean {
  const maxRun = charge - 1;
  if (total === 0) return true;
  if (min > maxRun) return false;
  return Math.ceil(total / maxRun) <= Math.floor(total / min);
}

/** Split N into random runs within [min, charge-1]. Falls back to min=1 if infeasible. */
function decompose(N: number, min: number, charge: number, rand: () => number): number[] {
  let lo = runsFeasible(N, min, charge) ? min : 1;
  const hi = Math.max(lo, charge - 1);
  const runs: number[] = [];
  let left = N;
  while (left > 0) {
    let r = lo + Math.floor(rand() * (Math.min(hi, left) - lo + 1));
    const rest = left - r;
    if (rest > 0 && rest < lo) {
      // leftover would be too small — take either everything or leave a valid remainder
      r = left <= hi ? left : left - lo;
    }
    runs.push(r);
    left -= r;
  }
  return runs;
}

/** Deal the balls into queues: even partition (remainder random), random order. */
export function generateBallQueues(p: GenParams, rand: () => number): LayerType[][] {
  const balls: LayerType[] = [];
  ballsPerType(p).forEach((n, t) => {
    for (let i = 0; i < n; i++) balls.push(t);
  });
  // Fisher-Yates shuffle
  for (let i = balls.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [balls[i], balls[j]] = [balls[j], balls[i]];
  }
  const queues: LayerType[][] = Array.from({ length: p.queueCount }, () => []);
  balls.forEach((b, i) => queues[i % p.queueCount].push(b));
  return queues;
}

/**
 * Scatter all layers (balls x charge per type) into columns as runs of
 * [minGroup, charge-1], preferring the emptiest column and avoiding same-type
 * adjacency that would merge into a >= charge group at start.
 */
export function generateColumns(p: GenParams, rand: () => number): LayerType[][] {
  const runs: { type: LayerType; len: number }[] = [];
  ballsPerType(p).forEach((n, t) => {
    for (const len of decompose(n * p.charge, p.minGroup, p.charge, rand)) {
      runs.push({ type: t, len });
    }
  });
  for (let i = runs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [runs[i], runs[j]] = [runs[j], runs[i]];
  }

  const columns: LayerType[][] = Array.from({ length: p.columnCount }, () => []);
  const topRun = (c: LayerType[]) => {
    if (c.length === 0) return { type: -1, len: 0 };
    const t = c[c.length - 1];
    let n = 0;
    for (let i = c.length - 1; i >= 0 && c[i] === t; i--) n++;
    return { type: t, len: n };
  };

  for (const run of runs) {
    // Emptiest columns first; skip ones where the merged top group would reach charge.
    const order = columns
      .map((c, i) => ({ i, len: c.length, r: rand() }))
      .sort((a, b) => a.len - b.len || a.r - b.r);
    let placed = false;
    for (const { i } of order) {
      const top = topRun(columns[i]);
      if (top.type === run.type && top.len + run.len >= p.charge) continue;
      for (let k = 0; k < run.len; k++) columns[i].push(run.type);
      placed = true;
      break;
    }
    if (!placed) {
      // Every column tops with this type — drop it on the emptiest anyway.
      const c = columns[order[0].i];
      for (let k = 0; k < run.len; k++) c.push(run.type);
    }
  }
  return columns;
}
