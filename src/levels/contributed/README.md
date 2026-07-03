# Contributed Levels

Designer-authored levels live here. Workflow:

1. Design a level in the in-game editor (`+ Create New Level` from the menu).
2. Hit **↓ Download** — you get a `.json` file.
3. Drop the file into this folder.
4. Commit + push. The deploy workflow rebuilds and the level appears in the
   menu automatically (sorted alphabetically after the built-in levels).

No code changes needed — every `*.json` in this folder is auto-discovered at
build time.
