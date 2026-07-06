import type { LevelData } from '../shared/types';
import { generateBallQueues, generateColumns, mulberry32 } from '../shared/generate';

// Tutorial-trivial: two taps, teaches eject, waiting groups, smash, queue advance.
// One ball queue [red, yellow]; columns are bottom-to-top.
const level1: LevelData = {
  id: 'l1-first-smash',
  name: 'First Smash',
  charge: 4,
  conveyorCapacity: 8,
  ballQueues: [[2, 0]],
  columns: [
    [0, 0, 2, 2], // yellow yellow | red red (top)
    [2, 2, 0, 0], // red red | yellow yellow (top)
  ],
};

const p2 = { typeCount: 3, groupCount: 6, charge: 6, columnCount: 3, queueCount: 2, minGroup: 2 };
const r2 = mulberry32(11);
const level2: LevelData = {
  id: 'l2-charge-up',
  name: 'Charge Up',
  charge: p2.charge,
  conveyorCapacity: 8,
  minGroup: p2.minGroup,
  ballQueues: generateBallQueues(p2, r2),
  columns: generateColumns(p2, r2),
};

const p3 = { typeCount: 4, groupCount: 12, charge: 8, columnCount: 5, queueCount: 2, minGroup: 2 };
const r3 = mulberry32(7);
const level3: LevelData = {
  id: 'l3-ball-wall',
  name: 'Ball Wall',
  charge: p3.charge,
  conveyorCapacity: 10,
  minGroup: p3.minGroup,
  ballQueues: generateBallQueues(p3, r3),
  columns: generateColumns(p3, r3),
};

export const BUILTIN_LEVELS: LevelData[] = [level1, level2, level3];
