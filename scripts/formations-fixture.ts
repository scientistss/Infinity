/** Anonymous synthetic fleets. Native tests authorize designs and finite orders through the real UI. */
declare const process: { stdout: { write(text: string): void } };
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { createFormation } from "../src/game/formations";
import { emptyCargo, sendFleet } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { orderUnits, unitSeconds } from "../src/game/shipyard";
import { createOrderTask, pauseOrderTask } from "../src/game/orders";
import { equipCard } from "../src/automation/engine";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";

let base = createInitialState(20261010);
base.planets[0]!.name = "合成编成母星";
base.research.levels.astrophysics = 1;
base.research.levels.combustion_drive = 2;
base.research.levels.computer_tech = 3;
const colony = createPlanet("formation-colony", {...base.planets[0]!.coordinates, position:base.planets[0]!.coordinates.position === 9 ? 10 : 9});
colony.name = "合成编成第二星球"; base.planets.push(colony);
for (const planet of base.planets) {
  planet.resources = {metal:big(1_000_000),crystal:big(1_000_000),deuterium:big(1_000_000)};
  planet.buildings = {...planet.buildings, shipyard:2, robotics_factory:2, research_lab:2};
  planet.productionPct = {...planet.productionPct,metal_mine:0,crystal_mine:0,deuterium_synth:0,solar_plant:0,fusion_reactor:0};
}
base.planets[0]!.units.small_cargo = 1;
base.planets[0]!.units.light_fighter = 3;
base.planets[0]!.units.large_cargo = 7;
base = tick(base,0);
function ok(result: {state:GameState;ok:boolean;reason:string}): GameState { if (!result.ok) throw new Error(result.reason); return result.state; }
function clone(state: GameState): GameState { return deserializeState(importSave(exportSave(state)).state); }
const seeded = ok(createFormation(base,{expectedNextFormationId:1,name:"合成混编 <舰&🚀>",ships:{small_cargo:4,light_fighter:10}}));
const paid = ok(orderUnits(clone(seeded),"light_fighter",2,"manual"));
const single = ok(createFormation(clone(base),{expectedNextFormationId:1,name:"合成轻战有限编成",ships:{light_fighter:10}}));
const conflict = ok(pauseOrderTask(ok(createOrderTask(clone(seeded),{kind:"shipyard",unit:"light_fighter",quantity:999,planetId:base.activePlanetId,expectedNextTaskId:1,budget:{metal:"0",crystal:"0",deuterium:"0"}})),1));
const covered = clone(conflict);
covered.planets[0]!.units.small_cargo = 4; covered.planets[0]!.units.light_fighter = 10;
const inflightStart = clone(paid); inflightStart.planets[0]!.units.light_fighter = 7;
const inflight = ok(sendFleet(inflightStart,{mission:"transport",target:{...colony.coordinates},ships:{light_fighter:4},cargo:emptyCargo(),speedPercent:100}));
let curvature = clone(seeded);
curvature.lifetime = {metal:big(1e10),crystal:big(0),deuterium:big(0)}; curvature.warpCores = big(10); curvature = tick(curvature,0);
const automatic = equipCard(curvature,0,"auto_prestige");
if (!automatic.state.protocols.slots[0]?.card || automatic.state.protocols.slots[0].card.action.kind !== "prestige") throw new Error("Synthetic auto-curvature card was not equipped");
const variants = {base,seeded,paid,single,conflict,covered,inflight,curvature,automatic:automatic.state};
for (const [name,state] of Object.entries(variants)) {
  const restored = deserializeState(importSave(exportSave(state)).state);
  const next = deserializeState(importSave(exportSave(restored)).state);
  if (JSON.stringify(restored) !== JSON.stringify(next)) throw new Error(`${name}: strict reader roundtrip drift`);
  if (JSON.stringify(tick(restored,0)) !== JSON.stringify(restored)) throw new Error(`${name}: unsettled startup fixture`);
}
process.stdout.write(JSON.stringify({description:"Anonymous pre-funded synthetic two-planet named-formation fixtures, actual catalog prices, real paid queue and real dispatch API. Native HTTP and native Storage tests explicitly control Date/performance/RAF timestamps. These are labeled synthetic setups, not natural progression.",key:STORAGE_KEY,homeId:base.activePlanetId,colonyId:colony.id,colonyCoordinates:colony.coordinates,unitMilliseconds:unitSeconds(base,"light_fighter")*1000,
  ...Object.fromEntries(Object.entries(variants).map(([name,state]) => [name,JSON.parse(exportSave(state))])),
},null,2));
