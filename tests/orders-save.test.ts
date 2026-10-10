import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { exportSave, importSave, deserializeState, serializeState } from "../src/game/save";
import { readOrders, serializeOrders } from "../src/game/orders-save";
import { createOrderState, MAX_LIVE_ORDER_TASKS, MAX_ORDER_TASKS } from "../src/game/order-state";
import { SAVE_REVISION } from "../src/game/content";

const zero = () => ({ metal: "0", crystal: "0", deuterium: "0" });
const price = (metal: string, crystal = "0", deuterium = "0") => ({ metal, crystal, deuterium });
function emptyFile() { return JSON.parse(exportSave(createInitialState(55), 1000)); }
function paidFile(kind: "building" | "research" | "shipyard" = "building") {
  const file = emptyFile(), state = file.state;
  const task = { id: 1, kind, planetId: state.activePlanetId, status: "running", reason: "",
    budget: price("100000", "100000", "100000"), charged: price("60", "15"), refunded: zero(),
    activeJob: { jobId: 1, quantity: 1, credited: 0 }, completedUnits: 0 } as any;
  const job = { jobId: 1, taskId: 1, source: "plan" };
  if (kind === "building") {
    Object.assign(task, { building: "metal_mine", targetLevel: 3 });
    state.planets[0].buildQueue.push({ ...job, building: "metal_mine", targetLevel: 1,
      paid: price("60", "15"), totalSeconds: 20, remainingSeconds: 12.5 });
  } else if (kind === "research") {
    Object.assign(task, { tech: "energy_tech", targetLevel: 3 });
    state.research.queue.push({ ...job, planetId: state.activePlanetId, tech: "energy_tech", targetLevel: 1,
      paid: price("60", "15"), totalSeconds: 20, remainingSeconds: 12.5 });
  } else {
    Object.assign(task, { unit: "rocket_launcher", quantity: 10, charged: price("10000"), completedUnits: 2,
      activeJob: { jobId: 1, quantity: 5, credited: 2 } });
    state.planets[0].shipyardQueue.push({ ...job, unit: "rocket_launcher", count: 3, orderedCount: 5,
      paidPerUnit: price("2000"), progress: 0.375 });
  }
  state.orders = { nextTaskId: 2, nextJobId: 2, accumulator: 7.5, tasks: [task] };
  return file;
}
function read(file: any) { return importSave(JSON.stringify(file)); }
function queueFile() {
  const state = createInitialState(81);
  state.planets.push(createPlanet("colony", { galaxy: 2, system: 1, position: 1 }));
  const file = JSON.parse(exportSave(state, 1000));
  for (let index = 0; index < file.state.planets.length; index++) {
    const planet = file.state.planets[index];
    planet.buildQueue = [{ jobId: 10 + index * 2, taskId: null, source: "manual", building: "metal_mine", targetLevel: 1,
      paid: price("60", "15"), totalSeconds: 30.125 + index, remainingSeconds: 17.0625 + index }];
    planet.shipyardQueue = [{ jobId: 11 + index * 2, taskId: null, source: "protocol", unit: "rocket_launcher", count: 3,
      orderedCount: 5, paidPerUnit: price("2000"), progress: 0.375 }];
  }
  file.state.research.queue = [{ jobId: 14, taskId: null, source: "protocol", planetId: "colony", tech: "energy_tech", targetLevel: 1,
    paid: price("0", "800", "400"), totalSeconds: 44.5, remainingSeconds: 11.125 }];
  file.state.orders.nextJobId = 15;
  return file;
}
function legacyFile(revision: 2 | 3 | 4) {
  const file = queueFile();
  file.revision = revision;
  delete file.state.orders;
  for (const planet of file.state.planets) {
    for (const job of [...planet.buildQueue, ...planet.shipyardQueue]) {
      delete job.jobId; delete job.taskId; delete job.orderedCount; delete job.paidPerUnit;
    }
  }
  for (const job of file.state.research.queue) { delete job.jobId; delete job.taskId; }
  if (revision < 4) {
    delete file.state.arcade.nextRunId; delete file.state.arcade.autoBatch;
    for (const run of file.state.arcade.runs) delete run.id;
  }
  if (revision === 2) delete file.state.deepSpace;
  return file;
}

// Entirely synthetic snapshots; mutation cases are adversarial save files, never player data.
describe("r5 finite order persistence", () => {
  it.each(["building", "research", "shipyard"] as const)("round-trips %s ownership, exact ledgers, timer and completion watermark", kind => {
    const file = paidFile(kind), first = read(file);
    expect(first.revision).toBe(SAVE_REVISION);
    expect(first.state).toEqual(file.state);
    expect(serializeState(deserializeState(first.state))).toEqual(first.state);
    expect(read(first)).toEqual(first);
  });
  it("serializes independent nested ledger and receipt objects", () => {
    const original = readOrders(paidFile().state.orders), copy = serializeOrders(original);
    copy.tasks[0]!.budget.metal = "0";
    copy.tasks[0]!.activeJob!.credited = 1;
    expect(original.tasks[0]!.budget.metal).toBe("100000");
    expect(original.tasks[0]!.activeJob!.credited).toBe(0);
  });
  it("accepts exhausted counters as sentinels but not issued MAX_SAFE_INTEGER IDs", () => {
    const file = paidFile();
    file.state.orders.nextTaskId = Number.MAX_SAFE_INTEGER;
    file.state.orders.nextJobId = Number.MAX_SAFE_INTEGER;
    expect(() => read(file)).not.toThrow();
    file.state.planets[0].buildQueue[0].jobId = Number.MAX_SAFE_INTEGER;
    file.state.orders.tasks[0].activeJob.jobId = Number.MAX_SAFE_INTEGER;
    expect(() => read(file)).toThrow();
  });
  it("keeps terminal history for a removed planet with no receipt", () => {
    const file = paidFile();
    file.state.planets[0].buildQueue = [];
    Object.assign(file.state.orders.tasks[0], { status: "cancelled", planetId: "retired", activeJob: null });
    file.state.orders.accumulator = 0;
    expect(read(file).state.orders.tasks[0].planetId).toBe("retired");
  });
  it("permits a retained paid remainder after unrelated rewards consume local stock capacity", () => {
    const file = paidFile("shipyard");
    file.state.planets[0].units.rocket_launcher = 1e15;
    expect(read(file).state.planets[0].shipyardQueue[0].count).toBe(3);
  });
  it("checks refundable liability against exact net commitment, beyond floating-point precision", () => {
    const file = paidFile(), task = file.state.orders.tasks[0];
    task.budget.metal = "1e20"; task.charged.metal = "100000000000000000060"; task.refunded.metal = "1e20";
    expect(() => read(file)).not.toThrow();
    task.refunded.metal = "100000000000000000001";
    expect(() => read(file)).toThrow("退款超过净支出");
  });
  it.each([
    ["missing orders", (f: any) => { delete f.state.orders; }],
    ["missing counter", (f: any) => { delete f.state.orders.nextJobId; }],
    ["unsafe counter", (f: any) => { f.state.orders.nextJobId = Number.MAX_SAFE_INTEGER + 1; }],
    ["stale job counter", (f: any) => { f.state.orders.nextJobId = 1; }],
    ["stale task counter", (f: any) => { f.state.orders.nextTaskId = 1; }],
    ["fractional task ID", (f: any) => { f.state.orders.tasks[0].id = 1.5; }],
    ["unknown state", (f: any) => { f.state.orders.tasks[0].status = "waiting"; }],
    ["missing reason", (f: any) => { delete f.state.orders.tasks[0].reason; }],
    ["oversized reason", (f: any) => { f.state.orders.tasks[0].reason = "x".repeat(241); }],
    ["missing budget", (f: any) => { delete f.state.orders.tasks[0].budget; }],
    ["missing resource", (f: any) => { delete f.state.orders.tasks[0].budget.metal; }],
    ["unknown resource", (f: any) => { f.state.orders.tasks[0].budget.other = "0"; }],
    ["numeric budget", (f: any) => { f.state.orders.tasks[0].budget.metal = 100000; }],
    ["over bound", (f: any) => { f.state.orders.tasks[0].budget.metal = "1e191"; }],
    ["over precision", (f: any) => { f.state.orders.tasks[0].budget.metal = "0.0000000000000000001"; }],
    ["over budget", (f: any) => { f.state.orders.tasks[0].budget.metal = "59.999999999999999999"; }],
    ["over refund", (f: any) => { f.state.orders.tasks[0].refunded.metal = "60.000000000000000001"; }],
    ["unrepresentable paid quote", (f: any) => { f.state.planets[0].buildQueue[0].paid.metal = "60.000000000000000001"; }],
    ["missing receipt", (f: any) => { delete f.state.orders.tasks[0].activeJob; }],
    ["missing real job", (f: any) => { f.state.planets[0].buildQueue = []; }],
    ["missing job ID", (f: any) => { delete f.state.planets[0].buildQueue[0].jobId; }],
    ["missing task ID", (f: any) => { delete f.state.planets[0].buildQueue[0].taskId; }],
    ["orphan plan job", (f: any) => { f.state.planets[0].buildQueue[0].taskId = 9; }],
    ["manual owner", (f: any) => { f.state.planets[0].buildQueue[0].source = "manual"; }],
    ["unknown source", (f: any) => { f.state.planets[0].buildQueue[0].source = "other"; }],
    ["mismatched receipt", (f: any) => { f.state.orders.nextJobId = 3; f.state.orders.tasks[0].activeJob.jobId = 2; }],
    ["mismatched building", (f: any) => { f.state.orders.tasks[0].building = "crystal_mine"; }],
    ["too high queued goal", (f: any) => { f.state.planets[0].buildQueue[0].targetLevel = 4; }],
    ["wrong receipt quantity", (f: any) => { f.state.orders.tasks[0].activeJob.quantity = 2; }],
    ["premature level credit", (f: any) => { f.state.orders.tasks[0].activeJob.credited = 1; }],
    ["terminal receipt", (f: any) => { f.state.orders.tasks[0].status = "cancelled"; }],
    ["missing payer", (f: any) => { f.state.orders.tasks[0].planetId = "missing"; }],
    ["paused missing payer", (f: any) => { f.state.orders.tasks[0].status = "paused"; f.state.orders.accumulator = 0; f.state.orders.tasks[0].planetId = "missing"; }],
    ["elapsed boundary", (f: any) => { f.state.orders.accumulator = 10; }],
    ["stopped timer", (f: any) => { f.state.orders.tasks[0].status = "paused"; }],
    ["extra target authority", (f: any) => { f.state.orders.tasks[0].quantity = 99; }],
  ])("rejects %s instead of silently regenerating authorization", (_name, mutate) => {
    const file = paidFile(); (mutate as (file: any) => void)(file);
    expect(() => read(file)).toThrow();
  });
  it.each([
    ["missing snapshot", (f: any) => { delete f.state.planets[0].shipyardQueue[0].paidPerUnit; }],
    ["missing ordered count", (f: any) => { delete f.state.planets[0].shipyardQueue[0].orderedCount; }],
    ["original below remainder", (f: any) => { f.state.planets[0].shipyardQueue[0].orderedCount = 2; }],
    ["quantity mismatch", (f: any) => { f.state.orders.tasks[0].activeJob.quantity = 6; }],
    ["watermark mismatch", (f: any) => { f.state.orders.tasks[0].activeJob.credited = 1; }],
    ["missing prior credit", (f: any) => { f.state.orders.tasks[0].completedUnits = 1; }],
    ["remaining beyond goal", (f: any) => { f.state.orders.tasks[0].completedUnits = 9; }],
    ["liability beyond commitment", (f: any) => { f.state.orders.tasks[0].refunded.metal = "4000.000000000000000001"; }],
    ["incomplete completed goal", (f: any) => { Object.assign(f.state.orders.tasks[0], { status: "completed", activeJob: null }); f.state.orders.accumulator = 0; f.state.planets[0].shipyardQueue = []; }],
  ])("rejects ship %s", (_name, mutate) => {
    const file = paidFile("shipyard"); (mutate as (file: any) => void)(file);
    expect(() => read(file)).toThrow();
  });
  it.each(["building", "research", "shipyard"] as const)("rejects duplicate live %s goals even without a second paid job", kind => {
    const file = paidFile(kind), other = structuredClone(file.state.orders.tasks[0]);
    Object.assign(other, { id: 2, status: "paused", activeJob: null });
    file.state.orders.nextTaskId = 3; file.state.orders.tasks.push(other);
    expect(() => read(file)).toThrow("目标重复");
  });
  it("research payer is checked against its fixed owner, not the selected planet", () => {
    const file = paidFile("research"), colony = queueFile().state.planets[1];
    colony.buildQueue = []; colony.shipyardQueue = []; file.state.planets.push(colony);
    file.state.activePlanetId = colony.id;
    expect(() => read(file)).not.toThrow();
    file.state.research.queue[0].planetId = colony.id;
    expect(() => read(file)).toThrow("出资星球不一致");
  });
  it("rejects globally duplicated job IDs across kinds and planets", () => {
    const file = queueFile(); file.state.research.queue[0].jobId = file.state.planets[1].shipyardQueue[0].jobId;
    expect(() => read(file)).toThrow("付款 ID 重复");
  });
  it("bounds total and live task counts", () => {
    const orders = paidFile().state.orders;
    orders.tasks = Array.from({ length: MAX_LIVE_ORDER_TASKS + 1 }, (_, index) => ({ ...orders.tasks[0], id: index + 1, activeJob: null }));
    orders.nextTaskId = MAX_ORDER_TASKS + 2;
    expect(() => readOrders(orders)).toThrow("进行中的计划过多");
    orders.tasks = Array.from({ length: MAX_ORDER_TASKS + 1 }, (_, index) => ({ ...orders.tasks[0], id: index + 1, status: "cancelled" }));
    orders.accumulator = 0;
    expect(() => readOrders(orders)).toThrow("计划列表过长");
  });
});

describe("deterministic r2/r3/r4 paid queue migration", () => {
  it.each([2, 3, 4] as const)("migrates r%d in planet/build/ship/research order without changing old economics", revision => {
    const file = legacyFile(revision), original = structuredClone(file), first = read(file);
    expect(file).toEqual(original);
    expect(read(file)).toEqual(first);
    expect(first.state.orders).toEqual({ ...createOrderState(), nextJobId: 6 });
    const ids: number[] = [];
    for (let index = 0; index < first.state.planets.length; index++) {
      const planet = first.state.planets[index]!, old = file.state.planets[index];
      const { jobId, taskId, ...build } = planet.buildQueue[0]!;
      ids.push(jobId); expect(taskId).toBeNull(); expect(build).toEqual(old.buildQueue[0]);
      const { jobId: shipId, taskId: shipTask, orderedCount, paidPerUnit, ...ship } = planet.shipyardQueue[0]!;
      ids.push(shipId); expect(shipTask).toBeNull(); expect(ship).toEqual(old.shipyardQueue[0]);
      expect(orderedCount).toBe(old.shipyardQueue[0].count); expect(paidPerUnit).toEqual(price("2000"));
      expect(planet.resources).toEqual(old.resources); expect(planet.units).toEqual(old.units);
    }
    const { jobId, taskId, ...research } = first.state.research.queue[0]!;
    ids.push(jobId); expect(taskId).toBeNull(); expect(research).toEqual(file.state.research.queue[0]);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(first.state.arcade.seed).toBe(file.state.arcade.seed);
    expect(first.state.protocols).toEqual(file.state.protocols);
    expect(read(first)).toEqual(first);
  });
  it.each([2, 3, 4] as const)("rejects r5 fields smuggled into r%d", revision => {
    const mutations = [
      (f: any) => { f.state.orders = createOrderState(); },
      (f: any) => { f.state.planets[0].buildQueue[0].jobId = 1; },
      (f: any) => { f.state.planets[0].buildQueue[0].taskId = null; },
      (f: any) => { f.state.planets[0].shipyardQueue[0].orderedCount = 3; },
      (f: any) => { f.state.planets[0].shipyardQueue[0].paidPerUnit = price("2000"); },
      (f: any) => { f.state.research.queue[0].jobId = 5; },
      (f: any) => { f.state.research.queue[0].taskId = 1; },
      (f: any) => { f.state.research.queue[0].source = "plan"; },
    ];
    for (const mutate of mutations) { const file = legacyFile(revision); mutate(file); expect(() => read(file)).toThrow("不能夹带 r5"); }
  });
  it("preserves valid armed r4 ring authority without turning it into order permission", () => {
    const file = legacyFile(4);
    file.state.arcade.runs = [{ id: 1, source: "bonus", outcome: { main: { tile: 0, big: false, u: 0.2, v: 0.4 }, lucky: null, forced: null } }];
    file.state.arcade.nextRunId = 2;
    file.state.arcade.autoBatch = { armed: true, planetId: "homeworld", ticketIds: [1], completed: 0,
      maxDeuterium: "100.5", spentDeuterium: "25.25", bets: { metal: 1, crystal: 0, deuterium: 0, drifter: 0 }, stopReason: "" };
    expect(read(file).state.arcade).toEqual(file.state.arcade);
    expect(read(file).state.orders.tasks).toEqual([]);
  });
});
