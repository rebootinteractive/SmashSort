import type { LevelData, LayerType } from '../shared/types';

export interface TopGroup {
  type: LayerType;
  count: number;
}

export interface Smash {
  col: number;
  queue: number;
  type: LayerType;
}

/** Pure game state + rules. No three.js, no DOM — the views mirror this. */
export class Board {
  /** Layer types per column, bottom-to-top. */
  readonly columns: LayerType[][];
  /** Ball types per queue, leader (front) first. */
  readonly ballQueues: LayerType[][];
  readonly charge: number;
  readonly totalBalls: number;
  consumed = 0;

  constructor(level: LevelData) {
    this.charge = level.charge;
    this.columns = level.columns.map((c) => [...c]);
    this.ballQueues = level.ballQueues.map((q) => [...q]);
    this.totalBalls = this.ballQueues.reduce((n, q) => n + q.length, 0);
  }

  /** Top contiguous same-type run of a column, or null when empty. */
  topGroup(col: number): TopGroup | null {
    const c = this.columns[col];
    if (c.length === 0) return null;
    const type = c[c.length - 1];
    let count = 0;
    for (let i = c.length - 1; i >= 0 && c[i] === type; i--) count++;
    return { type, count };
  }

  /**
   * Remove up to maxCount layers of the column's top group (partial eject).
   * Returns what was actually removed, or null when nothing could be.
   */
  eject(col: number, maxCount: number): TopGroup | null {
    const group = this.topGroup(col);
    if (!group || maxCount <= 0) return null;
    const count = Math.min(group.count, maxCount);
    this.columns[col].length -= count;
    return { type: group.type, count };
  }

  /** Can a layer of `type` land on this column? (Empty columns accept any color.) */
  canAccept(col: number, type: LayerType): boolean {
    const c = this.columns[col];
    return c.length === 0 || c[c.length - 1] === type;
  }

  /** Push a layer onto a column. Returns the slot index used. */
  accept(col: number, type: LayerType): number {
    this.columns[col].push(type);
    return this.columns[col].length - 1;
  }

  /**
   * Find the next smash: leftmost column whose top group is >= charge and has a
   * matching leader ball (leftmost matching queue). Null when nothing qualifies.
   */
  findSmash(): Smash | null {
    for (let col = 0; col < this.columns.length; col++) {
      const group = this.topGroup(col);
      if (!group || group.count < this.charge) continue;
      for (let q = 0; q < this.ballQueues.length; q++) {
        if (this.ballQueues[q][0] === group.type) {
          return { col, queue: q, type: group.type };
        }
      }
    }
    return null;
  }

  /** Execute a smash: consume the ball, destroy `charge` layers off the column top. */
  smash(s: Smash): void {
    this.columns[s.col].length -= this.charge;
    this.ballQueues[s.queue].shift();
    this.consumed++;
  }

  get won(): boolean {
    return this.consumed >= this.totalBalls;
  }

  /** True when some column can accept a layer of this type. */
  anyAccept(type: LayerType): boolean {
    for (let col = 0; col < this.columns.length; col++) {
      if (this.canAccept(col, type)) return true;
    }
    return false;
  }
}
