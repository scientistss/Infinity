import { afterEach, describe, expect, it, vi } from "vitest";
import { SAVE_REVISION } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyTickLog, tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { exportSave, importSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";

afterEach(() => {
  vi.doUnmock("../src/game/content");
  vi.resetModules();
});

describe("terraformer historical revision boundary", () => {
  it("keeps genuine r10 grants strict when a later reader supports r11", async () => {
    // Produce genuine r10 bytes before mocking the later reader. Only prerequisites
    // are synthetic; no ledger, grant, job counter or revision is manufactured.
    expect(SAVE_REVISION).toBe(10);
    const state = createInitialState(123, 456), planet = activePlanet(state);
    planet.buildings.nanite_factory = 1;
    state.research.levels.energy_tech = 12;
    planet.tempMax = 10;
    planet.units.solar_satellite = 100;
    planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
    const paid = enqueue(state, "terraformer", "manual");
    expect(paid.ok, paid.reason).toBe(true);
    const log = emptyTickLog();
    const completed = tick(paid.state, Math.ceil(activePlanet(paid.state).buildQueue[0]!.remainingSeconds), "live", log);
    expect(log.completedBuilds).toEqual([{ building: "terraformer", level: 1 }]);
    const raw = exportSave(completed, 1000), original = importSave(raw);
    expect(original.revision).toBe(10);
    expect(original.state.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 1 });
    expect(original.state.terraformerGrantJobFloor).toBe(1);
    expect(original.state.orders.nextJobId).toBe(2);
    for (const revision of [11, 12]) {
      expect(() => importSave(JSON.stringify({ ...original, revision }))).toThrow(/修订不兼容/);
    }

    // Reset only this test file's module graph; the production format stays r10.
    vi.resetModules();
    vi.doMock("../src/game/content", async () => ({
      ...await vi.importActual<typeof import("../src/game/content")>("../src/game/content"),
      SAVE_REVISION: 11,
    }));
    const future = await import("../src/game/save");
    const restored = future.importSave(raw);
    expect(restored).toEqual({ ...original, revision: 11 });
    expect(future.importSave(JSON.stringify(restored))).toEqual(restored);

    const missingFloor = structuredClone(original) as any;
    delete missingFloor.state.terraformerGrantJobFloor;
    expect(() => future.importSave(JSON.stringify(missingFloor))).toThrow();
    const missingLedger = structuredClone(original) as any;
    delete missingLedger.state.planets[0].terraformerFields;
    expect(() => future.importSave(JSON.stringify(missingLedger))).toThrow();
    expect(() => future.importSave(JSON.stringify({ ...original, revision: 12 }))).toThrow(/修订不兼容/);
  });
});
