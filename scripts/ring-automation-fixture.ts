/** Synthetic, pre-funded acceptance cases. Outcomes are selected through the actual roller. */
declare const process: { stdout: { write(text: string): void } };
import { equipCard, refreshUnlocks } from "../src/automation/engine";
import { BOARD, type ArcadeSymbol } from "../src/data/arcade";
import { grantRun, revealRun, setBet } from "../src/game/arcade";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { exportSave } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";

function withSymbol(state: GameState, symbol: ArcadeSymbol): GameState {
  for (let seed = 1; seed < 100_000; seed++) {
    const next = grantRun({...state, arcade: {...state.arcade, seed}}, "bonus");
    if (next.granted && BOARD[next.state.arcade.runs.at(-1)!.outcome.main.tile] === symbol) return next.state;
  }
  throw new Error(`Cannot prepare synthetic ${symbol} result`);
}

let base = createInitialState(20261010);
base.arcade.seed = 20261010;
base.research.levels.astrophysics = 1;
base.planets[0].name = "合成固定来源母星";
base.planets[0].resources.deuterium = big(10_000);
const colony = createPlanet("synthetic-colony", {...base.planets[0].coordinates, position: base.planets[0].coordinates.position === 9 ? 10 : 9});
colony.name = "合成第二星球";
colony.resources.deuterium = big(9_000);
base.planets.push(colony);
const locked = withSymbol(base, "metal");
// Ten real manual reveals create the unlock; initial resources and planets remain synthetic.
for (let i = 0; i < 10; i++) base = revealRun(withSymbol(base, "metal"), "manual").state;
base = refreshUnlocks(base);
base = setBet(base, "metal", 1).state;
for (let i = 0; i < 4; i++) base = withSymbol(base, "metal");
const equipped = equipCard(base, 0, "auto_runner").state;
let tailwind: GameState = {...equipped, arcade: {...equipped.arcade, runs: [], beaconProgress: equipped.arcade.beaconRequired * 0.75}};
tailwind = withSymbol(tailwind, "tailwind");
tailwind = withSymbol(tailwind, "metal");
const save = (state: GameState) => JSON.parse(exportSave(state));
process.stdout.write(JSON.stringify({
  description: "Synthetic pre-funded two-planet cases; ten rule-driven manual reveals and seed-selected pending outcomes. Not natural progression or player data. Browser uses controlled timing, real HTTP, and native localStorage.",
  key: STORAGE_KEY,
  locked: save(locked), unequipped: save(base), equipped: save(equipped), tailwind: save(tailwind),
}, null, 2));
