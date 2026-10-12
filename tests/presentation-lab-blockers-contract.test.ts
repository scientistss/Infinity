/** Synthetic contract attacks only. Real archived fixture/native runs remain separate gates. */
import { describe, expect, it } from "vitest";
const { default: assert } = await import("node:assert/strict" as string);
const { readFileSync } = await import("node:fs" as string) as { readFileSync(path: URL, encoding: "utf8"): string };

const source = readFileSync(new URL("../scripts/benchmark-presentation.mjs", import.meta.url), "utf8");
const start = source.indexOf("function historicalLabBlockers(");
const end = source.indexOf("\nconst labBlockersSourceProof =", start);
assert.ok(start >= 0 && end > start, "test the one exact benchmark adapter without running measurements");
const adapt = new Function("assert", `return (${source.slice(start, end)});`)(assert);

type Fixture = { current: Record<string, any>; old: Record<string, any>; planets: Array<Record<string, any>>; migrated: Array<Record<string, any>> };
function specimen(visible = true): Fixture {
  const queue = { summary: "原有研究队列", items: [{ jobId: 31, detail: "剩余 2 秒", active: true }], signature: "home:31" };
  const cards = [{ id: "energy_tech", cost: "晶体 800.00", time: "研究时间 2 秒", canEnqueue: false }];
  const old = { visible: true, queue, summary: "原有研究总等级", items: cards };
  const current = { visible: true, queue, summary: old.summary,
    labBlockers: visible ? { planetCount: 0, jobCount: 0, summary: "", note: "", items: [] } : null,
    items: visible ? cards : [] };
  const planets = [
    { id: "homeworld", buildQueue: [{ building: "metal_storage", jobId: 11, paid: { metal: "100", crystal: "0", deuterium: "0" } },
      { building: "crystal_storage", jobId: 12, paid: { metal: "100", crystal: "50", deuterium: "0" } }] },
    { id: "colony", buildQueue: [{ building: "metal_storage", jobId: 21, paid: { metal: "100", crystal: "0", deuterium: "0" } }] },
  ];
  return { current, old, planets, migrated: planets.map(planet => ({ ...structuredClone(planet), demolition: null })) };
}
function project(value: Fixture, visible = true) {
  return adapt(value.current, value.old, value.planets, value.migrated, "synthetic adapter contract", visible);
}
function freeze(value: unknown) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe("historical performance lab blocker contract", () => {
  it("reproduces the exact old whole-panel failure, then adapts only the independently empty field", () => {
    const value = specimen(), before = structuredClone(value);
    expect(() => assert.deepEqual(value.current, value.old)).toThrow();
    freeze(value);
    const result = project(value);
    assert.deepEqual(result, value.old);
    assert.deepEqual(value, before);
    expect(result).not.toBe(value.current);
    expect(result.queue).toBe(value.current.queue);
    expect(result.items).toBe(value.current.items);
  });

  it("requires explicit null in each hidden research projection", () => {
    const value = specimen(false);
    assert.deepEqual(project(value, false), { ...value.old, items: [] });
    for (const wrong of [undefined, false, {}, specimen().current.labBlockers]) {
      value.current.labBlockers = wrong;
      expect(() => project(value, false)).toThrow();
    }
    expect(() => project(specimen(), "research" as unknown as boolean)).toThrow();
  });

  it("rejects missing, unknown, inherited, accessor, non-enumerable and reordered panel fields", () => {
    for (const side of ["current", "old"] as const) {
      for (const attack of [
        (panel: Record<string, any>) => { delete panel.summary; },
        (panel: Record<string, any>) => { panel.unknown = "unapproved"; },
        (panel: Record<string, any>) => { Object.setPrototypeOf(panel, { inherited: true }); },
        (panel: Record<string, any>) => { Object.defineProperty(panel, "summary", { get: () => "original", enumerable: true }); },
        (panel: Record<string, any>) => { Object.defineProperty(panel, "summary", { value: panel.summary, enumerable: false }); },
        (panel: Record<string, any>) => { const summary = panel.summary; delete panel.summary; panel.summary = summary; },
        (panel: Record<string, any>) => { Object.defineProperty(panel, Symbol("extra"), { value: 0 }); },
      ]) {
        const value = specimen(); attack(value[side]);
        expect(() => project(value)).toThrow();
      }
    }
    const value = specimen(); value.old.labBlockers = null;
    expect(() => project(value)).toThrow();
  });

  it("requires every exact visible literal field, scalar type and ordered empty item list", () => {
    const wrongValues = { planetCount: [1, -0, false, "0"], jobCount: [1, -0, false, "0"],
      summary: ["研究受阻", 0, null], note: ["工作", 0, null], items: [[{}], {}, null, undefined] };
    for (const [key, values] of Object.entries(wrongValues)) for (const wrong of values) {
      const value = specimen(); value.current.labBlockers[key] = wrong;
      expect(() => project(value)).toThrow();
    }
    for (const attack of [
      (model: Record<string, any>) => { delete model.note; },
      (model: Record<string, any>) => { model.extra = 0; },
      (model: Record<string, any>) => { Object.defineProperty(model, Symbol("extra"), { value: 0 }); },
      (model: Record<string, any>) => { Object.setPrototypeOf(model, { inherited: true }); },
      (model: Record<string, any>) => { Object.defineProperty(model, "jobCount", { get: () => 0, enumerable: true }); },
      (model: Record<string, any>) => { Object.defineProperty(model, "jobCount", { value: 0, enumerable: false }); },
      (model: Record<string, any>) => { const note = model.note; delete model.note; model.note = note; },
      (model: Record<string, any>) => { Object.defineProperty(model.items, "extra", { value: 0 }); },
      (model: Record<string, any>) => { model.items[Symbol("extra")] = 0; },
      (model: Record<string, any>) => { model.items.length = 1; },
    ]) {
      const value = specimen(); attack(value.current.labBlockers);
      expect(() => project(value)).toThrow();
    }
  });

  it("rejects a paid lab at every world and queue position even when the candidate model claims empty", () => {
    for (const [world, original] of specimen().planets.entries()) for (let slot = 0; slot < original.buildQueue.length; slot++) {
      const value = specimen();
      value.planets[world].buildQueue[slot].building = "research_lab";
      value.migrated[world].buildQueue[slot].building = "research_lab";
      expect(() => project(value)).toThrow(/paid laboratory/);
    }
    for (const demolition of [{ building: "research_lab", jobId: 51 }, { building: "metal_mine", jobId: 52 }, undefined]) {
      const value = specimen(); value.migrated[1].demolition = demolition;
      expect(() => project(value)).toThrow();
    }
    const value = specimen(); delete value.migrated[1].demolition;
    expect(() => project(value)).toThrow();
    const historical = specimen(); historical.planets[1].demolition = null;
    expect(() => project(historical)).toThrow();
  });

  it("requires every complete paid row, resource, positive identity and original world/queue order", () => {
    for (const attack of [
      (value: Fixture) => { value.migrated.reverse(); },
      (value: Fixture) => { value.migrated.pop(); },
      (value: Fixture) => { value.migrated.push(structuredClone(value.migrated[0])); },
      (value: Fixture) => { value.migrated[0].buildQueue.reverse(); },
      (value: Fixture) => { value.migrated[0].buildQueue.pop(); },
      (value: Fixture) => { value.migrated[0].buildQueue[0].paid.metal = "101"; },
      (value: Fixture) => { value.migrated[0].buildQueue[0].jobId = 999; },
      (value: Fixture) => { value.planets[1].id = value.planets[0].id; value.migrated[1].id = value.migrated[0].id; },
      (value: Fixture) => { value.planets = []; value.migrated = []; },
    ]) {
      const value = specimen(); attack(value);
      expect(() => project(value)).toThrow();
    }
    for (const wrong of [0, -1, "11", true, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const value = specimen(); value.planets[0].buildQueue[0].jobId = wrong; value.migrated[0].buildQueue[0].jobId = wrong;
      expect(() => project(value)).toThrow();
    }
  });

  it("retains every old summary, price, timer and permission mismatch for whole-model rejection", () => {
    for (const attack of [
      (value: Fixture) => { value.current.summary = "changed"; },
      (value: Fixture) => { value.current.visible = false; },
      (value: Fixture) => { value.current.queue = { ...value.current.queue, signature: "changed" }; },
      (value: Fixture) => { value.current.queue = structuredClone(value.current.queue); value.current.queue.items[0].detail = "剩余 3 秒"; },
      (value: Fixture) => { value.current.items = structuredClone(value.current.items); value.current.items[0].cost = "晶体 801.00"; },
      (value: Fixture) => { value.current.items = structuredClone(value.current.items); value.current.items[0].time = "研究时间 3 秒"; },
      (value: Fixture) => { value.current.items = structuredClone(value.current.items); value.current.items[0].canEnqueue = true; },
    ]) {
      const value = specimen(); attack(value);
      expect(() => assert.deepEqual(project(value), value.old)).toThrow();
    }
  });

  it("is wired into full and every visible research parity check, outside untouched timed callbacks", () => {
    expect(source.match(/function historicalLabBlockers\(/g)).toHaveLength(1);
    expect(source).toContain("const prior = historicalLabBlockers(panel, fullOriginal.research, fixture.ready.state.planets,");
    expect(source).toContain('research: historicalResearch(fullCurrent.research, "full presenter")');
    expect(source).toContain('historicalResearch(visible.research, `${tab}: research`, resolved === "research")');
    expect(source).toContain('return { ...prior,\n    items: panel.items.map');
    expect(source).toContain('fixture.manifest.paidJobIds.build, "all source paid construction identities remain in exact world/queue order"');
    expect(source).toContain('fixture.ready.state.planets.map(() => ["metal_storage", "crystal_storage"])');
    expect(source).toContain('assert.equal(digest, rows[0].after.sha256, `exact adopted lab presentation source: ${path}`)');
    const measurement = source.slice(source.indexOf("// Escaping the callback result"), source.indexOf("const sourceHashes ="));
    expect(measurement).not.toContain("historicalLabBlockers");
    expect(measurement).not.toContain("historicalResearch");
    expect(measurement).toContain("() => beforePresent.present(state, input), () => afterPresent.presentVisible(state, input, tab)");
  });
});
