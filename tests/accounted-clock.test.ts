import { describe, expect, it, vi } from "vitest";
import { AccountedClock, type ClockSample } from "../src/core/accounted-clock";

describe("accounted snapshot clock", () => {
  it("starts at its paired epoch and leaves repeated gap reads unconsumed", () => {
    const clock = new AccountedClock({ wallAt: 1_000_000, frameAt: 250 });
    expect(clock.lastTickAt).toBe(1_000_000);
    expect(clock.gapSeconds(15_250)).toBe(15);
    expect(clock.gapSeconds(30_250)).toBe(30);
    expect(clock.gapSeconds(45_250)).toBe(45);
    expect(clock.lastTickAt).toBe(1_000_000);
    clock.account(61_250);
    expect(clock.lastTickAt).toBe(1_061_000);
    expect(clock.gapSeconds(62_250)).toBe(1);
  });

  it("accounts a full raw window even when its caller caps the simulated duration", () => {
    const clock = new AccountedClock({ wallAt: 1_000_000, frameAt: 500 });
    const resumedFrame = 500 + 10 * 3600 * 1000;
    expect(clock.gapSeconds(resumedFrame)).toBe(10 * 3600);
    clock.account(resumedFrame);
    expect(clock.gapSeconds(resumedFrame)).toBe(0);
    expect(clock.gapSeconds(resumedFrame + 1000)).toBe(1);
    expect(clock.lastTickAt).toBe(1_000_000 + 10 * 3600 * 1000);
  });

  it("derives a fractional watermark from one epoch without repeated large-number addition", () => {
    const sample = { wallAt: 1_800_000_000_000, frameAt: 12.5 };
    const clock = new AccountedClock(sample);
    let repeatedlyAdded = sample.wallAt;
    let previousFrame = sample.frameAt;
    for (let i = 1; i <= 10_000; i++) {
      const frameAt = sample.frameAt + i * 1000 / 60;
      repeatedlyAdded += frameAt - previousFrame;
      clock.account(frameAt);
      previousFrame = frameAt;
    }
    const expected = sample.wallAt + (previousFrame - sample.frameAt);
    expect(clock.lastTickAt).toBe(expected);
    expect(repeatedlyAdded).not.toBe(expected);
  });

  it("does not read external clocks or retain its caller's mutable sample", () => {
    const sample: ClockSample = { wallAt: 700, frameAt: 10 };
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("wall read"); });
    try {
      const clock = new AccountedClock(sample);
      sample.wallAt = 999;
      sample.frameAt = 999;
      clock.account(15.5);
      expect(clock.lastTickAt).toBe(705.5);
      expect(clock.gapSeconds(20)).toBe(0.0045);
    } finally {
      now.mockRestore();
    }
  });

  it.each([NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1])(
    "ignores invalid frame sample %s without consuming a future valid gap", frameAt => {
      const clock = new AccountedClock({ wallAt: 1000, frameAt: 200 });
      clock.account(1200);
      expect(clock.gapSeconds(frameAt)).toBe(0);
      clock.account(frameAt);
      expect(clock.lastTickAt).toBe(2000);
      expect(clock.gapSeconds(2200)).toBe(1);
    },
  );

  it("never moves backwards or double-counts an already accounted frame", () => {
    const clock = new AccountedClock({ wallAt: 1000, frameAt: 200 });
    clock.account(1200);
    for (const earlier of [0, 200, 1199.9, 1200]) {
      expect(clock.gapSeconds(earlier)).toBe(0);
      clock.account(earlier);
      expect(clock.lastTickAt).toBe(2000);
    }
    expect(clock.gapSeconds(2200)).toBe(1);
  });

  it.each(["wallAt", "frameAt"] as const)("rejects invalid %s constructor and replacement samples atomically", field => {
    const clock = new AccountedClock({ wallAt: 1000, frameAt: 200 });
    clock.account(1200);
    for (const value of [NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const sample = { wallAt: 3000, frameAt: 500, [field]: value };
      expect(() => new AccountedClock(sample)).toThrow(RangeError);
      expect(() => clock.rebase(sample)).toThrow(RangeError);
      expect(clock.lastTickAt).toBe(2000);
      expect(clock.gapSeconds(2200)).toBe(1);
    }
  });

  it("keeps the derived wall watermark within the explicit safe-millisecond bound", () => {
    const clock = new AccountedClock({ wallAt: Number.MAX_SAFE_INTEGER - 1000, frameAt: 0 });
    clock.account(1000);
    expect(clock.lastTickAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(clock.gapSeconds(1001)).toBe(0);
    clock.account(1001);
    expect(clock.lastTickAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rebases only on explicit replacement and abandons the previous world's pending gap", () => {
    const clock = new AccountedClock({ wallAt: 10_000, frameAt: 100 });
    clock.account(1100);
    expect(clock.gapSeconds(20_100)).toBe(19);
    clock.rebase({ wallAt: 30_000, frameAt: 20_100 });
    expect(clock.lastTickAt).toBe(30_000);
    expect(clock.gapSeconds(21_100)).toBe(1);
    // A replacement owns a new wall epoch, even after a wall-clock correction.
    clock.rebase({ wallAt: 5000, frameAt: 25_100 });
    expect(clock.lastTickAt).toBe(5000);
    expect(clock.gapSeconds(26_100)).toBe(1);
  });
});
