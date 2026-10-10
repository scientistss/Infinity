import { describe, expect, it } from "vitest";
import { buildPerformanceState, performanceFixtureCounts, PERFORMANCE_FIXTURE_TIMESTAMP } from "../scripts/performance-fixture";
import { tick } from "../src/game/logic";
import { deserializeState, exportSave, importSave } from "../src/game/save";

describe("anonymous legal performance fixture recipe", () => {
  it("smoke profile creates real paid work and returned transport history, with deterministic strict startup", () => {
    const { state } = buildPerformanceState({ profile: "smoke" });
    expect(performanceFixtureCounts(state)).toMatchObject({ worlds: 2, fleets: 4, tasks: 3,
      completedTasks: 1, cancelledTasks: 1, runningTasks: 1, pausedTasks: 0,
      transportReceipts: 4, returnedReceipts: 4, outboundReceipts: 0,
      buildJobs: 4, shipyardJobs: 20, researchJobs: 2, paidJobs: 26,
      templates: 2, templateGoals: 32, formations: 2, formationShipEntries: 26 });
    const completed = state.orders.tasks[0]!;
    expect(completed.completedUnits).toBe(4);
    expect(completed.transport!.trips.map(trip => trip.cargo.deuterium)).toEqual(["15000", "15000", "15000", "15000"]);
    expect(completed.transport!.trips.every(trip => trip.phase.kind === "returned" && trip.phase.outcome.kind === "delivered")).toBe(true);
    expect(state.orders.tasks[1]!.transport!.trips).toHaveLength(0);
    const jobs = [...state.planets.flatMap(world => [...world.buildQueue, ...world.shipyardQueue]), ...state.research.queue];
    expect(new Set(jobs.map(job => job.jobId)).size).toBe(26);
    expect(jobs.every(job => job.jobId > 4 && job.jobId < state.orders.nextJobId)).toBe(true);
    const encoded = exportSave(state, PERFORMANCE_FIXTURE_TIMESTAMP);
    const loaded = deserializeState(importSave(encoded).state);
    expect(exportSave(loaded, PERFORMANCE_FIXTURE_TIMESTAMP)).toBe(encoded);
    expect(exportSave(tick(loaded, 0), PERFORMANCE_FIXTURE_TIMESTAMP)).toBe(encoded);
    expect(exportSave(buildPerformanceState({ profile: "smoke" }).state, PERFORMANCE_FIXTURE_TIMESTAMP)).toBe(encoded);
  });
});
