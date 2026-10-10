import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { exportSave, importSave, deserializeState, serializeState } from "../src/game/save";
import { readOrders, serializeOrders } from "../src/game/orders-save";
import { MAX_ORDER_TRIP_RECEIPTS } from "../src/game/order-state";
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { SaveSession } from "../src/game/save-session";

const money = (metal = "0", crystal = "0", deuterium = "0") => ({ metal, crystal, deuterium });
function pendingFile(kind: "building" | "research" | "shipyard" = "building"): any {
  const state = createInitialState(665);
  state.planets.push(createPlanet("donor", { galaxy: 2, system: 5, position: 4 }));
  const file = JSON.parse(exportSave(state, 1000));
  const task: any = { id: 1, kind, planetId: state.activePlanetId, status: "paused", reason: "",
    budget: money("100000", "100000", "100000"), charged: money(), refunded: money(), activeJob: null,
    completedUnits: 0, transport: { authorization: { donorPlanetId: "donor", ship: "small_cargo", count: 1,
      speedPercent: 100, maxTrips: 3, grossCargoCap: money("10000", "10000", "10000") }, trips: [] },
    currentWork: { workId: 1, shipmentFleetId: null, stage: "pending", spec: {}, reserved: money("60", "15") } };
  if (kind === "building") {
    Object.assign(task, { building: "metal_mine", targetLevel: 3 });
    task.currentWork.spec = { kind, building: "metal_mine", targetLevel: 1, price: money("60", "15") };
  } else if (kind === "research") {
    Object.assign(task, { tech: "energy_tech", targetLevel: 3 });
    task.currentWork.spec = { kind, tech: "energy_tech", targetLevel: 1, price: money("60", "15") };
  } else {
    Object.assign(task, { unit: "rocket_launcher", quantity: 10, completedUnits: 3, charged: money("4000") });
    task.currentWork.spec = { kind, unit: "rocket_launcher", quantity: 5, completedUnitsAtStart: 1, paidPerUnit: money("2000") };
    task.currentWork.reserved = money("6000");
  }
  file.state.orders = { nextTaskId: 2, nextJobId: 1, nextWorkId: 2, accumulator: 0, tasks: [task] };
  return file;
}
function tripFile(kind = "outbound", outcome: any = { kind: "delivered" }): any {
  const file = pendingFile(), task = file.state.orders.tasks[0];
  const target = { ...file.state.planets[0].coordinates };
  const phase = kind === "outbound" ? { kind } : kind === "returning" ? { kind, outcome, dockBlocked: false } : { kind, outcome };
  const trip = { fleetId: 1, workId: 1, targetPlanetId: task.planetId, target,
    cargo: money("60", "15"), fuel: "4", duration: 1000, phase };
  task.transport.trips = [trip]; task.currentWork.shipmentFleetId = 1; task.charged.deuterium = "4";
  file.state.nextFleetId = 2;
  if (kind === "outbound" || kind === "returning") file.state.fleets = [{
    id: 1, orderTransport: { taskId: 1, workId: 1 }, originId: "donor", target, mission: "transport", ships: { small_cargo: 1 },
    cargo: kind === "returning" && outcome.kind === "delivered" ? money() : money("60", "15"),
    duration: 1000, remaining: 750, elapsed: 250, returning: kind === "returning",
  }];
  if (kind === "prestige-retired") { task.status = "cancelled"; task.currentWork = null; }
  return file;
}
function paidFile(kind: "building" | "research" | "shipyard" = "building"): any {
  const file = pendingFile(kind), task = file.state.orders.tasks[0], work = task.currentWork;
  const quantity = kind === "shipyard" ? 3 : 1;
  task.activeJob = { jobId: 1, quantity, credited: 0 };
  delete work.reserved; Object.assign(work, { stage: "paid", jobId: 1 });
  file.state.orders.nextJobId = 2;
  const identity = { jobId: 1, taskId: 1, source: "plan" };
  if (kind === "building") file.state.planets[0].buildQueue = [{ ...identity, building: "metal_mine", targetLevel: 1,
    paid: money("60", "15"), totalSeconds: 20, remainingSeconds: 17 }];
  if (kind === "research") file.state.research.queue = [{ ...identity, planetId: task.planetId, tech: "energy_tech", targetLevel: 1,
    paid: money("60", "15"), totalSeconds: 20, remainingSeconds: 17 }];
  if (kind === "shipyard") file.state.planets[0].shipyardQueue = [{ ...identity, unit: "rocket_launcher", count: 3,
    orderedCount: 3, paidPerUnit: money("2000"), progress: 0.375 }];
  task.charged = kind === "shipyard" ? money("10000") : money("60", "15");
  return file;
}
function read(file: any) { return importSave(JSON.stringify(file)); }
function attachPaid(file: any): any {
  const paid = paidFile();
  file.state.planets[0].buildQueue = paid.state.planets[0].buildQueue;
  file.state.orders.nextJobId = 2;
  const task = file.state.orders.tasks[0];
  task.activeJob = paid.state.orders.tasks[0].activeJob;
  delete task.currentWork.reserved;
  Object.assign(task.currentWork, { stage: "paid", jobId: 1 });
  task.charged = money("60", "15", "4");
  return file;
}

// Synthetic adversarial boundary fixtures. Actual old-source exports are exercised independently.
describe("r6 transport save round trips", () => {
  it.each(["building", "research", "shipyard"] as const)("retains pending and paid %s fixed work", kind => {
    for (const file of [pendingFile(kind), paidFile(kind)]) {
      const first = read(file);
      expect(first.revision).toBe(SAVE_REVISION);
      expect(first.state).toEqual(file.state);
      expect(serializeState(deserializeState(first.state))).toEqual(first.state);
      expect(read(first)).toEqual(first);
    }
  });
  it.each([
    ["outbound", { kind: "delivered" }],
    ["returning", { kind: "delivered" }],
    ["returning", { kind: "not-delivered", reason: "manual-recall" }],
    ["returned", { kind: "delivered" }],
    ["returned", { kind: "not-delivered", reason: "precision-rejected" }],
    ["prestige-retired", null],
    ["prestige-retired", { kind: "delivered" }],
  ])("preserves %s receipts without creating economic events", (kind, outcome) => {
    const file = tripFile(kind as string, outcome);
    expect(read(file).state).toEqual(file.state);
  });
  it("allows paid work while the delivered ship is truly returning", () => {
    const file = attachPaid(tripFile("returning"));
    expect(read(file).state).toEqual(file.state);
  });
  it("accepts exhausted work/fleet counters only as unissued sentinels", () => {
    const file = tripFile(); file.state.orders.nextWorkId = Number.MAX_SAFE_INTEGER; file.state.nextFleetId = Number.MAX_SAFE_INTEGER;
    expect(() => read(file)).not.toThrow();
    file.state.orders.tasks[0].currentWork.workId = Number.MAX_SAFE_INTEGER;
    expect(() => read(file)).toThrow();
  });
  it.each(["cancelled", "completed"])("retains %s returning transport without a current work", status => {
    const file = tripFile("returning"); Object.assign(file.state.orders.tasks[0], { status, currentWork: null });
    expect(read(file).state).toEqual(file.state);
  });
  it("retains dock-blocked original ship and cargo at zero remaining time", () => {
    const file = tripFile("returning", { kind: "not-delivered", reason: "manual-recall" });
    file.state.orders.tasks[0].transport.trips[0].phase.dockBlocked = true;
    Object.assign(file.state.fleets[0], { remaining: 0, elapsed: 1000 });
    expect(read(file).state).toEqual(file.state);
  });
  it("permits only cancelled target-invalid returns when original executor is absent", () => {
    const file = tripFile("returning", { kind: "not-delivered", reason: "target-invalid" });
    const task = file.state.orders.tasks[0];
    Object.assign(task, { status: "cancelled", currentWork: null, planetId: "missing" });
    task.transport.trips[0].targetPlanetId = "missing";
    expect(() => read(file)).not.toThrow();
    task.transport.trips[0].phase.outcome.reason = "manual-recall";
    expect(() => read(file)).toThrow();
  });
  it("allows settled terminal history after both old planets disappear", () => {
    const file = tripFile("returned"), task = file.state.orders.tasks[0];
    Object.assign(task, { status: "cancelled", currentWork: null, planetId: "missing" });
    task.transport.authorization.donorPlanetId = "old-donor";
    task.transport.trips[0].targetPlanetId = "missing";
    expect(() => read(file)).not.toThrow();
  });
  it("deep-copies all authorization, work, manifest, coordinate and phase data", () => {
    const orders = readOrders(tripFile("returning").state.orders), cloned = serializeOrders(orders);
    cloned.tasks[0]!.transport!.authorization.grossCargoCap.metal = "0";
    cloned.tasks[0]!.transport!.trips[0]!.cargo.metal = "0";
    cloned.tasks[0]!.transport!.trips[0]!.target.system = 1;
    cloned.tasks[0]!.transport!.trips[0]!.phase = { kind: "outbound" };
    cloned.tasks[0]!.currentWork!.spec = { kind: "building", building: "metal_mine", targetLevel: 2, price: money() };
    expect(orders).toEqual(tripFile("returning").state.orders);
    const state = deserializeState(tripFile().state), serialized = serializeState(state);
    serialized.fleets[0]!.orderTransport!.workId = 2;
    expect(state.fleets[0]!.orderTransport!.workId).toBe(1);
  });
});

describe("r6 strict transport structure and identity", () => {
  const mutations: Array<[string, (file: any) => void]> = [
    ["missing nextWorkId", f => { delete f.state.orders.nextWorkId; }],
    ["missing transport", f => { delete f.state.orders.tasks[0].transport; }],
    ["missing currentWork", f => { delete f.state.orders.tasks[0].currentWork; }],
    ["missing fleet tag", f => { delete f.state.fleets[0].orderTransport; }],
    ["unknown auth field", f => { f.state.orders.tasks[0].transport.authorization.autoShips = true; }],
    ["unknown fleet field", f => { f.state.fleets[0].delivered = true; }],
    ["unknown phase", f => { f.state.orders.tasks[0].transport.trips[0].phase.kind = "arrived"; }],
    ["phase extra data", f => { f.state.orders.tasks[0].transport.trips[0].phase.dockBlocked = false; }],
    ["unknown spec field", f => { f.state.orders.tasks[0].currentWork.spec.quantity = 1; }],
    ["same source and executor", f => { f.state.orders.tasks[0].transport.authorization.donorPlanetId = f.state.activePlanetId; }],
    ["missing donor", f => { f.state.orders.tasks[0].transport.authorization.donorPlanetId = "missing"; }],
    ["satellite", f => { f.state.orders.tasks[0].transport.authorization.ship = "solar_satellite"; }],
    ["defense", f => { f.state.orders.tasks[0].transport.authorization.ship = "rocket_launcher"; }],
    ["fractional count", f => { f.state.orders.tasks[0].transport.authorization.count = 1.5; }],
    ["zero count", f => { f.state.orders.tasks[0].transport.authorization.count = 0; }],
    ["invalid speed", f => { f.state.orders.tasks[0].transport.authorization.speedPercent = 25; }],
    ["too many trips", f => { f.state.orders.tasks[0].transport.authorization.maxTrips = 101; }],
    ["work future ID", f => { f.state.orders.nextWorkId = 1; }],
    ["fleet future ID", f => { f.state.nextFleetId = 1; }],
    ["work sentinel used", f => { f.state.orders.tasks[0].currentWork.workId = Number.MAX_SAFE_INTEGER; }],
    ["empty cargo manifest", f => { f.state.orders.tasks[0].transport.trips[0].cargo = money(); }],
    ["fleet orphan", f => { f.state.orders.tasks[0].transport.trips = []; }],
    ["receipt orphan", f => { f.state.fleets = []; }],
    ["fleet tag erased", f => { f.state.fleets[0].orderTransport = null; }],
    ["wrong task owner", f => { f.state.fleets[0].orderTransport.taskId = 2; }],
    ["wrong work owner", f => { f.state.fleets[0].orderTransport.workId = 2; }],
    ["wrong origin", f => { f.state.fleets[0].originId = f.state.activePlanetId; }],
    ["wrong target ID", f => { f.state.orders.tasks[0].transport.trips[0].targetPlanetId = "donor"; }],
    ["wrong target coordinates", f => { f.state.fleets[0].target = { galaxy: 3, system: 5, position: 4 }; }],
    ["wrong ship", f => { f.state.fleets[0].ships = { light_fighter: 1 }; }],
    ["extra zero ship", f => { f.state.fleets[0].ships.light_fighter = 0; }],
    ["zero fuel", f => { f.state.orders.tasks[0].transport.trips[0].fuel = "0"; }],
    ["wrong ship count", f => { f.state.fleets[0].ships.small_cargo = 2; }],
    ["wrong mission", f => { f.state.fleets[0].mission = "deploy"; }],
    ["forged zero cargo", f => { f.state.fleets[0].cargo = money(); }],
    ["inexact fleet cargo", f => { f.state.fleets[0].cargo.metal = "60.000000000000000001"; }],
    ["inexact manifest", f => { f.state.orders.tasks[0].transport.trips[0].cargo.metal = "60.000000000000000001"; }],
    ["inexact fuel", f => { f.state.orders.tasks[0].transport.trips[0].fuel = "4.000000000000000001"; }],
    ["duration mismatch", f => { f.state.orders.tasks[0].transport.trips[0].duration = 1001; }],
    ["forged returning", f => { f.state.fleets[0].returning = true; }],
    ["cleared shipment identity", f => { f.state.orders.tasks[0].currentWork.shipmentFleetId = null; }],
    ["wrong shipment identity", f => { f.state.orders.tasks[0].currentWork.shipmentFleetId = 2; }],
    ["wrong pending reserve", f => { f.state.orders.tasks[0].currentWork.reserved.metal = "59"; }],
    ["pending skips actual predecessor", f => { f.state.orders.tasks[0].currentWork.spec.targetLevel = 2; }],
    ["wrong frozen target", f => { f.state.orders.tasks[0].currentWork.spec.building = "crystal_mine"; }],
    ["terminal outbound", f => { Object.assign(f.state.orders.tasks[0], { status: "cancelled", currentWork: null }); }],
    ["outbound missing work", f => { f.state.orders.tasks[0].currentWork = null; }],
    ["new work before prior return", f => { f.state.orders.nextWorkId = 3; Object.assign(f.state.orders.tasks[0].currentWork, { workId: 2, shipmentFleetId: null }); }],
    ["local plan with transport work", f => { f.state.orders.tasks[0].transport = null; }],
    ["net and reserved budget exceeded", f => { f.state.orders.tasks[0].budget.metal = "59"; }],
    ["gross cap exceeded", f => { f.state.orders.tasks[0].transport.authorization.grossCargoCap.metal = "59"; }],
    ["fuel never charged", f => { f.state.orders.tasks[0].charged.deuterium = "3"; }],
    ["fuel refunded", f => { f.state.orders.tasks[0].refunded.deuterium = "1"; }],
  ];
  it.each(mutations)("rejects %s", (_label, mutate) => {
    const file = tripFile(); mutate(file); expect(() => read(file)).toThrow();
  });
  it("rejects pending plus paid queue, and paid without its exact queue", () => {
    const file = paidFile(); file.state.orders.tasks[0].currentWork = pendingFile().state.orders.tasks[0].currentWork;
    expect(() => read(file)).toThrow();
    const missing = paidFile(); missing.state.planets[0].buildQueue = []; expect(() => read(missing)).toThrow();
  });
  it.each(["outbound", "returning"])("rejects paid work during %s before successful delivery or actual failed-trip return", phase => {
    const file = attachPaid(tripFile(phase, { kind: "not-delivered", reason: "manual-recall" }));
    expect(() => read(file)).toThrow();
  });
  it("accepts local payment after a failed trip actually returns", () => {
    expect(() => read(attachPaid(tripFile("returned", { kind: "not-delivered", reason: "manual-recall" })))).not.toThrow();
  });
  it("checks refundable payment liability after subtracting irreversible fuel", () => {
    const file = attachPaid(tripFile("returning"));
    file.state.planets[0].buildQueue[0].paid.deuterium = "4";
    file.state.orders.tasks[0].currentWork.spec.price.deuterium = "4";
    expect(() => read(file)).toThrow("退款超过净支出");
  });
  it.each(["building", "research", "shipyard"] as const)("rejects %s paid snapshot drift", kind => {
    const file = paidFile(kind), spec = file.state.orders.tasks[0].currentWork.spec;
    (spec.price ?? spec.paidPerUnit).metal = "59";
    expect(() => read(file)).toThrow();
  });
  it("rejects ship work completion watermark drift after cancellation and re-payment", () => {
    const file = paidFile("shipyard"); file.state.orders.tasks[0].currentWork.spec.completedUnitsAtStart = 0;
    expect(() => read(file)).toThrow();
  });
  it("rejects a transport building behind an uncompleted same-goal predecessor", () => {
    const file = paidFile(), task = file.state.orders.tasks[0];
    file.state.orders.nextJobId = 3;
    const predecessor = structuredClone(file.state.planets[0].buildQueue[0]);
    Object.assign(predecessor, { source: "manual", taskId: null, jobId: 2 });
    file.state.planets[0].buildQueue.unshift(predecessor);
    task.currentWork.spec.targetLevel = 2; file.state.planets[0].buildQueue[1].targetLevel = 2;
    expect(() => read(file)).toThrow();
  });
  it("rejects missing/extra returning outcomes and nonzero delivered cargo", () => {
    for (const mutate of [
      (f: any) => { delete f.state.orders.tasks[0].transport.trips[0].phase.outcome; },
      (f: any) => { f.state.orders.tasks[0].transport.trips[0].phase.outcome.kind = "unloaded"; },
      (f: any) => { f.state.orders.tasks[0].transport.trips[0].phase.outcome = { kind: "not-delivered", reason: ["manual-recall"] }; },
      (f: any) => { f.state.orders.tasks[0].transport.trips[0].phase.outcome.reason = "manual-recall"; },
      (f: any) => { delete f.state.orders.tasks[0].transport.trips[0].phase.dockBlocked; },
      (f: any) => { f.state.orders.tasks[0].transport.trips[0].phase.dockBlocked = true; },
      (f: any) => { f.state.fleets[0].cargo.metal = "1"; },
    ]) { const file = tripFile("returning"); mutate(file); expect(() => read(file)).toThrow(); }
  });
  it("rejects a fleet attached to a returned or prestige-retired receipt", () => {
    for (const phase of ["returned", "prestige-retired"]) {
      const file = tripFile(phase); file.state.fleets = tripFile("returning").state.fleets;
      expect(() => read(file)).toThrow();
    }
  });
  it("rejects duplicate fleet receipts and multiple trips for one historical work", () => {
    for (const distinctFleet of [false, true]) {
      const file = tripFile("returned"), task = file.state.orders.tasks[0];
      const duplicate = structuredClone(task.transport.trips[0]);
      if (distinctFleet) { duplicate.fleetId = 2; file.state.nextFleetId = 3; }
      task.transport.trips.push(duplicate); expect(() => read(file)).toThrow();
    }
  });
  it("rejects retained historical work IDs claimed by another task", () => {
    const file = tripFile("returned"), task = file.state.orders.tasks[0];
    Object.assign(task, { status: "cancelled", currentWork: null });
    const other = structuredClone(task); other.id = 2; other.transport.trips[0].fleetId = 2;
    file.state.orders.tasks.push(other); file.state.orders.nextTaskId = 3; file.state.nextFleetId = 3;
    expect(() => read(file)).toThrow("跨计划冒领");
  });
  it("rejects two active trips even when each fleet/work reference is individually unique", () => {
    const file = tripFile("returning"), task = file.state.orders.tasks[0];
    task.transport.trips.push({ ...structuredClone(task.transport.trips[0]), fleetId: 2, workId: 2 });
    file.state.fleets.push({ ...structuredClone(file.state.fleets[0]), id: 2, orderTransport: { taskId: 1, workId: 2 } });
    file.state.nextFleetId = 3; file.state.orders.nextWorkId = 3; task.charged.deuterium = "8";
    expect(() => read(file)).toThrow("最多一艘");
  });
  it("bounds global retained receipts at 256, including terminal history", () => {
    const file = tripFile("returned"), original = file.state.orders.tasks[0];
    file.state.orders.tasks = []; let fleetId = 1;
    for (let index = 0; index < 3; index++) {
      const task = structuredClone(original); Object.assign(task, { id: index + 1, status: "cancelled", currentWork: null });
      task.transport.authorization.maxTrips = 100;
      task.transport.trips = Array.from({ length: index < 2 ? 100 : 56 }, () => {
        const trip = { ...structuredClone(original.transport.trips[0]), fleetId, workId: fleetId }; fleetId += 1; return trip;
      });
      task.charged.deuterium = String(task.transport.trips.length * 4); file.state.orders.tasks.push(task);
    }
    file.state.orders.nextTaskId = 4; file.state.nextFleetId = fleetId + 1; file.state.orders.nextWorkId = fleetId + 1;
    expect(file.state.orders.tasks.flatMap((t: any) => t.transport.trips)).toHaveLength(MAX_ORDER_TRIP_RECEIPTS);
    expect(() => read(file)).not.toThrow();
    file.state.orders.tasks[2].transport.trips.push({ ...structuredClone(original.transport.trips[0]), fleetId, workId: fleetId });
    expect(() => read(file)).toThrow("全局上限");
  });
  it("rejects historical exact-fuel accumulation overflow instead of rounding it away", () => {
    const file = tripFile("returned"), task = file.state.orders.tasks[0];
    task.budget.deuterium = task.charged.deuterium = "1e190";
    task.transport.trips[0].fuel = "1e190";
    task.transport.trips.push({ ...structuredClone(task.transport.trips[0]), fleetId: 2, workId: 2, fuel: "1" });
    file.state.nextFleetId = 3; file.state.orders.nextWorkId = 3;
    expect(() => read(file)).toThrow("累计溢出");
  });
});

describe("r6 to r7 retains the complete existing transport state", () => {
  it.each(["pending", "paid-research", "outbound", "returning"])("adds only empty intent to %s source state", scenario => {
    const file = scenario === "pending" ? pendingFile() : scenario === "paid-research" ? paidFile("research") : tripFile(scenario);
    file.revision = 6; delete file.state.researchTemplates;
    const original = structuredClone(file), imported = read(file);
    expect(file).toEqual(original);
    const { researchTemplates, ...projection } = imported.state;
    expect(researchTemplates).toEqual({ nextTemplateId: 1, templates: [] });
    expect(projection).toEqual(file.state);
    expect(read(imported)).toEqual(imported);
  });
  it("keeps paid r6 research and transport receipts frozen when migration backup fails", () => {
    for (const file of [paidFile("research"), tripFile()]) {
      file.revision = 6; delete file.state.researchTemplates;
      const raw = JSON.stringify(file), data = new Map([[STORAGE_KEY, raw]]);
      const store = { getItem: (key: string) => data.get(key) ?? null,
        setItem: () => { throw Error("synthetic quota failure"); }, removeItem: (key: string) => { data.delete(key); } };
      const session = new SaveSession(store, 6000);
      expect(session.mode).toBe("protected");
      expect(session.loaded.appliedSeconds).toBe(0);
      const { researchTemplates, ...projection } = serializeState(session.loaded.state);
      expect(researchTemplates).toEqual({ nextTemplateId: 1, templates: [] });
      expect(projection).toEqual(file.state);
      expect(session.export(session.loaded.state, 6000)).toEqual({ raw, protected: true });
      expect(data.get(STORAGE_KEY)).toBe(raw);
    }
  });
});

describe("r5 transport migration is additive and cannot erase smuggled authority", () => {
  function r5(): any {
    const file = paidFile("shipyard");
    const task = file.state.orders.tasks[0];
    file.revision = 5; delete file.state.researchTemplates; delete file.state.orders.nextWorkId; delete task.transport; delete task.currentWork;
    return file;
  }
  it("preserves paid local identities, partial progress and all original ledgers", () => {
    const file = r5(), first = read(file), projected = structuredClone(first.state) as any;
    expect(projected.researchTemplates).toEqual({ nextTemplateId: 1, templates: [] }); delete projected.researchTemplates;
    expect(projected.orders.nextWorkId).toBe(1); delete projected.orders.nextWorkId;
    for (const task of projected.orders.tasks) {
      expect(task.transport).toBeNull(); expect(task.currentWork).toBeNull(); delete task.transport; delete task.currentWork;
    }
    expect(projected).toEqual(file.state);
    expect(read(first)).toEqual(first);
  });
  it.each(["transport", "currentWork", "nextWorkId", "orderTransport", "workId", "shipmentFleetId", "grossCargoCap"])("rejects even null r6 %s on an old revision", key => {
    const file = r5(); file.state.orders.tasks[0][key] = null;
    expect(() => read(file)).toThrow("不能夹带 r6");
  });
  it("still validates r5 owner identities before accepting the additive upgrade", () => {
    const file = r5(); file.state.orders.tasks[0].activeJob.jobId = 2;
    expect(() => read(file)).toThrow();
  });
  it("invalid import leaves current raw bytes and live state unchanged", () => {
    const original = exportSave(createInitialState(9), 1000), data = new Map([[STORAGE_KEY, original]]);
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const session = new SaveSession(store, 1000), before = serializeState(session.loaded.state);
    const invalid = tripFile(); invalid.state.orders.tasks[0].currentWork.shipmentFleetId = null;
    expect(session.importText(JSON.stringify(invalid), 1000)).toMatchObject({ ok: false, code: "invalid" });
    expect(data.get(STORAGE_KEY)).toBe(original); expect(serializeState(session.loaded.state)).toEqual(before); expect(data.size).toBe(1);
  });
});
