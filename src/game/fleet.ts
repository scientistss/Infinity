import { DRIVE_BONUS, SHIP_IDS, unitById, type ShipId } from "../data/units";
import { activePlanet, withPlanet } from "./empire";
import { big, isValidAmount } from "./decimal";
import { coordinateKey, distance, GALAXY, npcAt, planetProperties, sameCoordinates, validCoordinates, type Coordinates } from "./galaxy";
import { clonePlanet, createPlanet } from "./planet";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "./types";

export const MISSIONS = ["transport", "deploy", "colonize", "scout"] as const;
export type Mission = (typeof MISSIONS)[number];
export const MISSION_LABEL: Record<Mission, string> = { transport: "运输", deploy: "部署", colonize: "殖民", scout: "侦察" };
export interface Fleet {
  id: number;
  originId: string;
  target: Coordinates;
  mission: Mission;
  ships: Partial<Record<ShipId, number>>;
  cargo: ResourceAmounts;
  /** One-way duration locked at dispatch; technology changes do not teleport fleets. */
  duration: number;
  remaining: number;
  returning: boolean;
  elapsed: number;
}
export interface FleetMessage { id: string; at: number; text: string }
export interface FleetRequest {
  mission: Mission;
  target: Coordinates;
  ships: Partial<Record<ShipId, number>>;
  cargo: ResourceAmounts;
  speedPercent: number;
}
export interface FlightQuote { ok: boolean; reason: string; duration: number; fuel: ReturnType<typeof big>; capacity: ReturnType<typeof big> }
export interface FleetResult { ok: boolean; reason: string; state: GameState }
export function emptyCargo(): ResourceAmounts { return { metal: big(0), crystal: big(0), deuterium: big(0) }; }
export function fleetSlots(state: GameState): number { return Math.min(GALAXY.maxFleetCount, 1 + state.research.levels.computer_tech); }
export function colonyLimit(state: GameState): number { return Math.ceil(state.research.levels.astrophysics / 2); }
export function reservedColonies(state: GameState): number { return state.fleets.filter((f) => f.mission === "colonize" && !f.returning).length; }
export function colonyCount(state: GameState): number { return state.planets.filter((p) => !p.homeworld).length; }
export function flightSeconds(d: number, speed: number, percent: number): number {
  if (!(d > 0) || !(speed > 0) || !Number.isFinite(d + speed) || percent < 10 || percent > 100 || percent % 10) throw new Error("飞行参数无效");
  return Math.max(GALAXY.minFlightSeconds, (10 + 35000 / percent * Math.sqrt(10 * d / speed)) / GALAXY.fleetSpeed);
}
export function shipEngine(state: GameState, id: ShipId): { speed: number; fuel: number } {
  const stages = unitById(id).drives;
  const engine = [...stages].reverse().find((s) => state.research.levels[s.drive] >= s.level);
  if (!engine) return { speed: 0, fuel: 0 };
  return { speed: engine.speed * (1 + DRIVE_BONUS[engine.drive] * state.research.levels[engine.drive]), fuel: engine.fuel };
}

/** Validate the entire command before deducting anything. All resource arithmetic stays decimal. */
export function quoteFlight(state: GameState, request: FleetRequest): FlightQuote {
  const fail = (reason: string): FlightQuote => ({ ok: false, reason, duration: 0, fuel: big(0), capacity: big(0) });
  if (!request || !MISSIONS.includes(request.mission)) return fail("任务类型无效");
  if (!validCoordinates(request.target)) return fail("目标坐标无效；深空充能尚未开放");
  if (!Number.isInteger(request.speedPercent) || request.speedPercent % 10 || request.speedPercent < 10 || request.speedPercent > 100) return fail("速度必须为 10–100%，步长 10%");
  if (state.fleets.length >= fleetSlots(state)) return fail("舰队槽位已满");
  const origin = activePlanet(state);
  if (sameCoordinates(origin.coordinates, request.target)) return fail("不能向当前星球派遣舰队");
  if (!request.ships || !request.cargo) return fail("舰队或货物参数缺失");
  let capacity = big(0), total = 0, slowest = Infinity;
  const selected: Array<{ count: number; speed: number; fuel: number }> = [];
  for (const [key, count] of Object.entries(request.ships)) {
    if (!SHIP_IDS.includes(key as ShipId) || key === "solar_satellite") return fail("只能派遣可飞行舰船，不能派遣卫星或防御");
    if (!Number.isSafeInteger(count) || count < 0 || count > 1e15) return fail("舰船数量必须是安全范围内的非负整数");
    if (!count) continue;
    const id = key as ShipId;
    if (count > origin.units[id]) return fail(`${unitById(id).nameZh} 数量不足`);
    const engine = shipEngine(state, id);
    if (!(engine.speed > 0)) return fail("舰船没有可用引擎");
    total += count;
    slowest = Math.min(slowest, engine.speed);
    capacity = capacity.add(big(unitById(id).cargo).mul(count).mul(1 + 0.05 * state.research.levels.hyperspace_tech));
    selected.push({ count, ...engine });
  }
  if (!total) return fail("至少选择一艘舰船");
  const targetPlanet = state.planets.find((p) => sameCoordinates(p.coordinates, request.target));
  if ((request.mission === "transport" || request.mission === "deploy") && !targetPlanet) return fail("运输和部署的目标必须是自己的星球");
  if (request.mission === "colonize") {
    if (!request.ships.colony_ship) return fail("殖民任务需要殖民船");
    if (targetPlanet || npcAt(state, request.target)) return fail("目标位置已被占据");
    if (state.fleets.some((f) => f.mission === "colonize" && !f.returning && sameCoordinates(f.target, request.target))) return fail("该位置已有殖民舰队在途");
    if (colonyCount(state) + reservedColonies(state) >= colonyLimit(state)) return fail("殖民地名额不足，需提升天体物理学");
  }
  if (request.mission === "scout" && !request.ships.espionage_probe) return fail("侦察任务需要间谍卫星");
  const d = distance(origin.coordinates, request.target);
  const duration = flightSeconds(d, slowest, request.speedPercent);
  // Relative engine throttles account for mixed-speed fleets; reserve both legs even for deployment.
  let fuel = big(0);
  for (const ship of selected) {
    const throttle = request.speedPercent / 100 * Math.sqrt(slowest / ship.speed);
    fuel = fuel.add(big(ship.fuel).mul(ship.count).mul(d / 35000).mul((throttle + 1) ** 2));
  }
  fuel = fuel.ceil().add(1).mul(2);
  let load = big(0);
  for (const id of RESOURCE_IDS) {
    const amount = request.cargo[id];
    if (!amount || typeof amount.add !== "function" || !isValidAmount(amount)) return fail("货物必须为有限的非负大数");
    if (request.mission === "scout" && amount.gt(0)) return fail("侦察不携带货物");
    load = load.add(amount);
    if (origin.resources[id].lt(amount.add(id === "deuterium" ? fuel : 0))) return fail(`${id === "metal" ? "金属" : id === "crystal" ? "晶体" : "重氢（含往返燃料）"}不足`);
  }
  if (load.add(fuel).gt(capacity)) return fail("货舱不足（货物与预留往返燃料共用货舱）");
  if (!Number.isSafeInteger(state.nextFleetId) || state.nextFleetId >= Number.MAX_SAFE_INTEGER) return fail("舰队编号已超出安全范围");
  return { ok: true, reason: "可以出发", duration, fuel, capacity };
}
export function sendFleet(state: GameState, request: FleetRequest): FleetResult {
  const quote = quoteFlight(state, request);
  if (!quote.ok) return { ok: false, reason: quote.reason, state };
  const planet = clonePlanet(activePlanet(state));
  for (const id of SHIP_IDS) planet.units[id] -= request.ships[id] ?? 0;
  for (const id of RESOURCE_IDS) planet.resources[id] = planet.resources[id].sub(request.cargo[id]).sub(id === "deuterium" ? quote.fuel : 0);
  const fleet: Fleet = { id: state.nextFleetId, originId: planet.id, target: { ...request.target }, mission: request.mission, ships: { ...request.ships }, cargo: { ...request.cargo }, duration: quote.duration, remaining: quote.duration, returning: false, elapsed: 0 };
  const next = { ...withPlanet(state, { planet }), fleets: [...state.fleets, fleet], nextFleetId: state.nextFleetId + 1 };
  return { ok: true, state: addMessage(next, `dispatch-${fleet.id}`, `${MISSION_LABEL[fleet.mission]}舰队 #${fleet.id} 已从 ${planet.name} 出发，目标 [${coordinateKey(fleet.target)}]。`), reason: "舰队已出发，往返燃料已扣除" };
}
export function nextFleetEvent(state: GameState): number {
  return state.fleets.reduce((min, f) => Math.min(min, Math.max(0, f.remaining)), Infinity);
}
export function advanceFleets(state: GameState, seconds: number): GameState {
  const advanced = { ...state, fleets: state.fleets.map((f) => ({ ...f, remaining: Math.max(0, f.remaining - seconds), elapsed: f.elapsed + seconds })) };
  return resolveFleetArrivals(advanced);
}
function addMessage(state: GameState, id: string, text: string): GameState {
  return { ...state, messages: [...state.messages, { id, at: state.totalTime.toNumber(), text }].slice(-GALAXY.maxMessages) };
}
function unload(state: GameState, planetId: string, fleet: Fleet, ships: boolean): GameState {
  return { ...state, planets: state.planets.map((p) => {
    if (p.id !== planetId) return p;
    const next = clonePlanet(p);
    for (const id of RESOURCE_IDS) next.resources[id] = next.resources[id].add(fleet.cargo[id]);
    if (ships) for (const id of SHIP_IDS) next.units[id] += fleet.ships[id] ?? 0;
    return next;
  }) };
}
/** Resolve only due events; tick must stop at their exact times before calling this. */
export function resolveFleetArrivals(state: GameState): GameState {
  let next = state;
  for (const fleet of [...state.fleets].sort((a, b) => a.id - b.id)) {
    if (fleet.remaining > 1e-9) continue;
    const remove = () => { next = { ...next, fleets: next.fleets.filter((f) => f.id !== fleet.id) }; };
    if (fleet.returning) {
      if (!next.planets.some((p) => p.id === fleet.originId)) throw new Error("返航母港不存在");
      next = unload(next, fleet.originId, fleet, true);
      remove();
      next = addMessage(next, `return-${fleet.id}`, `舰队 #${fleet.id} 已返航，舰船与剩余货物已入港。`);
      continue;
    }
    const target = next.planets.find((p) => sameCoordinates(p.coordinates, fleet.target));
    let cargo = fleet.cargo;
    const ships = { ...fleet.ships };
    if ((fleet.mission === "transport" || fleet.mission === "deploy") && target) {
      next = unload(next, target.id, fleet, fleet.mission === "deploy");
      next = addMessage(next, `arrival-${fleet.id}`, `舰队 #${fleet.id} 已抵达 ${target.name}，${fleet.mission === "deploy" ? "舰船与货物完成部署" : "货物已卸载，舰队开始返航"}。`);
      if (fleet.mission === "deploy") { remove(); continue; }
      cargo = emptyCargo();
    } else if (fleet.mission === "colonize" && !target && !npcAt(next, fleet.target) && colonyCount(next) < colonyLimit(next) && (ships.colony_ship ?? 0) > 0) {
      const id = `colony-${fleet.id}`;
      const planet = { ...createPlanet(), ...planetProperties(next.universe.seed, fleet.target), id, name: `殖民地 ${coordinateKey(fleet.target)}`, coordinates: { ...fleet.target }, homeworld: false, resources: { ...fleet.cargo } };
      next = { ...next, planets: [...next.planets, planet] };
      ships.colony_ship! -= 1;
      cargo = emptyCargo();
      next = addMessage(next, `colony-${fleet.id}`, `已建立 ${planet.name}。消耗 1 艘殖民船；其余舰船返航。`);
      if (!Object.values(ships).some((n) => n > 0)) { remove(); continue; }
    } else if (fleet.mission === "scout") {
      const npc = npcAt(next, fleet.target);
      const detail = target ? `${target.name}（己方），${target.fieldsMax} 格` : npc ? `${npc.name}，派系：${npc.faction}。当前阶段不会反击；战斗与精确情报尚未开放` : "无人占据，可派殖民船建立基地";
      next = addMessage(next, `scout-${fleet.id}`, `侦察报告 [${coordinateKey(fleet.target)}]：${detail}。`);
    } else {
      next = addMessage(next, `failed-${fleet.id}`, `舰队 #${fleet.id} 目标失效，全部舰船及货物原路返航。`);
    }
    next = { ...next, fleets: next.fleets.map((f) => f.id === fleet.id ? { ...fleet, ships, cargo, returning: true, remaining: fleet.duration, elapsed: 0 } : f) };
  }
  return next;
}
export function recallFleet(state: GameState, id: number): FleetResult {
  const fleet = state.fleets.find((f) => f.id === id);
  if (!fleet || fleet.returning) return { ok: false, state, reason: "舰队不存在或已在返航途中" };
  const next = { ...state, fleets: state.fleets.map((f) => f.id === id ? { ...f, returning: true, remaining: Math.min(f.duration, f.elapsed), elapsed: 0 } : f) };
  return { ok: true, state: resolveFleetArrivals(addMessage(next, `recall-${id}`, `舰队 #${id} 已召回，返航耗时等于已飞行时间；燃料不退还。`)), reason: "召回指令已下达" };
}
export function abandonColony(state: GameState, id: string): FleetResult {
  const planet = state.planets.find((p) => p.id === id);
  if (!planet || planet.homeworld) return { state, ok: false, reason: "不能放弃母星" };
  if (state.fleets.some((f) => f.originId === id || sameCoordinates(f.target, planet.coordinates)) || state.research.queue.some((q) => q.planetId === id)) return { state, ok: false, reason: "仍有相关舰队或研究订单，不能放弃该星球" };
  const planets = state.planets.filter((p) => p.id !== id);
  return { state: { ...state, planets, activePlanetId: state.activePlanetId === id ? planets[0]!.id : state.activePlanetId }, ok: true, reason: "殖民地已放弃；其库存、建筑与驻留舰船不退款" };
}
