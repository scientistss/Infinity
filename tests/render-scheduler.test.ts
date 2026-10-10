import { describe, expect, it } from "vitest";
import { RenderScheduler } from "../src/ui/render-scheduler";

const ready = (visibleTab = "facilities") => ({ hidden: false, ready: true, visibleTab });
function paint(scheduler: RenderScheduler, now: number, input = ready()): boolean {
  if (!scheduler.shouldPaint(now, input)) return false;
  scheduler.didPaint(now, input.visibleTab);
  return true;
}

describe("presentation-only latest-frame scheduler", () => {
  it.each([60, 120])("bounds ordinary painting at %i Hz without skipping simulation callbacks", hz => {
    const scheduler = new RenderScheduler();
    let simulatedFrames = 0;
    const paints: number[] = [];
    for (let i = 0; i <= hz; i++) {
      simulatedFrames++;
      const now = i * 1000 / hz;
      if (paint(scheduler, now)) paints.push(now);
    }
    expect(simulatedFrames).toBe(hz + 1);
    expect(paints).toHaveLength(11);
    for (let i = 1; i < paints.length; i++) expect(paints[i]! - paints[i - 1]!).toBeCloseTo(100, 7);
  });

  it("paints only the latest frame after a stall, with no backlog", () => {
    const scheduler = new RenderScheduler();
    expect(paint(scheduler, 0)).toBe(true);
    expect(paint(scheduler, 1_000_000)).toBe(true);
    expect(paint(scheduler, 1_000_001)).toBe(false);
    expect(paint(scheduler, 1_000_100)).toBe(true);
  });

  it("defers all hidden work but retains action, tab and adoption invalidation", () => {
    const scheduler = new RenderScheduler();
    paint(scheduler, 0);
    scheduler.invalidate();
    expect(paint(scheduler, 1, { ...ready("fleet"), hidden: true })).toBe(false);
    expect(paint(scheduler, 10_000, { ...ready("arcade"), hidden: true })).toBe(false);
    expect(paint(scheduler, 10_001, ready("fleet"))).toBe(true);
    expect(paint(scheduler, 10_002, ready("fleet"))).toBe(false);
    scheduler.reset();
    expect(paint(scheduler, 10_003, { ...ready(), hidden: true })).toBe(false);
    expect(paint(scheduler, 10_004)).toBe(true);
  });

  it("refreshes input and navigation on the next eligible frame without waiting 100 ms", () => {
    const scheduler = new RenderScheduler();
    paint(scheduler, 1000);
    expect(paint(scheduler, 1001)).toBe(false);
    scheduler.invalidate();
    expect(paint(scheduler, 1002)).toBe(true);
    expect(paint(scheduler, 1003, ready("galaxy"))).toBe(true);
    expect(paint(scheduler, 1004, ready("galaxy"))).toBe(false);
  });

  it("keeps both idle attract and active ring animation at every visible RAF", () => {
    const scheduler = new RenderScheduler();
    for (let i = 0; i < 120; i++) expect(paint(scheduler, i * 1000 / 120, ready("arcade"))).toBe(true);
    expect(paint(scheduler, 1000, { ...ready("arcade"), hidden: true })).toBe(false);
  });

  it("protected worlds repaint only explicit invalidations, not time or animation", () => {
    const scheduler = new RenderScheduler();
    const frozen = { ...ready("arcade"), ready: false };
    expect(paint(scheduler, 0, frozen)).toBe(true);
    expect(paint(scheduler, 10000, frozen)).toBe(false);
    scheduler.invalidate();
    expect(paint(scheduler, 10001, frozen)).toBe(true);
    expect(paint(scheduler, 20000, frozen)).toBe(false);
  });

  it("does not consume dirty state for invalid samples or paint early on clock regression", () => {
    const scheduler = new RenderScheduler();
    for (const now of [NaN, Infinity, -1]) expect(paint(scheduler, now)).toBe(false);
    expect(paint(scheduler, 1000)).toBe(true);
    expect(paint(scheduler, 900)).toBe(false);
    expect(paint(scheduler, 1099)).toBe(false);
    expect(paint(scheduler, 1100)).toBe(true);
  });
});
