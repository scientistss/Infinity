/** One prepared homeworld. All colonies shown in the smoke test are created through real fleet actions. */
declare const process: { stdout:{write(text:string):void} };
import { createInitialState } from "../src/game/state";
import { activePlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { tick } from "../src/game/logic";
import { exportSave } from "../src/game/save";
let state=createInitialState(42);const home=activePlanet(state);
home.resources={metal:big(480000),crystal:big(360000),deuterium:big(200000)};
Object.assign(home.buildings,{metal_mine:18,crystal_mine:15,deuterium_synth:12,solar_plant:20,robotics_factory:2,research_lab:4,shipyard:4,metal_storage:7,crystal_storage:7,deuterium_tank:7});
Object.assign(home.units,{colony_ship:3,small_cargo:20,large_cargo:6,espionage_probe:12,light_fighter:36});
Object.assign(state.research.levels,{combustion_drive:6,impulse_drive:3,astrophysics:3,computer_tech:6,energy_tech:4,espionage_tech:4,shielding_tech:2});
state=tick(state,.1);process.stdout.write(exportSave(state));
