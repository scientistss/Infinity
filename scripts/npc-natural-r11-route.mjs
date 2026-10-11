/** Bounded natural NPC acceptance: immutable r10 → actual ca5 r11 export → r12 age0.
 * Every real action/tick has a byte-pinned ca5 control and independent money/stock goldens.
 * Preparation can be dirty; formal fixture rejects it. No native browser claim here.
 * node --import tsx scripts/npc-natural-r11-route.mjs --legacy-root CA5 --output NEW.json
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { activePlanet, selectPlanet } from "../src/game/empire.ts";
import { enqueueResearch } from "../src/game/research.ts";
import { orderUnits } from "../src/game/shipyard.ts";
import { emptyTickLog, tick, evaluatePrestige, prestige } from "../src/game/logic.ts";
import { emptyCargo, quoteFlight, resolveFleetArrivals, sendFleet } from "../src/game/fleet.ts";
import { npcAt } from "../src/game/galaxy.ts";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save.ts";
import { npcEconomySnapshot } from "../src/game/npc-economy.ts";
import { SaveSession } from "../src/game/save-session.ts";
import { STORAGE_KEY } from "../src/game/content.ts";
import { createInitialState } from "../src/game/state.ts";
import { prestigeConfirmation } from "../src/ui/prestige-preview-model.ts";
import { NPC_SCOUT_UI_SELECTION } from "./npc-scout-ui-selection.ts";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const INPUT = resolve(REPO, "tests/fixtures/demolition-origin-r10-save.json");
const PIN = "ca5ef0c769856f2c4c8925e76a5c7d322822fe1b";
const INPUT_SHA = "d456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a";
const args = new Map();
for (let i=2;i<process.argv.length;i+=2) {
    const k=process.argv[i], v=process.argv[i+1];
    if (!["--output", "--legacy-root"].includes(k) || !v || args.has(k)) throw Error("Usage: --legacy-root EXACT_CA5_CHECKOUT --output NEW_REPORT.json");
    args.set(k,v);
}
if(args.size!==2) throw Error("Both --legacy-root and --output are required");
const LEGACY = realpathSync(args.get("--legacy-root"));
const REPORT = resolve(args.get("--output"));
// Fail before simulation, and create exclusively afterward: output is never input.
const outputParent = realpathSync(dirname(REPORT));
const realOutput = resolve(outputParent, basename(REPORT));
const outputScope = relative(realpathSync(REPO), realOutput).split(/[\\/]/)[0];
if (existsSync(REPORT) || ["src", "tests", "scripts", "docs", "public", ".github", ".git"].includes(outputScope)) {
    throw new Error("Report output must be a new file outside protected repository source paths");
}
const RES = ["metal", "crystal", "deuterium"];
const GOLD = Object.freeze({
    sourceGameSeconds: 25810, researchMetal: 1600, researchDeuterium: 2400,
    researchSeconds: 1, probeCrystal: 1000, probeSeconds: .24,
    distance: 1025, probeSpeed: 130000000, legSeconds: 1, fuelEachDispatch: 4,
    capacity: 7, firstFleetId: 4, secondFleetId: 5, researchJobId: 202, probeJobId: 203,
    firstArrivalElapsed: 3, secondArrivalElapsed: 65, finalElapsed: 66,
    npcId: "npc-1:56:6", npcName: "晨星共同体 56-6", npcFaction: "晨星共同体",
});
const BUDGET = { wallSeconds: 300, simulationSeconds: 120, ticks: 130, actions: 10 };
const started = performance.now();
const startedAt = new Date().toISOString();
const checks = [];
const actions = [], ticks = [], checkpoints = [], milestones = [];
let legacy, control, r11Raw, legacyIdentityRaw, branches = {};
let stage = "source validation", elapsed = 0, actionCount = 0;
let state;
let origin;
let originalAt = 0;
let firstReport = null;
const produced = { metal: 0, crystal: 0, deuterium: 0 };
const spent = { metal: 0, crystal: 0, deuterium: 0 };
const sha = (data) => createHash("sha256").update(data).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", timeout: 10000 }).trim();
function check(name, valid) {
    checks.push({ name, passed: valid });
    if (!valid)
        throw new Error(name);
}
function budget() {
    check(`${stage}: bounded execution`, (performance.now() - started) / 1000 < BUDGET.wallSeconds && elapsed <= BUDGET.simulationSeconds && ticks.length <= BUDGET.ticks && actionCount <= BUDGET.actions);
}
function equal(name, actual, expected) {
    check(name, isDeepStrictEqual(actual, expected));
}
function near(name, actual, expected) {
    // Frozen before execution, inherited scale from the existing engineering evidence.
    check(name, Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-7 + Math.abs(expected) * 2e-14);
}
function wallet(s) {
    return Object.fromEntries(s.planets.map(p => [p.id, Object.fromEntries(RES.map(r => [r, p.resources[r].toNumber()]))]));
}
function keyOrderChanges(a, b, path = "$") {
    if (!a || typeof a !== "object")
        return [];
    if (Array.isArray(a))
        return a.flatMap((value, index) => keyOrderChanges(value, b[index], `${path}[${index}]`));
    const keys = Object.keys(a), otherKeys = Object.keys(b);
    const own = isDeepStrictEqual(keys, otherKeys) ? [] : [{ path, firstExportKeys: keys, canonicalExportKeys: otherKeys }];
    return [...own, ...keys.flatMap(key => keyOrderChanges(a[key], b[key], `${path}.${key}`))];
}
function withReferenceKeyOrder(reference, value) {
    if (!reference || typeof reference !== "object")
        return value;
    if (Array.isArray(reference))
        return reference.map((item, index) => withReferenceKeyOrder(item, value[index]));
    return Object.fromEntries(Object.keys(reference).map(key => [key, withReferenceKeyOrder(reference[key], value[key])]));
}
function invariant() {
    const now = serializeState(state);
    equal(`${stage}: bounded NPC age counts only adopted current-version seconds`, now.npcEconomy, { model: "fixed-production-v1", elapsedSeconds: elapsed });
    const projected=structuredClone(now); delete projected.npcEconomy;
    const old=legacy.save.serializeState(control);
    projected.messages=projected.messages.map(message=>/^scout-[45]$/.test(message.id) ? {...message,text:old.messages.find(x=>x.id===message.id)?.text} : message);
    equal(`${stage}: every legacy field matches exact ca5 action/tick control`,projected,old);
    const readBefore=serializeState(state), observed=npcEconomySnapshot(state.npcEconomy);
    equal(`${stage}: independent fixed NPC stock formula`,observed.resources,{metal:Math.min(50000,500+5*elapsed),crystal:Math.min(30000,250+2.5*elapsed),deuterium:Math.min(10000,elapsed)});
    equal(`${stage}: NPC observation is pure`,serializeState(state),readBefore);
    equal(`${stage}: existing plans and authorization unchanged`, now.orders.tasks, origin.orders.tasks);
    equal(`${stage}: original reports retained verbatim`, now.messages.slice(0, origin.messages.length), origin.messages);
    equal(`${stage}: random worlds and unrevealed ring outcomes unchanged`, [now.arcade, now.deepSpace], [origin.arcade, origin.deepSpace]);
    equal(`${stage}: no external reward/core/item/booster/unlock changes`, [now.darkMatter, now.warpCores, now.items, now.boosters, now.curvature, now.unlocked], [origin.darkMatter, origin.warpCores, origin.items, origin.boosters, origin.curvature, origin.unlocked]);
    for (const p of now.planets) {
        const old = origin.planets.find((x) => x.id === p.id);
        equal(`${stage}: ${p.id} fixed buildings/ratios/terraformer`, [p.buildings, p.productionPct, p.terraformerFields, p.fieldsMax], [old.buildings, old.productionPct, old.terraformerFields, old.fieldsMax]);
    }
    near(`${stage}: total game time`, state.totalTime.toNumber(), GOLD.sourceGameSeconds + elapsed);
    if (firstReport)
        equal(`${stage}: first scout remains a frozen identity snapshot`, state.messages.find(m => m.id === "scout-4"), firstReport);
}
function checkpoint(name) {
    stage = name;
    const before = serializeState(state);
    const at = originalAt + elapsed * 1000;
    const raw = exportSave(state, at, at);
    const loaded = importSave(raw);
    equal(`${name}: strict reader preserves full state`, loaded.state, before);
    state = deserializeState(loaded.state);
    equal(`${name}: adopted reload preserves every state field`, serializeState(state), before);
    const canonical = exportSave(state, at, at);
    equal(`${name}: restoring only original key order restores first export bytes`, JSON.stringify(withReferenceKeyOrder(JSON.parse(raw), JSON.parse(canonical)), null, 2), raw);
    equal(`${name}: whole envelope values strictly stable despite possible key order`, JSON.parse(canonical), JSON.parse(raw));
    state = deserializeState(importSave(canonical).state);
    equal(`${name}: second strict roundtrip preserves every state field`, serializeState(state), before);
    equal(`${name}: canonical same-time export bytes stable on second roundtrip`, exportSave(state, at, at), canonical);
    checkpoints.push({ name, elapsedSeconds: elapsed, totalGameSeconds: state.totalTime.toString(), firstExportSha256: sha(raw), canonicalSaveSha256: sha(canonical), firstExportBytes: Buffer.byteLength(raw), canonicalSaveBytes: Buffer.byteLength(canonical), firstRoundtripChangedOnlyObjectKeyOrder: raw !== canonical, objectKeyOrderChanges: keyOrderChanges(JSON.parse(raw), JSON.parse(canonical)), sameEnvelopeValues: true, revision: loaded.revision, fullStateRoundtrip: true, adoptedReload: true, rawPayloadCopied: false });
    const save=JSON.parse(canonical);
    milestones.push({name,elapsedSeconds:elapsed,strictRoundtrips:2,stateAdoptedFromReload:true,save,raw:canonical,rawSha256:sha(canonical)});
    invariant();
}
function payment(name, execute, expected, oldExecute) {
    stage = name;
    actionCount += 1;
    budget();
    const before = wallet(state), priorLifetime = RES.map(r => state.lifetime[r].toString()), previousTime = state.totalTime.toString();
    const result = execute();
    check(`${name}: accepted through real API: ${result.reason}`, result.ok);
    state = result.state;
    const oldResult=oldExecute(); check(`${name}: ca5 control accepts same paid action`,oldResult.ok); control=oldResult.state;
    const after = wallet(state);
    for (const p of state.planets)
        for (const r of RES) {
            const debit = p.id === "homeworld" ? expected[r] : 0;
            near(`${name}: ${p.id}/${r} payment source`, after[p.id][r], before[p.id][r] - debit);
        }
    equal(`${name}: payment never counts as lifetime production`, RES.map(r => state.lifetime[r].toString()), priorLifetime);
    equal(`${name}: action does not assign simulation time`, state.totalTime.toString(), previousTime);
    for (const r of RES)
        spent[r] += expected[r];
    actions.push({ name, elapsedSeconds: elapsed, jobId: result.jobId, fleetId: result.fleetId, expectedDebit: expected, before, after });
    invariant();
    return result;
}
function independentRates(p) {
    // Literal frozen r10 rule math. Never imports economy, storageCaps, or quote as its oracle.
    const b = p.buildings;
    const growth = (n) => n * Math.pow(1.1, n);
    const supply = 20 * growth(b.solar_plant) + Math.max(0, Math.floor((p.tempMax + 140) / 6)) * p.units.solar_satellite;
    const demand = 10 * growth(b.metal_mine) + 10 * growth(b.crystal_mine) + 20 * growth(b.deuterium_synth);
    const efficiency = demand > 0 ? Math.min(1, supply / demand) : 1;
    const metalPosition = p.id === "homeworld" ? 1 : p.coordinates.position === 10 ? 1.17 : NaN;
    const rate = {
        metal: (30 + 30 * growth(b.metal_mine) * efficiency * metalPosition) / 6 * 1.15,
        crystal: (15 + 20 * growth(b.crystal_mine) * efficiency) / 6 * 1.15,
        deuterium: 10 * growth(b.deuterium_synth) * (1.44 - .004 * p.tempMax) * efficiency / 6 * 1.15,
    };
    const cap = (level) => 5000 * Math.floor(2.5 * Math.exp(20 * level / 33));
    return { rate, caps: { metal: cap(b.metal_storage), crystal: cap(b.crystal_storage), deuterium: cap(b.deuterium_tank) } };
}
function advance(seconds, name) {
    stage = name;
    budget();
    const before = wallet(state), oldLifetime = Object.fromEntries(RES.map(r => [r, state.lifetime[r].toNumber()]));
    const expected = {}, output = { metal: 0, crystal: 0, deuterium: 0 };
    for (const p of state.planets) {
        const { rate, caps } = independentRates(p);
        expected[p.id] = {};
        for (const r of RES) {
            const gained = Math.max(0, Math.min(caps[r] - before[p.id][r], rate[r] * seconds));
            output[r] += gained;
            expected[p.id][r] = before[p.id][r] + gained;
        }
    }
    const previous = serializeState(state), log = emptyTickLog();
    const sourceState = state;
    state = tick(state, seconds, "live", log);
    control = legacy.logic.tick(control, seconds, "live");
    elapsed += seconds;
    equal(`${name}: original tick input immutable`, serializeState(sourceState), previous);
    const after = wallet(state);
    for (const p of state.planets)
        for (const r of RES)
            near(`${name}: ${p.id}/${r} independent capped production`, after[p.id][r], expected[p.id][r]);
    for (const r of RES) {
        near(`${name}: ${r} only actual production enters lifetime`, state.lifetime[r].toNumber(), oldLifetime[r] + output[r]);
        produced[r] += output[r];
    }
    ticks.push({ name, seconds, elapsedSeconds: elapsed, before, after, independentActualProduction: output, completedResearch: log.completedResearch, completedUnits: log.completedUnits });
    invariant();
    budget();
    return log;
}
const target = { galaxy: 1, system: 56, position: 6 };
// Match the real UI request before quote/send, including all legal zero inputs.
// sendFleet and the strict reader preserve these keys; never normalize results.
const request = () => ({ mission: "scout", target, ships: { ...NPC_SCOUT_UI_SELECTION }, cargo: emptyCargo(), speedPercent: 100 });
function dispatch(name, expectedId) {
    const before = serializeState(state), quote = quoteFlight(state, request());
    check(`${name}: real quote accepted`, quote.ok);
    equal(`${name}: literal duration/fuel/capacity golden`, [quote.duration, quote.fuel.toNumber(), quote.capacity.toNumber()], [GOLD.legSeconds, GOLD.fuelEachDispatch, GOLD.capacity]);
    equal(`${name}: quoting is pure`, serializeState(state), before);
    check(`${name}: no early identity report`, !state.messages.some(m => m.id === `scout-${expectedId}`));
    const result = payment(name, () => sendFleet(state, request()), { metal: 0, crystal: 0, deuterium: GOLD.fuelEachDispatch }, () => legacy.fleet.sendFleet(control, request()));
    equal(`${name}: real fleet ID`, result.fleetId, expectedId);
    const fleet = state.fleets.find(f => f.id === expectedId);
    equal(`${name}: real locked outbound and empty cargo`, [fleet.duration, fleet.remaining, fleet.returning, fleet.elapsed, fleet.ships, RES.map(r => fleet.cargo[r].toString())], [1, 1, false, 0, NPC_SCOUT_UI_SELECTION, ["0", "0", "0"]]);
    equal(`${name}: exactly one probe and twelve legal zero selections`, [Object.keys(fleet.ships).length, Object.values(fleet.ships).reduce((sum, count) => sum + count, 0), Object.values(fleet.ships).filter(count => count === 0).length, fleet.ships.espionage_probe], [13, 1, 12, 1]);
    equal(`${name}: probe removed from home availability`, activePlanet(state).units.espionage_probe, 0);
}
function arrival(id, observedElapsed) {
    const message = state.messages.find(m => m.id === `scout-${id}`);
    check(`arrival-${id}: exactly one static identity message`, state.messages.filter(m => m.id === `scout-${id}`).length === 1);
    const expectedText = `侦察报告 [1:56:6]：晨星共同体 56-6（NPC npc-1:56:6；派系：晨星共同体）。抵达时快照（数值保留3位小数）：游戏时间 ${(25810 + observedElapsed).toFixed(3)} 秒；经济年龄 ${observedElapsed.toFixed(3)} 秒。金属 ${(500 + 5 * observedElapsed).toFixed(3)}/50000.000，固定产量 5.000/秒，生产中；晶体 ${(250 + 2.5 * observedElapsed).toFixed(3)}/30000.000，固定产量 2.500/秒，生产中；重氢 ${observedElapsed.toFixed(3)}/10000.000，固定产量 1.000/秒，生产中。历史快照不会随时间更新。`;
    equal(`arrival-${id}: full frozen independent snapshot text`,message?.text,expectedText);
    check(`arrival-${id}: stock snapshot is at adopted arrival age`,state.npcEconomy.elapsedSeconds===observedElapsed);
    equal(`arrival-${id}: actual global timestamp`, message.at, GOLD.sourceGameSeconds + observedElapsed);
    equal(`arrival-${id}: existing return leg retained`, state.fleets.filter(f => f.id === id).map(f => [f.returning, f.remaining, f.elapsed]), [[true, 1, 0]]);
    equal(`arrival-${id}: repeated arrival resolution is idempotent`, serializeState(resolveFleetArrivals(state)), serializeState(state));
    return structuredClone(message);
}
let failure = null;
let source = null;
try {
    const raw = readFileSync(INPUT);
    check("input exact original 35551 bytes and independently supplied digest", raw.length === 35551 && sha(raw) === INPUT_SHA);
    const actualGitHead = git("rev-parse", "HEAD");
    const sourceScopeStatusPorcelain=git("status","--porcelain=v1","--untracked-files=all","--","src","scripts","tests","public",":(glob)*.json",":(glob)*.ts",":(glob)*.mjs","index.html",".github");
    const oldGit=(...args)=>execFileSync("git",args,{cwd:LEGACY,encoding:"utf8",timeout:10000}).trim();
    equal("historical producer is exact pinned ca5 revision11",oldGit("rev-parse","HEAD"),PIN);
    equal("historical production and dependencies have no tracked changes",oldGit("diff","HEAD","--","src","package.json","package-lock.json"),"");
    equal("historical src has no extra source files",oldGit("ls-files","--others","--","src"),"");
    const sourcePaths=oldGit("ls-tree","-r","--name-only",PIN,"--","src").split("\n").filter(Boolean);
    const historicalFiles=sourcePaths.map(path=>{
      const bytes=readFileSync(resolve(LEGACY,path));
      check(`actual historical imported bytes equal ca5:${path}`,bytes.equals(execFileSync("git",["show",`${PIN}:${path}`],{cwd:LEGACY,timeout:10000})));
      return {path,sha256:sha(bytes)};
    });
    for(const path of ["package.json","package-lock.json"])check(`historical ${path} exact`,readFileSync(resolve(LEGACY,path)).equals(execFileSync("git",["show",`${PIN}:${path}`],{cwd:LEGACY,timeout:10000})));
    legacy=Object.fromEntries(await Promise.all(["save","logic","empire","research","shipyard","fleet"].map(async name=>[name,await import(pathToFileURL(resolve(LEGACY,`src/game/${name}.ts`)).href)])));
    equal("candidate src has no ignored extra modules",git("ls-files","--others","--ignored","--exclude-standard","--","src"),"");
    const actualFiles=git("ls-files","--cached","--others","--exclude-standard","--","src").split("\n").filter(Boolean).map(path=>({path,sha256:sha(readFileSync(resolve(REPO,path)))}));
    source = { sourceSha:actualGitHead, gitHead:actualGitHead, worktreeStatusPorcelain:git("status","--porcelain=v1","--untracked-files=all"), sourceScopeStatusPorcelain,
      scriptSha256:sha(readFileSync(fileURLToPath(import.meta.url))), sourceFiles:actualFiles, runtimeNode:process.version,
      packageSha256:sha(readFileSync(resolve(REPO,"package.json"))),lockSha256:sha(readFileSync(resolve(REPO,"package-lock.json"))),
      historicalProducer:{sourceSha:PIN,srcTree:oldGit("rev-parse","HEAD:src"),sourceFiles:historicalFiles,lockSha256:sha(readFileSync(resolve(LEGACY,"package-lock.json"))),sourceScopeStatusPorcelain:oldGit("status","--porcelain=v1","--untracked-files=all","--","src","package.json","package-lock.json")},
      sourceBinding:"Preparation may be dirty and is labeled. Formal fixture requires an exact clean candidate commit. Historical producer is byte-pinned ca5 and never the current serializer with revision edited."};
    const envelope = JSON.parse(raw.toString("utf8"));
    equal("original schema/version/revision retained", [envelope.schema, envelope.version, envelope.revision], ["infinity-original-p4", 9, 10]);
    const oldImported=legacy.save.importSave(raw.toString("utf8"));
    const migratedProjection=structuredClone(oldImported.state);
    for(const p of migratedProjection.planets){check("ca5 adds explicit empty demolition only",p.demolition===null);delete p.demolition;}
    equal("actual ca5 r10 reader preserves every old field",migratedProjection,envelope.state);
    r11Raw=legacy.save.exportSave(legacy.save.deserializeState(oldImported.state),envelope.savedAt,envelope.lastTickAt);
    const r11=JSON.parse(r11Raw);
    equal("actual ca5 exporter produces v9/r11",[r11.schema,r11.version,r11.revision],["infinity-original-p4",9,11]);
    equal("actual ca5 export preserves original clocks",[r11.savedAt,r11.lastTickAt],[envelope.savedAt,envelope.lastTickAt]);
    check("actual ca5 r11 has no NPC state",!("npcEconomy" in r11.state));
    const imported = importSave(r11Raw), projected=structuredClone(imported.state); delete projected.npcEconomy;
    equal("r11→r12 pure migration preserves every complete old state field",projected,r11.state);
    equal("r11→r12 initial NPC age is zero regardless of old totalTime",imported.state.npcEconomy,{model:"fixed-production-v1",elapsedSeconds:0});
    equal("current strict import revision",imported.revision,12);
    control=legacy.save.deserializeState(r11.state);
    state = deserializeState(imported.state);
    origin = serializeState(state);
    originalAt = envelope.lastTickAt;
    equal("fixed starting capability gap", [state.totalTime.toNumber(), state.research.levels.combustion_drive, state.research.levels.espionage_tech, state.planets.length], [25810, 2, 4, 2]);
    check("production oracle scope: no new multiplier/cap/consumption changes", state.unlocked.length === 15 && state.warpCores.eq(0) && state.curvature.output_double === 0 && state.research.levels.plasma_tech === 0 && !state.boosters.length && state.planets.every(p => p.buildings.fusion_reactor === 0 && Object.values(p.productionPct).every(v => v === 100) && !p.buildQueue.length));
    checkpoint("origin-migrated-r11-age-zero");
    state = selectPlanet(state, "homeworld");
    control = legacy.empire.selectPlanet(control,"homeworld");
    stage = "select home through original API";
    invariant(); checkpoint("selected-home");
    const beforeRejected = serializeState(state), refused = orderUnits(state, "espionage_probe", 1, "manual");
    check("probe genuinely blocked before combustion 3", !refused.ok && refused.reason.includes("燃烧引擎"));
    equal("failed probe order has no state effect", serializeState(refused.state), beforeRejected);
    const research = payment("real-combustion-2-to-3-payment", () => enqueueResearch(state, "combustion_drive", "manual"), { metal: 1600, crystal: 0, deuterium: 2400 }, () => legacy.research.enqueueResearch(control,"combustion_drive","manual"));
    equal("real research stable job ID", research.jobId, 202);
    equal("research locks independent literal duration", [state.research.queue[0].totalSeconds, state.research.queue[0].remainingSeconds], [1, 1]);
    checkpoint("research-paid-unfinished");
    advance(1, "real-research-completion");
    equal("combustion only becomes 3 after real tick", state.research.levels.combustion_drive, 3); checkpoint("research-complete");
    const probe = payment("real-probe-payment", () => orderUnits(state, "espionage_probe", 1, "manual"), { metal: 0, crystal: 1000, deuterium: 0 }, () => legacy.shipyard.orderUnits(control,"espionage_probe",1,"manual"));
    equal("real probe stable job ID", probe.jobId, 203);
    checkpoint("probe-paid-unfinished");
    const units = advance(1, "real-probe-completion");
    check("probe actually built by shipyard tick", activePlanet(state).units.espionage_probe === 1 && units.completedUnits.some(x => x.unit === "espionage_probe" && x.count === 1));
    checkpoint("probe-complete");
    equal("original npcAt confirms independent coordinate-hash golden", npcAt(state, target), { name: GOLD.npcName, faction: GOLD.npcFaction, id: GOLD.npcId });
    dispatch("first-real-scout", 4);
    checkpoint("first-scout-outbound");
    advance(1, "first-scout-arrival");
    firstReport = arrival(4, 3);
    checkpoint("first-snapshot-returning");
    advance(1, "first-scout-return");
    check("first probe returns once", activePlanet(state).units.espionage_probe === 1 && state.fleets.length === 0);
    checkpoint("first-probe-returned");
    for (let i = 0; i < 60; i++)
        advance(1, `ordinary-wait-${i + 1}`);
    checkpoint("ordinary-wait-complete");
    dispatch("second-real-scout", 5); checkpoint("second-scout-outbound");
    advance(.5, "second-scout-midflight");
    const uninterrupted = state;
    checkpoint("second-scout-halfway-native-free-strict-reload");
    const expectedUninterrupted = tick(uninterrupted, .5, "live");
    advance(.5, "second-scout-arrival-after-adopted-reload");
    equal("midflight reload equals uninterrupted full-state control", serializeState(state), serializeState(expectedUninterrupted));
    arrival(5, 65);
    checkpoint("second-snapshot-returning");
    advance(1, "second-scout-return");
    check("same real probe safely returns twice", activePlanet(state).units.espionage_probe === 1 && state.fleets.length === 0);
    checkpoint("final-returned-and-reloaded");
    equal("all real debits match literal aggregate", spent, { metal: 1600, crystal: 1000, deuterium: 2408 });
    const finalWallet = wallet(state);
    for (const r of RES) {
        const originalTotal = origin.planets.reduce((n, p) => n + Number(p.resources[r]), 0);
        const finalTotal = Object.values(finalWallet).reduce((n, p) => n + p[r], 0);
        near(`final conservation ${r}: original + real production - research/probe/fuel`, finalTotal, originalTotal + produced[r] - spent[r]);
    }
    equal("two true snapshots have distinct actual arrival time and new stock", state.messages.filter(m => m.id.startsWith("scout-")).map(m => [m.id, m.at, m.text === firstReport.text]), [["scout-4", 25813, true], ["scout-5", 25875, false]]);
    check("input original bytes still intact", sha(readFileSync(INPUT)) === INPUT_SHA);
    check("runtime source unchanged from recorded bytes", source.sourceFiles.every((file) => sha(readFileSync(resolve(REPO, file.path))) === file.sha256));

    check("candidate package and lock unchanged during execution",sha(readFileSync(resolve(REPO,"package.json")))===source.packageSha256 && sha(readFileSync(resolve(REPO,"package-lock.json")))===source.lockSha256);
    check("actual HEAD unchanged during execution", git("rev-parse", "HEAD") === source.gitHead);
    for(const file of source.historicalProducer.sourceFiles)check("historical source unchanged: "+file.path,sha(readFileSync(resolve(LEGACY,file.path)))===file.sha256);
    legacyIdentityRaw=legacy.save.exportSave(control,originalAt+elapsed*1000,originalAt+elapsed*1000);
    const oldIdentity=importSave(legacyIdentityRaw);
    equal("separate real ca5 identity-report branch migrates without rewriting either report",oldIdentity.state.messages,legacy.save.serializeState(control).messages);
    equal("separate old identity branch starts age zero",oldIdentity.state.npcEconomy,{model:"fixed-production-v1",elapsedSeconds:0});
    const final=milestones.find(m=>m.name==="final-returned-and-reloaded");
    const evaluation=evaluatePrestige(state);check("real naturally earned curvature eligibility",evaluation.next!==state && evaluation.gain.gte(1));
    const curved=prestige(state);
    equal("real curvature retains NPC universe age and stock",[curved.universe,curved.npcEconomy,npcEconomySnapshot(curved.npcEconomy)],[state.universe,state.npcEconomy,npcEconomySnapshot(state.npcEconomy)]);
    equal("real curvature preserves frozen reports",curved.messages,state.messages);
    const keep=new Map([[STORAGE_KEY,final.raw]]);
    const store={getItem:k=>keep.get(k)??null,setItem:(k,v)=>keep.set(k,v),removeItem:k=>keep.delete(k)};
    const nextAt=final.save.lastTickAt+100000*1000;
    const offline=new SaveSession(store,nextAt);
    check("true SaveSession adopts only base offline limit",offline.mode==="ready" && offline.loaded.appliedSeconds===7200);
    equal("offline NPC age is actual adopted 66+7200",offline.loaded.state.npcEconomy,{model:"fixed-production-v1",elapsedSeconds:7266});
    check("save actual offline adopted watermark",offline.save(offline.loaded.state,nextAt,nextAt).ok);
    const adoptedRaw=keep.get(STORAGE_KEY), resumed=new SaveSession(store,nextAt);
    equal("second true startup applies zero elapsed",resumed.loaded.appliedSeconds,0);
    equal("second true startup preserves every offline-adopted field",serializeState(resumed.loaded.state),serializeState(offline.loaded.state));
    check("same-time second startup leaves saved bytes intact",keep.get(STORAGE_KEY)===adoptedRaw);
    equal("offline old snapshots remain frozen",offline.loaded.state.messages,state.messages);
    const fresh=createInitialState(20261010,11334455);
    equal("complete new game starts new NPC age zero",fresh.npcEconomy,{model:"fixed-production-v1",elapsedSeconds:0});
    equal("complete new game carries no old reports",fresh.messages,[]);
    branches={classification:"Branches from real serialized milestones, not added to the continuous 66-second route. Memory key-value adapter here is domain evidence only; CI uses native Storage.",
      legacyIdentity:{raw:legacyIdentityRaw,rawSha256:sha(legacyIdentityRaw),save:JSON.parse(legacyIdentityRaw),migratedSave:oldIdentity,sourceSha:PIN,classification:"Same original r10 starting state; exact old ca5 paid research/probe/scout control produced these genuine pre-NPC reports."},
      curvature:{base:final.save,confirmation:prestigeConfirmation(state,evaluation),expected:JSON.parse(exportSave(curved,final.save.savedAt,final.save.lastTickAt))},
      offline:{base:final.save,baseRaw:final.raw,rawGapSeconds:100000,appliedSeconds:7200,now:nextAt,expected:JSON.parse(adoptedRaw),sameTimeReloadApplied:resumed.loaded.appliedSeconds},
      newGame:{expectedNpcEconomy:fresh.npcEconomy}};
    equal("bounded natural game time", elapsed, 66);
}
catch (error) {
    failure = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).split(REPO).join("<repository>").split(REPORT).join("<report>");
    process.exitCode = 1;
}
const finalState = state ? serializeState(state) : null;
const originalBytesUnchangedAfterRun = (() => {
    try {
        return sha(readFileSync(INPUT)) === INPUT_SHA;
    }
    catch {
        return null;
    }
})();
const report = {
    schema:"infinity-npc-natural-r11-route-v1",source,
    origin:{sourceSha:PIN,originalSourceSha:"ac3cce98403bea1e7162bcb4092e4cfeeb448a9a",originalSaveRaw:readFileSync(INPUT,"utf8"),originalSaveSha256:INPUT_SHA,originalSaveBytes:35551,
      reportSha256:null,r11Raw:r11Raw??null,r11Sha256:r11Raw?sha(r11Raw):null,r11Save:r11Raw?JSON.parse(r11Raw):null,
      classification:"Unedited ac3/r10 bytes passed through actual isolated ca5/r11 reader and exporter at original clocks, no simulated tick. No revision retagging."},
    provenance:{originalBytesUnchanged:originalBytesUnchangedAfterRun,injectedGameState:false,noWalletTechnologyShipClockInjection:true,
      exactHistoricalControl:true,timeAdvance:"Only ordinary positive live ticks. Save metadata uses original lastTickAt plus counted adopted elapsed; no gameplay clock assignment.",
      independentOracle:"Frozen literal research/probe/fuel costs, fixed NPC arithmetic and explicit player production formula. Full legacy field projection matches byte-pinned ca5 control.",
      walletTolerance:"absolute <= 1e-7 + abs(expected)*2e-14, frozen before execution; no tolerance for snapshots, IDs, timers or whole-state equality"},
    limits:BUDGET,timing:{startedAt,wallElapsedSeconds:(performance.now()-started)/1000,adoptedContinuationGameSeconds:elapsed},
    literalGoldens:GOLD,checks,actions,ticks,checkpoints,milestones,branches,
    outcome:{status:failure?"failed":"passed",failure,lastStage:stage,checksPassed:checks.filter(x=>x.passed).length,checksFailed:checks.filter(x=>!x.passed).length,
      realDebits:spent,independentlyAccountedActualProduction:produced,totalGameSeconds:finalState?.totalTime??null,scoutReports:state?state.messages.filter(m=>m.id.startsWith("scout-")):[],
      finalProbeCount:state?activePlanet(state).units.espionage_probe:null,nextFleetId:state?.nextFleetId??null,finalStateSha256:finalState?sha(JSON.stringify(finalState)):null,
      boundary:"Compressed domain continuation and memory-store SaveSession branches only. Native HTTP/UI/file/dialog/storage/reload/viewport evidence requires separate CI execution."}
};
writeFileSync(REPORT,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({status:report.outcome.status,failure,checksPassed:report.outcome.checksPassed,gameSeconds:elapsed,hostSeconds:report.timing.wallElapsedSeconds,report:relative(REPO,REPORT).startsWith("..")?"<external-report>":relative(REPO,REPORT)}));
