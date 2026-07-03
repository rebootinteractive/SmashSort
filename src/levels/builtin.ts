import type { LevelData } from '../shared/types';
import { generateQueues, mulberry32 } from '../shared/generate';

// Tutorial-trivial: two taps to win.
// Queue arrays are bottom-to-top; each queue here is one container of 4.
const level1: LevelData = {
  id: 'l1-first-smash',
  name: 'First Smash',
  capacity: 4,
  queues: [
    [0, 0, 2, 2], // yellow yellow | red red (top)
    [2, 2, 0, 0], // red red | yellow yellow (top)
  ],
};

const level2: LevelData = {
  id: 'l2-warm-up',
  name: 'Warm Up',
  capacity: 6,
  queues: generateQueues(
    { typeCount: 3, groupCount: 6, capacity: 6, queueCount: 3 },
    mulberry32(42)
  ),
};

// Approximates the mockup: 7 queues, 3 full containers each, 4 colors.
const level3: LevelData = {
  id: 'l3-the-wall',
  name: 'The Wall',
  capacity: 10,
  queues: generateQueues(
    { typeCount: 4, groupCount: 21, capacity: 10, queueCount: 7 },
    mulberry32(7)
  ),
};

export const BUILTIN_LEVELS: LevelData[] = [level1, level2, level3];
