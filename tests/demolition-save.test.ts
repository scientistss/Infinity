import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { readDemolitionJob, serializeDemolitionJob } from "../src/game/demolition-save";
import { MAX_DEMOLITION_SECONDS } from "../src/game/demolition-state";
import { activePlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { actualPaidJobs } from "../src/game/paid-job-identity";
import { createPlanet, clonePlanet } from "../src/game/planet";
import { importSave, exportSave, deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";

/** Explicitly synthetic reader-unit input. Genuine paid producer coverage is below. */
function job(): any {
  return { kind: "demolition", source: "manual", taskId: null, demolitionRuleVersion: 1,
    jobId: 1, building: "metal_mine", fromLevel: 10, toLevel: 9,
    paid: { metal: "1476", crystal: "369", deuterium: "0" }, totalSeconds: 4.6104, remainingSeconds: 4.3604 };
}
function file(): any {
  const state = createInitialState(123, 456);
  activePlanet(state).buildings.metal_mine = 10;
  const result = JSON.parse(exportSave(tick(state, 0), 1000));
  result.state.planets[0].demolition = job();
  result.state.orders.nextJobId = 2;
  return result;
}
const read = (value: unknown) => importSave(JSON.stringify(value));

function actuallyPaid(ion = 1) {
  const state = createInitialState(123, 456);
  activePlanet(state).buildings.metal_mine = 10;
  activePlanet(state).resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  state.research.levels.ion_tech = ion;
  const refreshed = tick(state, 0), quote = quoteDemolition(refreshed, "metal_mine");
  expect(quote.ok, quote.reason).toBe(true);
  const committed = commitDemolition(refreshed, quote.quote!);
  expect(committed.ok, committed.reason).toBe(true);
  return committed.state;
}

describe("r11 strict independent demolition slot", () => {
  it("has one explicit null slot and clones the job and saved paid independently", () => {
    const state = createInitialState(123, 456), planet = activePlanet(state);
    expect(planet.demolition).toBeNull();
    expect(read(JSON.parse(exportSave(state, 1000))).state.planets[0]!.demolition).toBeNull();
    planet.demolition = readDemolitionJob(job());
    const cloned = clonePlanet(planet);
    expect(cloned.demolition).not.toBe(planet.demolition);
    expect(cloned.demolition!.paid).not.toBe(planet.demolition!.paid);
  });
  it("preserves actual paid partial work, fractional time and stable ID through a cold read", () => {
    const issued = actuallyPaid(), paidTotal = activePlanet(issued).demolition!.totalSeconds;
    const partial = tick(issued, 0.25), raw = exportSave(partial, 1250), parsed = JSON.parse(raw);
    expect(parsed.revision).toBe(12);
    expect(parsed.state.planets[0].demolition.paid).toEqual({ metal: "1476", crystal: "369", deuterium: "0" });
    expect(Math.abs(paidTotal - 4.6104)).toBeLessThanOrEqual(Number.EPSILON * 4.6104);
    expect(parsed.state.planets[0].demolition.totalSeconds).toBe(paidTotal);
    expect(parsed.state.planets[0].demolition.remainingSeconds).toBe(paidTotal - 0.25);
    expect(read(parsed)).toEqual(parsed);
    const cold = deserializeState(read(parsed).state), saved = activePlanet(cold).demolition!;
    expect(serializeState(cold)).toEqual(parsed.state);
    // Later technology and different current wallets cannot reprice or invalidate already-paid work.
    cold.research.levels.ion_tech = 25; cold.curvature.growth_cut = 1;
    activePlanet(cold).resources = { metal: big(0), crystal: big(0), deuterium: big(0) };
    expect(importSave(exportSave(cold, 1250)).state.planets[0]!.demolition).toEqual(serializeDemolitionJob(saved));
    const finished = tick(cold, saved.remainingSeconds);
    expect(activePlanet(finished).demolition).toBeNull();
    expect(activePlanet(finished).buildings.metal_mine).toBe(9);
    const finishedCold = deserializeState(importSave(exportSave(finished, 6000)).state);
    expect(activePlanet(tick(finishedCold, 10)).buildings.metal_mine).toBe(9);
  });
  it.each([25, 26])("retains zero-payment ion %i work as one issued paid identity", ion => {
    const state = tick(actuallyPaid(ion), 0.25), first = importSave(exportSave(state, 1250));
    expect(first.state.planets[0]!.demolition!.paid).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
    expect(first.state.planets[0]!.demolition!.totalSeconds).toBe(activePlanet(state).demolition!.totalSeconds);
    expect(Math.abs(first.state.planets[0]!.demolition!.totalSeconds - 4.6104)).toBeLessThanOrEqual(Number.EPSILON * 4.6104);
    expect(first.state.orders.nextJobId).toBe(2);
    expect(actualPaidJobs(deserializeState(first.state)).map(entry => [entry.kind, entry.job.jobId])).toEqual([["demolition", 1]]);
    expect(importSave(JSON.stringify(first))).toEqual(first);
  });
  it.each([
    ["missing slot", (f: any) => { delete f.state.planets[0].demolition; }],
    ["array", (f: any) => { f.state.planets[0].demolition = [job()]; }],
    ["false", (f: any) => { f.state.planets[0].demolition = false; }],
    ["multiple jobs", (f: any) => { f.state.planets[0].demolition = { jobs: [job(), job()] }; }],
    ["wrong level", (f: any) => { f.state.planets[0].buildings.metal_mine = 11; }],
    ["below floor", (f: any) => { f.state.terraformerGrantJobFloor = 2; }],
  ] as const)("rejects %s without normalization", (_label, mutate) => {
    const candidate = file(); mutate(candidate); const before = structuredClone(candidate);
    expect(() => read(candidate)).toThrow(); expect(candidate).toEqual(before);
  });
  it.each([
    ["kind", "building"], ["source", "protocol"], ["source", "plan"], ["taskId", 1],
    ["demolitionRuleVersion", 2], ["building", "terraformer"], ["building", "lunar_base"],
    ["building", "alliance_depot"], ["fromLevel", 0], ["fromLevel", 1001], ["fromLevel", 1.5],
    ["toLevel", 10], ["toLevel", -1], ["jobId", 0], ["jobId", -1], ["jobId", 1.5],
    ["jobId", Number.MAX_SAFE_INTEGER], ["totalSeconds", 0], ["totalSeconds", -1],
    ["totalSeconds", Infinity], ["totalSeconds", MAX_DEMOLITION_SECONDS], ["remainingSeconds", -1],
    ["remainingSeconds", 4.6105], ["remainingSeconds", NaN],
  ] as const)("rejects invalid %s=%s", (key, value) => {
    const candidate = job(); candidate[key] = value; expect(() => readDemolitionJob(candidate)).toThrow();
  });
  it("rejects absent, unexpected, inherited and symbol fields even before serialization", () => {
    for (const key of Object.keys(job())) { const candidate = job(); delete candidate[key]; expect(() => readDemolitionJob(candidate)).toThrow(); }
    for (const key of ["budget", "transport", "authorization", "timeCost", "jobs"]) {
      expect(() => readDemolitionJob({ ...job(), [key]: null })).toThrow();
    }
    expect(() => readDemolitionJob(Object.assign(Object.create({ malicious: true }), job()))).toThrow();
    expect(() => readDemolitionJob({ ...job(), [Symbol("extra")]: true })).toThrow();
    expect(() => readDemolitionJob(undefined)).toThrow();
    const runtime = readDemolitionJob(job())!;
    Object.assign(runtime, { extra: undefined });
    expect(() => serializeDemolitionJob(runtime)).toThrow();
  });
  it("retains valid zero/fractional time boundary exactly and refuses negative zero JSON drift", () => {
    for (const remainingSeconds of [0, 0.0000000001, 4.6104]) {
      const candidate = { ...job(), remainingSeconds };
      expect(serializeDemolitionJob(readDemolitionJob(candidate))).toEqual(candidate);
    }
    expect(() => readDemolitionJob({ ...job(), remainingSeconds: -0 })).toThrow();
    expect(() => readDemolitionJob({ ...job(), fromLevel: 1, toLevel: -0 })).toThrow();
    const large = { ...job(), totalSeconds: 2576980377.6, remainingSeconds: 2576980377.6 - 1 / 144,
      paid: { metal: "40", crystal: "0", deuterium: "0" } };
    expect(serializeDemolitionJob(readDemolitionJob(large))).toEqual(large);
  });
});

describe("canonical exact demolition payment snapshots", () => {
  it.each([0, -1, "-1", "1.5", "NaN", "Infinity", "1e191", "1e-19", "+1", "01", "1.0", "1e0", "1073741824000", "1000000000000000001"])("rejects %s instead of rounding or normalizing it", amount => {
    const candidate = job(); candidate.paid.metal = amount;
    expect(() => readDemolitionJob(candidate)).toThrow();
  });
  it.each(["0", "40", "1e+21", "1e+190"])("accepts the canonical exact integer %s", amount => {
    const candidate = job(); candidate.paid.metal = amount;
    expect(serializeDemolitionJob(readDemolitionJob(candidate))).toEqual(candidate);
  });
  it("rejects missing/extra resource keys and non-plain money maps", () => {
    const missing = job(); delete missing.paid.crystal;
    const extra = job(); extra.paid.energy = "0";
    const inherited = job(); inherited.paid = Object.assign(Object.create({ x: 1 }), inherited.paid);
    for (const candidate of [missing, extra, inherited]) expect(() => readDemolitionJob(candidate)).toThrow();
  });
});

describe("complete paid-ID ownership including free demolition", () => {
  it.each(["building", "research", "shipyard", "demolition"])("rejects a duplicate against %s on another world", kind => {
    const candidate = file(), colony = createPlanet("colony", { galaxy: 1, system: 50, position: 9 });
    candidate.state.planets.push(serializeState({ ...createInitialState(123, 456), planets: [colony] }).planets[0]);
    const target = candidate.state.planets[1];
    if (kind === "building") target.buildQueue = [{ jobId: 1, taskId: null, source: "manual", building: "solar_plant", targetLevel: 1,
      paid: { metal: "0", crystal: "0", deuterium: "0" }, totalSeconds: 1, remainingSeconds: 1 }];
    if (kind === "research") candidate.state.research.queue = [{ jobId: 1, taskId: null, source: "manual", planetId: "colony", tech: "energy_tech", targetLevel: 1,
      paid: { metal: "0", crystal: "0", deuterium: "0" }, totalSeconds: 1, remainingSeconds: 1 }];
    if (kind === "shipyard") target.shipyardQueue = [{ jobId: 1, taskId: null, source: "manual", unit: "light_fighter", count: 1, orderedCount: 1,
      paidPerUnit: { metal: "3000", crystal: "1000", deuterium: "0" }, progress: 0 }];
    if (kind === "demolition") { target.buildings.metal_mine = 10; target.demolition = job(); }
    expect(() => read(candidate)).toThrow(/付款 ID/);
  });
  it("rejects jobId>=next and cannot let a finite-plan receipt claim demolition", () => {
    const candidate = file(); candidate.state.orders.nextJobId = 1;
    expect(() => read(candidate)).toThrow(/付款 ID/);
    const claim = file(); claim.state.orders.nextTaskId = 2;
    claim.state.orders.tasks = [{ id: 1, kind: "building", planetId: "homeworld", building: "crystal_mine", targetLevel: 2,
      status: "paused", reason: "synthetic forged ownership", budget: { metal: "2000", crystal: "2000", deuterium: "0" },
      charged: { metal: "1476", crystal: "369", deuterium: "0" }, refunded: { metal: "0", crystal: "0", deuterium: "0" },
      activeJob: { jobId: 1, quantity: 1, credited: 0 }, completedUnits: 0, transport: null, currentWork: null, formationOrigin: null }];
    expect(() => read(claim)).toThrow(/凭证没有对应队列/);
  });
  it("counts free demolition in G+P<=I and leaves exhausted-counter history valid", () => {
    const candidate = file(), planet = candidate.state.planets[0];
    planet.demolition.paid = { metal: "0", crystal: "0", deuterium: "0" };
    planet.buildings.terraformer = 1; planet.terraformerFields.grantedLevels = 1; planet.fieldsMax = 168;
    // G1 + P1 cannot fit in just one issued identity. Omitting a zero job would admit this.
    expect(() => read(candidate)).toThrow(/发行数量/);
    candidate.state.orders.nextJobId = 3;
    expect(read(candidate).state.planets[0]!.demolition).toEqual(planet.demolition);
    candidate.state.orders.nextJobId = Number.MAX_SAFE_INTEGER;
    candidate.state.planets[0].demolition.jobId = Number.MAX_SAFE_INTEGER - 1;
    expect(read(candidate).state.orders.nextJobId).toBe(Number.MAX_SAFE_INTEGER);
  });
});
