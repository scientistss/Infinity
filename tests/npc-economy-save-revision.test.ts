import { afterEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { exportSave, importSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";

afterEach(() => { vi.doUnmock("../src/game/content"); vi.resetModules(); });

describe("NPC introduction stays fixed at r12", () => {
  it("preserves actual r12 economic age under explicitly supported future output", async () => {
    const state = createInitialState(12, 91);
    state.npcEconomy = { model: "fixed-production-v1", elapsedSeconds: 123.25 };
    state.totalTime = big(98765);
    const raw = exportSave(state, 2000, 1750), original = importSave(raw);
    expect(original.revision).toBe(12);
    vi.resetModules();
    vi.doMock("../src/game/content", async () => ({
      ...await vi.importActual<typeof import("../src/game/content")>("../src/game/content"),
      SAVE_REVISION: 13, SUPPORTED_SAVE_REVISIONS: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    }));
    const future = await import("../src/game/save"), adopted = future.importSave(raw);
    expect(adopted).toEqual({ ...original, revision: 13 });
    expect(future.importSave(JSON.stringify(adopted))).toEqual(adopted);
    expect(() => importSave(JSON.stringify(adopted))).toThrow(/修订不兼容/);
    for (const field of ["npcEconomy", "terraformerGrantJobFloor"]) {
      const damaged = structuredClone(original) as any; delete damaged.state[field];
      expect(() => future.importSave(JSON.stringify(damaged))).toThrow();
    }
    const lostSlot = structuredClone(original) as any; delete lostSlot.state.planets[0].demolition;
    expect(() => future.importSave(JSON.stringify(lostSlot))).toThrow(/拆除槽/);
  });

  it("does not accept future input merely because output revision is increased", async () => {
    const raw = JSON.parse(exportSave(createInitialState(12, 91), 2000)); raw.revision = 13;
    vi.resetModules();
    vi.doMock("../src/game/content", async () => ({
      ...await vi.importActual<typeof import("../src/game/content")>("../src/game/content"), SAVE_REVISION: 13,
    }));
    const future = await import("../src/game/save");
    expect(() => future.importSave(JSON.stringify(raw))).toThrow(/修订不兼容/);
  });
});
