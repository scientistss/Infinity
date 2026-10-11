import { describe, expect, it } from "vitest";
import { DEMOLITION_GOLDEN as GOLD, evidenceDifference, exactEvidence, projectR11NullToR10 } from "../scripts/demolition-fixture";
const old = () => ({ terraformerGrantJobFloor: 89, planets: [{ id: "homeworld", fieldsMax: 173, terraformerFields: { base: 163, grantedLevels: 2 }, resources: { metal: "2920000" }, buildQueue: [] }], orders: { nextJobId: 202 } });
const current = () => ({ ...old(), planets: old().planets.map(p => ({ ...p, demolition: null })) });
describe("demolition acceptance strict old projection", () => {
  it("accepts exactly additive per-planet null while preserving all original data", () => expect(projectR11NullToR10(current(), old())).toEqual(old()));
  it.each(["wallet", "field", "floor", "nextID", "extra", "missing", "reordered", "absentNull", "undefinedNull", "live"])("rejects %s mutation rather than masking it", kind => {
    const candidate: any = current();
    if (kind === "wallet") candidate.planets[0].resources.metal = "2920001";
    if (kind === "field") candidate.planets[0].terraformerFields.grantedLevels = 0;
    if (kind === "floor") candidate.terraformerGrantJobFloor = 202;
    if (kind === "nextID") candidate.orders.nextJobId++;
    if (kind === "extra") candidate.unexpected = null;
    if (kind === "missing") delete candidate.planets[0].buildQueue;
    if (kind === "reordered") candidate.planets[0].id = "colony-1";
    if (kind === "absentNull") delete candidate.planets[0].demolition;
    if (kind === "undefinedNull") candidate.planets[0].demolition = undefined;
    if (kind === "live") candidate.planets[0].demolition = { jobId: 202 };
    expect(() => projectR11NullToR10(candidate, old())).toThrow();
  });
  it("does not accept null already smuggled into old input", () => expect(() => projectR11NullToR10(current(), current())).toThrow());
  it("compares unknown keys, arrays and integer types without blanket removals", () => {
    expect(evidenceDifference({ x: 1 }, { x: "1" })).not.toBeNull();
    expect(evidenceDifference({ x: [] }, { x: {} })).not.toBeNull();
    expect(() => exactEvidence({ id: 1 }, { id: 1, hidden: null }, "all keys")).toThrow();
  });
  it("pins independent exact economic targets and narrowly discloses decimal tolerance", () => {
    expect(GOLD.paid.metal).toBe("128000"); expect(GOLD.rebuildPaid.metal).toBe("256000");
    expect(GOLD.demolitionSeconds).toBe(768 / 55); expect(GOLD.rebuildSeconds).toBe(1536 / 55);
    expect(GOLD.cap8).toBe(1590000); expect(GOLD.nextJobId).toBe(205); expect(GOLD.walletAbsoluteTolerance).toBe(1e-6);
  });
});

import original from "./fixtures/demolition-origin-r10-save.json";
import { selectPlanet } from "../src/game/empire";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { tick } from "../src/game/logic";
import { deserializeState, importSave, serializeState } from "../src/game/save";
import { syntheticDemolitionBoundaries } from "../scripts/demolition-fixture";

describe("separate synthetic native-boundary oracles", () => {
  it("strictly reloads actual robot demolition/off/clear/rebuild branches without restoring authority", () => {
    let natural = tick(deserializeState(importSave(JSON.stringify(original)).state), 1, "live");
    natural = selectPlanet(natural, "homeworld");
    const result = commitDemolition(natural, quoteDemolition(natural, "metal_storage").quote!);
    expect(result.ok, result.reason).toBe(true);
    const evidence = syntheticDemolitionBoundaries(original.savedAt + 1000, serializeState(result.state));
    expect(evidence.classification).toContain("Explicit synthetic");
    expect(evidence.expected.syntheticRobotLocked!.planets[0]!.buildings.robotics_factory).toBe(1);
    expect(evidence.expected.syntheticRobotLocked!.protocols.slots[1]!.card!.enabled).toBe(true);
    expect(evidence.expected.syntheticRobotOffUnlocked!.planets[0]!.buildings.robotics_factory).toBe(2);
    expect(evidence.expected.syntheticRobotOffUnlocked!.protocols.slots[1]!.card!.enabled).toBe(false);
    expect(evidence.expected.syntheticRobotClearUnlocked!.protocols.slots[1]!.card).toBeNull();
    expect(evidence.expected.syntheticRobotOffUnlocked!.orders.nextJobId).toBe(3);
    expect(evidence.expected.naturalCurvatureReset!.planets.every(p => p.demolition === null)).toBe(true);
    expect(evidence.prestige.confirmation).toContain("128000");
  });
});
