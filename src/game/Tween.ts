export type Ease = (t: number) => number;

export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic: Ease = (t) => t * t * t;
export const easeInOutCubic: Ease = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

interface TweenItem {
  elapsed: number; // negative while delayed
  dur: number;
  ease: Ease;
  update: (k: number) => void;
  done?: () => void;
}

/** Tiny tween runner. All animations in the game go through one instance. */
export class Tweens {
  private items: TweenItem[] = [];

  add(
    dur: number,
    update: (k: number) => void,
    opts: { ease?: Ease; done?: () => void; delay?: number } = {}
  ): void {
    this.items.push({
      elapsed: -(opts.delay ?? 0),
      dur,
      ease: opts.ease ?? easeOutCubic,
      update,
      done: opts.done,
    });
  }

  update(dt: number): void {
    const finished: TweenItem[] = [];
    for (const it of this.items) {
      it.elapsed += dt;
      if (it.elapsed < 0) continue;
      const k = Math.min(1, it.elapsed / it.dur);
      it.update(it.ease(k));
      if (k >= 1) finished.push(it);
    }
    if (finished.length) {
      this.items = this.items.filter((it) => !finished.includes(it));
      for (const it of finished) it.done?.();
    }
  }

  clear(): void {
    this.items = [];
  }
}
