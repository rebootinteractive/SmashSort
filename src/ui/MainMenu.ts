import type { LevelData } from '../shared/types';
import { totalBalls, typeCount } from '../shared/types';
import { ALL_LEVELS } from '../levels';
import { loadCustomLevels, deleteCustomLevel } from './storage';

export interface MainMenuOptions {
  onPlay(level: LevelData): void;
  onEdit(level: LevelData): void;
  onCreate(): void;
}

export class MainMenu {
  private root: HTMLDivElement;

  constructor(parent: HTMLElement, private opts: MainMenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    parent.appendChild(this.root);
    this.render();
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="menu-title">SmashSort</div>
      <div class="menu-sub">Stack up a charge. Feed the balls. Smash the wall.</div>
      <div class="menu-section-label">Levels</div>
      <div class="level-list" data-el="levels"></div>
      <div class="menu-section-label" data-el="custom-label"></div>
      <div class="level-list" data-el="custom"></div>
      <div class="menu-footer">
        <button class="btn" style="width:100%" data-act="create">+ Create New Level</button>
      </div>`;

    const levelsEl = this.root.querySelector('[data-el="levels"]')!;
    for (const level of ALL_LEVELS) levelsEl.appendChild(this.card(level, false));

    const customs = loadCustomLevels();
    const label = this.root.querySelector('[data-el="custom-label"]') as HTMLElement;
    const customEl = this.root.querySelector('[data-el="custom"]') as HTMLElement;
    label.textContent = `Your Levels (${customs.length})`;
    if (customs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'menu-sub';
      empty.textContent = 'No custom levels yet — create one in the editor.';
      customEl.appendChild(empty);
    } else {
      for (const level of customs) customEl.appendChild(this.card(level, true));
    }

    this.root
      .querySelector('[data-act="create"]')!
      .addEventListener('click', () => this.opts.onCreate());
  }

  private card(level: LevelData, custom: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = 'level-card';
    const meta = `${level.columns.length} columns · ${totalBalls(level)} balls · ${typeCount(level)} colors`;
    el.innerHTML = `
      <div>
        <div class="name"></div>
        <div class="meta">${meta}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center"></div>`;
    (el.querySelector('.name') as HTMLElement).textContent = level.name;
    const right = el.querySelector('div:last-child') as HTMLElement;
    if (custom) {
      const edit = document.createElement('button');
      edit.className = 'btn ghost small';
      edit.textContent = '✎';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        this.opts.onEdit(level);
      });
      const del = document.createElement('button');
      del.className = 'delete';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCustomLevel(level.id);
        this.render();
      });
      right.append(edit, del);
    } else {
      const dup = document.createElement('button');
      dup.className = 'btn ghost small';
      dup.textContent = '⧉';
      dup.title = 'Duplicate & edit';
      dup.addEventListener('click', (e) => {
        e.stopPropagation();
        this.opts.onEdit({
          ...level,
          id: `custom-${Date.now()}`,
          name: `${level.name} Copy`,
          ballQueues: level.ballQueues.map((q) => [...q]),
          columns: level.columns.map((c) => [...c]),
        });
      });
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'PLAY';
      right.append(dup, badge);
    }
    el.addEventListener('click', () => this.opts.onPlay(level));
    return el;
  }

  dispose(): void {
    this.root.remove();
  }
}
