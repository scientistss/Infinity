declare const process: { argv: string[]; stdout: { write(text: string): void } };
/** Anonymous synthetic fixtures. Legacy bytes come from each actual released serializer. */
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { BACKUP_KEY, exportSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";

function fixture(name: string, seed: number) {
  const state = createInitialState(seed);
  state.arcade.seed = seed;
  state.planets[0].name = name;
  return JSON.parse(exportSave(state, Date.now()));
}

// Usage: node --import tsx scripts/save-session-fixture.ts /absolute/r2 /absolute/r3 /absolute/r4
const roots = process.argv.slice(2);
if (roots.length !== 3 || roots.some(root => !root.startsWith("/"))) {
  throw Error("Provide absolute verified source directories for r2, r3 and r4; legacy fixtures must use their real serializers");
}
const legacy: Record<string, unknown> = {};
const legacySources: Array<{ revision: number; schema: string; version: number; generatedBy: string }> = [];
let armedR4: unknown;
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
process.stdout.write(JSON.stringify({
  description: "Synthetic fixtures only; no player data. Legacy files are produced by verified source-revision serializers.",
  key: STORAGE_KEY, saveRevision: SAVE_REVISION, backupKey: BACKUP_KEY,
  current: fixture("合成当前母星", 20261001), imported: fixture("合成导入母星", 20261002),
  newer: fixture("合成后续母星", 20261003), legacy, legacySources, armedR4,
}, null, 2));
