/**
 * Native Node wall-time model measurements. This never measures browser DOM,
 * paint/FPS, storage quota, or scheduler correctness. No clock/RAF shims.
 *
 * node --import tsx scripts/benchmark-presentation.mjs \
 *   --fixture /tmp/infinity-performance-fixture.json \
 *   --before-source /tmp/infinity-pre-performance-source > /tmp/infinity-model-benchmark.json
 *
 * Generate fixtures before this process. Keep the archived original source and
 * its dependency resolution intact. No absolute machine-time CI thresholds.
 */
import { expectedNpcEconomy, assertR8StatePreserved, liftR8StateToR14, assertHistoricalSource, assertZeroNpcResourceRemainders } from "./r14-compatibility.mjs";
import { captureAdoptedSteps } from "./capture-adopted-steps.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `${name} requires a value`);
  return args[index + 1];
}
function boundedInteger(name, fallback, min, max) {
  const value = Number(option(name, String(fallback)));
  assert.ok(Number.isInteger(value) && value >= min && value <= max, `${name} must be ${min}–${max}`);
  return value;
}
const fixturePath = option("--fixture");
assert.ok(fixturePath, "Pass --fixture with a generated performance-fixture JSON file");
const beforeRoot = resolve(option("--before-source", "/tmp/infinity-pre-performance-source"));
const afterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const beforeVersion = JSON.parse(readFileSync(resolve(beforeRoot, "package.json"), "utf8")).version;
const afterVersion = JSON.parse(readFileSync(resolve(afterRoot, "package.json"), "utf8")).version;
for (const version of [beforeVersion, afterVersion]) assert.ok(typeof version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), "explicit package version metadata");
function normalizedPhase(phase, version, label) {
  assert.equal(typeof phase, "string", `${label}: phase must remain a string`);
  assert.equal(phase.split(version).length - 1, 1, `${label}: exact respective package version must occur once`);
  const token = ` v${version} · `;
  assert.equal(phase.split(token).length - 1, 1, `${label}: package version must retain its exact display-token boundaries`);
  // Normalize this one declared release-metadata token only. Every other byte
  // in phase and every other model field still undergoes exact comparison.
  return phase.replace(token, " v<package-version> · ");
}
const warmup = boundedInteger("--warmup", 5, 1, 100);
const samples = boundedInteger("--samples", 30, 5, 1000);
const simulationSamples = boundedInteger("--simulation-samples", 5, 3, 30);
const sha256 = text => createHash("sha256").update(text).digest("hex");
assertHistoricalSource(beforeRoot, "4a4a4d68d0a0cf467f10a734a690606487acd327");
const load = (root, path) => import(pathToFileURL(resolve(root, path)).href);
const [afterSave, beforeSave, afterLogic, beforeLogic, afterPresent, beforePresent,
  afterSpace, beforeSpace, afterOrders, beforeOrders, empire, fleet] = await Promise.all([
  load(afterRoot, "src/game/save.ts"), load(beforeRoot, "src/game/save.ts"),
  load(afterRoot, "src/game/logic.ts"), load(beforeRoot, "src/game/logic.ts"),
  load(afterRoot, "src/ui/present.ts"), load(beforeRoot, "src/ui/present.ts"),
  load(afterRoot, "src/ui/space-present.ts"), load(beforeRoot, "src/ui/space-present.ts"),
  load(afterRoot, "src/ui/orders-present.ts"), load(beforeRoot, "src/ui/orders-present.ts"),
  load(afterRoot, "src/game/empire.ts"), load(afterRoot, "src/game/fleet.ts"),
]);
assert.equal(typeof afterPresent.presentVisible, "function", "new visible presenter must exist");
const fixture = JSON.parse(readFileSync(resolve(fixturePath), "utf8"));
assert.equal(typeof fixture.save, "string", "fixture.save must preserve actual native exportSave bytes");
assert.equal(sha256(fixture.save), fixture.manifest.sha256, "exact native save checksum");
assert.equal(fixture.save.length, fixture.manifest.stringChars, "native save UTF-16 code-unit length");
assert.equal(Buffer.byteLength(fixture.save), fixture.manifest.utf8Bytes, "native save UTF-8 byte length");
assert.deepEqual(JSON.parse(fixture.save), fixture.ready, "save/ready contract");
assert.equal(fixture.ready.revision, 8, "common bytes must come from the actual r8 serializer");
const migratedFile = afterSave.importSave(fixture.save);
assert.equal(migratedFile.revision, 14, "new reader must perform the real r8-to-r14 migration");
const migrationFloor = fixture.ready.state.orders.nextJobId;
const sourceState = afterSave.deserializeState(migratedFile.state);
const beforeState = beforeSave.deserializeState(beforeSave.importSave(fixture.save).state);
const serialized = JSON.stringify(afterSave.serializeState(sourceState));
const archivedSerialized = JSON.stringify(beforeSave.serializeState(beforeState));
assertR8StatePreserved(afterSave.serializeState(sourceState), beforeSave.serializeState(beforeState), "archived/current strict readers", migrationFloor, expectedNpcEconomy());
for (let pass = 0; pass < 2; pass++) {
  assert.equal(JSON.stringify(beforeSave.serializeState(beforeLogic.tick(beforeState, 0))), archivedSerialized, "archived zero-time startup parity");
  assert.equal(JSON.stringify(afterSave.serializeState(afterLogic.tick(sourceState, 0))), serialized, "current zero-time startup parity");
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
// Both model versions receive the very same frozen object, not generated copies.
const state = deepFreeze(sourceState);
// Both native schemas are independently full-projection-equal above. The r8
// serializer must receive its actual archived state: it retains unknown message
// fields when handed a current runtime and would otherwise time/export r14 slots.
const archivedState = deepFreeze(beforeState);
const input = deepFreeze({ status: "", banner: null, notice: null, catchup: null });
const cursor = deepFreeze({ ...empire.activePlanet(state).coordinates });
const target = state.planets.find(world => world.id !== state.activePlanetId)?.coordinates;
assert.ok(target, "fixture requires another owned world");
const request = deepFreeze({ mission: "transport", target: { ...target }, ships: { large_cargo: 1 }, cargo: fleet.emptyCargo(), speedPercent: 10 });
const fullOriginal = beforePresent.present(state, input);
// The one shipped catalog addition has an independent, complete golden. Its
// fixture preconditions are explicit, rather than inferred from the new card.
const home = empire.activePlanet(state);
assert.deepEqual({ id: home.id, terraformer: home.buildings.terraformer, nanite: home.buildings.nanite_factory,
  robotics: home.buildings.robotics_factory, energy: state.research.levels.energy_tech,
  usedFields: Object.values(home.buildings).reduce((sum, level) => sum + level, 0),
  fieldsMax: home.fieldsMax, reserved: home.buildQueue.length, satellites: home.units.solar_satellite,
  queuedBuildings: home.buildQueue.map(job => job.building),
  productionPct: home.productionPct }, {
  id: "homeworld", terraformer: 0, nanite: 0, robotics: 4, energy: 8,
  usedFields: 74, fieldsMax: 163, reserved: 2, satellites: 0,
  queuedBuildings: ["metal_storage", "crystal_storage"],
  productionPct: { metal_mine: 0, crystal_mine: 0, deuterium_synth: 0, solar_plant: 0, fusion_reactor: 0 },
}, "the archived fixture independently fixes every terraformer-card precondition");
const expectedTerraformerCard = Object.freeze({
  id: "terraformer", level: "0",
  cost: "金属 0.00 · 晶体 5.00e4 · 重氢 1.00e5 · 供能 0.00 / 需要 1.00e3（不消耗）",
  time: "建造时间 7 秒",
  effect: "本版新付款入队每级 +5 总格，建筑占 1 格（净 +4）",
  payback: "格子 74 / 163 · 已付预留 2",
  requires: "前置未满足：纳米机器人工厂 等级 1、能源技术 等级 12",
  locked: true, button: "升级到 等级 1", canEnqueue: false,
  reason: "需要 纳米机器人工厂 等级 1、能源技术 等级 12",
});
assert.equal(fullOriginal.buildings.some(card => card.id === "terraformer"), false, "archived catalog has no terraformer card");
function historicalBuildingCards(cards, label) {
  assert.equal(cards.length, fullOriginal.buildings.length + 1, `${label}: exactly one added card`);
  assert.equal(cards.filter(card => card.id === "terraformer").length, 1, `${label}: exactly one terraformer identity`);
  assert.deepEqual(cards.at(-1), expectedTerraformerCard, `${label}: complete independently specified final terraformer card`);
  // Only this independently verified append is removed, with all old card order
  // and every field retained. The measured callbacks below remain untouched.
  return cards.slice(0, -1);
}
const fullCurrent = afterPresent.present(state, input);
// This historical workload has no completed IRN. No speed, participant, cost,
// permission or active-timer exception is allowed, even across its many worlds.
const researchIds = ["energy_tech", "laser_tech", "ion_tech", "hyperspace_tech", "plasma_tech",
  "combustion_drive", "impulse_drive", "hyperspace_drive", "espionage_tech", "computer_tech",
  "astrophysics", "intergalactic_research_network", "graviton_tech", "weapons_tech", "shielding_tech", "armour_tech"];
const irnIndex = 11;
const sourceResearch = fixture.ready.state.research;
const sourceResearchJobs = fixture.manifest.paidJobIds.research;
assert.equal(sourceResearch.levels.intergalactic_research_network, 0, "archived workload has completed IRN zero");
assert.equal(state.research.levels.intergalactic_research_network, 0, "migration preserves completed IRN zero");
assert.equal(fixture.ready.state.activePlanetId, "homeworld", "fixed primary lab identity");
assert.equal(fixture.ready.state.planets.length, fixture.manifest.counts.worlds, "all historical worlds remain represented");
assert.ok(fixture.ready.state.planets.every(planet => planet.buildings.research_lab === 8 &&
  planet.buildQueue.every(job => job.building !== "research_lab")), "every historical lab is exactly level eight and not upgrading");
assert.deepEqual(sourceResearchJobs, [sourceResearch.queue[0].jobId, sourceResearch.queue[0].jobId + 1], "two exact successive paid research identities");
assert.deepEqual(sourceResearch.queue, [
  { planetId: "homeworld", tech: "energy_tech", targetLevel: 9,
    paid: { metal: "0", crystal: "204800", deuterium: "102400" },
    totalSeconds: 136.53333333333333, remainingSeconds: 136.53333333333333,
    source: "manual", jobId: sourceResearchJobs[0], taskId: null },
  { planetId: "homeworld", tech: "laser_tech", targetLevel: 11,
    paid: { metal: "204800", crystal: "102400", deuterium: "0" },
    totalSeconds: 0, remainingSeconds: 0,
    source: "manual", jobId: sourceResearchJobs[1], taskId: null },
], "complete archived paid rows independently fix quote and frozen-timer preconditions");
const oldNetworkLater = "后续：多星球后生效（第 4 阶段）";
const oldWaitingResearch = Object.freeze({ index: 1, key: `homeworld:${sourceResearchJobs[1]}`,
  planetId: "homeworld", jobId: sourceResearchJobs[1],
  label: "激光技术 → 等级 11 · 匿名性能星球 000 <测试&🚀>",
  detail: "等待中 · 已付款 · 预计 3 分 25 秒", progressPct: 0, active: false, halve: null, finish: null });
const newWaitingResearch = Object.freeze({ ...oldWaitingResearch,
  detail: "等待中 · 已付款 · 按当前条件预计 3 分 25 秒（开工时确定）" });
assert.deepEqual(fullOriginal.research.items.map(card => card.id), researchIds, "all sixteen archived research identities in exact order");
assert.equal(fullOriginal.research.items[irnIndex].later, oldNetworkLater, "complete obsolete archived IRN field");
assert.equal(fullOriginal.research.queue.items.length, 2, "exact archived active/waiting queue cardinality");
assert.deepEqual(fullOriginal.research.queue.items[1], oldWaitingResearch, "complete archived waiting row is independently specified");
const buildingBatchSourceProof = (() => {
  const manifestPath = "tests/fixtures/building-batch-provenance.json";
  const raw = readFileSync(resolve(afterRoot, manifestPath));
  const manifestSha256 = sha256(raw);
  assert.equal(manifestSha256, "d05cec8f03492743713b38ffda518c59116f7b74a55cc741f77ceea20bd2b4c1", "exact independently frozen building-batch source seal");
  const manifest = JSON.parse(raw);
  const sourceAudit = JSON.parse(execFileSync("python3",
    ["-B", "scripts/test_building_batch_provenance.py", "--verify-ui-baseline"], { cwd: afterRoot, encoding: "utf8" }));
  const paths = ["src/game/building-template-batch-state.ts", "src/game/building-template-batch.ts", "src/main.ts",
    "src/ui/building-template-batch-panel.ts", "src/ui/building-template-batch-present.ts", "src/ui/building-template-batch.css", "src/ui/space-panel.ts"];
  assert.equal(sourceAudit.contract, "exact-declared-building-batch-source-delta", "current complete building-batch source contract");
  assert.equal(sourceAudit.sourceBaseline, "6f73735534ffc1b0e47a01935d8c6e3ff786c989", "exact public pre-batch source");
  assert.equal(sourceAudit.manifestSha256, manifestSha256, "current independently verified batch seal");
  assert.deepEqual(sourceAudit.approvedSourceDeltaPaths, paths, "only the seven reviewed batch source paths");
  assert.ok(Number.isInteger(sourceAudit.checks) && sourceAudit.checks > 174, "complete current and all historical source checks must run");
  assert.equal(manifest.schema, "infinity-ring-protection-building-batch-provenance-v1", "exact current batch schema");
  assert.equal(manifest.previousAdoptionSourceSha, sourceAudit.sourceBaseline, "current batch adoption baseline");
  assert.equal(Object.keys(manifest.productionInventory).length, 215, "complete current batch production inventory");
  assert.equal(manifest.previousManifests.length, 14, "all fourteen earlier immutable source seals retained");
  assert.deepEqual(manifest.changedPaths.map(row => row.path), paths, "complete exact current batch delta");
  assert.deepEqual(manifest.previousManifests[13], { path: "tests/fixtures/research-unlock-copy-provenance.json",
    sha256: "ee3d929da35f41aef0aad587a11ab6acba0726abde44f0de5f753a74c4cb6999" }, "separately preserved historical research-copy seal");
  assert.deepEqual(sourceAudit.originalUiBaseline, manifest.originalUiBaseline, "unchanged original cumulative UI and art bindings");
  return { manifestPath, manifestSha256, contract: sourceAudit.contract, sourceBaseline: sourceAudit.sourceBaseline,
    productionEntries: 215, previousSeals: 14, approvedSourceDeltaPaths: paths, checks: sourceAudit.checks,
    scope: "Exact complete current batch source identity. The following 210-entry research proof is explicitly historical; native behavior and measured performance are separate evidence." };
})();
// This adapter is intentionally specific to the old no-lab-work workload.
// Tests execute this exact function against hostile copied inputs, without
// importing the benchmark's fixtures, production models or timing callbacks.
function historicalLabBlockers(panel, archivedPanel, sourcePlanets, currentPlanets, label, includeCards = true) {
  function exactKeys(value, keys, field) {
    assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, `${label}: ${field} is an ordinary object`);
    assert.deepEqual(Reflect.ownKeys(value), keys, `${label}: exact ordered ${field} fields`);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert.ok(descriptor && "value" in descriptor && descriptor.enumerable, `${label}: own enumerable ${field}.${key} data`);
    }
  }
  exactKeys(archivedPanel, ["visible", "queue", "summary", "items"], "archived research panel");
  exactKeys(panel, ["visible", "queue", "summary", "labBlockers", "items"], "current research panel");
  assert.equal(typeof includeCards, "boolean", `${label}: explicit visible-body decision`);
  assert.ok(Array.isArray(sourcePlanets) && sourcePlanets.length > 0, `${label}: nonempty complete historical worlds`);
  assert.ok(Array.isArray(currentPlanets), `${label}: complete current worlds`);
  assert.deepEqual(currentPlanets.map(planet => planet.id), sourcePlanets.map(planet => planet.id), `${label}: every historical world in original order`);
  assert.equal(new Set(sourcePlanets.map(planet => planet.id)).size, sourcePlanets.length, `${label}: unique historical world identities`);
  for (const [index, original] of sourcePlanets.entries()) {
    const current = currentPlanets[index];
    assert.equal("demolition" in original, false, `${label}: actual r8 world has no demolition slot`);
    const demolition = Object.getOwnPropertyDescriptor(current, "demolition");
    assert.ok(demolition && "value" in demolition && demolition.enumerable, `${label}: explicit current demolition slot`);
    assert.equal(demolition.value, null, `${label}: no current paid demolition may be hidden`);
    assert.ok(Array.isArray(original.buildQueue), `${label}: complete actual paid building queue`);
    assert.deepEqual(current.buildQueue, original.buildQueue, `${label}: every paid building row and its order remain exact`);
    for (const job of original.buildQueue) {
      assert.notEqual(job.building, "research_lab", `${label}: no paid laboratory head or waiting row may be hidden`);
      assert.ok(Number.isSafeInteger(job.jobId) && job.jobId > 0, `${label}: actual positive paid-job identity`);
    }
  }
  if (includeCards) {
    exactKeys(panel.labBlockers, ["planetCount", "jobCount", "summary", "note", "items"], "lab blockers");
    assert.deepEqual(panel.labBlockers, { planetCount: 0, jobCount: 0, summary: "", note: "", items: [] },
      `${label}: complete independent empty lab-blocker literal`);
    assert.deepEqual(Reflect.ownKeys(panel.labBlockers.items), ["length"], `${label}: exactly empty ordinary ordered item list`);
  } else assert.equal(panel.labBlockers, null, `${label}: hidden research body has the explicit null projection`);
  // Remove only the one own field after every premise and complete new value
  // is proven. All original fields survive into the existing whole-model check.
  const { labBlockers: verifiedAddition, ...prior } = panel;
  return prior;
}
const labBlockersSourceProof = (() => {
  const manifestPath = "tests/fixtures/lab-blockers-provenance.json";
  const raw = readFileSync(resolve(afterRoot, manifestPath));
  const manifestSha256 = sha256(raw);
  assert.equal(manifestSha256, "ea23cbbc562494b2e00ab37eac5f666c2fb2773904f2366d3f3f8b76d4c9afb8", "exact previously adopted read-only lab UI seal");
  const manifest = JSON.parse(raw);
  // The later copy-only adoption leaves the lab seal untouched. Reuse its full
  // Python/Git contract, including all 210 source entries and thirteen earlier
  // seals, instead of accepting a second unqualified present.ts hash.
  const copyManifestPath = "tests/fixtures/research-unlock-copy-provenance.json";
  const copyRaw = readFileSync(resolve(afterRoot, copyManifestPath));
  const copyManifestSha256 = sha256(copyRaw);
  assert.equal(copyManifestSha256, "ee3d929da35f41aef0aad587a11ab6acba0726abde44f0de5f753a74c4cb6999", "exact two-line research unlock copy seal");
  const copyManifest = JSON.parse(copyRaw);
  const sourceAudit = JSON.parse(execFileSync("python3",
    ["-B", "scripts/test_research_unlock_copy_provenance.py", "--verify-ui-baseline"], { cwd: afterRoot, encoding: "utf8" }));
  assert.equal(sourceAudit.contract, "exact-declared-research-unlock-copy-source-delta", "complete research unlock source contract");
  assert.equal(sourceAudit.sourceBaseline, "49303d3740cf223955386ff984b335ca9b110087", "immutable public source before the two-line removal");
  assert.equal(sourceAudit.manifestSha256, copyManifestSha256, "independently verified exact copy seal");
  assert.deepEqual(sourceAudit.approvedSourceDeltaPaths, ["src/ui/present.ts"], "no unrelated source adaptation");
  assert.ok(sourceAudit.checks > 145, "complete recursive source checks must run");
  assert.equal(Object.keys(copyManifest.productionInventory).length, 210, "complete approved production inventory");
  assert.equal(copyManifest.previousManifests.length, 13, "all prior source seals retained");
  assert.deepEqual(copyManifest.changedPaths.map(row => row.path), ["src/ui/present.ts"], "only the reviewed presentation delta");
  const copyRow = copyManifest.changedPaths[0];
  const files = Object.fromEntries(["src/ui/present.ts", "src/ui/lab-blockers-model.ts"].map(path => {
    const rows = manifest.changedPaths.filter(row => row.path === path);
    assert.equal(rows.length, 1, `one sealed lab presentation source: ${path}`);
    assert.equal(rows[0].after.mode, "100644", `ordinary sealed lab presentation source: ${path}`);
    const current = readFileSync(resolve(afterRoot, path));
    let adopted = current;
    if (path === "src/ui/present.ts") {
      assert.deepEqual(copyRow.before, rows[0].after, "copy delta starts from the exact unchanged lab seal");
      assert.equal(copyRow.after.mode, "100644", "ordinary adopted research copy source");
      assert.equal(sha256(current), copyRow.after.sha256, "current source is exactly the independently verified two-line removal");
      adopted = execFileSync("git", ["--no-replace-objects", "-C", afterRoot, "show", `${sourceAudit.sourceBaseline}:${path}`]);
    }
    const digest = sha256(adopted);
    assert.equal(digest, rows[0].after.sha256, `exact adopted lab presentation source: ${path}`);
    return [path, sha256(current)];
  }));
  return { manifestPath, manifestSha256, files, researchUnlockCopy: {
    manifestPath: copyManifestPath, manifestSha256: copyManifestSha256,
    sourceBaseline: sourceAudit.sourceBaseline, checks: sourceAudit.checks,
    approvedSourceDeltaPaths: sourceAudit.approvedSourceDeltaPaths,
    beforePresentSha256: copyRow.before.sha256, afterPresentSha256: copyRow.after.sha256,
  } };
})();
const currentSerializedPlanets = afterSave.serializeState(state).planets;
assert.deepEqual(fixture.ready.state.planets.flatMap(planet => planet.buildQueue.map(job => job.jobId)),
  fixture.manifest.paidJobIds.build, "all source paid construction identities remain in exact world/queue order");
assert.equal(fixture.manifest.paidJobIds.build.length, fixture.manifest.counts.buildJobs, "complete source paid construction count");
assert.deepEqual(fixture.ready.state.planets.map(planet => planet.buildQueue.map(job => job.building)),
  fixture.ready.state.planets.map(() => ["metal_storage", "crystal_storage"]), "the exact legal fixture paid only two storage upgrades per world");
function historicalResearch(panel, label, includeCards = true) {
  const prior = historicalLabBlockers(panel, fullOriginal.research, fixture.ready.state.planets,
    currentSerializedPlanets, label, includeCards);
  assert.equal(panel.queue.items.length, 2, `${label}: no queued research may be omitted`);
  assert.deepEqual(panel.queue.items[0], fullOriginal.research.queue.items[0], `${label}: entire active timer, identity and actions stay exact`);
  assert.deepEqual(panel.queue.items[1], newWaitingResearch, `${label}: complete new waiting row, including unchanged quote and disabled actions`);
  if (includeCards) {
    assert.deepEqual(panel.items.map(card => card.id), researchIds, `${label}: every research card and its order remain`);
    assert.deepEqual(panel.items[irnIndex], { ...fullOriginal.research.items[irnIndex], later: "" },
      `${label}: only the complete obsolete IRN field changes; all other card fields remain exact`);
  } else assert.deepEqual(panel.items, [], `${label}: hidden research body remains intentionally unprojected`);
  return { ...prior,
    items: panel.items.map((card, index) => index === irnIndex ? { ...card, later: oldNetworkLater } : card),
    queue: { ...panel.queue, items: panel.queue.items.map((item, index) => index === 1 ? { ...item, detail: oldWaitingResearch.detail } : item) },
  };
}
assert.deepEqual({ ...fullCurrent, buildings: historicalBuildingCards(fullCurrent.buildings, "full presenter"),
  research: historicalResearch(fullCurrent.research, "full presenter") },
  fullOriginal, "retained full presenter equals archived original after fully asserted terraformer, research-copy and empty lab-blocker differences");
const fullSpace = beforeSpace.spaceView(state, cursor, request);
const currentFullSpace = afterSpace.spaceView(state, cursor, request);
// Only this frozen transport workload may adapt the new empty read-only field.
function historicalRecyclePreview(view, kind, draft) {
  assert.ok(kind === "full" || kind === "fleet", "recycle adapter is fleet-only");
  assert.equal(draft.mission, "transport", "recycle adapter requires the fixed non-recycle workload");
  const keys = Object.keys(view), index = keys.indexOf("recyclePreview");
  assert.equal(keys.filter(key => key === "recyclePreview").length, 1, "one own recycle preview field");
  assert.equal(index, 4, "recycle preview retains the exact declared model position");
  assert.deepEqual(keys.slice(2, 6), ["isCharge", "chargePreview", "recyclePreview", kind === "full" ? "origin" : "slots"],
    "recycle preview retains both original adjacent keys");
  assert.equal(view.recyclePreview, null, "the fixed transport workload has no active recycle preview");
  const result = structuredClone(view);
  delete result.recyclePreview;
  return result;
}
function historicalSpace(view, kind) {
  assertZeroNpcResourceRemainders(state, `${kind}: independent zero-rights historical presentation scope`);
  const result=kind==='full'||kind==='fleet' ? historicalRecyclePreview(view,kind,request) : structuredClone(view);
  if(kind==='full'||kind==='fleet') {
    assert.equal(view.planets.length,fullSpace.planets.length,`${kind}: all historical planet cards retained`);
    result.planets=view.planets.map((row,index)=>{
      assert.equal(row.id,state.planets[index].id,`${kind}: same independently zero-rights owner`);
      assert.equal(row.npcRemainder,null,`${kind}: exact null view for verified zero rights`);
      const {npcRemainder,...prior}=row;
      assert.deepEqual(prior,fullSpace.planets[index],`${kind}: every original planet card field unchanged`);
      return prior;
    });
  }
  if(kind==='full'||kind==='fleet'){
    assert.equal(view.isAttack,false,`${kind}: exact ordinary mission flag`);
    assert.equal(view.attackQuota,'',`${kind}: ordinary quote has no NPC quota text`);
    delete result.isAttack;delete result.attackQuota;
    assert.equal(view.fleets.length,fullSpace.fleets.length,`${kind}: no historical fleet removed`);
    result.fleets=view.fleets.map((row,index)=>{
      const old=fullSpace.fleets[index],source=state.fleets[index];
      assert.equal(row.id,old.id,`${kind}: stable fleet identity`);
      assert.equal(row.isAttack,false);assert.equal(row.reportId,null);assert.equal(row.canRetryDock,false);
      assert.equal(row.phase,source.returning?'返航':source.charge?.phase==='holding'?'驻留充能':'出航');
      const {isAttack,phase,reportId,canRetryDock,...prior}=row;
      assert.deepEqual(prior,old,`${kind}: every old fleet field remains exact`);return prior;
    });
  }
  if(kind==='full'||kind==='galaxy'){
    assert.equal(view.rows.length,fullSpace.rows.length,`${kind}: no historical row removed`);
    result.rows=view.rows.map((row,index)=>{
      const old=fullSpace.rows[index];assert.equal(row.key,old.key);
      assert.equal(row.canRouteAttack,old.kind==='NPC 邻居'&&old.planetId===''&&old.position!==16,`${kind}: attack navigation exactly for old NPC identity`);
      const {canRouteAttack,...prior}=row;assert.deepEqual(prior,old,`${kind}: every old coordinate field remains exact`);return prior;
    });
  }
  if(kind==='full'||kind==='messages'){
    assert.deepEqual(view.npcReports,[],`${kind}: exactly empty independently no-attack report list`);delete result.npcReports;
  }
  return result;
}
const normalizedOriginalSpace = { ...fullSpace, phase: normalizedPhase(fullSpace.phase, beforeVersion, "archived full space") };
assert.deepEqual({ ...historicalSpace(currentFullSpace,"full"), phase: normalizedPhase(currentFullSpace.phase, afterVersion, "current full space") },
  normalizedOriginalSpace, "retained full space equals archived original except the declared package-version token");
assert.deepEqual(afterOrders.ordersView(state), beforeOrders.ordersView(state), "orders model parity");

const tabs = ["facilities", "overview", "research", "shipyard", "defense", "darkmatter", "arcade", "protocol", "achievements", "curvature", "galaxy", "fleet", "messages", "orders", "deep"];
const topPanelFields = new Set(["research", "shipyard", "darkMatter", "arcade", "buildings", "production", "overview", "catalog", "slots", "achievements", "techs"]);
function parityVisible(tab) {
  const visible = afterPresent.presentVisible(state, input, tab);
  const resolved = afterPresent.resolveVisibleTab(state, tab);
  const historicalResearchPanel = historicalResearch(visible.research, `${tab}: research`, resolved === "research");
  for (const key of Object.keys(fullOriginal)) {
    if (!topPanelFields.has(key)) assert.deepEqual(visible[key], fullOriginal[key], `${tab}: shared ${key}`);
  }
  for (const [panel, excluded] of [
    ["research", ["items"]], ["shipyard", ["ships", "defenses"]],
    ["darkMatter", ["shop", "packages", "inventory", "boosters"]], ["overview", ["production", "energy"]],
  ]) {
    for (const key of Object.keys(fullOriginal[panel])) {
      if (!excluded.includes(key)) assert.deepEqual((panel === "research" ? historicalResearchPanel : visible[panel])[key], fullOriginal[panel][key], `${tab}: shared ${panel}.${key}`);
    }
  }
  assert.equal(visible.arcade.visible, fullOriginal.arcade.visible, `${tab}: ring unlock flag`);
  const visibleKeys = {
    facilities: ["buildings", "production"], overview: ["overview"], research: ["research"], darkmatter: ["darkMatter"],
    arcade: ["arcade"], protocol: ["catalog", "slots"], achievements: ["achievements"], curvature: ["techs"],
  }[resolved] ?? [];
  for (const key of visibleKeys) assert.deepEqual(key === "buildings"
    ? historicalBuildingCards(visible[key], `${tab}: visible buildings`)
    : key === "research" ? historicalResearchPanel : visible[key], fullOriginal[key], `${tab}: visible ${key}`);
  if (resolved === "shipyard") assert.deepEqual(visible.shipyard.ships, fullOriginal.shipyard.ships, "visible ship cards");
  if (resolved === "defense") assert.deepEqual(visible.shipyard.defenses, fullOriginal.shipyard.defenses, "visible defense cards");
  return resolved;
}
const resolvedTabs = Object.fromEntries(tabs.map(tab => [tab, parityVisible(tab)]));
for (const [kind,currentProjection] of [["galaxy",afterSpace.spaceGalaxyView(state, cursor)], ["fleet",afterSpace.spaceFleetView(state, request)], ["messages",afterSpace.spaceMessagesView(state)]]) {
  const projection=historicalSpace(currentProjection,kind);
  for (const [key, value] of Object.entries(projection)) {
    assert.deepEqual(key === "phase" ? normalizedPhase(value, afterVersion, "current split space") : value,
      normalizedOriginalSpace[key], `space split ${key}`);
  }
}
assert.equal(afterSpace.spaceOrigin(state), fullSpace.origin);

// Escaping the callback result avoids dead-result optimization; JSON formatting
// and verification are deliberately outside the timed sample.
let sink;
function elapsed(fn) {
  const start = performance.now();
  sink = fn();
  return performance.now() - start;
}
function statistics(rawSamplesMs) {
  const sorted = [...rawSamplesMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { samples: sorted.length, medianMs, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minMs: sorted[0], maxMs: sorted.at(-1), meanMs: rawSamplesMs.reduce((sum, value) => sum + value, 0) / rawSamplesMs.length,
    rawSamplesMs };
}
function paired(name, before, after, count = samples, warmups = warmup) {
  for (let index = 0; index < warmups; index++) { before(); after(); }
  const oldSamples = [], newSamples = [], order = [];
  for (let index = 0; index < count; index++) {
    const beforeFirst = index % 2 === 0;
    order.push(beforeFirst ? "before,after" : "after,before");
    if (beforeFirst) { oldSamples.push(elapsed(before)); newSamples.push(elapsed(after)); }
    else { newSamples.push(elapsed(after)); oldSamples.push(elapsed(before)); }
  }
  const oldStats = statistics(oldSamples), newStats = statistics(newSamples);
  return { name, warmupPerVariant: warmups, order, before: oldStats, after: newStats,
    medianAfterOverBefore: newStats.medianMs / oldStats.medianMs,
    medianReductionPercent: (1 - newStats.medianMs / oldStats.medianMs) * 100 };
}
const modelResults = tabs.map(tab => ({ tab, resolvedTab: resolvedTabs[tab], ...paired(`present:${tab}`,
  () => beforePresent.present(state, input), () => afterPresent.presentVisible(state, input, tab)) }));
for (const [name, next] of [
  ["galaxy", () => afterSpace.spaceGalaxyView(state, cursor)],
  ["fleet", () => afterSpace.spaceFleetView(state, request)],
  ["messages", () => afterSpace.spaceMessagesView(state)],
  ["other-tab-origin-only", () => afterSpace.spaceOrigin(state)],
]) modelResults.push(paired(`space:${name}`, () => beforeSpace.spaceView(state, cursor, request), next));
modelResults.push(paired("orders:visible", () => beforeOrders.ordersView(state), () => afterOrders.ordersView(state)));

// A precisely scoped model pipeline, not an estimate of full browser rendering.
// This includes only the three existing independent pure presenters; DOM panels,
// templates/formation DOM updates, and deep extensions belong to browser timing.
for (const tab of ["facilities", "galaxy", "fleet", "messages", "orders"]) {
  modelResults.push(paired(`pure-model-pipeline:${tab}`,
    () => [beforePresent.present(state, input), beforeSpace.spaceView(state, cursor, request), beforeOrders.ordersView(state)],
    () => [afterPresent.presentVisible(state, input, tab), afterSpace.spaceOrigin(state),
      tab === "galaxy" ? afterSpace.spaceGalaxyView(state, cursor) : tab === "fleet" ? afterSpace.spaceFleetView(state, request)
        : tab === "messages" ? afterSpace.spaceMessagesView(state) : null,
      tab === "orders" ? afterOrders.ordersView(state) : null]));
}
const separateResults = [
  paired("serialization:exact-native-exportSave", () => beforeSave.exportSave(archivedState, fixture.manifest.savedAt), () => afterSave.exportSave(state, fixture.manifest.savedAt), simulationSamples, 1),
  paired("strict-import:importSave-plus-deserializeState", () => beforeSave.deserializeState(beforeSave.importSave(fixture.save).state), () => afterSave.deserializeState(afterSave.importSave(fixture.save).state), simulationSamples, 1),
  paired("simulation:zero-time-startup", () => beforeLogic.tick(state, 0), () => afterLogic.tick(state, 0), simulationSamples, 1),
  paired("simulation:one-native-60Hz-sized-step", () => beforeLogic.tick(state, 1 / 60), () => afterLogic.tick(state, 1 / 60), simulationSamples, 1),
];
assert.equal(JSON.stringify(afterSave.serializeState(state)), serialized, "no measured model or simulation mutated the shared frozen input");
assert.equal(JSON.stringify(beforeSave.serializeState(archivedState)), archivedSerialized, "no measurement mutated the actual archived serialization input");
assert.equal(beforeSave.exportSave(archivedState, fixture.manifest.savedAt), fixture.save, "archived exact serialization parity");
const expectedR14 = { ...fixture.ready, revision: 14, state: liftR8StateToR14(fixture.ready.state, migrationFloor, expectedNpcEconomy()) };
assert.equal(afterSave.exportSave(state, fixture.manifest.savedAt), JSON.stringify(expectedR14, null, 2), "current exact native serialization is the exact empty-library and grant-ledger lift plus explicit null demolition slots and zero-age r13 NPC metadata, explicit null scout snapshot slots and r14 envelope");
for (const delta of [0, 1 / 60, 0.125]) {
  const witnessed = captureAdoptedSteps(beforeState, input => ({ state: beforeLogic.tick(input, delta) }), beforeSave.serializeState);
  assertR8StatePreserved(afterSave.serializeState(afterLogic.tick(state, delta)),
    beforeSave.serializeState(witnessed.result.state), `complete simulation state parity at ${delta}s`, migrationFloor, expectedNpcEconomy(witnessed.adoptedSegmentsSeconds));
}
assert.ok(sink, "measurement results were consumed");
const sourceHashes = root => Object.fromEntries(["package.json", "src/ui/present.ts", "src/ui/shipyard-present.ts", "src/ui/space-present.ts", "src/game/logic.ts", "src/game/save.ts", "src/game/research.ts", "src/data/research.ts"].map(path => [path, sha256(readFileSync(resolve(root, path)))]));
process.stdout.write(JSON.stringify({
  scope: "Native Node performance.now wall-time model measurements on the identical frozen current state from the real r8 strict-reader fixture after observed r14 migration; native serialization uses the separately frozen actual archived/current schemas, proven complete old-field equal, so the archived serializer cannot retain new message slots; the save adds only independently asserted empty buildingTemplates and fixed-floor, zero-grant metadata plus explicit null demolition slots and exact zero-age wallet/empty-receipt metadata. Model parity permits exactly one fully asserted appended terraformer card, removal of the exact obsolete IRN later field, the exact waiting-research quote wording, and the fully asserted empty lab-blocker field (explicit null when hidden). Every original paid construction row/order and null demolition slot is proven before adapting that one field. The fixed transport draft independently requires exactly one null recyclePreview at its declared full/fleet model key position before removing only that field; active previews and every other field remain outside that exception. The independently asserted IRN-zero workload permits no network speed or active-timer exception; every historical card, queue identity, other field and full simulation state remains exact. Paired old archived full presenters versus new visible presenters, alternating sample order, with explicit warmups and raw samples. No fake time, no browser/DOM/FPS claim, no absolute millisecond gate, no player data.",
  environment: { node: process.version, platform: platform(), release: release(), arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  fixture: { path: resolve(fixturePath), profile: fixture.profile, manifest: fixture.manifest },
  sources: { beforeRoot, afterRoot, before: sourceHashes(beforeRoot), after: sourceHashes(afterRoot), currentBuildingBatch: buildingBatchSourceProof },
  metadataException: { field: "spaceView.phase / spaceGalaxyView.phase", beforePackageVersion: beforeVersion, afterPackageVersion: afterVersion,
    rule: "Assert each exact respective package version occurs once with its original display-token boundaries; replace only that version token for parity comparison. Every other phase byte and model field remains exact. Native timing callbacks receive no normalization.",
    normalizedToken: "v<package-version>" },
  featureException: { field: "present.buildings / presentVisible(facilities).buildings", addedCard: expectedTerraformerCard,
    rule: "Assert the exact fixture preconditions, old-catalog absence, one unique appended identity and all 11 card fields before removing only the last card for historical comparison. Every old card, ordering and other field is compared in full. Timing callbacks use unmodified current outputs." },
  researchCopyExceptions: { completedIRN: 0, labLevels: 8,
    later: { identity: "intergalactic_research_network", before: oldNetworkLater, after: "" },
    waitingRow: { before: oldWaitingResearch, after: newWaitingResearch },
    rule: "Assert exact source receipts and lab/IRN conditions, all sixteen ordered card identities, the complete old/new waiting row and the entire changed IRN card before normalizing only its later field and the waiting detail. Compare all other fields, active timers, actions and full state exactly. Timing callbacks receive no normalization." },
  labBlockersException: { field: "present.research.labBlockers / presentVisible.research.labBlockers",
    visibleValue: { planetCount: 0, jobCount: 0, summary: "", note: "", items: [] }, hiddenValue: null,
    source: labBlockersSourceProof,
    rule: "Prove every complete ordered source/current paid building queue, all exact null current demolition slots, unique world identities and ordered panel/model key shape. Only then remove this one independently empty/null read-only field from copied research evidence; the whole prior presenter, source state and unmodified timing callbacks remain exact." },
  method: { modelSamples: samples, modelWarmup: warmup, simulationSamples, percentile: "nearest-rank 95th percentile", frozenSameObject: true,
    startupParityPasses: 2, timingIncludes: "only the named synchronous callback", timingExcludes: "fixture generation, module loading, freezing, equality/hash checks, output serialization",
    limits: "CPU/JIT/GC and competing workload affect native timings. Small-sample p95 is descriptive, not a statistical guarantee. Browser measurements and storage quota must be reported separately." },
  modelResults, separateResults,
  correctness: { strictReadersEqualAfterExplicitR11AdditiveLift: true, zeroTimeStartupStable: true, archivedFullPresentParityAfterAssertedTerraformerAppend: true, visibleAndSharedFieldsEqualAfterAssertedTerraformerAppend: true,
    researchCopyExceptionsFullyAsserted: true, emptyLabBlockersAdditionFullyAsserted: true, irnZeroResearchTimesAndAllActiveTimersUnchanged: true,
    splitSpaceParity: true, frozenInputUnchanged: true, completeSimulationStateParity: true, exactNativeSerializationParityAfterExplicitR11Lift: true },
}, null, 2) + "\n");
