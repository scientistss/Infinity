import { afterEach, describe, expect, it, vi } from "vitest";
import historical from "./fixtures/demolition-r10.json";
import { big } from "../src/game/decimal";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { activePlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { deserializeState, exportSave, importSave } from "../src/game/save";

afterEach(() => { vi.doUnmock("../src/game/content"); vi.resetModules(); });

describe("demolition historical boundary remains r10 forever", () => {
  it("preserves genuine r11 paid partial work and earned terra grants under explicit future r12 support", async () => {
    const source = historical.rows.find(row => row.id === "G10a-earned-grant")!;
    const state = deserializeState(importSave(source.raw).state), planet = activePlanet(state);
    // Synthetic prerequisites/wallet only; the r11 job is produced by real quote/payment/tick.
    planet.buildings.metal_mine = 10; planet.buildings.robotics_factory = 0; planet.buildings.nanite_factory = 0;
    planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
    state.research.levels.ion_tech = 1;
    const refreshed = tick(state, 0), quote = quoteDemolition(refreshed, "metal_mine");
    expect(quote.ok, quote.reason).toBe(true);
    const payment = commitDemolition(refreshed, quote.quote!); expect(payment.ok, payment.reason).toBe(true);
    const issuedTotal = activePlanet(payment.state).demolition!.totalSeconds;
    expect(Math.abs(issuedTotal - 4.6104)).toBeLessThanOrEqual(Number.EPSILON * 4.6104);
    const partial = tick(payment.state, 0.25), raw = exportSave(partial, 1250), original = importSave(raw);
    expect(original.revision).toBe(11);
    expect(original.state.planets[0]!.demolition).toMatchObject({ jobId: 2, paid: { metal: "1476", crystal: "369", deuterium: "0" },
      totalSeconds: issuedTotal, remainingSeconds: issuedTotal - 0.25, fromLevel: 10, toLevel: 9 });
    expect(original.state.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 1 });
    expect(original.state.terraformerGrantJobFloor).toBe(1); expect(original.state.orders.nextJobId).toBe(3);
    vi.resetModules();
    vi.doMock("../src/game/content", async () => ({
      ...await vi.importActual<typeof import("../src/game/content")>("../src/game/content"),
      SAVE_REVISION: 12, SUPPORTED_SAVE_REVISIONS: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    }));
    const future = await import("../src/game/save"), adopted = future.importSave(raw);
    expect(adopted).toEqual({ ...original, revision: 12 });
    expect(future.importSave(JSON.stringify(adopted))).toEqual(adopted);
    expect(() => importSave(JSON.stringify(adopted))).toThrow(/修订不兼容/);
    const missing = structuredClone(original) as any; delete missing.state.planets[0].demolition;
    expect(() => future.importSave(JSON.stringify(missing))).toThrow(/拆除槽/);
  });
  it("does not accept a future format just because the output revision was increased", async () => {
    vi.resetModules();
    vi.doMock("../src/game/content", async () => ({
      ...await vi.importActual<typeof import("../src/game/content")>("../src/game/content"), SAVE_REVISION: 12,
    }));
    const future = await import("../src/game/save");
    const old = JSON.parse(historical.rows[0]!.raw); old.revision = 12;
    expect(() => future.importSave(JSON.stringify(old))).toThrow(/修订不兼容/);
  });
});
