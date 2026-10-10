import { describe, expect, it } from "vitest";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { createPlanet } from "../src/game/planet";
import { big } from "../src/game/decimal";
import { tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { orderUnits } from "../src/game/shipyard";
import { serializeState } from "../src/game/save";
import { maySpeedUp, queueHeads, sameQueueHeads } from "../src/ui/queue-head-authority";
import { rich, stateWith } from "./helpers";

const prepared = () => {
  let state = rich(stateWith({ robotics_factory: 1, research_lab: 1, shipyard: 1 }));
  state = { ...state, darkMatter: big(100000) };
  state = enqueue(enqueue(state, "metal_mine", "manual").state, "metal_mine", "manual").state;
  state = enqueueResearch(state, "energy_tech", "manual").state;
  return orderUnits(state, "rocket_launcher", 2, "manual").state;
};

describe("painted paid-head authority", () => {
  it("retains identity as timers advance and cannot mutate a world", () => {
    const state = prepared();
    const before = JSON.stringify(serializeState(state));
    const heads = queueHeads(state);
    expect(Object.values(heads).every(value => value !== null)).toBe(true);
    const advanced = tick(state, 0.001);
    expect(sameQueueHeads(heads, queueHeads(advanced))).toBe(true);
    for (const target of ["build", "research", "shipyard"] as const) expect(maySpeedUp(heads, queueHeads(advanced), target)).toBe(true);
    expect(JSON.stringify(serializeState(state))).toBe(before);
  });

  it("does not transfer a displayed speedup to the next paid queue head", () => {
    const state = prepared();
    const heads = queueHeads(state);
    const next = tick(state, activePlanet(state).buildQueue[0]!.remainingSeconds + 0.001);
    expect(activePlanet(next).buildQueue[0]!.jobId).not.toBe(activePlanet(state).buildQueue[0]!.jobId);
    expect(sameQueueHeads(heads, queueHeads(next))).toBe(false);
    expect(maySpeedUp(heads, queueHeads(next), "build")).toBe(false);
  });

  it("retires authority for replacement and empty queues; another planet is a different head", () => {
    const state = prepared();
    const heads = queueHeads(state);
    expect(maySpeedUp(null, heads, "build")).toBe(false);
    const other = createPlanet("other", { galaxy: 1, system: 50, position: 9 });
    // Deliberately same numeric identity across a replacement namespace.
    other.buildQueue = activePlanet(state).buildQueue;
    const switched = selectPlanet({ ...state, planets: [...state.planets, other] }, other.id);
    expect(maySpeedUp(heads, queueHeads(switched), "build")).toBe(false);
    const empty = queueHeads(stateWith());
    expect(maySpeedUp(empty, empty, "build")).toBe(false);
    expect(sameQueueHeads(null, empty)).toBe(false);
  });
});
