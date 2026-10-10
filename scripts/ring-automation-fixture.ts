/** Synthetic, pre-funded acceptance cases. Outcomes are selected through the actual roller. */
declare const process: { stdout: { write(text: string): void } };
import { equipCard, refreshUnlocks, toggleSlot } from "../src/automation/engine";
import { BOARD, type ArcadeSymbol } from "../src/data/arcade";
import { grantRun, revealRun, setBet } from "../src/game/arcade";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { tick } from "../src/game/logic";
import { deserializeState, exportSave, importSave } from "../src/game/save";
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
// App startup calls tick(0), which grants the real one-time Astrophysics bonus.
// Reconcile that now, before choosing any acceptance queue snapshots. Merely
// setting a research level is not a settled save and would add a fifth ticket.
base = tick(base, 0);
const locked = base;
while (base.arcade.runs.length) base = revealRun(base, "manual").state;
// Ten real manual reveals create the unlock, including the legitimate opening
// bonus above. Initial resources and the two planets are still synthetic.
while (base.arcade.stats.manualRuns < 10) base = revealRun(withSymbol(base, "metal"), "manual").state;
base = tick(base, 0);
base = refreshUnlocks(base);
base = setBet(base, "metal", 1).state;
for (let i = 0; i < 4; i++) base = withSymbol(base, "metal");
const equipped = equipCard(base, 0, "auto_runner").state;
let tailwind: GameState = {...equipped, arcade: {...equipped.arcade, runs: [], beaconProgress: equipped.arcade.beaconRequired * 0.75}};
tailwind = withSymbol(tailwind, "tailwind");
tailwind = withSymbol(tailwind, "metal");

/** Exercise the real save reader and startup/protocol pipeline, without a browser.
 * Intentional beacon progress/production changes are excluded; ticket identities,
 * rolls, spending authority, statistics and deuterium wallets must stay fixed.
 */
function stableSnapshot(state: GameState): string {
  const { runs, nextRunId, seed, autoBatch, bets, stats } = state.arcade;
  return JSON.stringify({runs, nextRunId, seed, autoBatch, bets, stats,
    unlocked: state.unlocked, wallets: state.planets.map(planet => [planet.id, planet.resources.deuterium.toString()])});
}
function assertStableFixture(name: string, state: GameState, count: number): void {
  if (state.arcade.runs.length !== count || state.arcade.stats.autoRuns !== 0 || state.arcade.autoBatch !== null) {
    throw new Error(`${name}: fixture must begin with exactly ${count} pending tickets and no auto authority`);
  }
  const restored = deserializeState(importSave(exportSave(state)).state);
  const expected = stableSnapshot(restored);
  const startup = tick(restored, 0);
  for (const [label, current] of [["startup tick(0)", startup], ["initial tick(2.1)", tick(startup, 2.1)]] as const) {
    if (stableSnapshot(current) !== expected) throw new Error(`${name}: ${label} changed pending results, authority, statistics or wallets`);
  }
  if (state.arcade.stats.manualRuns >= 10) {
    const enabled = toggleSlot(equipCard(startup, 0, "auto_runner").state, 0, true);
    if (stableSnapshot(tick(enabled, 2.1)) !== expected) throw new Error(`${name}: plain toggle changed results without batch authority`);
  }
}
assertStableFixture("locked", locked, 1);
assertStableFixture("unequipped", base, 4);
assertStableFixture("equipped", equipped, 4);
assertStableFixture("tailwind", tailwind, 2);
const save = (state: GameState) => JSON.parse(exportSave(state));
process.stdout.write(JSON.stringify({
  description: "Synthetic pre-funded two-planet cases; real startup achievements and opening bonus are settled before ten rule-driven manual reveals and seed-selected pending queues. A generation guard checks save reload, tick(0), tick(2.1), and plain-toggle stability. Not natural progression or player data. Browser uses controlled timing, real HTTP, and native localStorage.",
  key: STORAGE_KEY,
  locked: save(locked), unequipped: save(base), equipped: save(equipped), tailwind: save(tailwind),
}, null, 2));
