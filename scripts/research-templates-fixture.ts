/** Anonymous synthetic templates: native tests create their own intent and order authorization. */
declare const process: { stdout: { write(text: string): void } };
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { selectPlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { enqueueResearch } from "../src/game/research";
import { createResearchTemplate } from "../src/game/research-templates";
import { createOrderTask, pauseOrderTask } from "../src/game/orders";
import { equipCard } from "../src/automation/engine";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";
let base = createInitialState(20261010);
base.planets[0]!.name = "合成模板母星";
base.research.levels.astrophysics = 1;
const colony = createPlanet("template-colony", {...base.planets[0]!.coordinates, position:base.planets[0]!.coordinates.position === 9 ? 10 : 9});
colony.name = "合成模板第二星球"; base.planets.push(colony);
for (const planet of base.planets) {
  planet.resources = {metal:big(1_000_000),crystal:big(1_000_000),deuterium:big(1_000_000)};
  planet.buildings = {...planet.buildings, research_lab:2, robotics_factory:2};
  planet.productionPct = {...planet.productionPct,metal_mine:0,crystal_mine:0,deuterium_synth:0,solar_plant:0,fusion_reactor:0};
}
base = tick(base,0);
function ok(result: {state:GameState;ok:boolean;reason:string}): GameState { if (!result.ok) throw new Error(result.reason); return result.state; }
const seeded = ok(createResearchTemplate(base,{name:"合成多科技意图",goals:[{tech:"energy_tech",targetLevel:2},{tech:"computer_tech",targetLevel:1}]},1));
const covered = ok(pauseOrderTask(ok(createOrderTask(seeded,{kind:"research",tech:"energy_tech",targetLevel:3,planetId:colony.id,expectedNextTaskId:1,budget:{metal:"0",crystal:"5600",deuterium:"2800"}})),1));
const conflict = ok(createOrderTask(seeded,{kind:"research",tech:"energy_tech",targetLevel:1,planetId:colony.id,expectedNextTaskId:1,budget:{metal:"0",crystal:"800",deuterium:"400"}}));
const manual = ok(enqueueResearch(selectPlanet(seeded,colony.id),"energy_tech","manual"));
let curvature = {...seeded,lifetime:{metal:big(1e10),crystal:big(0),deuterium:big(0)},warpCores:big(10)};
curvature = tick(curvature,0);
const automatic = equipCard(curvature,0,"auto_prestige");
if (!automatic.state.protocols.slots[0]?.card || automatic.state.protocols.slots[0].card.action.kind !== "prestige") throw new Error("Synthetic auto-curvature card was not equipped");
const variants = {base,seeded,covered,conflict,manual,curvature,automatic:automatic.state};
for (const [name,state] of Object.entries(variants)) {
  const restored = deserializeState(importSave(exportSave(state)).state);
  const next = deserializeState(importSave(exportSave(restored)).state);
  if (JSON.stringify(restored) !== JSON.stringify(next)) throw new Error(`${name}: strict reader roundtrip drift`);
  if (JSON.stringify(tick(restored,0)) !== JSON.stringify(restored)) throw new Error(`${name}: unsettled startup fixture`);
}
process.stdout.write(JSON.stringify({description:"Anonymous pre-funded synthetic two-planet research-intent fixtures, real costs and scheduler. Native HTTP and native Storage tests explicitly control Date/performance/RAF timestamps; curvature and queue variants are labeled synthetic setup, not natural progression.",key:STORAGE_KEY,homeId:base.activePlanetId,colonyId:colony.id,
  ...Object.fromEntries(Object.entries(variants).map(([name,state]) => [name,JSON.parse(exportSave(state))])),
},null,2));
