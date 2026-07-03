export interface HudOptions {
  levelName: string;
  totalContainers: number;
  conveyorCapacity: number;
  onMenu(): void;
  onRestart(): void;
  onNext?: () => void;
}

/** HTML overlay above the canvas: top bar, counters, win/lose modals. */
export class Hud {
  private root: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;
  private smashedEl: HTMLElement;
  private beltEl: HTMLElement;

  constructor(private parent: HTMLElement, private opts: HudOptions) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="hud-top">
        <button class="btn ghost small" data-act="menu">← Levels</button>
        <div class="hud-title">${escapeHtml(opts.levelName)}</div>
        <button class="btn ghost small" data-act="restart">↻</button>
      </div>
      <div class="hud-counters">
        <span class="hud-pill">💥 <strong data-el="smashed">0</strong>/${opts.totalContainers}</span>
        <span class="hud-pill">Belt <strong data-el="belt">0</strong>/${opts.conveyorCapacity}</span>
      </div>`;
    parent.appendChild(this.root);
    this.smashedEl = this.root.querySelector('[data-el="smashed"]')!;
    this.beltEl = this.root.querySelector('[data-el="belt"]')!;
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', () => opts.onMenu());
    this.root
      .querySelector('[data-act="restart"]')!
      .addEventListener('click', () => opts.onRestart());
  }

  setSmashed(n: number): void {
    this.smashedEl.textContent = String(n);
  }

  setBelt(n: number, full: boolean): void {
    this.beltEl.textContent = String(n);
    this.beltEl.parentElement!.classList.toggle('warn', full);
  }

  showWin(): void {
    this.showModal(
      'win',
      'Smashed!',
      'Every container destroyed. Nice sorting.',
      this.opts.onNext
        ? [
            { label: 'Next Level', cls: 'btn', act: this.opts.onNext },
            { label: 'Menu', cls: 'btn ghost', act: this.opts.onMenu },
          ]
        : [{ label: 'Menu', cls: 'btn', act: this.opts.onMenu }]
    );
  }

  showLose(): void {
    this.showModal('lose', 'Jammed!', 'The belt is full and nothing can land.', [
      { label: 'Retry', cls: 'btn', act: this.opts.onRestart },
      { label: 'Menu', cls: 'btn ghost', act: this.opts.onMenu },
    ]);
  }

  private showModal(
    kind: 'win' | 'lose',
    title: string,
    sub: string,
    actions: { label: string; cls: string; act(): void }[]
  ): void {
    if (this.modalEl) return;
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal';
    const card = document.createElement('div');
    card.className = `modal-card endgame ${kind}`;
    card.innerHTML = `<h1>${title}</h1><p>${sub}</p>`;
    const row = document.createElement('div');
    row.className = 'modal-actions';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = a.cls;
      b.textContent = a.label;
      b.addEventListener('click', () => a.act());
      row.appendChild(b);
    }
    card.appendChild(row);
    this.modalEl.appendChild(card);
    this.parent.appendChild(this.modalEl);
  }

  dispose(): void {
    this.modalEl?.remove();
    this.modalEl = null;
    this.root.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
