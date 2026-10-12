import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sourceR11 from "./fixtures/npc-economy-r11.json";
import legacyScouts from "./fixtures/npc-scout-legacy.json";
import { AccountedClock } from "../src/core/accounted-clock";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { advanceFleets, emptyCargo, quoteFlight, recallFleet, resolveFleetArrivals, sendFleet, type FleetRequest } from "../src/game/fleet";
import { npcAt, SPACE, type Coordinates } from "../src/game/galaxy";
import { prestige, tick } from "../src/game/logic";
import { npcScoutReportText } from "../src/game/npc-scout";
import * as wallet from "../src/game/npc-wallet";
import { catchUp } from "../src/core/offline";
import { enqueueResearch } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { orderUnits } from "../src/game/shipyard";
import type { GameState } from "../src/game/types";
import { spaceMessagesView } from "../src/ui/space-present";

const TARGET = { galaxy: 1, system: 56, position: 6 };
const EMPTY = { galaxy: 1, system: 56, position: 1 };
const request = (target = TARGET, speedPercent = 100): FleetRequest => ({ mission: "scout", target, ships: { espionage_probe: 1 }, cargo: emptyCargo(), speedPercent });
const reload = (state: GameState) => deserializeState(importSave(exportSave(state, 123456)).state);
const reports = (state: GameState) => state.messages.filter(message => message.npcScoutSnapshot !== null);
const launch = (state: GameState, order = request()) => {
  const result = sendFleet(state, order);
  expect(result.ok, result.reason).toBe(true);
  return result.state;
};
const due = (state: GameState): GameState => ({ ...state, fleets: state.fleets.map(fleet => ({ ...fleet, remaining: 0, elapsed: fleet.duration })) });

/** Genuine retained r11 natural fixture, followed only by real paid APIs/ticks.
 * This is a domain continuation; it does not claim new native/browser evidence.
 */
function buildPaidProbe(): GameState {
  const fixture = sourceR11.rows.find(row => row.id === "natural-r11-adoption")!;
  expect(fixture.synthetic).toBe(false);
  expect(fixture.naturalProgression).toBe(true);
  expect(fixture.rawSha256).toBe("2a27b35f351865912f26d97dd1a3d987953025d181894b288d0e98638298d87a");
  let state = selectPlanet(deserializeState(importSave(fixture.raw).state), "homeworld");
  expect(state.totalTime.toString()).toBe("25810");
  expect(state.nextFleetId).toBe(4);
  expect(state.messages.every(message => message.npcScoutSnapshot === null)).toBe(true);
  expect(orderUnits(state, "espionage_probe", 1, "manual").ok).toBe(false);
  const research = enqueueResearch(state, "combustion_drive", "manual");
  expect(research.ok, research.reason).toBe(true);
  expect(research.state.research.queue[0]!.jobId).toBe(202);
  expect(research.state.research.levels.combustion_drive).toBe(2);
  expect(activePlanet(research.state).resources.metal.eq(activePlanet(state).resources.metal.sub(1600))).toBe(true);
  expect(activePlanet(research.state).resources.deuterium.eq(activePlanet(state).resources.deuterium.sub(2400))).toBe(true);
  state = tick(reload(research.state), 1);
  expect(state.research.levels.combustion_drive).toBe(3);
  const probe = orderUnits(state, "espionage_probe", 1, "manual");
  expect(probe.ok, probe.reason).toBe(true);
  expect(activePlanet(probe.state).shipyardQueue[0]!.jobId).toBe(203);
  expect(activePlanet(probe.state).units.espionage_probe).toBe(0);
  expect(activePlanet(probe.state).resources.crystal.eq(activePlanet(state).resources.crystal.sub(1000))).toBe(true);
  state = tick(reload(probe.state), 1);
  expect(activePlanet(state).units.espionage_probe).toBe(1);
  expect(state.totalTime.toString()).toBe("25812");
  expect(state.npcEconomy.now).toBe(2);
  return state;
}
let paid: GameState;
beforeAll(() => { paid = buildPaidProbe(); });
afterEach(() => { vi.restoreAllMocks(); });
const ready = () => reload(paid);

describe("r14 typed actual paid scout arrival", () => {
  it("pays, partially flies, reloads, observes once, reloads and returns the same probe", () => {
    const start = ready(), quote = quoteFlight(start, request());
    expect(quote.fuel.toNumber()).toBe(4);
    expect(quote.duration).toBe(1);
    const sent = launch(start);
    expect(reports(sent)).toHaveLength(0);
    expect(sent.messages.at(-1)?.npcScoutSnapshot).toBeNull();
    expect(activePlanet(sent).resources.deuterium.eq(activePlanet(start).resources.deuterium.sub(4))).toBe(true);
    expect(activePlanet(sent).units.espionage_probe).toBe(0);
    const partial = tick(sent, .25);
    expect(reports(partial)).toHaveLength(0);
    const arrived = tick(reload(partial), .75), message = reports(arrived)[0]!;
    expect(reports(arrived)).toHaveLength(1);
    expect(message).toEqual({ id: "scout-4", at: 25813,
      text: "侦察报告 [1:56:6]：晨星共同体 56-6（NPC npc-1:56:6；派系：晨星共同体）。抵达时快照（数值保留3位小数）：游戏时间 25813.000 秒。金属 515.000/50000.000，固定产量 5.000/秒，生产中；晶体 257.500/30000.000，固定产量 2.500/秒，生产中；重氢 3.000/10000.000，固定产量 1.000/秒，生产中。轨道驻军：轻型战斗机 4，重型战斗机 0；驻军战斗科技 0。历史快照不会随时间更新。",
      npcScoutSnapshot: { model: "npc-scout-snapshot-v1", fleetId: 4, originId: "homeworld", target: TARGET, observedAt: "25813",
        stock: [515, 257.5, 3], garrison: { light_fighter: 4, heavy_fighter: 0 }, defenderTech: { weapons: 0, shields: 0, armour: 0 } },
    });
    const snapshot = message.npcScoutSnapshot!;
    for (const value of [snapshot, snapshot.target, snapshot.stock, snapshot.garrison, snapshot.defenderTech]) expect(Object.isFrozen(value)).toBe(true);
    expect(arrived.fleets[0]).toMatchObject({ id: 4, remaining: 1, duration: 1, elapsed: 0, returning: true, cargo: emptyCargo() });
    expect(arrived.nextFleetId).toBe(5);
    expect(arrived.npcEconomy.sites).toEqual({});
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
    const saved = reload(arrived);
    expect(saved.messages).toEqual(arrived.messages);
    const returned = tick(saved, 1);
    expect(returned.fleets).toHaveLength(0);
    expect(activePlanet(returned).units.espionage_probe).toBe(1);
    expect(reports(returned)).toEqual([message]);
    expect(returned.messages.at(-1)).toMatchObject({ id: "return-4", npcScoutSnapshot: null });
    expect(serializeState(reload(returned))).toEqual(serializeState(returned));
  });

  it("takes exactly one frozen projection without wallet, RNG, clock or ID side effects", () => {
    // Synthetic due timer isolates settlement from ordinary tick production.
    const state = due(launch(ready())), before = serializeState(state);
    const projected = vi.spyOn(wallet, "projectNpc");
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("global RNG"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("wall clock"); });
    const arrived = resolveFleetArrivals(state), snapshot = reports(arrived)[0]!.npcScoutSnapshot!;
    expect(projected).toHaveBeenCalledTimes(1);
    const projection = projected.mock.results[0]!.value as wallet.NpcWalletSnapshot;
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.stock)).toBe(true);
    expect(Object.isFrozen(projection.garrison)).toBe(true);
    expect(snapshot.stock).toEqual(projection.stock);
    expect(snapshot.stock).not.toBe(projection.stock);
    expect(snapshot.garrison).not.toBe(projection.garrison);
    expect(snapshot.target).not.toBe(state.fleets[0]!.target);
    expect(arrived.npcEconomy).toBe(state.npcEconomy);
    expect(arrived.planets).toBe(state.planets);
    expect(arrived.arcade).toBe(state.arcade);
    expect(arrived.deepSpace).toBe(state.deepSpace);
    expect(arrived.nextFleetId).toBe(state.nextFleetId);
    expect(arrived.totalTime).toBe(state.totalTime);
    expect(serializeState(state)).toEqual(before);
    expect(random).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  it("preserves every represented nonzero stock value and normalizes only detached economic zero", () => {
    // Synthetic frozen projection witness: no rounded text or source mutation.
    const projected = Object.freeze({ key: "1:56:6", stock: Object.freeze([511.123456789, Number.MIN_VALUE, -0] as const),
      garrison: Object.freeze({ light_fighter: 2, heavy_fighter: 0 }) });
    vi.spyOn(wallet, "projectNpc").mockReturnValue(projected);
    const arrived = resolveFleetArrivals(due(launch(ready()))), message = reports(arrived)[0]!;
    expect(message.npcScoutSnapshot!.stock).toEqual([511.123456789, Number.MIN_VALUE, 0]);
    expect(Object.is(projected.stock[2], -0)).toBe(true);
    expect(Object.is(message.npcScoutSnapshot!.stock[2], 0)).toBe(true);
    expect(message.text).toContain("金属 511.123/50000.000");
    expect(message.text).toContain("晶体 0.000/30000.000");
    expect(message.text).toContain("轻型战斗机 2，重型战斗机 0");
    expect(reload(arrived).messages).toEqual(arrived.messages);
  });

  it.each([0, .25, .999])("never creates intel for a recalled scout at %s seconds", elapsed => {
    const sent = launch(ready()), recalled = recallFleet(tick(sent, elapsed), 4);
    expect(recalled.ok).toBe(true);
    const returned = tick(reload(recalled.state), elapsed);
    expect(reports(returned)).toHaveLength(0);
    expect(returned.messages.every(message => message.npcScoutSnapshot === null)).toBe(true);
    expect(activePlanet(returned).units.espionage_probe).toBe(1);
    expect(returned.nextFleetId).toBe(5);
  });

  it("does not authorize snapshots for empty or owned targets, text reads, or message views", () => {
    const state = ready();
    const empty = [...Array(15)].map((_, i) => ({ ...EMPTY, position: i + 1 }))
      .find(target => !state.planets.some(planet => planet.coordinates.position === target.position) && !npcAt(state, target))!;
    const own = state.planets.find(planet => planet.id === "colony-1")!.coordinates;
    for (const target of [empty, own]) {
      const arrived = tick(launch(state, request(target)), 1);
      expect(reports(arrived)).toHaveLength(0);
      expect(arrived.messages.find(message => message.id === "scout-4")?.npcScoutSnapshot).toBeNull();
    }
    const before = exportSave(state, 1);
    for (let i = 0; i < 10; i++) {
      expect(npcScoutReportText(state, TARGET)).toContain("抵达时快照");
      spaceMessagesView(state);
    }
    expect(exportSave(state, 1)).toBe(before);
    expect(reload(state).messages).toEqual(state.messages);
    expect(reports(state)).toHaveLength(0);
  });
});

describe("r14 arrival time, ordering and retained history", () => {
  it.each([1e12, "1e400", "1e1000000"])("keeps actual canonical time %s while clamping only the list label", time => {
    // Synthetic time boundary; the actual probe still pays and flies normally.
    const start = { ...ready(), totalTime: big(time) };
    const arrived = tick(reload(launch(start)), 1), message = reports(arrived)[0]!;
    expect(message.npcScoutSnapshot!.observedAt).toBe(arrived.totalTime.toString());
    expect(message.at).toBe(1e12);
    expect(message.text).toContain(`游戏时间 ${arrived.totalTime.toString()} 秒`);
    expect(message.text).toContain("列表时间已达显示上限");
    expect(reload(arrived).messages).toEqual(arrived.messages);
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
  });

  it("uses the same accepted canonical representation for a typed list label and timestamp", () => {
    const sent = due(launch(ready()));
    // Synthetic noncanonical binary mantissa with a canonical string output.
    const time = big(0).fromMantissaExponent(2.5813000000000006, 4);
    const state = { ...sent, totalTime: time }, next = resolveFleetArrivals(state), message = reports(next)[0]!;
    expect(message.npcScoutSnapshot!.observedAt).toBe(time.toString());
    expect(message.at).toBe(big(message.npcScoutSnapshot!.observedAt).toNumber());
    expect(reload(next).messages).toEqual(next.messages);
  });

  it("preserves fractional actual flight boundaries across partitions and reload", () => {
    let state = ready();
    const paidSecond = orderUnits(state, "espionage_probe", 1, "manual");
    expect(paidSecond.ok).toBe(true);
    state = tick(paidSecond.state, 1);
    const target = [...Array(15)].map((_, i) => ({ galaxy: 3, system: 56, position: i + 1 }))
      .find(coordinates => npcAt(state, coordinates)) as Coordinates;
    const sent = launch(state, { ...request(target, 10), ships: { espionage_probe: 2 } });
    const duration = sent.fleets[0]!.duration;
    expect(Number.isInteger(duration)).toBe(false);
    const whole = tick(sent, duration);
    let partitioned = sent;
    for (let i = 0; i < 6; i++) partitioned = tick(partitioned, .25);
    partitioned = tick(reload(partitioned), duration - 1.5);
    const a = reports(whole)[0]!.npcScoutSnapshot!, b = reports(partitioned)[0]!.npcScoutSnapshot!;
    expect(reports(whole)[0]!.text).toBe(reports(partitioned)[0]!.text);
    expect(a.observedAt).toBe(whole.totalTime.toString());
    expect(b.observedAt).toBe(partitioned.totalTime.toString());
    // Existing floating partition semantics, not invented exact clock arithmetic.
    expect(Math.abs(big(a.observedAt).toNumber() - big(b.observedAt).toNumber())).toBeLessThanOrEqual(1e-8);
    for (let i = 0; i < 3; i++) expect(Math.abs(a.stock[i] - b.stock[i])).toBeLessThanOrEqual(5e-8);
    expect(reload(whole).messages).toEqual(whole.messages);
    expect(reload(partitioned).messages).toEqual(partitioned.messages);
  });

  it("keeps scouts before attacks at a shared due boundary even with a larger scout ID", () => {
    let state = ready();
    const researching = enqueueResearch(state, "weapons_tech", "manual");
    expect(researching.ok).toBe(true);
    state = tick(researching.state, 1);
    const fighters = orderUnits(state, "light_fighter", 20, "manual");
    expect(fighters.ok).toBe(true);
    state = tick(fighters.state, 30);
    state = launch(state, { mission: "attack", target: TARGET, ships: { light_fighter: 20 }, cargo: emptyCargo(), speedPercent: 100 });
    state = launch(state);
    // Synthetic exact tie only; both launches above used real payments/IDs.
    state = { ...state, fleets: state.fleets.map(fleet => ({ ...fleet, remaining: 1, elapsed: fleet.duration - 1 })) };
    const arrived = tick(state, 1), snapshot = reports(arrived)[0]!.npcScoutSnapshot!;
    expect(snapshot.fleetId).toBe(5);
    expect(snapshot.garrison).toEqual({ light_fighter: 4, heavy_fighter: 0 });
    expect(arrived.npcBattles.reports[0]!.fleetId).toBe(4);
    expect(snapshot.stock).toEqual(arrived.npcBattles.reports[0]!.stockBefore);
    expect(arrived.npcEconomy.sites["1:56:6"]!.garrison).toEqual({ light_fighter: 0, heavy_fighter: 0 });
    expect(arrived.messages.find(message => message.id === "npc-battle-4")?.npcScoutSnapshot).toBeNull();
    expect(serializeState(tick(reload(state), 1))).toEqual(serializeState(arrived));
    let later = tick(arrived, 5);
    later = tick(launch(later), 1);
    expect(reports(later)[1]!.npcScoutSnapshot!.garrison).toEqual({ light_fighter: 0, heavy_fighter: 0 });
    expect(reports(later)[0]!.npcScoutSnapshot).toEqual(snapshot);
  });

  it.each([0, -1, NaN, Infinity])("settles an already-due scout once through the existing tick(%s) behavior", dt => {
    const state = due(launch(ready()));
    const arrived = tick(state, dt);
    expect(reports(arrived)).toHaveLength(1);
    expect(reports(arrived)[0]!.npcScoutSnapshot!.observedAt).toBe(state.totalTime.toString());
    expect(reports(tick(reload(arrived), dt))).toEqual(reports(arrived));
  });

  it("observes at offline arrival once, not at the final capped catch-up clock", () => {
    const sent = launch(ready()), clock = new AccountedClock({ wallAt: 1000, frameAt: 0 });
    const frameAt = 100000 * 1000, caught = catchUp(sent, clock.gapSeconds(frameAt));
    expect(caught.appliedSeconds).toBe(7200);
    expect(reports(caught.state)[0]!.npcScoutSnapshot!.observedAt).toBe("25813");
    expect(reports(caught.state)[0]!.npcScoutSnapshot!.stock).toEqual([515, 257.5, 3]);
    clock.account(frameAt);
    const again = catchUp(reload(caught.state), clock.gapSeconds(frameAt));
    expect(again.appliedSeconds).toBe(0);
    expect(reports(again.state)).toEqual(reports(caught.state));
  });

  it("retains snapshots through naturally eligible curvature and safely returns after FIFO eviction", () => {
    const arrived = tick(launch(ready()), 1), snapshot = reports(arrived)[0]!.npcScoutSnapshot!;
    const reset = prestige(arrived);
    expect(reset.stats.launches).toBe(arrived.stats.launches + 1);
    expect(reset.messages).toEqual(arrived.messages);
    expect(reset.totalTime.toString()).toBe(snapshot.observedAt);
    expect(reload(reset).messages).toEqual(reset.messages);
    // Synthetic ordinary chatter isolates exactly the normal 150-message FIFO.
    const filled: GameState = { ...arrived, messages: [reports(arrived)[0]!, ...Array.from({ length: SPACE.maxMessages - 1 }, (_, i) => ({ id: `ordinary-${i}`, at: 0, text: "普通消息", npcScoutSnapshot: null }))] };
    const returned = advanceFleets(filled, 1);
    expect(returned.messages).toHaveLength(150);
    expect(returned.messages[0]!.id).toBe("ordinary-0");
    expect(reports(returned)).toHaveLength(0);
    expect(returned.fleets).toHaveLength(0);
    expect(activePlanet(returned).units.espionage_probe).toBe(1);
    expect(returned.npcEconomy).toBe(arrived.npcEconomy);
    expect(reload(returned).messages).toEqual(returned.messages);
  });
});

describe("actual-arrival identity refusals", () => {
  it.each(["duplicate-fleet", "unissued-id", "missing-probe", "wrong-timer"])("rejects synthetic %s without adopting a partial message", defect => {
    let state = due(launch(ready()));
    if (defect === "duplicate-fleet") state = { ...state, fleets: [...state.fleets, { ...state.fleets[0]! }] };
    if (defect === "unissued-id") state = { ...state, nextFleetId: 4 };
    if (defect === "missing-probe") state = { ...state, fleets: state.fleets.map(fleet => ({ ...fleet, ships: { light_fighter: 1 } })) };
    if (defect === "wrong-timer") state = { ...state, fleets: state.fleets.map(fleet => ({ ...fleet, elapsed: 0 })) };
    const before = JSON.stringify(state);
    expect(() => resolveFleetArrivals(state)).toThrow("侦察抵达身份或出航状态无效");
    expect(JSON.stringify(state)).toBe(before);
    expect(reports(state)).toHaveLength(0);
  });
});

describe("explicit synthetic historical scout message-ID collisions", () => {
  it("keeps old history, creates one text-only warning, and returns cargo normally", () => {
    const sent = launch(ready()), old = { id: "scout-4", at: 1, text: "旧读者接受的历史文本", npcScoutSnapshot: null };
    const source: GameState = { ...sent, messages: [...sent.messages, old],
      fleets: sent.fleets.map(fleet => ({ ...fleet, cargo: { metal: big(1), crystal: big(2.5), deuterium: big(3) } })) };
    const saved = reload(source), before = serializeState(saved);
    const projected = vi.spyOn(wallet, "projectNpc"), arrived = resolveFleetArrivals(due(saved));
    expect(arrived.messages.find(message => message.id === old.id)).toEqual(old);
    expect(arrived.messages.at(-1)).toMatchObject({ id: "scout-4-observation-1", npcScoutSnapshot: null });
    expect(arrived.messages.at(-1)!.text).toContain("历史消息编号冲突，未生成新的可预演快照");
    expect(projected).not.toHaveBeenCalled();
    expect(reports(arrived)).toHaveLength(0);
    expect(arrived.fleets[0]!.cargo).toEqual(saved.fleets[0]!.cargo);
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
    const returned = advanceFleets(reload(arrived), 1);
    expect(returned.fleets).toHaveLength(0);
    for (const id of ["metal", "crystal", "deuterium"] as const) {
      expect(activePlanet(returned).resources[id].eq(activePlanet(saved).resources[id].add(saved.fleets[0]!.cargo[id]))).toBe(true);
    }
    expect(reload(returned).messages).toEqual(returned.messages);
    expect(serializeState(saved)).toEqual(before);
  });

  it("searches the complete bounded message list and uses the ordinary FIFO", () => {
    const source: GameState = { ...launch(ready()), messages: [
      { id: "scout-4", at: 0, text: "旧侦察报告", npcScoutSnapshot: null },
      ...Array.from({ length: 149 }, (_, i) => ({ id: `scout-4-observation-${i + 1}`, at: 0, text: "旧历史消息", npcScoutSnapshot: null })),
    ] };
    const arrived = resolveFleetArrivals(due(reload(source)));
    expect(arrived.messages).toHaveLength(150);
    expect(arrived.messages[0]!.id).toBe("scout-4-observation-1");
    expect(arrived.messages.at(-1)!.id).toBe("scout-4-observation-150");
    expect(new Set(arrived.messages.map(message => message.id)).size).toBe(150);
    expect(reports(arrived)).toHaveLength(0);
    expect(reload(arrived).messages).toEqual(arrived.messages);
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
  });

  it("resolves simultaneous legacy collisions once in stable fleet-ID order", () => {
    const ordered = orderUnits(ready(), "espionage_probe", 1, "manual");
    expect(ordered.ok).toBe(true);
    const launched = launch(launch(tick(ordered.state, 1)));
    const state: GameState = { ...launched, messages: [...launched.messages,
      { id: "scout-4", at: 0, text: "较早旧消息", npcScoutSnapshot: null },
      { id: "scout-5", at: 0, text: "较晚旧消息", npcScoutSnapshot: null },
    ] };
    const arrived = resolveFleetArrivals(due(reload(state)));
    const reversed = resolveFleetArrivals(due({ ...reload(state), fleets: [...state.fleets].reverse() }));
    expect(arrived.messages).toEqual(reversed.messages);
    expect(arrived.messages.slice(-2).map(message => message.id)).toEqual(["scout-4-observation-1", "scout-5-observation-1"]);
    expect(reports(arrived)).toHaveLength(0);
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
    const returned = advanceFleets(reload(arrived), 1);
    expect(returned.fleets).toHaveLength(0);
    expect(activePlanet(returned).units.espionage_probe).toBe(2);
    expect(reload(returned).messages).toEqual(returned.messages);
  });

  it("still refuses nonempty cargo for a new paid dispatch", () => {
    const source = ready(), order = { ...request(), cargo: { metal: big(1), crystal: big(2.5), deuterium: big(3) } };
    expect(quoteFlight(source, order).ok).toBe(false);
    expect(sendFleet(source, order).state).toBe(source);
    expect(reports(source)).toHaveLength(0);
  });
});

type ArchivedScoutBoundary = {
  arrivalSeconds: number; returnSeconds: number;
  oldArrivalState: { messages: unknown[]; [field: string]: unknown };
  oldReturnState: { messages: unknown[]; [field: string]: unknown };
  oldArrivalReaderError: string | null; oldReturnReaderError: string | null;
};
function archivedBoundary(id: string) {
  const row = legacyScouts.rows.find(value => value.id === id);
  expect(row, id).toBeDefined();
  expect(row!.revision).toBe(13);
  const boundary = (row as unknown as { legacyBoundary: ArchivedScoutBoundary }).legacyBoundary;
  expect(boundary).toBeDefined();
  const state = deserializeState(importSave(row!.raw).state);
  expect(state.fleets).toHaveLength(1);
  expect(state.fleets[0]!.mission).toBe("scout");
  expect(state.fleets[0]!.returning).toBe(false);
  expect([state.fleets[0]!.cargo.metal.toNumber(), state.fleets[0]!.cargo.crystal.toNumber(), state.fleets[0]!.cargo.deuterium.toNumber()]).toEqual([1, 2.5, 3]);
  expect(reports(state)).toHaveLength(0);
  return { row: row!, boundary, state };
}
function historicalMessageProjection(state: GameState) {
  const serialized = serializeState(state);
  return { ...serialized, messages: serialized.messages.map(({ npcScoutSnapshot: _snapshot, ...message }) => message) };
}

describe("archived r13 reader-admitted synthetic scout boundaries", () => {
  it("migrates original admitted nonzero cargo and preserves every old arrival/return field", () => {
    const { row, boundary, state } = archivedBoundary("r13-synthetic-scout-cargo");
    const rawBefore = row.raw, before = serializeState(state), fleet = state.fleets[0]!;
    expect(boundary.oldArrivalReaderError).toBeNull();
    expect(boundary.oldReturnReaderError).toBeNull();
    const arrived = tick(state, boundary.arrivalSeconds);
    expect(reports(arrived)).toHaveLength(1);
    expect(reports(arrived)[0]!.npcScoutSnapshot).toMatchObject({ fleetId: fleet.id, originId: fleet.originId, target: fleet.target });
    expect(arrived.fleets[0]!.cargo).toEqual(fleet.cargo);
    expect(historicalMessageProjection(arrived)).toEqual(boundary.oldArrivalState);
    expect(reload(arrived).messages).toEqual(arrived.messages);
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
    const returned = tick(arrived, boundary.returnSeconds);
    expect(returned.fleets).toHaveLength(0);
    expect(historicalMessageProjection(returned)).toEqual(boundary.oldReturnState);
    expect(serializeState(reload(returned))).toEqual(serializeState(returned));
    expect(serializeState(state)).toEqual(before);
    expect(row.raw).toBe(rawBefore);
  });

  it.each([
    ["r13-synthetic-scout-message-collision", false],
    ["r13-synthetic-scout-oldest-full-collision", true],
  ] as const)("completes %s while retaining the archived distinction between old failure and success", (id, oldSucceeded) => {
    const { row, boundary, state } = archivedBoundary(id), before = serializeState(state), fleet = state.fleets[0]!;
    const rawBefore = row.raw;
    if (oldSucceeded) {
      expect(state.messages).toHaveLength(150);
      expect(state.messages[0]!.id).toBe(`scout-${fleet.id}`);
      expect(boundary.oldArrivalReaderError).toBeNull();
      expect(boundary.oldReturnReaderError).toBeNull();
    } else {
      expect(state.messages.length).toBeLessThan(150);
      expect(boundary.oldArrivalReaderError).toBe("舰队消息无效");
      expect(boundary.oldReturnReaderError).toBe("舰队消息无效");
    }
    const arrived = tick(state, boundary.arrivalSeconds), { messages: _oldArrivalMessages, ...oldArrival } = boundary.oldArrivalState;
    const { messages: _newArrivalMessages, ...newArrival } = serializeState(arrived);
    expect(newArrival).toEqual(oldArrival);
    expect(reports(arrived)).toHaveLength(0);
    expect(arrived.messages.at(-1)).toMatchObject({ id: `scout-${fleet.id}-observation-1`, npcScoutSnapshot: null });
    expect(arrived.messages.at(-1)!.text).toContain("历史消息编号冲突，未生成新的可预演快照");
    expect(arrived.messages.slice(0, -1)).toEqual(state.messages.slice(-149));
    expect(arrived.fleets[0]!.cargo).toEqual(fleet.cargo);
    expect(serializeState(reload(arrived))).toEqual(serializeState(arrived));
    expect(resolveFleetArrivals(arrived)).toBe(arrived);
    const returned = tick(arrived, boundary.returnSeconds), { messages: _oldReturnMessages, ...oldReturn } = boundary.oldReturnState;
    const { messages: _newReturnMessages, ...newReturn } = serializeState(returned);
    expect(newReturn).toEqual(oldReturn);
    expect(returned.fleets).toHaveLength(0);
    expect(reports(returned)).toHaveLength(0);
    expect(serializeState(reload(returned))).toEqual(serializeState(returned));
    expect(serializeState(state)).toEqual(before);
    expect(row.raw).toBe(rawBefore);
  });
});
