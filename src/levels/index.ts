import type { LevelData } from '../shared/types';
import { BUILTIN_LEVELS } from './builtin';

const contributedModules = import.meta.glob<LevelData>('./contributed/*.json', {
  eager: true,
  import: 'default',
});
const contributed: LevelData[] = Object.values(contributedModules).sort((a, b) =>
  a.name.localeCompare(b.name)
);

export const ALL_LEVELS: LevelData[] = [...BUILTIN_LEVELS, ...contributed];
export { BUILTIN_LEVELS };
