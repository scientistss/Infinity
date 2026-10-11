import { beforeAll, describe, expect, it } from "vitest";
import { type BuildingId } from "../src/data/buildings";
import { type ResearchId } from "../src/data/research";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, recallFleet, resolveFleetArrivals, sendFleet, type FleetRequest } from "../src/game/fleet";
import { coordinateKey, npcAt, SPACE, type Coordinates } from "../src/game/galaxy";
import { tick } from "../src/game/logic";
import { npcEconomySnapshot } from "../src/game/npc-economy";
import { npcScoutReportText } from "../src/game/npc-scout";
import { createPlanet } from "../src/game/planet";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { orderUnits, unitSeconds } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState } from "../src/game/types";
import { spaceFleetView, spaceGalaxyView, spaceMessagesView } from "../src/ui/space-present";

const TARGET = { galaxy: 1, system: 56, position: 6 };
// Frozen before running: age/time 1e-8 s, stock 5e-8 units. Text uses 3 decimals.
const TIME_TOLERANCE = 1e-8;
const STOCK_TOLERANCE = 5e-8;

/**
 * Explicit synthetic starting funds, not a natural-new-account claim. Everything
 * after the initial wallet uses paid building/research/shipyard commands and tick.
 * No level, unit, fleet, report, timer or economy-age field is injected here.
 */
function buildPaidProbes(): GameState {
  let state = createInitialState(20261010, 97531);
  activePlanet(state).resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  const buildings: BuildingId[] = ["robotics_factory", "robotics_factory", "shipyard", "shipyard", "shipyard", "research_lab", "research_lab", "research_lab"];
  for (const building of buildings) {
    const result = enqueue(state, building, "manual");
    expect(result.ok, result.reason).toBe(true);
    const job = activePlanet(result.state).buildQueue[0]!;
    expect(job.jobId).toBeGreaterThan(0);
    state = tick(result.state, job.remainingSeconds);
    expect(activePlanet(state).buildQueue).toHaveLength(0);
  }
  const technologies: ResearchId[] = ["energy_tech", "combustion_drive", "combustion_drive", "combustion_drive", "espionage_tech", "espionage_tech", "computer_tech"];
  for (const technology of technologies) {
    const result = enqueueResearch(state, technology, "manual");
    expect(result.ok, result.reason).toBe(true);
    state = tick(result.state, result.state.research.queue[0]!.remainingSeconds);
    expect(state.research.queue).toHaveLength(0);
  }
  expect(activePlanet(state).units.espionage_probe).toBe(0);
  const before = activePlanet(state).resources.crystal;
  const result = orderUnits(state, "espionage_probe", 2, "manual");
  expect(result.ok, result.reason).toBe(true);
  expect(activePlanet(result.state).resources.crystal.eq(before.sub(2000))).toBe(true);
  expect(activePlanet(result.state).units.espionage_probe).toBe(0);
  state = tick(result.state, unitSeconds(result.state, "espionage_probe") * 2);
  expect(activePlanet(state).units.espionage_probe).toBe(2);
  expect(activePlanet(state).shipyardQueue).toHaveLength(0);
  expect(state.stats.unitsBuilt).toBe(2);
  expect(npcAt(state, TARGET)?.id).toBe("npc-1:56:6");
  return state;
}

let paidBaseline: GameState;
beforeAll(() => { paidBaseline = buildPaidProbes(); });
const ready = (): GameState => deserializeState(serializeState(paidBaseline));
const request = (target = TARGET, speedPercent = 100): FleetRequest => ({ mission: "scout", target, speedPercent, ships: { espionage_probe: 1 }, cargo: emptyCargo() });
const reports = (state: GameState) => state.messages.filter(message => message.id.startsWith("scout-"));
const roundTrip = (state: GameState): GameState => deserializeState(importSave(exportSave(state, 123456)).state);

function launch(state: GameState, order = request()): GameState {
  const quote = quoteFlight(state, order);
  expect(quote.ok, quote.reason).toBe(true);
  const result = sendFleet(state, order);
  expect(result.ok, result.reason).toBe(true);
  expect(result.state.npcEconomy).toEqual(state.npcEconomy);
  expect(activePlanet(result.state).units.espionage_probe).toBe(activePlanet(state).units.espionage_probe - order.ships.espionage_probe!);
  expect(activePlanet(result.state).resources.deuterium.eq(activePlanet(state).resources.deuterium.sub(quote.fuel))).toBe(true);
  for (const id of ["metal", "crystal"] as const) expect(activePlanet(result.state).resources[id]).toEqual(activePlanet(state).resources[id]);
  expect(reports(result.state)).toEqual(reports(state));
  return result.state;
}

/** Independent frozen-design arithmetic; no production constants or snapshot output. */
function expectObservation(state: GameState, id: number, gameTime: number, age: number): void {
  const message = state.messages.find(value => value.id === `scout-${id}`)!;
  expect(message).toBeDefined();
  expect(Math.abs(message.at - gameTime)).toBeLessThan(TIME_TOLERANCE);
  expect(message.text).toContain("抵达时快照（数值保留3位小数）");
  expect(message.text).toContain(`游戏时间 ${gameTime.toFixed(3)} 秒；经济年龄 ${age.toFixed(3)} 秒`);
  const expected = [
    { name: "金属", id: "metal", stock: Math.min(50000, 500 + 5 * age), cap: 50000, rate: 5 },
    { name: "晶体", id: "crystal", stock: Math.min(30000, 250 + 2.5 * age), cap: 30000, rate: 2.5 },
    { name: "重氢", id: "deuterium", stock: Math.min(10000, age), cap: 10000, rate: 1 },
  ] as const;
  const snapshot = npcEconomySnapshot(state.npcEconomy);
  for (const resource of expected) {
    expect(message.text).toContain(`${resource.name} ${resource.stock.toFixed(3)}/${resource.cap.toFixed(3)}，固定产量 ${resource.rate.toFixed(3)}/秒，${resource.stock === resource.cap ? "满仓停产" : "生产中"}`);
    expect(Math.abs(snapshot.resources[resource.id] - resource.stock)).toBeLessThan(STOCK_TOLERANCE);
  }
  expect(message.text.length).toBeLessThanOrEqual(1000);
}

describe("paid NPC scouts observe only actual arrival", () => {
  it("keeps galaxy, quotes and in-flight views identity-only, then snapshots the exact event", () => {
    const start = ready();
    const before = exportSave(start, 1);
    for (let i = 0; i < 20; i++) {
      const galaxy = spaceGalaxyView(start, TARGET);
      expect(galaxy.rows.find(row => row.key === "1:56:6")?.kind).toBe("NPC 邻居");
      expect(JSON.stringify(galaxy)).not.toMatch(/抵达时快照|经济年龄|固定产量|满仓停产/);
      quoteFlight(start, request());
      spaceFleetView(start, request());
      spaceMessagesView(start);
    }
    expect(exportSave(start, 1)).toBe(before);
    const sent = launch(start);
    const duration = sent.fleets[0]!.duration;
    expect(duration).toBe(1);
    const partial = tick(sent, .25);
    expect(reports(partial)).toHaveLength(0);
    expect(JSON.stringify(spaceFleetView(partial, request()))).not.toMatch(/抵达时快照|经济年龄|固定产量/);
    const arrived = tick(partial, duration - .25);
    const message = reports(arrived)[0]!;
    const npc = npcAt(start, TARGET)!;
    expect(message.text).toContain(`侦察报告 [1:56:6]：${npc.name}（NPC ${npc.id}；派系：${npc.faction}）`);
    expectObservation(arrived, 1, start.totalTime.toNumber() + duration, start.npcEconomy.elapsedSeconds + duration);
    expect(arrived.fleets[0]!.returning).toBe(true);
    expect(arrived.fleets[0]!.remaining).toBe(duration);
    expect(arrived.fleets[0]!.cargo).toEqual(emptyCargo());
    expect(spaceMessagesView(arrived).messages.find(value => value.id === "scout-1")?.text).toBe(message.text);
  });

  it("preserves the first report through a paid second journey and partial-flight save/reload", () => {
    const start = ready();
    let state = launch(start);
    const duration = state.fleets[0]!.duration;
    state = tick(state, duration);
    const first = { ...reports(state)[0]! };
    state = tick(state, duration + 60);
    expect(state.fleets).toHaveLength(0);
    expect(activePlanet(state).units.espionage_probe).toBe(2);
    const departureAge = state.npcEconomy.elapsedSeconds;
    const departureTime = state.totalTime.toNumber();
    state = tick(launch(state), .25);
    const reloaded = roundTrip(state);
    expect(serializeState(reloaded)).toEqual(serializeState(state));
    const reference = tick(state, duration - .25);
    const arrived = tick(reloaded, duration - .25);
    expect(serializeState(arrived)).toEqual(serializeState(reference));
    expectObservation(arrived, 2, departureTime + duration, departureAge + duration);
    expect(reports(arrived)).toHaveLength(2);
    expect(reports(arrived)[0]).toEqual(first);
    expect(reports(arrived)[1]!.text).not.toBe(first.text);
    expect(roundTrip(arrived).messages).toEqual(arrived.messages);
    const returned = tick(roundTrip(arrived), duration);
    expect(returned.fleets).toHaveLength(0);
    expect(reports(returned)[0]).toEqual(first);
    const finalBytes = exportSave(returned, 1);
    for (let i = 0; i < 50; i++) spaceMessagesView(returned);
    expect(exportSave(returned, 1)).toBe(finalBytes);
    expect(reports(resolveFleetArrivals(returned))).toEqual(reports(returned));
  });

  it("shares one age across simultaneous scouts regardless of fleet array order", () => {
    const start = ready();
    const sent = launch(launch(start));
    const duration = sent.fleets[0]!.duration;
    const a = tick(sent, duration);
    const b = tick({ ...sent, fleets: [...sent.fleets].reverse() }, duration);
    expect(reports(a)).toEqual(reports(b));
    expect(reports(a)).toHaveLength(2);
    expect(reports(a)[0]!.text).toBe(reports(a)[1]!.text);
    expectObservation(a, 1, start.totalTime.toNumber() + duration, start.npcEconomy.elapsedSeconds + duration);
    expectObservation(a, 2, start.totalTime.toNumber() + duration, start.npcEconomy.elapsedSeconds + duration);
    const settled = resolveFleetArrivals(a);
    expect(settled).toBe(a);
    expect(serializeState(settled)).toEqual(serializeState(a));
  });

  it("uses the real fractional locked flight boundary without rounding age or stocks", () => {
    const start = ready();
    let far: Coordinates | undefined;
    for (let position = 1; position <= 15; position++) {
      const coordinate = { galaxy: 3, system: 56, position };
      if (npcAt(start, coordinate)) { far = coordinate; break; }
    }
    expect(far).toBeDefined();
    // Two paid probes provide 10 cargo slots for the unchanged 8-unit fuel quote.
    const sent = launch(start, { ...request(far!, 10), ships: { espionage_probe: 2 } });
    // Independent original flight formula: two-galaxy ring distance, combustion 3.
    const duration = (10 + 35000 / 10 * Math.sqrt(10 * 40000 / 130000000)) / 120;
    expect(sent.fleets[0]!.duration).toBe(duration);
    expect(Number.isInteger(duration)).toBe(false);
    let partitioned = sent;
    for (let i = 0; i < 6; i++) partitioned = tick(partitioned, .25);
    expect(reports(partitioned)).toHaveLength(0);
    partitioned = tick(partitioned, duration - 1.5);
    const whole = tick(sent, duration);
    expectObservation(whole, 1, start.totalTime.toNumber() + duration, start.npcEconomy.elapsedSeconds + duration);
    expectObservation(partitioned, 1, start.totalTime.toNumber() + duration, start.npcEconomy.elapsedSeconds + duration);
    expect(reports(partitioned)[0]!.text).toBe(reports(whole)[0]!.text);
    expect(Math.abs(partitioned.npcEconomy.elapsedSeconds - whole.npcEconomy.elapsedSeconds)).toBeLessThan(TIME_TOLERANCE);
  });

  it.each([0, .25, .999])("recall before arrival at %s seconds produces no intel and refunds no fuel", elapsed => {
    const start = ready();
    const sent = launch(start);
    const quote = quoteFlight(start, request());
    const outward = tick(sent, elapsed);
    const result = recallFleet(outward, 1);
    expect(result.ok).toBe(true);
    const returned = tick(roundTrip(result.state), elapsed);
    expect(returned.fleets).toHaveLength(0);
    expect(reports(returned)).toHaveLength(0);
    expect(activePlanet(returned).units.espionage_probe).toBe(2);
    expect(activePlanet(returned).resources.deuterium.eq(activePlanet(start).resources.deuterium.sub(quote.fuel))).toBe(true);
    expect(recallFleet(returned, 1).ok).toBe(false);
  });

  it("does not change player wallets, stats, points inputs or saved random state at observation", () => {
    const start = ready();
    const sent = launch(start);
    const arrived = tick(sent, sent.fleets[0]!.duration);
    const { npcEconomy: _beforeAge, fleets: _beforeFleets, messages: _beforeMessages, totalTime: _beforeTime, protocols: _beforeProtocols, orders: beforeOrders, ...before } = serializeState(sent);
    const { npcEconomy: _afterAge, fleets: _afterFleets, messages: _afterMessages, totalTime: _afterTime, protocols: _afterProtocols, orders: afterOrders, ...after } = serializeState(arrived);
    expect(after).toEqual(before);
    // Empty plans accrue their existing pass timer; no grant/authorization is created.
    expect(afterOrders.tasks).toEqual(beforeOrders.tasks);
    expect(afterOrders.nextJobId).toBe(beforeOrders.nextJobId);
    expect(arrived.arcade).toEqual(start.arcade);
    expect(arrived.deepSpace).toEqual(start.deepSpace);
    expect(arrived.lifetime).toEqual(start.lifetime);
    expect(arrived.stats).toEqual(start.stats);
    for (const id of RESOURCE_IDS) expect(activePlanet(arrived).resources[id]).toEqual(activePlanet(sent).resources[id]);
  });
});

describe("synthetic arrival boundaries and static-report compatibility", () => {
  it.each([0, 1e12 - 2, 1e12, 1e12 + 1, "1e400", "1e1000000"])("keeps actual dispatch/arrival saves readable at synthetic totalTime=%s", gameTime => {
    let state = ready();
    state = { ...state, totalTime: big(gameTime) };
    const sent = launch(state);
    const dispatch = sent.messages.at(-1)!;
    expect(dispatch.at).toBe(state.totalTime.gt(1e12) ? 1e12 : state.totalTime.toNumber());
    const originalDispatch = `侦察舰队 #1 已从 ${activePlanet(state).name} 出发，目标 [1:56:6]。`;
    if (state.totalTime.lte(1e12)) expect(dispatch.text).toBe(originalDispatch);
    else {
      expect(dispatch.text).toContain(originalDispatch);
      expect(dispatch.text).toContain(`列表时间已达显示上限；实际游戏时间 ${state.totalTime.toString()} 秒`);
    }
    expect(serializeState(roundTrip(sent))).toEqual(serializeState(sent));
    const arrived = tick(roundTrip(sent), sent.fleets[0]!.duration);
    const observation = reports(arrived)[0]!;
    expect(Number.isFinite(observation.at)).toBe(true);
    expect(observation.at).toBeLessThanOrEqual(1e12);
    expect(observation.text).not.toMatch(/Infinity|NaN/);
    if (arrived.totalTime.gt(1e12)) {
      expect(observation.text).toContain(`游戏时间 ${arrived.totalTime.toString()} 秒`);
      expect(observation.text).toContain("列表时间已达显示上限");
    }
    expect(serializeState(roundTrip(arrived))).toEqual(serializeState(arrived));
    const returned = tick(roundTrip(arrived), arrived.fleets[0]!.duration);
    expect(serializeState(roundTrip(returned))).toEqual(serializeState(returned));
    expect(returned.messages.map(message => message.id)).toEqual(["dispatch-1", "scout-1", "return-1"]);
    expect(spaceMessagesView(returned).messages.map(message => message.id)).toEqual(["return-1", "scout-1", "dispatch-1"]);
    expect(returned.messages.every(message => message.text.length <= 1000)).toBe(true);
  });

  it("keeps simultaneous overflow timestamps separate by their fleet identities", () => {
    let state = ready();
    state = { ...state, totalTime: big("1e400") };
    const sent = launch(launch(state));
    const arrived = roundTrip(tick(sent, 1));
    expect(arrived.messages.map(message => message.id)).toEqual(["dispatch-1", "dispatch-2", "scout-1", "scout-2"]);
    expect(arrived.messages.every(message => message.at === 1e12)).toBe(true);
    expect(reports(arrived)[0]!.text).toBe(reports(arrived)[1]!.text);
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
    expect(arrived.totalTime.toString()).toBe("1e+400");
  });

  it.each([9900, 10000, 11900])("reports the independent cap status at exact age %s", age => {
    // Explicit age fixture isolates this event boundary; dispatch, fuel and flight stay real.
    let state = ready();
    state = { ...state, npcEconomy: { ...state.npcEconomy, elapsedSeconds: age - 1 } };
    const gameTime = state.totalTime.toNumber();
    state = tick(launch(state), 1);
    expect(state.npcEconomy.elapsedSeconds).toBe(age);
    expectObservation(state, 1, gameTime + 1, age);
  });

  it.each([0, -1, NaN, Infinity])("an already-due synthetic boundary at dt=%s uses current age exactly once", dt => {
    let state = launch(ready());
    state = { ...state, npcEconomy: { ...state.npcEconomy, elapsedSeconds: 60 }, fleets: state.fleets.map(fleet => ({ ...fleet, remaining: 0, elapsed: fleet.duration })) };
    const at = state.totalTime.toNumber();
    const settled = tick(state, dt);
    expect(settled.npcEconomy.elapsedSeconds).toBe(60);
    expectObservation(settled, 1, at, 60);
    expect(reports(tick(settled, dt))).toEqual(reports(settled));
    expect(resolveFleetArrivals(settled)).toBe(settled);
  });

  it("display rounding cannot declare a not-quite-full store stopped", () => {
    let state = ready();
    state = { ...state, npcEconomy: { ...state.npcEconomy, elapsedSeconds: 9898.999999 } };
    state = tick(launch(state), 1);
    const text = reports(state)[0]!.text;
    expect(text).toContain("金属 50000.000/50000.000，固定产量 5.000/秒，生产中");
    expect(npcEconomySnapshot(state.npcEconomy).resources.metal).toBeLessThan(50000);
  });

  it("keeps empty and owned-target report text unchanged and refuses non-NPC observations", () => {
    const start = ready();
    const empty = { ...TARGET, position: 10 };
    expect(npcAt(start, empty)).toBeNull();
    const vacant = tick(launch(start, request(empty)), 1);
    expect(reports(vacant)[0]!.text).toBe("侦察报告 [1:56:10]：无人占据，可派殖民船建立基地。");
    const colony = createPlanet("synthetic-owned", empty);
    const own = { ...start, planets: [...start.planets, colony] };
    const arrived = tick(launch(own, request(empty)), 1);
    expect(reports(arrived)[0]!.text).toBe(`侦察报告 [1:56:10]：${colony.name}（己方），${colony.fieldsMax} 格。`);
    for (const coordinate of [empty, activePlanet(start).coordinates, { ...TARGET, position: 16 }, { ...TARGET, galaxy: 0 }]) {
      expect(npcScoutReportText(own, coordinate)).toBeNull();
    }
    expect(npcScoutReportText(start, empty)).toBeNull();
  });

  it("queries and message views never mutate frozen state or retrospectively fill old reports", () => {
    const historical = { id: "scout-old", at: 3, text: "侦察报告 [1:56:6]：旧身份情报，没有历史库存。" };
    let state = ready();
    state = { ...state, messages: [historical] };
    const before = exportSave(state, 1);
    Object.freeze(state.npcEconomy);
    Object.freeze(state.messages);
    Object.freeze(state);
    for (let i = 0; i < 30; i++) {
      npcScoutReportText(state, TARGET);
      spaceGalaxyView(state, TARGET);
      spaceMessagesView(state);
    }
    expect(exportSave(state, 1)).toBe(before);
    const advanced = tick(roundTrip(state), 60);
    expect(advanced.messages[0]).toEqual(historical);
    expect(spaceMessagesView(advanced).messages[0]!.text).toBe(historical.text);
  });

  it("retains only 150 messages during repeated actual paid journeys and no secondary report cache", () => {
    let state = ready();
    const keys = Object.keys(serializeState(state)).sort();
    for (let i = 0; i < 52; i++) {
      state = launch(state);
      state = tick(state, state.fleets[0]!.duration * 2);
    }
    expect(state.messages).toHaveLength(SPACE.maxMessages);
    expect(state.messages[0]!.id).toBe("dispatch-3");
    expect(state.messages.at(-1)!.id).toBe("return-52");
    expect(new Set(state.messages.map(message => message.id)).size).toBe(SPACE.maxMessages);
    expect(state.messages.every(message => message.text.length <= 1000)).toBe(true);
    expect(Object.keys(serializeState(state)).sort()).toEqual(keys);
    expect(Object.keys(state.npcEconomy).sort()).toEqual(["elapsedSeconds", "model"]);
    expect(roundTrip(state).messages).toEqual(state.messages);
    expect(coordinateKey(TARGET)).toBe("1:56:6");
  });
});
