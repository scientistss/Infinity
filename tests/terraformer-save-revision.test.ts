import { expectedInactiveEnergyChallenge } from "./helpers/energy-challenge-legacy";
import { expectedFreshNpcWallet, expectedEmptyNpcBattles } from "./npc-wallet-expectations";
import { stripVerifiedNpcRemainders, stripVerifiedNullNpcScoutSnapshots } from "./helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import historical from "./fixtures/demolition-r10.json";
import { SAVE_REVISION } from "../src/game/content";
import { importSave } from "../src/game/save";

afterEach(() => {
  vi.doUnmock("../src/game/content");
  vi.resetModules();
});

const row = historical.rows.find(value => value.id === "G10a-earned-grant")!;
function lifted(original: any, revision: number) {
  return { ...original, revision, state: { ...original.state, energyChallenge: expectedInactiveEnergyChallenge(), npcEconomy: expectedFreshNpcWallet(), npcBattles: expectedEmptyNpcBattles(), planets: original.state.planets.map((planet: any) => ({ ...planet, demolition: null })) } };
}

describe("terraformer historical revision boundary", () => {
  it("keeps actual fixed r10 earned grants unchanged when r16 and a future r17 reader adopt them", async () => {
    // The source is retained ac3 serializer bytes from real enqueue/tick, not a new export
    // relabeled r10. Its own old reader output is independently saved with byte hashes.
    expect(SAVE_REVISION).toBe(16);
    expect(historical.sourceSha).toBe("ac3cce98403bea1e7162bcb4092e4cfeeb448a9a");
    const original: any = row.oldReaderOutput;
    expect(JSON.parse(row.raw).revision).toBe(10);
    expect(original.state.planets[0].terraformerFields).toEqual({ base: 163, grantedLevels: 1 });
    expect(original.state.terraformerGrantJobFloor).toBe(1);
    expect(original.state.orders.nextJobId).toBe(2);
    const verified = importSave(row.raw);
    stripVerifiedNpcRemainders(verified.state); stripVerifiedNullNpcScoutSnapshots(verified.state);
    expect(verified).toEqual(lifted(original, 16));
    expect(() => importSave(JSON.stringify({ ...original, revision: 15 }))).toThrow(/修订不兼容/);

    vi.resetModules();
    vi.doMock("../src/game/content", async () => ({
      ...await vi.importActual<typeof import("../src/game/content")>("../src/game/content"),
      SAVE_REVISION: 17,
      // Future compatibility is an explicit opt-in, separate from the output revision.
      SUPPORTED_SAVE_REVISIONS: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17],
    }));
    const future = await import("../src/game/save");
    const restored = future.importSave(row.raw);
    const verifiedFuture = structuredClone(restored);
    stripVerifiedNpcRemainders(verifiedFuture.state); stripVerifiedNullNpcScoutSnapshots(verifiedFuture.state);
    expect(verifiedFuture).toEqual(lifted(original, 17));
    expect(future.importSave(JSON.stringify(restored))).toEqual(restored);

    const missingFloor = JSON.parse(row.raw);
    delete missingFloor.state.terraformerGrantJobFloor;
    expect(() => future.importSave(JSON.stringify(missingFloor))).toThrow();
    const missingLedger = JSON.parse(row.raw);
    delete missingLedger.state.planets[0].terraformerFields;
    expect(() => future.importSave(JSON.stringify(missingLedger))).toThrow();
    expect(() => future.importSave(JSON.stringify({ ...original, revision: 18 }))).toThrow(/修订不兼容/);
  });
});
