/** Explicit synthetic pre-funded worlds, plus a labeled controlled docking fault/repair. No player data. */
declare const process: { stdout: { write(text: string): void } };
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { tick } from "../src/game/logic";
import { applyOrderAction } from "../src/game/orders";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";

let base=createInitialState(20261010);
const donor=base.planets[0]!;
donor.name="合成固定供货港";
const payer=createPlanet("transport-payer",{galaxy:3,system:50,position:8});
payer.name="合成固定执行星球";
base.planets.push(payer);
base.research.levels={...base.research.levels,astrophysics:1,computer_tech:3,combustion_drive:6,hyperspace_drive:4,energy_tech:7};
base.darkMatter=big(100_000);
for(const planet of base.planets){
  planet.buildings={...planet.buildings,robotics_factory:2,research_lab:8,shipyard:7,metal_mine:15};
  planet.productionPct={...planet.productionPct,metal_mine:0,crystal_mine:0,deuterium_synth:0,solar_plant:0,fusion_reactor:0};
  planet.resources={metal:big(10_000),crystal:big(10_000),deuterium:big(10_000)};
}
donor.resources={metal:big(1_000_000_000),crystal:big(1_000_000_000),deuterium:big(1_000_000_000)};
donor.units.small_cargo=1000;
base=tick(base,0);
const auth={donorPlanetId:donor.id,ship:"small_cargo" as const,count:100,speedPercent:100,maxTrips:2,grossCargoCap:{metal:"1000000",crystal:"1000000",deuterium:"1000000"}};
let departed=applyOrderAction(base,{type:"order-create",request:{kind:"building",planetId:payer.id,building:"metal_mine",targetLevel:16,expectedNextTaskId:1,budget:{metal:"1000000",crystal:"1000000",deuterium:"1000000"},transport:auth}});
if(!departed.ok)throw Error(`Transport fixture creation failed: ${departed.reason}`);
let fault=tick(departed.state,10);
if(fault.fleets.length!==1||fault.orders.tasks[0]!.transport?.trips.length!==1)throw Error(`Fixture failed to dispatch actual transport: ${fault.orders.tasks[0]?.reason}`);
fault=tick(fault,1);
const cancelled=applyOrderAction(fault,{type:"order-cancel",taskId:1});
if(!cancelled.ok)throw Error(`Fixture cancel failed: ${cancelled.reason}`);
fault=cancelled.state;
// Deliberate synthetic fault: another source has filled the donor's unit storage.
// This is not claimed to arise through the browser or normal player progression.
fault={...fault,planets:fault.planets.map(p=>p.id===donor.id?{...p,units:{...p.units,small_cargo:1e15}}:p)};
fault=tick(fault,2);
const blockedTrip=fault.orders.tasks[0]!.transport!.trips[0]!;
if(blockedTrip.phase.kind!=="returning"||!blockedTrip.phase.dockBlocked||fault.fleets.length!==1)throw Error("Synthetic docking fault did not enter explicit blocked return");
// Deliberate controlled repair, delivered only through the app's normal import UI.
// Keeps task/work/fleet IDs and receipts unchanged to test stale-node retirement.
const repaired={...fault,planets:fault.planets.map(p=>p.id===donor.id?{...p,units:{...p.units,small_cargo:900}}:p)};
function guard(name:string,state:GameState){
  const restored=deserializeState(importSave(exportSave(state)).state);
  const snap=JSON.stringify(restored);
  if(JSON.stringify(tick(restored,0))!==snap)throw Error(`${name}: tick(0) changed settled fixture`);
  if(JSON.stringify(deserializeState(importSave(exportSave(restored)).state))!==snap)throw Error(`${name}: strict-reader repeat roundtrip changed fixture`);
}
guard("base",base);guard("blocked fault",fault);guard("controlled repair",repaired);
process.stdout.write(JSON.stringify({description:"Synthetic pre-funded two-world transport acceptance. Base has no plan or fleet. Blocked fixture uses real create, dispatch, tick, cancel and return, then an explicitly injected donor unit-storage fault. Repaired fixture changes only that synthetic donor storage, retaining all exact IDs. Browser imports both through the real app, uses native localStorage and explicitly controlled timestamps. Neither fault nor repair is claimed to be natural player progression.",
  key:STORAGE_KEY,donorId:donor.id,payerId:payer.id,base:JSON.parse(exportSave(base)),blocked:JSON.parse(exportSave(fault)),repaired:JSON.parse(exportSave(repaired))},null,2));
