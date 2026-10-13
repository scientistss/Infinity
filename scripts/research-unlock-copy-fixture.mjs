#!/usr/bin/env node
/**
 * Independent first-lab natural-domain source. Run with node --import tsx.
 * No legacy journey generator, canned economy, direct research/resource edit,
 * disabled achievement, speedup item, scrape, protocol, or RNG override is used.
 * Time is accelerated by explicit bounded real-engine live ticks, not browser time.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INPUT = { status: "", banner: null, notice: null, catchup: null };
const WORLD_SEED = 20261013;
const ARCADE_SEED = 49303029;
const MAX_ENGINE_SECONDS = 300;
const MAX_ACTIONS = 320;
const EXPECTED_EFFECT = "1 级解锁深空星环机（信标版）";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));
const args = process.argv.slice(2);
const mode = args.shift();
const options = {};
while (args.length) {
  const key = args.shift(), value = args.shift();
  assert(key?.startsWith("--") && value && !value.startsWith("--"), "Expected --key value arguments");
  assert(!Object.hasOwn(options, key.slice(2)), `Duplicate option ${key}`);
  options[key.slice(2)] = value;
}
assert(["generate", "read"].includes(mode), "Use generate --out DIR or read --input RAW --out FILE [--source-root ROOT]");
for (const key of Object.keys(options)) assert(["out", "input", "source-root"].includes(key), `Unknown option ${key}`);
assert(options.out, "--out is required; output is never written into an implicit report location");
const sourceRoot = resolve(options["source-root"] ?? dirname(fileURLToPath(import.meta.url)), options["source-root"] ? "." : "..");
const moduleAt = relative => import(pathToFileURL(resolve(sourceRoot, relative)).href);
const [{ createInitialState }, { activePlanet }, { canEnqueue, enqueue }, { tick, emptyTickLog },
  { exportSave, importSave, deserializeState, serializeState }, { economy },
  { presentVisible, researchVisible, resolveVisibleTab }, { arcadeUnlocked }] = await Promise.all([
  moduleAt("src/game/state.ts"), moduleAt("src/game/empire.ts"), moduleAt("src/game/queue.ts"),
  moduleAt("src/game/logic.ts"), moduleAt("src/game/save.ts"), moduleAt("src/game/economy.ts"),
  moduleAt("src/ui/present.ts"), moduleAt("src/game/arcade.ts"),
]);

function git(...command) {
  return execFileSync("git", ["-C", sourceRoot, ...command], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
}
async function provenance() {
  const names = git("ls-files", "-z", "src", "package.json", "package-lock.json").split("\0").filter(Boolean).sort();
  const files = [];
  for (const path of names) files.push({ path, sha256: sha256(await readFile(resolve(sourceRoot, path))) });
  return {
    sourceRoot, head: git("rev-parse", "HEAD"),
    changedSourceFiles: git("diff", "--name-only", "HEAD", "--", "src", "package.json", "package-lock.json").split("\n").filter(Boolean),
    files, sourceManifestSha256: sha256(JSON.stringify(files)),
    generator: { path: fileURLToPath(import.meta.url), sha256: sha256(await readFile(fileURLToPath(import.meta.url))) },
  };
}
function money(resources) {
  return Object.fromEntries(["metal", "crystal", "deuterium"].map(id => [id, resources[id].toString()]));
}
function snapshot(state) {
  const home = activePlanet(state);
  return {
    totalTime: state.totalTime.toString(), resources: money(home.resources), lifetime: money(state.lifetime),
    buildings: { ...home.buildings }, research: plain(state.research), buildQueue: plain(home.buildQueue),
    seeds: { universe: state.universe.seed, arcade: state.arcade.seed, deepSpace: state.deepSpace.seed },
    darkMatter: state.darkMatter.toString(), unlocked: [...state.unlocked], stats: { ...state.stats },
    economy: economy(state), stateSha256: sha256(JSON.stringify(serializeState(state))),
  };
}
function readProjection(raw) {
  const bytesHash = sha256(raw), parsed = importSave(raw), state = deserializeState(parsed.state);
  const allBefore = JSON.stringify(state), serializedBefore = JSON.stringify(serializeState(state));
  const shown = presentVisible(state, INPUT, "research");
  assert.equal(JSON.stringify(state), allBefore, "Presentation mutated full in-memory state");
  assert.equal(JSON.stringify(serializeState(state)), serializedBefore, "Presentation mutated serialized state");
  const astro = shown.research.items.find(item => item.id === "astrophysics");
  return {
    rawSha256: bytesHash, schema: parsed.schema, version: parsed.version, revision: parsed.revision,
    savedAt: parsed.savedAt, lastTickAt: parsed.lastTickAt,
    stateSha256: sha256(serializedBefore), stateUnchanged: true,
    researchVisible: researchVisible(state), arcadeUnlocked: arcadeUnlocked(state),
    resolvedResearchTab: resolveVisibleTab(state, "research"),
    astrophysics: astro ?? null, research: shown.research, view: shown,
  };
}

if (mode === "read") {
  assert(options.input, "read requires --input RAW");
  const raw = await readFile(resolve(options.input), "utf8");
  const report = { schema: "infinity-research-unlock-reader-v1", source: await provenance(), input: resolve(options.input), ...readProjection(raw) };
  await mkdir(dirname(resolve(options.out)), { recursive: true });
  await writeFile(resolve(options.out), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ ok: true, output: resolve(options.out), rawSha256: report.rawSha256, effect: report.astrophysics?.effect }) + "\n");
} else {
  assert(!options.input, "generate does not accept input or reuse another journey's source");
  const out = resolve(options.out);
  await mkdir(out, { recursive: true });
  const source = await provenance();
  // One actual factory call; both optional entropy arguments are supported by this API.
  let state = createInitialState(WORLD_SEED, ARCADE_SEED);
  const savedAt = Date.now();
  const rawInitial = exportSave(state, savedAt, savedAt);
  const initial = snapshot(state);
  assert.deepEqual(initial.resources, { metal: "500", crystal: "500", deuterium: "0" });
  assert(Object.values(activePlanet(state).buildings).every(level => level === 0));
  assert(Object.values(state.research.levels).every(level => level === 0));
  assert.equal(researchVisible(state), false);
  assert.equal(arcadeUnlocked(state), false);
  // Save evidence immediately; a later failure never erases or replaces it.
  await writeFile(resolve(out, "raw-initial.json"), rawInitial, { flag: "wx" });
  const actions = [];
  const receipt = {
    schema: "infinity-research-unlock-natural-v1", status: "running", passed: false, completed: false, sourceSha: source.head, source,
    method: "Accelerated natural-domain engine progression; not elapsed browser/wall-clock play.",
    initialFactory: { api: "createInitialState(seed, arcadeSeed)", worldSeed: WORLD_SEED, arcadeSeed: ARCADE_SEED, stateEdits: [] },
    bounds: { maxEngineSeconds: MAX_ENGINE_SECONDS, maxActions: MAX_ACTIONS, maxTickSeconds: 1, mode: "live" },
    savedAt, lastTickAt: savedAt, initial, actions,
    rawInitial: { path: resolve(out, "raw-initial.json"), sha256: sha256(rawInitial) },
    exclusions: ["No resource/research/building injections", "No achievement or bonus injection/suppression", "No item/DM speedup", "No scrape", "No protocol or local-plan activation", "No imported old fixture or report", "No browser-clock acceleration"],
  };
  const persist = async () => writeFile(resolve(out, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  await persist();
  const assertBound = () => {
    assert(actions.length < MAX_ACTIONS, "Finite action bound exceeded");
    assert(state.totalTime.toNumber() <= MAX_ENGINE_SECONDS, "Finite engine-time bound exceeded");
  };
  const pay = building => {
    assertBound();
    const before = snapshot(state), quoted = canEnqueue(state, building);
    assert(quoted.ok, `${building} cannot be paid: ${quoted.reason}`);
    assert.equal(quoted.targetLevel, 1);
    const result = enqueue(state, building, "manual");
    assert(result.ok, `${building} enqueue failed: ${result.reason}`);
    state = result.state;
    const job = activePlanet(state).buildQueue.find(value => value.jobId === result.jobId);
    assert(job, "Payment did not create the returned paid job");
    assert.deepEqual(money(job.paid), money(quoted.cost));
    for (const id of ["metal", "crystal", "deuterium"]) {
      assert(activePlanet(state).resources[id].eq(bigFromBefore(before.resources[id], quoted.cost[id])), `${building} ${id} payment mismatch`);
    }
    const after = snapshot(state);
    assert.equal(after.totalTime, before.totalTime, "Payment advanced engine time");
    actions.push({ index: actions.length + 1, kind: "enqueue", building, targetLevel: 1, source: "manual", jobId: result.jobId, cost: money(quoted.cost), paidJob: plain(job), before, after });
  };
  // Use the same existing BigNumber implementation via the payment's zero value,
  // without constructing or editing any game-state resource.
  const bigFromBefore = (text, cost) => cost.mul(0).add(text).sub(cost);
  const advance = (seconds, reason) => {
    assertBound();
    assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 1);
    assert(state.totalTime.toNumber() + seconds <= MAX_ENGINE_SECONDS, "Finite engine-time bound exceeded");
    const before = snapshot(state), log = emptyTickLog();
    state = tick(state, seconds, "live", log);
    const after = snapshot(state);
    assert(Math.abs(Number(after.totalTime) - Number(before.totalTime) - seconds) < 1e-7, "Engine did not adopt the requested time");
    assert.deepEqual(after.seeds, initial.seeds, "Unexpected RNG consumption before any research");
    assert(Object.values(state.research.levels).every(level => level === 0));
    actions.push({ index: actions.length + 1, kind: "tick", reason, seconds, mode: "live", completed: log, before, after });
  };
  try {
    pay("solar_plant");
    pay("deuterium_synth");
    while (activePlanet(state).buildQueue.length) {
      advance(Math.min(1, activePlanet(state).buildQueue[0].remainingSeconds), "Finish the two actually paid starter buildings");
    }
    while (!canEnqueue(state, "research_lab").ok) {
      const check = canEnqueue(state, "research_lab");
      assert(check.onlyResources, `Unexpected lab blocker: ${check.reason}`);
      advance(1, "Accumulate the lab's missing resources through ordinary production");
    }
    pay("research_lab");
    while (activePlanet(state).buildQueue.length) {
      advance(Math.min(1, activePlanet(state).buildQueue[0].remainingSeconds), "Finish the actually paid first lab");
    }
    assert.equal(activePlanet(state).buildings.research_lab, 1);
    assert.equal(researchVisible(state), true);
    assert.equal(arcadeUnlocked(state), false);
    assert.equal(state.research.queue.length, 0);
    assert.deepEqual(actions.filter(action => action.kind === "enqueue").map(action => action.building), ["solar_plant", "deuterium_synth", "research_lab"]);
    // Keep both raw inputs on the same explicit source wall-clock watermark.
    // Simulated duration is state.totalTime; it is not forged elapsed wall time.
    const rawFirstLab = exportSave(state, savedAt, savedAt);
    const projection = readProjection(rawFirstLab);
    assert.equal(projection.astrophysics.effect, EXPECTED_EFFECT, "Generate expected candidate view only from the corrected presenter");
    const expected = { schema: "infinity-research-unlock-expected-v1", source, ...projection };
    await writeFile(resolve(out, "raw-first-lab.json"), rawFirstLab, { flag: "wx" });
    await writeFile(resolve(out, "expected-view.json"), JSON.stringify(expected, null, 2) + "\n", { flag: "wx" });
    Object.assign(receipt, {
      status: "passed", passed: true, completed: true, final: snapshot(state), totalEngineSeconds: state.totalTime.toNumber(), actionCount: actions.length,
      rawFirstLab: { path: resolve(out, "raw-first-lab.json"), sha256: sha256(rawFirstLab) },
      expectedView: { path: resolve(out, "expected-view.json"), effect: projection.astrophysics.effect },
      researchVisible: true, arcadeUnlocked: false,
      earnedAchievements: [...state.unlocked], earnedDarkMatter: state.darkMatter.toString(),
    });
    await persist();
    process.stdout.write(JSON.stringify({ ok: true, output: out, totalEngineSeconds: receipt.totalEngineSeconds, actionCount: actions.length, rawFirstLabSha256: receipt.rawFirstLab.sha256, effect: projection.astrophysics.effect }) + "\n");
  } catch (error) {
    Object.assign(receipt, { status: "failed", error: error instanceof Error ? error.stack : String(error), final: snapshot(state) });
    await persist();
    throw error;
  }
}
