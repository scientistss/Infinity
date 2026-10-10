/** Synthetic pre-funded finite-plan acceptance cases; no player data. */
declare const process: { stdout: { write(text: string): void } };
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { selectPlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { orderUnits, unitSeconds } from "../src/game/shipyard";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";

let base = createInitialState(20261010);
base.planets[0]!.name = "合成付款母星";
base.research.levels.astrophysics = 1;
base.research.levels.combustion_drive = 2;
base.darkMatter = big(100_000);
const colony = createPlanet("order-colony",{...base.planets[0]!.coordinates,position:base.planets[0]!.coordinates.position === 9 ? 10 : 9});
colony.name = "合成第二付款星球";
base.planets.push(colony);
for (const planet of base.planets) {
  planet.resources = {metal:big(1_000_000),crystal:big(1_000_000),deuterium:big(1_000_000)};
  planet.buildings = {...planet.buildings,robotics_factory:2,research_lab:2,shipyard:2,metal_mine:1};
  // Pre-funded above ordinary storage limits: no production contaminates exact
  // browser wallet debit/refund assertions. Costs and durations remain real.
  planet.productionPct = {...planet.productionPct,metal_mine:0,crystal_mine:0,deuterium_synth:0,solar_plant:0,fusion_reactor:0};
}
// Settle all legitimate startup achievements/opening tickets before snapshots.
base = tick(base,0);
let manual = base;
function requireOk(result: {state:GameState;ok:boolean;reason:string}): GameState {
  if (!result.ok) throw new Error(`Fixture enqueue failed: ${result.reason}`);
  return result.state;
}
for (const planet of base.planets) {
  manual = selectPlanet(manual,planet.id);
  manual = requireOk(enqueue(manual,"metal_mine","manual"));
  manual = requireOk(enqueue(manual,"crystal_mine","manual"));
  manual = requireOk(orderUnits(manual,"light_fighter",5,"manual"));
  manual = requireOk(enqueueResearch(manual,"energy_tech","manual"));
}
manual = tick(selectPlanet(manual,base.activePlanetId),0);
function snapshot(state: GameState): string {
  return JSON.stringify({orders:state.orders,planets:state.planets,research:state.research,unlocked:state.unlocked,
    darkMatter:state.darkMatter.toString(),arcade:state.arcade,stats:state.stats});
}
function guard(name: string, state: GameState): void {
  const restored = deserializeState(importSave(exportSave(state)).state);
  const expected = snapshot(restored);
  if (snapshot(tick(restored,0)) !== expected) throw new Error(`${name}: startup tick(0) changed settled fixture`);
  const twice = deserializeState(importSave(exportSave(restored)).state);
  if (snapshot(twice) !== expected) throw new Error(`${name}: second strict-reader roundtrip changed fixture`);
  if (state.orders.tasks.length || state.orders.nextTaskId !== 1) throw new Error(`${name}: fixtures must carry no pre-authorized plans`);
}
guard("base",base); guard("manual",manual);
process.stdout.write(JSON.stringify({
  description:"Synthetic pre-funded two-planet finite-plan cases. Real startup achievements are settled before strict-reader, repeat roundtrip and tick(0) generation guards. All prices, queues and durations use production rules. Browser uses actual HTTP, native localStorage, native input and explicitly controlled simulation timestamps. Not natural progression or player data.",
  key:STORAGE_KEY,homeId:base.activePlanetId,colonyId:colony.id,shipSeconds:unitSeconds(base,"light_fighter"),
  base:JSON.parse(exportSave(base)),manual:JSON.parse(exportSave(manual)),
},null,2));
