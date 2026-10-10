declare const process: { argv: string[]; stdout: { write(text: string): void } };
/** Anonymous synthetic fixtures. Legacy bytes come from each actual released serializer. */
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { BACKUP_KEY, exportSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { createLegacyR6Fixtures } from "./legacy-r6-fixture";

function fixture(name: string, seed: number) {
  const state = createInitialState(seed);
  state.arcade.seed = seed;
  state.planets[0].name = name;
  return JSON.parse(exportSave(state, Date.now()));
}

// Usage: node --import tsx scripts/save-session-fixture.ts /absolute/r2 /absolute/r3 /absolute/r4 /absolute/r5 /absolute/r6
const roots = process.argv.slice(2);
if (roots.length !== 5 || roots.some(root => !root.startsWith("/"))) {
  throw Error("Provide absolute verified source directories for r2, r3, r4, r5 and r6; legacy fixtures must use their real serializers");
}
const legacy: Record<string, unknown> = {};
const legacySources: Array<{ revision: number; schema: string; version: number; generatedBy: string }> = [];
let armedR4: unknown;
let paidR5: unknown;
for (let index = 0; index < roots.length; index++) {
  const root = roots[index]!.replace(/\/$/, ""), revision = index + 2;
  const [saved, initial] = await Promise.all([
    import(`${root}/src/game/save.ts`), import(`${root}/src/game/state.ts`),
  ]);
  let state = initial.createInitialState(20261000 + revision);
  state.arcade.seed = 20261000 + revision;
  state.planets[0].name = `合成 r${revision} 母星`;
  const original = JSON.parse(saved.exportSave(state, Date.now()));
  if (original.revision !== revision || original.version !== 9 || original.schema !== "infinity-original-p4") {
    throw Error(`Source ${root} did not export the expected v9/r${revision} save`);
  }
  legacy[String(revision)] = original;
  legacySources.push({ revision, schema: original.schema, version: original.version,
    generatedBy: "actual source-revision createInitialState/exportSave" });
  if (revision === 5) {
    const [decimal, orders, factory, fleet] = await Promise.all([
      import(`${root}/src/game/decimal.ts`), import(`${root}/src/game/orders.ts`),
      import(`${root}/src/game/planet.ts`), import(`${root}/src/game/fleet.ts`),
    ]);
    for (const res of ["metal", "crystal", "deuterium"]) state.planets[0].resources[res] = decimal.big("1e12");
    state.planets[0].buildings.metal_mine = 20;
    state.planets[0].units.small_cargo = 2;
    state.research.levels.combustion_drive = 3;
    const created = orders.createOrderTask(state, { kind: "building", planetId: state.activePlanetId,
      building: "metal_mine", targetLevel: 21, expectedNextTaskId: state.orders.nextTaskId,
      budget: { metal: "1e10", crystal: "1e10", deuterium: "1e10" } });
    if (!created.ok) throw Error(created.reason);
    state = orders.advanceOrderPlans(created.state, 10);
    if (!state.orders.tasks[0].activeJob) throw Error("Actual r5 plan must have a real paid queue");
    state = orders.pauseOrderTask(state, state.orders.tasks[0].id).state;
    const coordinates = { galaxy: 3, system: 90, position: 7 };
    state.planets.push(factory.createPlanet("synthetic-r5-colony", coordinates));
    const sent = fleet.sendFleet(state, { mission: "transport", target: coordinates, ships: { small_cargo: 1 },
      cargo: { metal: decimal.big(13), crystal: decimal.big(17), deuterium: decimal.big(19) }, speedPercent: 100 });
    if (!sent.ok) throw Error(sent.reason);
    paidR5 = JSON.parse(saved.exportSave(sent.state, Date.now()));
  }
  if (revision === 4) {
    const arcade = await import(`${root}/src/game/arcade.ts`);
    state.research.levels.astrophysics = 1;
    state.arcade.stats.manualRuns = 10;
    for (let n = 0; n < 3; n++) state = arcade.grantRun(state, "bonus").state;
    const result = arcade.armRingBatch(state, { planetId: state.activePlanetId, count: 3, maxDeuterium: "0" });
    if (!result.ok) throw Error(result.reason);
    armedR4 = JSON.parse(saved.exportSave(result.state, Date.now()));
  }
}
const transportR6 = await createLegacyR6Fixtures(roots[4]!, Date.now());
process.stdout.write(JSON.stringify({
  description: "Synthetic fixtures only; no player data. Legacy files are produced by verified source-revision serializers.",
  key: STORAGE_KEY, saveRevision: SAVE_REVISION, backupKey: BACKUP_KEY,
  current: fixture("合成当前母星", 20261001), imported: fixture("合成导入母星", 20261002),
  newer: fixture("合成后续母星", 20261003), legacy, legacySources, armedR4, paidR5, transportR6,
}, null, 2));
