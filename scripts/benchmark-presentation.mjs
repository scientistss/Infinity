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
import { assertR8StatePreserved, liftR8StateToR10 } from "./r8-compatibility.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
assert.equal(migratedFile.revision, 10, "new reader must perform the real r8-to-r10 migration");
const migrationFloor = fixture.ready.state.orders.nextJobId;
const sourceState = afterSave.deserializeState(migratedFile.state);
const beforeState = beforeSave.deserializeState(beforeSave.importSave(fixture.save).state);
const serialized = JSON.stringify(afterSave.serializeState(sourceState));
const archivedSerialized = JSON.stringify(beforeSave.serializeState(beforeState));
assertR8StatePreserved(afterSave.serializeState(sourceState), beforeSave.serializeState(beforeState), "archived/current strict readers", migrationFloor);
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
assert.deepEqual({ ...fullCurrent, buildings: historicalBuildingCards(fullCurrent.buildings, "full presenter") },
  fullOriginal, "retained full presenter equals exact archived original after the one fully asserted terraformer append");
const fullSpace = beforeSpace.spaceView(state, cursor, request);
const currentFullSpace = afterSpace.spaceView(state, cursor, request);
const normalizedOriginalSpace = { ...fullSpace, phase: normalizedPhase(fullSpace.phase, beforeVersion, "archived full space") };
assert.deepEqual({ ...currentFullSpace, phase: normalizedPhase(currentFullSpace.phase, afterVersion, "current full space") },
  normalizedOriginalSpace, "retained full space equals archived original except the declared package-version token");
assert.deepEqual(afterOrders.ordersView(state), beforeOrders.ordersView(state), "orders model parity");

const tabs = ["facilities", "overview", "research", "shipyard", "defense", "darkmatter", "arcade", "protocol", "achievements", "curvature", "galaxy", "fleet", "messages", "orders", "deep"];
const topPanelFields = new Set(["research", "shipyard", "darkMatter", "arcade", "buildings", "production", "overview", "catalog", "slots", "achievements", "techs"]);
function parityVisible(tab) {
  const visible = afterPresent.presentVisible(state, input, tab);
  const resolved = afterPresent.resolveVisibleTab(state, tab);
  for (const key of Object.keys(fullOriginal)) {
    if (!topPanelFields.has(key)) assert.deepEqual(visible[key], fullOriginal[key], `${tab}: shared ${key}`);
  }
  for (const [panel, excluded] of [
    ["research", ["items"]], ["shipyard", ["ships", "defenses"]],
    ["darkMatter", ["shop", "packages", "inventory", "boosters"]], ["overview", ["production", "energy"]],
  ]) {
    for (const key of Object.keys(fullOriginal[panel])) {
      if (!excluded.includes(key)) assert.deepEqual(visible[panel][key], fullOriginal[panel][key], `${tab}: shared ${panel}.${key}`);
    }
  }
  assert.equal(visible.arcade.visible, fullOriginal.arcade.visible, `${tab}: ring unlock flag`);
  const visibleKeys = {
    facilities: ["buildings", "production"], overview: ["overview"], research: ["research"], darkmatter: ["darkMatter"],
    arcade: ["arcade"], protocol: ["catalog", "slots"], achievements: ["achievements"], curvature: ["techs"],
  }[resolved] ?? [];
  for (const key of visibleKeys) assert.deepEqual(key === "buildings"
    ? historicalBuildingCards(visible[key], `${tab}: visible buildings`) : visible[key], fullOriginal[key], `${tab}: visible ${key}`);
  if (resolved === "shipyard") assert.deepEqual(visible.shipyard.ships, fullOriginal.shipyard.ships, "visible ship cards");
  if (resolved === "defense") assert.deepEqual(visible.shipyard.defenses, fullOriginal.shipyard.defenses, "visible defense cards");
  return resolved;
}
const resolvedTabs = Object.fromEntries(tabs.map(tab => [tab, parityVisible(tab)]));
for (const projection of [afterSpace.spaceGalaxyView(state, cursor), afterSpace.spaceFleetView(state, request), afterSpace.spaceMessagesView(state)]) {
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
  paired("serialization:exact-native-exportSave", () => beforeSave.exportSave(state, fixture.manifest.savedAt), () => afterSave.exportSave(state, fixture.manifest.savedAt), simulationSamples, 1),
  paired("strict-import:importSave-plus-deserializeState", () => beforeSave.deserializeState(beforeSave.importSave(fixture.save).state), () => afterSave.deserializeState(afterSave.importSave(fixture.save).state), simulationSamples, 1),
  paired("simulation:zero-time-startup", () => beforeLogic.tick(state, 0), () => afterLogic.tick(state, 0), simulationSamples, 1),
  paired("simulation:one-native-60Hz-sized-step", () => beforeLogic.tick(state, 1 / 60), () => afterLogic.tick(state, 1 / 60), simulationSamples, 1),
];
assert.equal(JSON.stringify(afterSave.serializeState(state)), serialized, "no measured model or simulation mutated the shared frozen input");
assert.equal(beforeSave.exportSave(state, fixture.manifest.savedAt), fixture.save, "archived exact serialization parity");
const expectedR10 = { ...fixture.ready, revision: 10, state: liftR8StateToR10(fixture.ready.state, migrationFloor) };
assert.equal(afterSave.exportSave(state, fixture.manifest.savedAt), JSON.stringify(expectedR10, null, 2), "current exact native serialization is the exact empty-library and grant-ledger lift plus r10 envelope");
for (const delta of [0, 1 / 60, 0.125]) {
  assertR8StatePreserved(afterSave.serializeState(afterLogic.tick(state, delta)),
    beforeSave.serializeState(beforeLogic.tick(state, delta)), `complete simulation state parity at ${delta}s`, migrationFloor);
}
assert.ok(sink, "measurement results were consumed");
const sourceHashes = root => Object.fromEntries(["package.json", "src/ui/present.ts", "src/ui/shipyard-present.ts", "src/ui/space-present.ts", "src/game/logic.ts", "src/game/save.ts"].map(path => [path, sha256(readFileSync(resolve(root, path)))]));
process.stdout.write(JSON.stringify({
  scope: "Native Node performance.now wall-time measurements on the identical frozen state from the real r8 strict-reader fixture after observed r10 migration; the save adds only independently asserted empty buildingTemplates and fixed-floor, zero-grant metadata. Model parity permits exactly one appended terraformer card, with all preconditions and every card field independently asserted; every historical card and other model field remains exact. Paired old archived full presenters versus new visible presenters, alternating sample order, with explicit warmups and raw samples. No fake time, no browser/DOM/FPS claim, no absolute millisecond gate, no player data.",
  environment: { node: process.version, platform: platform(), release: release(), arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  fixture: { path: resolve(fixturePath), profile: fixture.profile, manifest: fixture.manifest },
  sources: { beforeRoot, afterRoot, before: sourceHashes(beforeRoot), after: sourceHashes(afterRoot) },
  metadataException: { field: "spaceView.phase / spaceGalaxyView.phase", beforePackageVersion: beforeVersion, afterPackageVersion: afterVersion,
    rule: "Assert each exact respective package version occurs once with its original display-token boundaries; replace only that version token for parity comparison. Every other phase byte and model field remains exact. Native timing callbacks receive no normalization.",
    normalizedToken: "v<package-version>" },
  featureException: { field: "present.buildings / presentVisible(facilities).buildings", addedCard: expectedTerraformerCard,
    rule: "Assert the exact fixture preconditions, old-catalog absence, one unique appended identity and all 11 card fields before removing only the last card for historical comparison. Every old card, ordering and other field is compared in full. Timing callbacks use unmodified current outputs." },
  method: { modelSamples: samples, modelWarmup: warmup, simulationSamples, percentile: "nearest-rank 95th percentile", frozenSameObject: true,
    startupParityPasses: 2, timingIncludes: "only the named synchronous callback", timingExcludes: "fixture generation, module loading, freezing, equality/hash checks, output serialization",
    limits: "CPU/JIT/GC and competing workload affect native timings. Small-sample p95 is descriptive, not a statistical guarantee. Browser measurements and storage quota must be reported separately." },
  modelResults, separateResults,
  correctness: { strictReadersEqualAfterExplicitR10AdditiveLift: true, zeroTimeStartupStable: true, archivedFullPresentParityAfterAssertedTerraformerAppend: true, visibleAndSharedFieldsEqualAfterAssertedTerraformerAppend: true,
    splitSpaceParity: true, frozenInputUnchanged: true, completeSimulationStateParity: true, exactNativeSerializationParityAfterExplicitR10Lift: true },
}, null, 2) + "\n");
