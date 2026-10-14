/** r14 natural continuation of exact historical 7554 paid 31-second final export.
 * The historical source's complete CI was RED at an unrelated old galaxy test;
 * its completed 4884-check native battle / 941-check natural evidence is provenance,
 * not a released-r13 claim. This script is not native/browser evidence.
 * node --import tsx scripts/scout-rehearsal-natural-route.ts --legacy-root PATH --output NEW.json
 */
import { enqueueResearch } from "../src/game/research";
import { orderUnits } from "../src/game/shipyard";
import { emptyCargo, sendFleet, quoteFlight } from "../src/game/fleet";
import { prestigeConfirmation } from "../src/ui/prestige-preview-model";
import { tick, evaluatePrestige } from "../src/game/logic";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { rehearseNpcScout } from "../src/game/npc-rehearsal";
import { STORAGE_KEY } from "../src/game/content";
import { captureAdoptedSteps } from "./capture-adopted-steps.mjs";
import { liftR13StateToR16, projectVerifiedScoutSnapshots } from "./r16-compatibility.mjs";
import { NPC_SCOUT_UI_SELECTION } from "./npc-scout-ui-selection";
import type { GameState } from "../src/game/types";
import type { NpcScoutSnapshotV1 } from "../src/game/npc-scout-state";
declare const process: { argv: string[]; version: string; exitCode?: number; stdout: { write(value: string): void } };
type Obj = Record<string, any>;
const [{ readFileSync, writeFileSync, existsSync, realpathSync }, { createHash }, { execFileSync }, { resolve }, { pathToFileURL }, { isDeepStrictEqual }] = await Promise.all([
  import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string), import("node:path" as string), import("node:url" as string), import("node:util" as string),
]);
const ROOT = realpathSync(new URL("../", import.meta.url));
const PIN = "7554c662e3ac1f27876a60d8aa706e5d4a4dcd52";
const RAW_SHA = "fae7a73c01fe9dec87d22564023a601e28853a218fc301185ba1a53463a5096b";
const ROW = "r13-empty10-zero-round-loot-delivered";
const TARGET = Object.freeze({ galaxy: 1, system: 56, position: 15 }), TARGET_KEY = "1:56:15";
const SEEDS = [608135816, 2242054355, 320440878];
const SHIPS = Object.keys(NPC_SCOUT_UI_SELECTION);
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1];
  if (!["--legacy-root", "--output"].includes(key) || !value || args.has(key)) throw Error("Require --legacy-root PATH --output NEW.json");
  args.set(key, value);
}
if (args.size !== 2) throw Error("Both named arguments are mandatory");
const LEGACY = realpathSync(args.get("--legacy-root")), OUTPUT = resolve(args.get("--output"));
if (existsSync(OUTPUT) || OUTPUT.startsWith(ROOT + "/src/") || OUTPUT.startsWith(ROOT + "/tests/") || OUTPUT.startsWith(ROOT + "/scripts/")) throw Error("Use a new evidence file outside source paths");
const hash = (value: string | Uint8Array) => String(createHash("sha256").update(value).digest("hex"));
const git = (...values: string[]) => String(execFileSync("git", values, { cwd: ROOT, encoding: "utf8", timeout: 10000 })).trimEnd();
const checks: Obj[] = [], milestones: Obj[] = [], tape: Obj[] = [], snapshots = new Map<string, Obj>(), observations: Obj[] = [], timeDistinctions: Obj[] = [];
let stage = "source", elapsed = 0, state!: GameState, control: any, failure: string | null = null, mainComplete = false;
let source: Obj = {}, origin: Obj = {}, branches: Obj = {}, naturalExamples: Obj | null = null;
const started = performance.now();
const old: Obj = {};
function check(name: string, value: unknown, detail?: unknown) { checks.push({ stage, name, passed: !!value, ...(detail === undefined ? {} : { detail }) }); if (!value) throw Error(name); }
function exact(name: string, actual: unknown, expected: unknown) {
  if (!isDeepStrictEqual(actual, expected)) writeFileSync(OUTPUT + ".mismatch.json", JSON.stringify({ stage, name, actual, expected }, null, 2));
  check(name, isDeepStrictEqual(actual, expected));
}
function independentRandom(seed: number, g: number, s: number, p: number, salt = 0) {
  let x = (seed ^ Math.imul(g, 73856093) ^ Math.imul(s, 19349663) ^ Math.imul(p, 83492791) ^ Math.imul(salt, 2654435761)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return (x >>> 0) / 4294967296;
}
function stockAt(wallet: Obj, now: number) {
  const a = wallet.sites[TARGET_KEY] ?? wallet.baseline;
  return a.stock.map((n: number, i: number) => Math.min([50000, 30000, 10000][i]!, n + [5, 2.5, 1][i]! * (now - a.mark)));
}
function expectedStateOf(value: any) {
  const expected = liftR13StateToR16(old.save.serializeState(value));
  for (const m of expected.messages) {
    const observed = snapshots.get(m.id);
    if (observed) { m.npcScoutSnapshot = structuredClone(observed); m.at = Math.min(1e12, old.decimal.big(observed.observedAt).toNumber()); }
  }
  return expected;
}
function expectedState() { return expectedStateOf(control); }
function invariant() {
  const actual = serializeState(state), expected = expectedState();
  exact("complete r14 state equals unmodified archived 7554 plus separately proved new fields", actual, expected);
  const projected = projectVerifiedScoutSnapshots(actual, snapshots, stage);
  const historical = old.save.serializeState(control);
  for (const message of projected.messages) {
    if (!snapshots.has(message.id)) continue;
    const oldMessage = historical.messages.find((m: Obj) => m.id === message.id);
    // Only this new typed-arrival list label has a documented canonical-time change.
    exact("new numeric list label is canonical observed time, never silently tolerated", message.at, Math.min(1e12, old.decimal.big(snapshots.get(message.id)!.observedAt).toNumber()));
    message.at = oldMessage.at;
  }
  exact("all unchanged old domains and untouched old list times equal exact 7554", projected, historical);
  check("natural continuation bounded without economic injection", elapsed <= 180 && tape.length <= 300 && performance.now() - started < 300000);
}
function checkpoint(name: string, reload = false) {
  stage = name; invariant();
  const at = origin.envelope.savedAt + elapsed * 1000, raw = exportSave(state, at, at);
  exact("strict current snapshot roundtrip", importSave(raw).state, serializeState(state));
  if (reload) {
    state = deserializeState(importSave(raw).state);
    control = old.save.deserializeState(old.save.importSave(old.save.exportSave(control, at, at)).state);
    invariant();
  }
  const historicalRaw = old.save.exportSave(control, at, at);
  milestones.push({ name, elapsedSeconds: elapsed, raw, rawSha256: hash(raw), historicalRaw, historicalRawSha256: hash(historicalRaw), expected: expectedState(), reload });
  tape.push({ kind: "checkpoint", name });
}
function advance(seconds = 1) {
  const before = control;
  const observed = captureAdoptedSteps(control, (s: any) => ({ state: old.logic.tick(s, seconds), appliedSeconds: seconds, rawSeconds: seconds, capSeconds: seconds, capped: false }), old.save.serializeState);
  let time = before.totalTime, now = before.npcEconomy.now, used = 0;
  const outbound = before.fleets.filter((f: Obj) => f.mission === "scout" && !f.returning);
  for (const step of observed.adoptedSegmentsSeconds) {
    time = time.add(step); now += step; used += step;
    for (const f of outbound) if (!snapshots.has(`scout-${f.id}`) && f.remaining - used <= 1e-9) {
      const snapshot = { model: "npc-scout-snapshot-v1", fleetId: f.id, originId: f.originId, target: { ...TARGET }, observedAt: time.toString(),
        stock: stockAt(before.npcEconomy, now).map((n: number) => n === 0 ? 0 : n),
        garrison: { ...(before.npcEconomy.sites[TARGET_KEY]?.garrison ?? { light_fighter: 4, heavy_fighter: 0 }) }, defenderTech: { weapons: 0, shields: 0, armour: 0 } };
      snapshots.set(`scout-${f.id}`, snapshot);
      observations.push({ id: f.id, adoptedSegmentsSeconds: observed.adoptedSegmentsSeconds, arrivalSegmentElapsed: used, npcNow: now, snapshot: structuredClone(snapshot) });
    }
  }
  control = observed.result.state;
  for (const row of observations) if (!timeDistinctions.some(x => x.id === row.id)) {
    const m = control.messages.find((x: Obj) => x.id === `scout-${row.id}`);
    if (m) timeDistinctions.push({ id: row.id, historicalNumericAt: m.at, canonicalObservedAt: row.snapshot.observedAt,
      r14NumericAt: Math.min(1e12, old.decimal.big(row.snapshot.observedAt).toNumber()), originalHistoricalText: m.text });
  }
  state = tick(state, seconds); elapsed += seconds; tape.push({ kind: "advance", seconds }); invariant();
}
function send(mission: "scout" | "attack", count: number) {
  const ships = { ...NPC_SCOUT_UI_SELECTION, espionage_probe: mission === "scout" ? 1 : 0, light_fighter: mission === "attack" ? count : 0 };
  const request = { mission, target: { ...TARGET }, ships, cargo: emptyCargo(), speedPercent: 100 };
  const before = serializeState(state), quote = quoteFlight(state, request), oldQuote = old.fleet.quoteFlight(control, { ...request, cargo: old.fleet.emptyCargo() });
  exact("current complete real flight quote equals archived 7554", quote, oldQuote);
  check("natural quote really permits paid dispatch", quote.ok);
  const fleetId = state.nextFleetId, a = sendFleet(state, request), b = old.fleet.sendFleet(control, { ...request, cargo: old.fleet.emptyCargo() });
  check("both real engines pay and dispatch", a.ok && b.ok);
  exact("paid action leaves its source state unchanged", serializeState(state), before);
  state = a.state; control = b.state; invariant();
  tape.push({ kind: mission, count, fleetId, target: TARGET, expectedFuel: quote.fuel.toString() });
  return fleetId;
}
/** Independently specified LF-only arithmetic. Literal catalogue/technology and
 * public seeds, no production combat/RNG/loot/real-seed imports. */
function sample(seed: number, count: number, defenders: number, stock: number[]) {
  let rng = seed, a = count, b = defenders, ah = count * 400, bh = defenders * 400;
  const next = () => { rng = (rng + 0x6d2b79f5) >>> 0; let t = rng; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rounds = [];
  for (let round = 1; round <= 6 && a && b; round++) {
    const ad = a * 50 * 1.1 * (.9 + .2 * next()), bd = b * 50 * (.9 + .2 * next());
    ah = Math.max(0, ah - Math.max(0, bd - a * 15)); bh = Math.max(0, bh - Math.max(0, ad - b * 10));
    a = Math.min(a, Math.ceil(ah / 400)); b = Math.min(b, Math.ceil(bh / 400));
    rounds.push({ round, attacker: a, defender: b, attackDamage: ad, defendDamage: bd });
  }
  const winner = a && !b ? "attacker" : b && !a ? "defender" : "draw", half = stock.map(v => Math.floor(v / 2));
  const total = half.reduce((x, y) => x + y, 0), survivingCapacity = Math.min(total, Math.floor(a * 50 * 1.4));
  const loot = winner === "attacker" && a && total ? half.map(v => Math.floor(v * survivingCapacity / total)) : [0, 0, 0];
  if (winner === "attacker") { let left = survivingCapacity - loot.reduce((x, y) => x + y, 0); for (let i = 0; i < 3 && left; i++) if (loot[i]! < half[i]!) { loot[i]!++; left--; } }
  return { seed, battle: { mode: "squadron-v1", winner, rounds, attackerBefore: { light_fighter: count }, defenderBefore: defenders ? { light_fighter: defenders } : {},
    attackerAfter: a ? { light_fighter: a } : {}, defenderAfter: b ? { light_fighter: b } : {} }, survivingCapacity, loot, undefended: defenders === 0, destroyed: a === 0 };
}
function compareSample(actual: Obj, expected: Obj) {
  const clone = structuredClone(actual);
  for (let i = 0; i < expected.battle.rounds.length; i++) for (const key of ["attackDamage", "defendDamage"]) {
    const x = clone.battle.rounds[i]?.[key], y = expected.battle.rounds[i][key];
    check("predeclared independent damage tolerance abs1e-12 + rel1e-14", typeof x === "number" && Math.abs(x - y) <= 1e-12 + 1e-14 * Math.abs(y));
    if (clone.battle.rounds[i]) clone.battle.rounds[i][key] = y;
  }
  exact("public sample all discrete fields and loot exact", clone, expected);
}
function rehearse(id: number) {
  stage = "natural-owned-six-LF-public-examples";
  const before = serializeState(state), snapshot = snapshots.get(`scout-${id}`)!;
  const expected = SEEDS.map(seed => sample(seed, 6, snapshot.garrison.light_fighter, snapshot.stock));
  const result = rehearseNpcScout(snapshot, { light_fighter: 6 }, { weapons: 1, shields: 5, armour: 0 }, 1.4);
  result.samples.forEach((value, i) => compareSample(value, expected[i]!));
  exact("three public samples leave complete game state unchanged", serializeState(state), before);
  check("natural six-fighter examples are meaningful defended combat", expected.every(value => value.battle.rounds.length > 0));
  naturalExamples = { snapshot, selectedShips: { light_fighter: 6 }, attackerTech: { weapons: 1, shields: 5, armour: 0 }, cargoFactor: 1.4, expected, damageTolerance: { absolute: 1e-12, relative: 1e-14 } };
  tape.push({ kind: "rehearsal", scoutId: id });
}
function branchEnvelope(value: GameState) {
  const at = origin.envelope.savedAt + elapsed * 1000, raw = exportSave(value, at, at);
  exact("explicit synthetic branch strictly validates without normalization", importSave(raw).state, serializeState(value));
  return { raw, rawSha256: hash(raw), envelope: JSON.parse(raw) };
}
try {
  const poolBytes = readFileSync(resolve(ROOT, "tests/fixtures/npc-scout-legacy.json"));
  const pool = JSON.parse(String(poolBytes)), row = pool.rows.find((r: Obj) => r.id === ROW);
  check("genuine paid retained original source row", row && row.synthetic === false && row.naturalProgression === true && row.sourceSha === PIN && row.rawSha256 === RAW_SHA && hash(row.raw) === RAW_SHA);
  const binding = pool.sourceBindings["13"];
  check("historical source full identity pinned", binding.sourceSha === PIN);
  for (const f of binding.sourceFiles) exact(`archived 7554 byte identity ${f.path}`, hash(readFileSync(resolve(LEGACY, f.path))), f.sha256);
  for (const name of ["save", "logic", "fleet", "decimal", "research", "shipyard"]) old[name] = await import(pathToFileURL(resolve(LEGACY, `src/game/${name}.ts`)).href);
  const envelope = JSON.parse(row.raw);
  origin = { id: ROW, raw: row.raw, rawSha256: RAW_SHA, envelope, historicalSourceSha: PIN, historicalCompleteCI: "red: old galaxy native branch; completed 4884 native battle and 941 natural checks are provenance only" };
  source = { sourceSha: git("rev-parse", "HEAD"), sourceScopeStatusPorcelain: git("status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "package.json", "package-lock.json"),
    fixturePoolSha256: hash(poolBytes), routeScriptSha256: hash(readFileSync(new URL(import.meta.url))), runtimeNode: process.version,
    oldSourceSha: PIN, oldSourceBindings: binding.sourceFiles, dependencyLockSha256: hash(readFileSync(resolve(ROOT, "package-lock.json"))) };
  state = deserializeState(importSave(row.raw).state); control = old.save.deserializeState(old.save.importSave(row.raw).state);
  exact("all old messages gain only explicit null snapshot slot", serializeState(state), liftR13StateToR16(old.save.serializeState(control)));
  exact("actual unchanged seed", state.universe.seed, 20261010);
  check("independent target occupancy and untouched weak initial garrison", independentRandom(20261010, 1, 56, 15) === .23852863418869674 && independentRandom(20261010, 1, 56, 15, 101) === .08924779412336648 && !control.npcEconomy.sites[TARGET_KEY]);
  checkpoint("migrated-paid31-final");
  const scout = send("scout", 0); exact("paid new scout uses next historical ID", scout, 11);
  checkpoint("scout11-paid-outbound"); advance(.5); check("partial scout remains outbound without typed observation", !snapshots.has("scout-11") && state.fleets[0]!.returning === false); checkpoint("scout11-partial-reload", true); advance(.5);
  while (!snapshots.has(`scout-${scout}`)) advance(); checkpoint("scout11-arrived-once");
  while (state.fleets.some(f => f.id === scout)) advance(); checkpoint("scout11-returned");
  rehearse(scout); checkpoint("run-cancel-reopen-fill-still-unpaid");
  const attack = send("attack", 6); exact("only separate real attack allocates ID12", attack, 12); checkpoint("attack12-paid-outbound", true);
  while (!state.npcBattles.reports.some(r => r.fleetId === attack)) advance(); checkpoint("attack12-actual-battle");
  while (state.fleets.some(f => f.id === attack)) advance(); checkpoint("attack12-return-delivered-once", true);
  const rescout = send("scout", 0); exact("new paid rescout has fresh ID13", rescout, 13);
  while (!snapshots.has(`scout-${rescout}`)) advance(); checkpoint("scout13-after-real-battle");
  while (state.fleets.some(f => f.id === rescout)) advance(); checkpoint("scout13-returned");
  exact("old historical typed payload stays frozen after actual attack and re-scout", state.messages.find(m => m.id === "scout-11")!.npcScoutSnapshot, snapshots.get("scout-11"));
  check("later paid observation records actual surviving garrison", snapshots.get("scout-13")!.garrison.light_fighter < 4);
  mainComplete = true;
  // Separate actual paid continuation, never an edited resource/technology fixture.
  // Each old twin starts from its own archived-source export captured at the same milestone.
  const completionOrigin = milestones.find(row => row.name === "scout11-returned")!;
  let completing = deserializeState(importSave(completionOrigin.raw).state);
  let completingOld = old.save.deserializeState(old.save.importSave(completionOrigin.historicalRaw).state);
  const completionStart = branchEnvelope(completing), completionSteps: Obj[] = [];
  function completionCheck(name: string) {
    exact(name + ": every paid-completion domain equals independent archived source", serializeState(completing), expectedStateOf(completingOld));
  }
  const queuedShip = orderUnits(completing, "light_fighter", 1, "manual"), oldQueuedShip = old.shipyard.orderUnits(completingOld, "light_fighter", 1, "manual");
  check("both engines really pay for one more fighter", queuedShip.ok && oldQueuedShip.ok);
  completing = queuedShip.state; completingOld = oldQueuedShip.state; completionCheck("paid-fighter-queued");
  const afterShip = branchEnvelope(completing);
  const queuedResearch = enqueueResearch(completing, "weapons_tech", "manual"), oldQueuedResearch = old.research.enqueueResearch(completingOld, "weapons_tech", "manual");
  check("both engines really pay for weapons2", queuedResearch.ok && oldQueuedResearch.ok);
  completing = queuedResearch.state; completingOld = oldQueuedResearch.state; completionCheck("paid-weapons2-queued");
  check("queued jobs do not grant stock or completed technology", completing.planets[0]!.units.light_fighter === 6 && completing.research.levels.weapons_tech === 1);
  const paid = branchEnvelope(completing);
  while (completing.planets[0]!.shipyardQueue.length || completing.research.queue.length) {
    check("paid completion continuation bounded", completionSteps.length < 120);
    completing = tick(completing, 1); completingOld = old.logic.tick(completingOld, 1); completionCheck("paid-completion-tick");
    completionSteps.push({ seconds: 1, expected: expectedStateOf(completingOld), raw: branchEnvelope(completing).raw });
  }
  check("actual paid completion grants seventh fighter and weapons2 exactly", completing.planets[0]!.units.light_fighter === 7 && completing.research.levels.weapons_tech === 2);
  const freshRequest = { mission: "attack" as const, target: { ...TARGET }, ships: { ...NPC_SCOUT_UI_SELECTION, espionage_probe: 0, light_fighter: 6 }, cargo: emptyCargo(), speedPercent: 100 };
  const fresh = sendFleet(completing, freshRequest), oldFresh = old.fleet.sendFleet(completingOld, { ...freshRequest, cargo: old.fleet.emptyCargo() });
  check("separate fresh actual send after completion pays in both engines", fresh.ok && oldFresh.ok);
  completing = fresh.state; completingOld = oldFresh.state; completionCheck("fresh-completion-send");
  branches.paidCompletion = { classification: "Separate actual paid continuation from earned scout11-returned; no resource/unit/technology field injection. Old twin receives the same paid APIs and ticks from its own byte-preserved export.",
    start: completionStart, afterShip, paid, steps: completionSteps, sent: { expected: expectedStateOf(completingOld) },
    required: { before: { light_fighter: 6, weapons: 1 }, after: { light_fighter: 7, weapons: 2 }, fleetId: 12 } };
  // EXPLICIT SYNTHETIC BOUNDARY. No fixture below is an earned natural state.
  const naturalFinal = serializeState(state), base = () => deserializeState(naturalFinal);
  const performanceFixture = base();
  for (const id of SHIPS) (performanceFixture.planets[0]!.units as any)[id] = 1e12;
  for (const id of ["weapons_tech", "shielding_tech", "armour_tech", "hyperspace_tech"] as const) performanceFixture.research.levels[id] = 1000;
  branches.performance = { classification: "EXPLICIT SYNTHETIC upper-bound context; all13 landed types1e12 and completed combat/cargo technology1000; never natural evidence", syntheticChanges: ["homeworld.units:13 types=1e12", "completed weapons/shields/armour/hyperspace=1000"], ...branchEnvelope(performanceFixture) };
  const pressure = base(), observed = snapshots.get("scout-11")!;
  pressure.nextFleetId = 1151;
  pressure.messages = Array.from({ length: 150 }, (_, i) => ({ id: `scout-${1000 + i}`, at: Math.min(1e12, old.decimal.big(observed.observedAt).toNumber()), text: "\u0001".repeat(1000), npcScoutSnapshot: { ...structuredClone(observed), fleetId: 1000 + i } as NpcScoutSnapshotV1 }));
  branches.maxMessages = { classification: "EXPLICIT SYNTHETIC admitted150 typed-message escaped-text storage pressure; not whole-product maximum", syntheticChanges: ["150 typed messages IDs1000..1149", "nextFleetId1151", "each message1000 control characters"], ...branchEnvelope(pressure) };
  const eviction = deserializeState(importSave(milestones.find(row => row.name === "scout11-arrived-once")!.raw).state); eviction.messages = [...eviction.messages.filter(m => m.id === "scout-11"), ...Array.from({ length: 149 }, (_, i) => ({ id: `synthetic-filler-${i}`, at: 0, text: "Explicit synthetic FIFO filler", npcScoutSnapshot: null }))];
  branches.eviction = { classification: "EXPLICIT SYNTHETIC retained first observation plus149 ordinary fillers; real already-paid scout return must evict open observation", syntheticChanges: ["messages:FIFO150", "baseline:actual scout11-arrived-once; no economic changes"], ...branchEnvelope(eviction) };
  const curve = evaluatePrestige(state), oldCurve = old.logic.evaluatePrestige(control);
  const oldPrestige = await import(pathToFileURL(resolve(LEGACY, "src/ui/prestige-preview-model.ts")).href);
  const curveConfirmation = oldPrestige.prestigeConfirmation(control, oldCurve);
  exact("curvature exact native confirmation matches archived source", prestigeConfirmation(state, curve), curveConfirmation);
  exact("curvature earned gain matches archived source", curve.gain.toString(), oldCurve.gain.toString());
  if (curve.gain.gte(1)) {
    const expected = liftR13StateToR16(old.save.serializeState(oldCurve.next));
    expected.messages = expected.messages.map((m: Obj) => ({ ...m, ...(snapshots.has(m.id) ? { at: Math.min(1e12, old.decimal.big(snapshots.get(m.id)!.observedAt).toNumber()), npcScoutSnapshot: structuredClone(snapshots.get(m.id)) } : {}) }));
    exact("natural actual curvature preserves typed history and all old domains", serializeState(curve.next), expected);
    branches.curvature = { confirmation: curveConfirmation, classification: "Actual natural evaluatePrestige branch, no economy injection", before: branchEnvelope(state), expected: branchEnvelope(curve.next) };
  }
  check("synthetic branches never mutate natural main", isDeepStrictEqual(serializeState(state), naturalFinal));
} catch (error) { failure = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
const report = { schema: "infinity-scout-rehearsal-natural-route-v1", source, origin, key: STORAGE_KEY, target: TARGET, ships: SHIPS, publicSeeds: SEEDS,
  classification: "Exact genuine r13 paid31 final followed only by real paid scout, tick, stock-six-LF rehearsal, separate real attack, return and re-scout. UI Cancel/Reopen/Fill is native-suite evidence only. Synthetic edge branches begin after natural completion.",
  sourceTimePolicy: "Only newly typed-arrival at comes from canonical observedAt. All original old message numeric times/text are untouched. Explicit differences below, never a generic tolerance.",
  timeDistinctions, observations, naturalExamples, milestones, tape, branches, checks,
  outcome: { status: failure ? "failed" : "passed", mainComplete, elapsedSeconds: elapsed, checks: checks.length, failure },
  nativeAcceptance: "PENDING: CI-only independent native job and unchanged complete original job must both pass on same SHA" };
writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ status: report.outcome.status, output: OUTPUT, checks: checks.length, elapsedSeconds: elapsed, failure }) + "\n");
