declare const process: { argv: string[]; stdout: { write(text: string): void } };
/** Explicit review fixture; never used by the normal new-game path. */
import { activePlanet, onPlanet } from "../src/game/empire";
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { big } from "../src/game/decimal";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { orderUnits } from "../src/game/shipyard";
import { tick } from "../src/game/logic";
import { equipCard } from "../src/automation/engine";
import { exportSave } from "../src/game/save";

let state = createInitialState();
state.arcade.seed = 1234567;
if (!process.argv.includes("--new-game")) {
  const home = activePlanet(state);
  Object.assign(home.buildings, {
    metal_mine: 18, crystal_mine: 15, deuterium_synth: 12, solar_plant: 20,
    robotics_factory: 2, research_lab: 4, shipyard: 4,
    metal_storage: 7, crystal_storage: 7, deuterium_tank: 7,
  });
  home.resources = { metal: big(480000), crystal: big(360000), deuterium: big(200000) };
  const colony = createPlanet("colony-review", {galaxy:1,system:1,position:1});
  colony.name = "冰海试验站";
  colony.tempMax = -30;
  Object.assign(colony.buildings, {
    metal_mine: 16, crystal_mine: 10, deuterium_synth: 8, solar_plant: 7,
    robotics_factory: 0, research_lab: 2, shipyard: 2,
    metal_storage: 5, crystal_storage: 5, deuterium_tank: 5,
  });
  colony.resources = { metal: big(86000), crystal: big(46000), deuterium: big(28000) };
  state.planets.push(colony);
  Object.assign(state.research.levels, { energy_tech: 4, combustion_drive: 6, espionage_tech: 4, computer_tech: 6, astrophysics: 2, shielding_tech: 2 });
  state.manualClicks = 100;
  state.totalTime = big(5400);
  state = tick(state, 0);
  state = enqueue(state, "metal_mine", "manual").state;
  state = enqueue(state, "crystal_mine", "manual").state;
  state = orderUnits(state, "large_cargo", 16, "manual").state;
  state = enqueueResearch(state, "computer_tech", "manual").state;
  state = onPlanet(state, colony.id, s => enqueue(s, "metal_mine", "manual").state);
  state = onPlanet(state, colony.id, s => orderUnits(s, "small_cargo", 8, "manual").state);
  state = onPlanet(state, colony.id, s => enqueueResearch(s, "energy_tech", "manual").state);
  state = tick(state, 0.01);
  state = equipCard(state, 0, "queue_scheduler").state;
  if (state.protocols.slots[0]?.card) state.protocols.slots[0].card.enabled = false;
}
process.stdout.write(exportSave(state, Date.now()));
