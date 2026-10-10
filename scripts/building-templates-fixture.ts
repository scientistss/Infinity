/** Anonymous synthetic setup, not natural progression: real domain APIs and strict save readers. */
declare const process: { stdout: { write(text: string): void } };
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { selectPlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { createBuildingTemplate, quoteBuildingTemplate } from "../src/game/building-templates";
import { createOrderTask, pauseOrderTask } from "../src/game/orders";
import { enqueue } from "../src/game/queue";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";

function ok(result: { state: GameState; ok: boolean; reason: string }): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
let base = createInitialState(20261010, 10102026);
base.planets[0]!.name = "合成建筑母星";
base.research.levels.astrophysics = 1;
const colony = createPlanet("building-template-colony", { ...base.planets[0]!.coordinates,
  position: base.planets[0]!.coordinates.position === 9 ? 10 : 9 });
colony.name = "合成空白建筑殖民地";
base.planets.push(colony);
for (const planet of base.planets) {
  // Deliberately over warehouse caps: base production cannot obscure exact debits.
  // No buildings or fake paid jobs are injected, and real prices stay unchanged.
  planet.resources = { metal: big(1_000_000), crystal: big(1_000_000), deuterium: big(1_000_000) };
  planet.productionPct = { metal_mine: 0, crystal_mine: 0, deuterium_synth: 0, solar_plant: 0, fusion_reactor: 0 };
}
base = tick(base, 0);
const seeded = ok(createBuildingTemplate(base, { name: "合成经济工位", goals: [
  { building: "metal_mine", targetLevel: 3 }, { building: "crystal_mine", targetLevel: 2 },
  { building: "solar_plant", targetLevel: 3 },
] }, 1));
const budget = { metal: "10000", crystal: "10000", deuterium: "0" };
function metalOrder(planetId: string, targetLevel: number): GameState {
  return ok(createOrderTask(seeded, { kind: "building", building: "metal_mine", targetLevel,
    planetId, expectedNextTaskId: 1, budget, transport: null }));
}
const covered = ok(pauseOrderTask(metalOrder(colony.id, 4), 1));
const conflict = metalOrder(colony.id, 2);
const elsewhere = ok(pauseOrderTask(metalOrder(base.activePlanetId, 4), 1));
const manual = selectPlanet(ok(enqueue(selectPlanet(seeded, colony.id), "metal_mine", "manual")), base.activePlanetId);
const variants = { base, seeded, covered, conflict, elsewhere, manual };
const expectedQuotes = {
  metal_mine: { metal: "285", crystal: "70", deuterium: "0" },
  crystal_mine: { metal: "124", crystal: "62", deuterium: "0" },
  solar_plant: { metal: "355", crystal: "142", deuterium: "0" },
};
const quote = quoteBuildingTemplate(seeded, 1, colony.id);
if (!quote.ok || JSON.stringify(quote.totalQuote) !== JSON.stringify({ metal: "764", crystal: "274", deuterium: "0" })) throw new Error("Empty-colony economic quotation changed");
for (const row of quote.rows) {
  if (JSON.stringify(row.quote) !== JSON.stringify(expectedQuotes[row.building as keyof typeof expectedQuotes])) throw new Error(`${row.building}: independent quotation changed`);
}
for (const [name, state] of Object.entries(variants)) {
  const restored = deserializeState(importSave(exportSave(state)).state);
  const next = deserializeState(importSave(exportSave(restored)).state);
  if (JSON.stringify(restored) !== JSON.stringify(next)) throw new Error(`${name}: strict reader roundtrip drift`);
  if (JSON.stringify(tick(restored, 0)) !== JSON.stringify(restored)) throw new Error(`${name}: unsettled startup fixture`);
}
process.stdout.write(JSON.stringify({
  description: "Anonymous synthetic pre-funded two-planet building-intent fixtures. The colony begins with zero buildings. createInitialState/createPlanet set up the worlds; templates, paused/conflicting plans and manual paid work use public domain APIs; all variants pass strict export/import roundtrips. Controlled browser simulation timestamps are not natural-play evidence.",
  key: STORAGE_KEY, homeId: base.activePlanetId, colonyId: colony.id, expectedQuotes,
  totalQuote: { metal: "764", crystal: "274", deuterium: "0" },
  ...Object.fromEntries(Object.entries(variants).map(([name, state]) => [name, JSON.parse(exportSave(state))])),
}, null, 2));
