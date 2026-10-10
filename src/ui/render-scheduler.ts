/** Presentation cadence only. No simulation clock, state snapshot or queued work. */
export class RenderScheduler {
  private lastPaint: number | null = null;
  private lastTab: string | null = null;
  private dirty = true;

  invalidate(): void { this.dirty = true; }

  reset(): void {
    this.lastPaint = null;
    this.lastTab = null;
    this.dirty = true;
  }

  shouldPaint(now: number, input: { hidden: boolean; ready: boolean; visibleTab: string }): boolean {
    if (input.visibleTab !== this.lastTab) this.dirty = true;
    if (input.hidden || !Number.isFinite(now) || now < 0) return false;
    if (this.dirty) return true;
    if (!input.ready) return false;
    // The original ring's attract/reveal animation lives in view.update().
    if (input.visibleTab === "arcade") return true;
    return this.lastPaint === null || now - this.lastPaint >= 100 - 1e-7;
  }

  didPaint(now: number, visibleTab: string): void {
    this.lastPaint = now;
    this.lastTab = visibleTab;
    this.dirty = false;
  }
}
