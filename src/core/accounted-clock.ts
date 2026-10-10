/** Capture the two clocks together, outside this pure bookkeeping helper. */
export type ClockSample = { wallAt: number; frameAt: number };

function safeMilliseconds(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

/**
 * The watermark describes the simulation snapshot, not the last storage write.
 * Keep one paired epoch instead of repeatedly adding fractional frame durations
 * to a large wall timestamp. Reads and saves never consume a simulation gap.
 */
export class AccountedClock {
  private wallAt = 0;
  private frameAt = 0;
  private accountedFrameAt = 0;

  constructor(sample: ClockSample) {
    this.rebase(sample);
  }

  /** Full raw gap; the caller keeps its existing live/catch-up choice and cap. */
  gapSeconds(frameAt: number): number {
    return this.canAccount(frameAt) ? (frameAt - this.accountedFrameAt) / 1000 : 0;
  }

  /** Call only after adopting the resulting state, including a capped catch-up. */
  account(frameAt: number): void {
    if (this.canAccount(frameAt)) this.accountedFrameAt = frameAt;
  }

  /** A successfully adopted replacement starts its own paired epoch. */
  rebase(sample: ClockSample): void {
    if (!safeMilliseconds(sample.wallAt) || !safeMilliseconds(sample.frameAt)) {
      throw new RangeError("Clock samples must be finite, nonnegative safe milliseconds");
    }
    this.wallAt = sample.wallAt;
    this.frameAt = sample.frameAt;
    this.accountedFrameAt = sample.frameAt;
  }

  get lastTickAt(): number {
    return this.wallAt + (this.accountedFrameAt - this.frameAt);
  }

  private canAccount(frameAt: number): boolean {
    return safeMilliseconds(frameAt) && frameAt >= this.accountedFrameAt &&
      safeMilliseconds(this.wallAt + (frameAt - this.frameAt));
  }
}
