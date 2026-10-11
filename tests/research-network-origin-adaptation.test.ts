import { describe, expect, it } from "vitest";
import originalR10 from "./fixtures/demolition-origin-r10-save.json";
import { readNaturalResearchOrigin } from "../scripts/natural-research-network-journey";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { selectPlanet } from "../src/game/empire";
import { exportSave, importSave } from "../src/game/save";

const PINNED_R10 = "4afa5331d6e54509a643572570dc3cd194c78ebf";
const CURRENT = "4a26a52345f79ca014471e527fcdf0ceafc8fae5";
type Save = ReturnType<typeof importSave>;
/** Actual complete r10 serialized data tests the adapter shape only. This unit
 * does not label it a 4afa source report; the CLI integration separately consumes
 * the unchanged hash-bound real 4afa report and validates its full provenance.
 */
const old = () => structuredClone(originalR10) as unknown as Save;

describe("IRN origin revision adapter", () => {
  it("adds only revision12, zero NPC age and explicit null slots, preserving complete raw input and earned fields", () => {
    const source = old(), bytes = JSON.stringify(source);
    const result = readNaturalResearchOrigin(source, PINNED_R10);
    expect(result.imported).toEqual({ ...source, revision: 12, state: { ...source.state, npcEconomy: { model: "fixed-production-v1", elapsedSeconds: 0 }, planets: source.state.planets.map(p => ({ ...p, demolition: null })) } });
    expect(JSON.stringify(source)).toBe(bytes);
    expect(result.candidate.terraformerGrantJobFloor).toBe(89);
    expect(result.candidate.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 2 });
  });
  it("keeps already current input entirely exact", () => {
    const current = readNaturalResearchOrigin(old(), PINNED_R10).imported;
    current.state.npcEconomy = { model: "fixed-production-v1", elapsedSeconds: 17.25 };
    expect(readNaturalResearchOrigin(current, CURRENT).imported).toEqual(current);
  });
  it("does not broadly accept another r10 source SHA", () => expect(() => readNaturalResearchOrigin(old(), CURRENT)).toThrow(/exact pinned/));
  it.each([null, {}, { jobId: 202 }])("rejects a new field smuggled under r10 even if null", value => {
    const source = old(); (source.state.planets[0] as any).demolition = value;
    expect(() => readNaturalResearchOrigin(source, PINNED_R10)).toThrow(/forbidden demolition/);
  });
  it("rejects missing current slots and unrelated normalization", () => {
    const current = readNaturalResearchOrigin(old(), PINNED_R10).imported;
    const missing = structuredClone(current); delete (missing.state.planets[0] as any).demolition;
    expect(() => readNaturalResearchOrigin(missing, CURRENT)).toThrow(/missing or competing/);
    const noncanonical = structuredClone(current); noncanonical.state.planets[0]!.resources.metal = "2920000.00";
    expect(() => readNaturalResearchOrigin(noncanonical, CURRENT)).toThrow();
  });
  it("rejects a legally readable active demolition as a supposedly settled r12 origin", () => {
    let state = selectPlanet(readNaturalResearchOrigin(old(), PINNED_R10).candidate, "homeworld");
    const paid = commitDemolition(state, quoteDemolition(state, "metal_storage").quote!);
    expect(paid.ok, paid.reason).toBe(true); state = paid.state;
    const current = importSave(exportSave(state, originalR10.savedAt));
    expect(() => readNaturalResearchOrigin(current, CURRENT)).toThrow(/competing demolition/);
  });
});
