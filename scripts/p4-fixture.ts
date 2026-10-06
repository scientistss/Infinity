/** Deterministic review fixture only. Never used by the new-game path. */
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { big } from "../src/game/decimal";
import { exportSave } from "../src/game/save";
import { tick } from "../src/game/logic";
import { refreshUnlocks } from "../src/automation/engine";
import { createArcade } from "../src/game/arcade";

let state = createInitialState();
state.arcade = createArcade(20261006);
const home = state.planets[0]!;
home.name = "黎明母星";
home.resources = { metal: big(80000), crystal: big(50000), deuterium: big(40000) };
home.buildings = { ...home.buildings, metal_mine: 15, crystal_mine: 12, deuterium_synth: 10, solar_plant: 16, metal_storage: 5, crystal_storage: 5, deuterium_tank: 5, robotics_factory: 4, shipyard: 4, research_lab: 4 };
home.units = { ...home.units, small_cargo: 20, colony_ship: 3, espionage_probe: 20, solar_satellite: 10 };
state.research.levels = { ...state.research.levels, energy_tech: 5, computer_tech: 4, astrophysics: 3, combustion_drive: 4, impulse_drive: 3, espionage_tech: 4 };
const colony = { ...createPlanet(), id: "review-colony", name: "霜线前哨", homeworld: false, coordinates: { galaxy: 1, system: 51, position: 12 }, tempMax: -45, fieldsMax: 181 };
colony.buildings = { ...colony.buildings, metal_mine: 7, crystal_mine: 5, deuterium_synth: 6, solar_plant: 10, metal_storage: 2, crystal_storage: 2, deuterium_tank: 2, robotics_factory: 2, shipyard: 2, research_lab: 3 };
colony.resources = { metal: big(15000), crystal: big(9000), deuterium: big(5000) };
state.planets.push(colony);
state = refreshUnlocks(tick(state, 0));
console.log(exportSave(state));
