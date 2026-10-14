import { expectedInactiveEnergyChallenge } from "./helpers/energy-challenge-legacy";
import { describe, expect, it } from "vitest";
import provenance from "./fixtures/npc-scout-legacy.json";
import { deserializeState, importSave, serializeState } from "../src/game/save";

/** These are genuine source-produced bytes; retagged current data is never provenance. */
describe("genuine r2–r13 historical scout migration", () => {
  it("retains source bindings for every supported legacy revision", () => {
    expect([...new Set(provenance.rows.map(row => row.revision))].sort((a, b) => a - b))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (const row of provenance.rows) {
      expect(JSON.parse(row.raw).revision).toBe(row.revision);
      expect(row.sourceSha).toMatch(/^[a-f0-9]{40}$/);
      expect(row.rawSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.sourceRefusesR14.rejected).toBe(true);
      expect(row.sourceRefusesR14.inputKind).toBe("synthetic-next-revision-envelope-probe");
      expect(row.sourceRefusesR14.inputSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.sourceRefusesR14.message.length).toBeGreaterThan(0);
    }
  });
  it.each(provenance.rows)("preserves the exact archived r13 projection plus null slot: $id", row => {
    const old = row.r13ReaderOutput;
    const expected = { ...old, revision: 16, state: { ...old.state, energyChallenge: expectedInactiveEnergyChallenge(),
      messages: old.state.messages.map(message => ({ ...message, npcScoutSnapshot: null })) } };
    const before = JSON.stringify(row), current = importSave(row.raw);
    expect(current).toEqual(expected); expect(JSON.stringify(row)).toBe(before);
    expect(importSave(JSON.stringify(current))).toEqual(current);
    expect(serializeState(deserializeState(current.state))).toEqual(current.state);
    expect(current.state.messages.every(message => message.npcScoutSnapshot === null)).toBe(true);
  });
});
