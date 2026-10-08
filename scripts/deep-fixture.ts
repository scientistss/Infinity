/** Deterministic acceptance fixture; NOT normal new-game data and no production RNG override. */
import { createInitialState } from "../src/game/state";
import { activePlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { tick } from "../src/game/logic";
import { sendFleet, emptyCargo, type FleetRequest } from "../src/game/fleet";
import { rollCharge } from "../src/game/deep-space";
import { exportSave } from "../src/game/save";
import type { GameState } from "../src/game/types";
declare const process:{argv:string[];stdout:{write(s:string):void}};
function ready(){let s=createInitialState(42);const p=activePlanet(s);
 Object.assign(p.buildings,{metal_mine:15,crystal_mine:12,deuterium_synth:10,solar_plant:20,metal_storage:10,crystal_storage:10,deuterium_tank:10,shipyard:6,research_lab:6});
 p.resources={metal:big(100000),crystal:big(100000),deuterium:big(1000000)};
 Object.assign(p.units,{small_cargo:200,large_cargo:100,light_fighter:300,cruiser:100,recycler:20,espionage_probe:10,colony_ship:4});
 Object.assign(s.research.levels,{astrophysics:4,computer_tech:8,combustion_drive:6,impulse_drive:4,hyperspace_tech:2,weapons_tech:4,shielding_tech:4,armour_tech:4});
 s.darkMatter=big(20000);s=tick(s,.01);s.arcade.runs=[];s.arcade.seed=771;return s;}
const req=(s:GameState):FleetRequest=>({mission:"charge",target:{...activePlanet(s).coordinates,position:16},ships:{small_cargo:5,light_fighter:30,cruiser:8},cargo:emptyCargo(),speedPercent:100,holdSlots:1});
let state=ready();const mode=process.argv[2]??'pirate';
let trial=sendFleet(state,req(state)).state;trial=tick(trial,trial.fleets[0]!.duration);
const symbol=mode==='merchant'?'merchant':mode==='alien'?'alien':mode.startsWith('blackhole')?'blackhole':'pirate';
for(let seed=1;seed<20000;seed++){trial.deepSpace.seed=seed;if(rollCharge(trial,trial.fleets[0]!).rawSymbol===symbol){state.deepSpace.seed=seed;break;}}
if(mode==='blackhole-risk')state.deepSpace.completed=20;
if(mode!=='pirate') {state=sendFleet(state,req(state)).state;state=tick(state,state.fleets[0]!.duration+59);}
process.stdout.write(exportSave(state));
