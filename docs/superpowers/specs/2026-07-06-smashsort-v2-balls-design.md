# SmashSort v2 — Balls & Charges (2026-07-06)

Major iteration replacing container logic with charged balls.

## Rules

- Columns are plain layer stacks (no containers, unlimited height). Leader group = top
  same-color run. Tap to eject to the conveyor (unchanged: rightward wrap loop, partial
  ejects, per-level belt capacity, no re-entry into the source column until wrap).
- A belt layer drops onto the first crossed column whose top color matches (empty column
  accepts any color).
- **Ball queues** sit above the conveyor. Each ball has a color; all balls share one
  **charge** (per level, default 8). Front ball of each queue = leader.
- **Smash**: when a column's top group reaches >= charge and some queue's leader ball
  matches its color, that ball (leftmost matching queue) dives in and destroys exactly
  `charge` layers; the ball is consumed and its queue advances. Remainders stay
  (10 - 8 = 2). Chains run automatically. Qualifying groups with no matching leader ball
  wait (still tappable). Buried >= charge groups smash when they become the top group.
  Smash-settle also runs at level start.
- **Win**: all balls consumed (zero-sum: per color, layers = balls x charge).
  **Lose**: belt full and no layer can land (auto-detected).
- Removed from v1: containers, capacity multiples, empty-queue refill rule.

## Level JSON v2

```json
{ "id", "name", "charge": 8, "conveyorCapacity": 8, "minGroup": 2,
  "ballQueues": [[2,0],[1]],        // per queue, leader first
  "columns": [[0,0,2,2],[2,2,0,0]]  // per column, bottom-to-top
}
```

## Editor — 3 steps

1. **Setup**: name, colors, group count (1 group = 1 ball + charge layers; balls split
   round-robin across colors), charge, columns, ball queues, belt capacity, min layers
   per group (distribution constraint; setup warns when infeasible).
2. **Balls**: distribute balls into queues; tap-select + tap-place editing of each
   queue's order (DOM dot rows).
3. **Layers**: distribute derived layers into columns in runs of [min, charge-1]
   avoiding start-smashes; group/layer drag fine-tuning. Pool is preserved by drags, so
   exports are always valid; start-smash/waiting groups produce warnings only.

Old v1 levels removed (git history keeps them).
