import type { LevelData } from '../shared/types';

const KEY = 'smashsort:custom-levels';

export function loadCustomLevels(): LevelData[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop stale v1 (container-format) levels — v2 levels have columns + ballQueues.
    return (parsed as LevelData[]).filter(
      (l) => Array.isArray(l.columns) && Array.isArray(l.ballQueues)
    );
  } catch {
    return [];
  }
}

export function saveCustomLevel(level: LevelData): void {
  const all = loadCustomLevels();
  const idx = all.findIndex((l) => l.id === level.id);
  if (idx >= 0) all[idx] = level;
  else all.push(level);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteCustomLevel(id: string): void {
  const all = loadCustomLevels().filter((l) => l.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
}
