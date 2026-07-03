# SmashSort — Approved Design (2026-07-03)

Conveyor-sorting prototype. References: Car Sort (Rollic), Loop Sort (Voodoo) — mechanics
borrowed: conveyor as moving stage, tap-to-release, color auto-matching into destinations,
congestion as the lose pressure.

## Structure

- **Wall** = several vertical **queues** side by side. Flat (no curve) for this prototype.
- **Queue** = a stack of **containers** separated by gray dividers. Top container = **leader**.
- **Container** = a stack of **layers** (capacity per level, default 10). Layers align from
  the bottom; free space is at the top.
- **Layer** = one colored plate. Color = type.
- **Conveyor** = belt across the top of the wall. Moves rightward, wraps right edge → left edge.
  Carry-only: it never spawns layers.

## Rules

- Player taps any layer in the **top same-color group** of a **leader** container → the whole
  group jumps to the conveyor. **Partial eject**: if the conveyor lacks space, as many layers
  as fit jump; the rest stay.
- A conveyor layer passing over a queue drops into its leader container iff top group matches
  its color (empty container accepts any color) **and** a slot is free. **Partial entry**:
  layers are individuals; leftovers keep looping. First match wins.
- Container completely full of one color → **pops** (smash). Queue advances; next container
  becomes leader. Pop check also runs at level start.
- **Win**: all containers destroyed (HUD shows destroyed/total).
- **Lose**: conveyor at capacity and no circulating layer can enter any leader container —
  auto-detected, fail screen.

## Global settings (src/shared/settings.ts)

- Conveyor capacity (fixed slot count, global — default 8)
- Conveyor speed
- Default container capacity (10; per-level override in editor setup)

## Editor (two steps)

1. **Setup**: type count, group count (a group = exactly one container's worth of layers;
   groups distributed round-robin across types), container capacity, queue count. Solvability
   by construction: total layers = groups × capacity.
2. **Layout**: Distribute button randomly scatters layers into queues (avoiding
   already-poppable containers). Two drag modes: **Group move** (contiguous same-color run)
   and **Layer move** (single layer). Mouse + touch. Containers auto-slice by capacity.
   Export blocked until every queue is a clean multiple of capacity (all containers full).
   Download `.json` → drop into `src/levels/contributed/`.

## Ships in v1

3 starter levels (first tutorial-trivial), level select menu, restart, editor,
GitHub Pages auto-deploy. Portrait 393×852 phone frame.
