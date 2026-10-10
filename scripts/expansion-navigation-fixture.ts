/** Anonymous synthetic initial balances/technology/inventory; every colony,
 * reservation, return, paid queue and deep encounter is made by the real APIs.
 * Strict readers and zero-time startup are settled before browser snapshots.
 */
declare const process: { stdout: { write(text: string): void } };
import { equipCard } from "../src/automation/engine";
import { grantRun } from "../src/game/arcade";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { expeditionSlots, storedRunLimit } from "../src/game/deep-state";
import { rollCharge } from "../src/game/deep-space";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { colonyCount, colonyLimit, emptyCargo, fleetSlots, quoteFlight, recallFleet, reservedColonies, sendFleet, type FleetRequest } from "../src/game/fleet";
import { createFormation } from "../src/game/formations";
import { coordinateKey, distance, npcAt, planetProperties, sameCoordinates, SPACE, type Coordinates } from "../src/game/galaxy";
import { tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { orderUnits } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

function ok(result: {state: GameState; ok: boolean; reason: string}): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
const clone = (state: GameState): GameState => deserializeState(importSave(exportSave(state)).state);
function settled(name: string, state: GameState): GameState {
  const result = clone(tick(clone(tick(state, 0)), 0));
  if (JSON.stringify(clone(result)) !== JSON.stringify(result) || JSON.stringify(tick(result, 0)) !== JSON.stringify(result)) {
    throw new Error(`${name}: strict reader or zero-time startup drift`);
  }
  return result;
}
function colonyRequest(target: Coordinates): FleetRequest {
  return {mission:"colonize", target:{...target}, ships:{colony_ship:1}, cargo:emptyCargo(), speedPercent:100};
}
function free(state: GameState, cursor: Coordinates): Coordinates[] {
  return Array.from({length:15}, (_, index) => ({...cursor,position:index+1})).filter(c =>
    !npcAt(state,c) && !state.planets.some(p=>sameCoordinates(p.coordinates,c)) &&
    !state.fleets.some(f=>f.mission === "colonize" && !f.returning && sameCoordinates(f.target,c)));
}
let base = createInitialState(20261010, 20261010);
const HOME = base.activePlanetId;
const home = activePlanet(base);
home.name = "匿名扩张母星 <母星&🚀>";
home.resources = {metal:big(100_000),crystal:big(100_000),deuterium:big(100_000)};
Object.assign(home.buildings, {robotics_factory:4,shipyard:4,research_lab:4,metal_storage:4,crystal_storage:4,deuterium_tank:4});
Object.assign(home.units, {colony_ship:6,small_cargo:30,recycler:4,light_fighter:40,cruiser:10});
Object.assign(base.research.levels, {astrophysics:8,computer_tech:8,combustion_drive:6,impulse_drive:4,
  energy_tech:3,espionage_tech:4,shielding_tech:4,weapons_tech:4,armour_tech:4});
home.productionPct = {...home.productionPct,metal_mine:0,crystal_mine:0,deuterium_synth:0,solar_plant:0,fusion_reactor:0};
const CURSOR = {...home.coordinates};
const first = free(base,CURSOR)[0]!;
base = ok(sendFleet(base,colonyRequest(first)));
base = tick(base,base.fleets[0]!.remaining);
const colony = base.planets.find(p=>p.id !== HOME)!;
if (!colony) throw new Error("Real colonization did not create the owned fixture planet");
const COLONY = colony.id;
// Explicit synthetic stored values intentionally differ from procedural generation.
colony.name = "已存殖民地 <旧值&🌌>"; colony.tempMax = -77; colony.fieldsMax = 231;
colony.productionPct = {...home.productionPct};
colony.resources = {metal:big(100_000),crystal:big(100_000),deuterium:big(100_000)};
Object.assign(colony.units,{colony_ship:2,small_cargo:5,recycler:1});
base = ok(createFormation(base,{expectedNextFormationId:1,name:"只读检查保留编成",ships:{small_cargo:3,colony_ship:1}}));
base = settled("base",base);
const EMPTY = free(base,CURSOR)[0]!;
const NPC = Array.from({length:15},(_,i)=>({...CURSOR,position:i+1})).find(c=>npcAt(base,c));
if (!NPC) throw new Error("Deterministic system must contain an NPC status fixture");

let ready = ok(enqueue(clone(base),"metal_storage","manual"));
ready = ok(orderUnits(ready,"light_fighter",2,"manual"));
let reserved = ok(sendFleet(clone(base),colonyRequest(EMPTY)));
reserved = tick(reserved,.125);
const returning = ok(recallFleet(clone(reserved),reserved.fleets[0]!.id));
let fullFleet = clone(base); fullFleet.research.levels.computer_tech = 0;
fullFleet = ok(sendFleet(fullFleet,{mission:"transport",target:{...colony.coordinates},ships:{small_cargo:1},cargo:emptyCargo(),speedPercent:100}));
fullFleet = tick(fullFleet,fullFleet.fleets[0]!.remaining);
if (!fullFleet.fleets[0]?.returning) throw new Error("Actual transport must be on its return leg");
const noShip = clone(base); activePlanet(noShip).units.colony_ship = 0;
const noFuel = clone(base); activePlanet(noFuel).resources.deuterium = big(0);
const noShipyard = clone(base); activePlanet(noShipyard).buildings.shipyard = 0;
const colonyFull = clone(base); colonyFull.research.levels.astrophysics = 1;
let queued = clone(base); queued.research.levels.astrophysics = 2;
queued = ok(enqueueResearch(queued,"astrophysics","manual"));
const noExpedition = clone(base); noExpedition.research.levels.astrophysics = 0;
let deepReturning = clone(base); deepReturning.research.levels.astrophysics = 1;
deepReturning = ok(sendFleet(deepReturning,{mission:"charge",target:{...CURSOR,position:16},ships:{small_cargo:1},cargo:emptyCargo(),speedPercent:100,holdSlots:1,chargeWithBets:false}));
deepReturning = tick(deepReturning,.125);
deepReturning = ok(recallFleet(deepReturning,deepReturning.fleets[0]!.id));
let ticketsFull = clone(base);
while (ticketsFull.arcade.runs.length < storedRunLimit(ticketsFull)) {
  const grant = grantRun(ticketsFull,"bonus");
  if (!grant.granted) throw new Error("Cannot make real full-ticket fixture");
  ticketsFull = grant.state;
}

let holding = ok(sendFleet(clone(base),{mission:"charge",target:{...CURSOR,position:16},ships:{small_cargo:5,light_fighter:30,cruiser:8},cargo:emptyCargo(),speedPercent:100,holdSlots:1,chargeWithBets:false}));
holding = tick(holding,holding.fleets[0]!.remaining);
let deepDebris: GameState | undefined;
for (let seed=1;seed<20_000;seed++) {
  const trial = {...holding,deepSpace:{...holding.deepSpace,seed}};
  if (rollCharge(trial,trial.fleets[0]!).rawSymbol !== "pirate") continue;
  let result = tick(trial,trial.fleets[0]!.remaining);
  if (!result.deepSpace.debris.length) continue;
  if (result.fleets.length) result = tick(result,result.fleets[0]!.remaining);
  deepDebris = result; break;
}
if (!deepDebris) throw new Error("No bounded real combat/debris fixture seed");

// Reach the global cap through 98 additional valid, paid real colonizations.
// Initial extra colony ships, wallets and completed research are synthetic setup.
let globalFull = clone(base);
globalFull.research.levels.astrophysics = 200;
activePlanet(globalFull).units.colony_ship = 150;
activePlanet(globalFull).resources.deuterium = big(1_000_000);
for (let system=1;system<=SPACE.systems && globalFull.planets.length<SPACE.maxPlanets;system++) {
  for (const target of free(globalFull,{galaxy:CURSOR.galaxy,system,position:1})) {
    if (globalFull.planets.length >= SPACE.maxPlanets) break;
    globalFull = ok(sendFleet(globalFull,colonyRequest(target)));
    globalFull = tick(globalFull,globalFull.fleets[0]!.remaining);
  }
}
if (globalFull.planets.length !== 100) throw new Error("Real colonization did not reach global safety cap");
// The original target is in the home system; preserve a known unowned coordinate
// even when the cap-building route happened to pass through that same system.
const GLOBAL_TARGET = free(globalFull,{galaxy:2,system:100,position:1})[0]!;
let curvature = clone(base);
curvature.lifetime = {metal:big(1e10),crystal:big(0),deuterium:big(0)};
curvature.warpCores = big(10); curvature = tick(curvature,0);
const automatic = equipCard(clone(curvature),0,"auto_prestige").state;
if (automatic.protocols.slots[0]?.card?.action.kind !== "prestige") throw new Error("Auto-curvature fixture is not armed");
const incoming = clone(base); activePlanet(incoming).name = "导入同 ID 的新母星";
const originColony = selectPlanet(clone(base),COLONY);
const variants: Record<string,GameState> = {base,ready,reserved,returning,fullFleet,noShip,noFuel,noShipyard,colonyFull,queued,
  noExpedition,deepReturning,ticketsFull,deepDebris,globalFull,curvature,automatic,incoming,originColony};
for (const name of Object.keys(variants)) variants[name] = settled(name,variants[name]!);

function expected(state: GameState, cursor: Coordinates, position: number) {
  const target = {...cursor,position};
  const origin = activePlanet(state);
  const owned = state.planets.find(p=>sameCoordinates(p.coordinates,target));
  const status = (c: Coordinates) => c.position === 16 ? "deep" : state.planets.some(p=>sameCoordinates(p.coordinates,c)) ? "owned" :
    npcAt(state,c) ? "npc" : state.fleets.some(f=>f.mission === "colonize" && !f.returning && sameCoordinates(f.target,c)) ? "reserved" : "empty";
  const requests: FleetRequest[] = position === 16 ? [
    {mission:"charge",target,ships:{small_cargo:1},cargo:emptyCargo(),speedPercent:100,holdSlots:1,chargeWithBets:false},
    {mission:"recycle",target,ships:{recycler:1},cargo:emptyCargo(),speedPercent:100},
  ] : [colonyRequest(target)];
  return {target,originId:origin.id,originName:origin.name,originCoordinates:origin.coordinates,
    statuses:Array.from({length:16},(_,i)=>status({...cursor,position:i+1})),status:status(target),
    properties:position === 16 ? null : owned ? {tempMax:owned.tempMax,fieldsMax:owned.fieldsMax} : planetProperties(state.universe.seed,target),
    owned:!!owned,home:owned?.id === HOME,distance:distance(origin.coordinates,target),
    capacity:{colonies:colonyCount(state),colonyLimit:colonyLimit(state),reserved:reservedColonies(state),planets:state.planets.length,
      globalLimit:SPACE.maxPlanets,fleets:state.fleets.length,fleetLimit:fleetSlots(state),expeditions:state.fleets.filter(f=>f.mission === "charge").length,expeditionLimit:expeditionSlots(state)},
    scenarios:requests.map(request=>{const quote=quoteFlight(state,request);return {mission:request.mission,ok:quote.ok,reason:quote.reason,
      ...(quote.ok ? {duration:quote.duration,fuel:quote.fuel.toString(),capacity:quote.capacity.toString(),holdSeconds:quote.holdSeconds,stake:quote.stake} : {})};})};
}
const cases = [
  {name:"ready",fixture:"ready",target:EMPTY},
  {name:"home",fixture:"base",target:CURSOR},
  {name:"owned",fixture:"base",target:colony.coordinates},
  {name:"npc",fixture:"base",target:NPC},
  ...["reserved","returning","fullFleet","noShip","noFuel","noShipyard","colonyFull","queued"].map(name=>({name,fixture:name,target:EMPTY})),
  ...["base","noExpedition","deepReturning","ticketsFull","deepDebris"].map(name=>({name:"deep-"+name,fixture:name,target:{...CURSOR,position:16}})),
  {name:"globalFull",fixture:"globalFull",target:GLOBAL_TARGET},
  {name:"originColony",fixture:"originColony",target:EMPTY},
  {name:"ringGalaxy",fixture:"base",target:free(base,{galaxy:5,system:CURSOR.system,position:1})[0]!},
  {name:"cargoCapacity",fixture:"base",target:free(base,{galaxy:3,system:CURSOR.system,position:1})[0]!},
  {name:"ringSystem",fixture:"base",target:free(base,{galaxy:1,system:100,position:1})[0]!},
].map(row=>({...row,expected:expected(variants[row.fixture]!,row.target,row.target.position)}));
if (!cases.find(row=>row.name === "ready")?.expected.scenarios[0]?.ok ||
    cases.find(row=>row.name === "cargoCapacity")?.expected.scenarios[0]?.reason !== "货舱不足（货物与预留往返燃料共用货舱）" ||
    !cases.find(row=>row.name === "noShipyard")?.expected.scenarios[0]?.ok ||
    !cases.find(row=>row.name === "deep-deepDebris")?.expected.scenarios[1]?.ok) throw new Error("Scenario fixture failed its rule-level premise");
process.stdout.write(JSON.stringify({description:"Anonymous synthetic inventory, balances and completed technologies. Real API colonization creates stored owned worlds and the 100-planet cap; real dispatch/recall produce reservations and returning slots; paid build/ship/research jobs use official APIs; bounded saved RNG selects a real pirate encounter and real debris. No player data. All snapshots pass strict canonical readers and unchanged zero-time startup. Expected quotes call quoteFlight directly, independently of the expansion model.",
  key:STORAGE_KEY,homeId:HOME,colonyId:COLONY,cursor:CURSOR,empty:EMPTY,npc:NPC,colonyCoordinates:colony.coordinates,
  homeKey:coordinateKey(CURSOR),cases,...Object.fromEntries(Object.entries(variants).map(([name,state])=>[name,JSON.parse(exportSave(state))]))},null,2));
