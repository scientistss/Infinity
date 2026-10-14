/** Native browser continuation oracles. No natural state is prefunded or patched.
 * node --import tsx scripts/terraformer-browser-fixture.ts REPORT REPORT_SHA256 > FIXTURE
 * Full-state expectations use production APIs; literal financial/field goldens are
 * independently asserted as well. Historical faults are separately classified.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void } };
import { expectedNpcEconomy, assertNpcEconomy, projectVerifiedNpcEconomy } from "./r16-compatibility.mjs";
import historical from "../tests/fixtures/terraformer-r9.json";
import { setProductionPct } from "../src/automation/engine";
import { catchUp } from "../src/core/offline";
import { createBuildingTemplate } from "../src/game/building-templates";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { speedUp } from "../src/game/dark-matter";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyTickLog, evaluatePrestige, prestige, tick } from "../src/game/logic";
import { cancelOrderTask, cancelPaidJob, pauseOrderTask } from "../src/game/orders";
import { usedFields } from "../src/game/planet";
import { canEnqueue, enqueue } from "../src/game/queue";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import { prestigeConfirmation, prestigePreview } from "../src/ui/prestige-preview-model";
const [{ readFileSync }, { createHash }] = await Promise.all([import("node:fs" as string), import("node:crypto" as string)]);
const bytes = readFileSync(process.argv[2] ?? "natural-terraformer-report.json");
const hash = String(createHash("sha256").update(bytes).digest("hex"));
function check(value: unknown, reason: string): asserts value { if (!value) throw Error(reason); }
check(/^[a-f0-9]{64}$/.test(process.argv[3] ?? "") && hash === process.argv[3], "Independently supplied natural report hash mismatch");
const report = JSON.parse(String(bytes));
check(report.schema === "infinity-natural-terraformer-journey-v1" && report.outcome.status === "passed" && report.provenance.injectedGameState === false, "Natural continuation report did not pass without injections");
check(report.origin.sourceSha === "53325263ddbd654b8e8b9511ec62b944fa955233" && report.origin.reportSha256 === "f331fa2e81d9fbfa2e1d86eaf710a824d8d66e6c5b738646b26c098eea97e826", "Immutable natural origin changed");
const names = { template: "10-paid-terra2-cancelled-exact-refund-no-new-grant", ready: "04-before-new-payment-nanite1-energy12-real1980-supply-and-wallet-ready", waiting: "08-terra2-finite-plan-waiting-at1980-no-charge-no-job", colony: "13-actual-colony-local-nanite1-solar14-and-transport-funded-wallet", curvature: "16-before-curvature-real-expansions-and-unpaid-paused-authority" };
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exact = (a: unknown, b: unknown, label: string) => check(stable(a) === stable(b), label);
const milestones = Object.fromEntries(Object.entries(names).map(([key, name]) => {
  const rows = report.milestones.filter((row: { name: string }) => row.name === name);
  check(rows.length === 1 && rows[0].strictRoundtrips === 2 && rows[0].stateAdoptedFromReload && rows[0].subsequentLiveTickObserved, `${name}: incomplete natural handoff`);
  return [key, rows[0]];
}));
const EPOCH = milestones.ready.save.savedAt;
const HOME = "homeworld", COLONY = "colony-1";
const clone = (state: GameState): GameState => deserializeState(importSave(exportSave(state, EPOCH)).state);
const saved = (state: GameState) => JSON.parse(exportSave(state, EPOCH));
const load = (key: keyof typeof names) => {
  const source = milestones[key].save;
  check(source.version === 9 && source.revision === 16 && source.savedAt === source.lastTickAt, `${key}: current zero-gap save required`);
  const state = deserializeState(importSave(JSON.stringify(source)).state);
  assertNpcEconomy(state, expectedNpcEconomy(milestones[key].npcAdoptedSegmentsSeconds), `${key}: counted natural continuation NPC age`);
  exact(serializeState(state), source.state, `${key}: strict import changes natural game state`);
  exact(serializeState(catchUp(clone(state), 0).state), source.state, `${key}: zero-gap startup changes natural state`);
  return state;
};
const expected: Record<string, ReturnType<typeof serializeState>> = {};
const put = (name: string, state: GameState) => { expected[name] = serializeState(state); importSave(exportSave(state, EPOCH)); return state; };
function accepted<T extends { ok: boolean; state: GameState; reason: string }>(result: T): GameState { check(result.ok, result.reason); return result.state; }
const first = load("ready"), home = activePlanet(first);
check(home.id === HOME && home.buildings.nanite_factory === 1 && first.research.levels.energy_tech === 12 && home.buildings.terraformer === 0 && home.fieldsMax === 163 && home.terraformerFields.grantedLevels === 0 && economy(first).supply === 1980, "Ready milestone lost literal natural prerequisites");
const GOLD = { first: { metal: "0", crystal: "50000", deuterium: "100000" }, second: { metal: "0", crystal: "100000", deuterium: "200000" }, firstEnergy: 1000, secondEnergy: 2000, firstSeconds: 1.5584415584415583, secondSeconds: 3.636363636363636 };
function provePaid(before: GameState, after: GameState, id: string, level: 1 | 2) {
  const a = before.planets.find(p => p.id === id)!, b = after.planets.find(p => p.id === id)!;
  const job = b.buildQueue.at(-1)!;
  check(job.building === "terraformer" && job.targetLevel === level && job.jobId === before.orders.nextJobId && job.jobId >= after.terraformerGrantJobFloor, "Real new payment identity changed");
  const price = level === 1 ? GOLD.first : GOLD.second;
  for (const res of ["metal", "crystal", "deuterium"] as const) {
    check(job.paid[res].toString() === price[res] && b.resources[res].eq(a.resources[res].sub(price[res])), `Independent ${res} payment golden failed`);
  }
  check(b.fieldsMax === a.fieldsMax && b.buildings.terraformer === a.buildings.terraformer && b.terraformerFields.grantedLevels === a.terraformerFields.grantedLevels, "Payment granted early fields");
  check(Math.abs(job.totalSeconds - (level === 1 ? GOLD.firstSeconds : GOLD.secondSeconds)) < 1e-12, "Independent paid duration golden failed");
  return job.jobId;
}
function proveGrant(before: GameState, after: GameState, id: string) {
  for (const old of before.planets) {
    const now = after.planets.find(p => p.id === old.id)!;
    const delta = old.id === id ? 1 : 0;
    check(now.fieldsMax === old.fieldsMax + delta * 5 && now.terraformerFields.grantedLevels === old.terraformerFields.grantedLevels + delta && now.buildings.terraformer === old.buildings.terraformer + delta, "Independent per-planet +5/level/grant golden failed");
    check(usedFields(now) === usedFields(old) + delta && now.fieldsMax - usedFields(now) === old.fieldsMax - usedFields(old) + delta * 4, "Independent used+1/free+4 golden failed");
  }
}
put("firstBaseline", first);
let state = put("firstPaid", accepted(enqueue(clone(first), "terraformer", "manual")));
const firstJob = provePaid(first, state, HOME, 1);
state = put("firstOneSecond", tick(state, 1)); check(activePlanet(state).buildQueue[0]?.jobId === firstJob, "Live reload must occur during actual payment");
state = put("firstReloadedPaid", catchUp(clone(state), 0).state);
const firstLog = emptyTickLog(); state = put("firstCompleted", tick(state, 1, "live", firstLog)); proveGrant(first, state, HOME);
check(firstLog.completedBuilds.some(job => job.building === "terraformer"), "Real completion log omitted terraformer");
state = put("firstReloadedCompleted", catchUp(clone(state), 0).state);
state = put("firstLater", tick(state, 1)); proveGrant(first, state, HOME);
const beforeOrdinary = state;
state = put("ordinaryPaid", accepted(enqueue(state, "metal_storage", "manual")));
let ordinarySeconds = 0;
while (activePlanet(state).buildQueue.length) { check(++ordinarySeconds <= 60, "Unexpected ordinary building duration"); state = tick(state, 1); }
put("ordinaryCompleted", state);
check(activePlanet(state).fieldsMax === 168 && activePlanet(state).terraformerFields.grantedLevels === 1 && usedFields(activePlanet(state)) === usedFields(activePlanet(beforeOrdinary)) + 1, "Ordinary follow-on building field accounting failed");
// Debit-only DM fault is separate from the natural successful route.
const dmFault = clone(deserializeState(expected.firstPaid)); dmFault.darkMatter = big(0);
const dmResult = speedUp(dmFault, "build", "finish"); check(!dmResult.ok, "DM-zero synthetic fault unexpectedly completes"); exact(serializeState(dmResult.state), serializeState(dmFault), "Failed DM completion mutates paid state");
put("dmFailure", dmFault);
state = put("waitingBaseline", load("waiting"));
const waitingTask = state.orders.tasks.find(task => task.kind === "building" && task.building === "terraformer" && task.status === "running" && task.activeJob === null)!;
check(waitingTask && economy(state).supply === 1980 && !canEnqueue(state, "terraformer").ok, "Natural waiting plan is not underpowered");
state = put("waitingOneSecond", tick(state, 1));
check(state.orders.nextJobId === expected.waitingBaseline!.orders.nextJobId && activePlanet(state).buildQueue.length === 0, "Underpowered real plan paid");
state = put("waitingRestoredSupply", setProductionPct(state, "solar_plant", 100));
state = put("waitingSelectedColony", selectPlanet(state, COLONY));
let planSeconds = 0;
while (!state.planets.find(p => p.id === HOME)!.buildQueue.length) { check(++planSeconds <= 10, "Restored-supply plan failed to pay"); state = tick(state, 1); }
put("planPaid", state);
const planJob = state.planets.find(p => p.id === HOME)!.buildQueue[0]!;
check(planJob.building === "terraformer" && planJob.targetLevel === 2 && planJob.taskId === waitingTask.id && planJob.source === "plan" && state.activePlanetId === COLONY, "Actual plan charged wrong owner");
for (const res of ["metal", "crystal", "deuterium"] as const) check(planJob.paid[res].toString() === GOLD.second[res], "Second-level literal cost changed");
state = put("planPaused", accepted(pauseOrderTask(state, waitingTask.id)));
state = put("planSelectedHome", selectPlanet(state, HOME));
const beforeCancel = state;
state = put("planRefunded", accepted(cancelPaidJob(state, { kind: "building", planetId: HOME, jobId: planJob.jobId })));
for (const old of beforeCancel.planets) for (const res of ["metal", "crystal", "deuterium"] as const) check(state.planets.find(p => p.id === old.id)!.resources[res].eq(old.resources[res].add(old.id === HOME ? planJob.paid[res] : 0)), "Real paid cancellation refunds wrong wallet");
check(activePlanet(state).fieldsMax === 168 && activePlanet(state).terraformerFields.grantedLevels === 1, "Cancellation awarded fields");
state = put("planCancelled", accepted(cancelOrderTask(state, waitingTask.id)));
const secondBaseline = state;
state = put("secondPaid", accepted(enqueue(state, "terraformer", "manual"))); provePaid(secondBaseline, state, HOME, 2);
state = put("secondSelectedColony", selectPlanet(state, COLONY));
for (let i = 0; i < 4; i++) state = tick(state, 1);
put("secondCompleted", state); proveGrant(secondBaseline, state, HOME);
state = put("colonyBaseline", load("colony")); const colonyBaseline = state;
check(state.activePlanetId === COLONY, "Colony milestone selected wrong payer");
state = put("colonyPaid", accepted(enqueue(state, "terraformer", "manual"))); const colonyJob = provePaid(colonyBaseline, state, COLONY, 1);
state = put("colonySelectedHome", selectPlanet(state, HOME));
state = tick(state, 1); state = put("colonyCompleted", tick(state, 1)); proveGrant(colonyBaseline, state, COLONY);
state = put("colonyReloaded", catchUp(clone(state), 0).state);
state = put("curvatureBaseline", load("curvature"));
const evaluation = evaluatePrestige(state), preview = prestigePreview(state, evaluation), confirmation = prestigeConfirmation(state, evaluation);
check(preview.eligible && preview.worlds.count === 2, "Natural curvature not eligible");
const curvatureBefore = state;
const retiredTask = state.orders.tasks.find(task => task.kind === "building" && task.building === "terraformer" && task.status === "paused")!;
check(retiredTask, "Curvature milestone lacks old unpaid authority");
state = put("curvatureReset", prestige(state)); exact(serializeState(evaluation.next), serializeState(state), "Curvature candidate mismatch");
check(state.planets.length === 1 && activePlanet(state).fieldsMax === 163 && activePlanet(state).buildings.terraformer === 0 && activePlanet(state).terraformerFields.grantedLevels === 0 && state.terraformerGrantJobFloor === curvatureBefore.orders.nextJobId && state.orders.tasks.find(task => task.id === retiredTask.id)?.status === "cancelled", "Old curvature authority survived");
put("curvatureLater", tick(state, 1));
state = put("templateBaseline", load("template"));
state = put("templateSelectedHome", selectPlanet(state, HOME));
check(activePlanet(state).buildings.terraformer === 1 && activePlanet(state).productionPct.solar_plant === 100 && activePlanet(state).buildQueue.length === 0 && !state.orders.tasks.some(task => task.kind === "building" && task.building === "terraformer" && (task.status === "running" || task.status === "paused")), "Natural template handoff lacks a settled level-one home");
const templateId = state.buildingTemplates.nextTemplateId;
const templateName = "地形二级能源核对";
state = put("templateCreated", accepted(createBuildingTemplate(state, { name: templateName, goals: [{ building: "terraformer", targetLevel: 2 }] }, templateId)));
state = put("templateSolarOff", setProductionPct(state, "solar_plant", 0));
check(economy(state).supply === 1980, "Natural template low-energy checkpoint changed");
state = put("templateSolarRestored", setProductionPct(state, "solar_plant", 100));
exact(expected.templateCreated, expected.templateSolarRestored, "Template energy roundtrip changes anything beyond restored production setting");
const legacy: Record<string, unknown> = {};
for (const name of ["continuous_manual", "full10000_plan"] as const) {
  const row = historical.rows.find(row => row.name === name)!;
  check(row && row.synthetic && row.canonical && createHash("sha256").update(row.raw).digest("hex") === row.rawSha256, "Historical native raw hash mismatch");
  exact(JSON.parse(row.raw), row.oldReaderOutput, "Canonical historical serializer/reader mismatch");
  const migrated = importSave(row.raw), initial = deserializeState(migrated.state);
  const projected = projectVerifiedNpcEconomy(migrated.state,expectedNpcEconomy(),"pure historical r9 migration has no retrospective NPC production or rights");
  delete projected.terraformerGrantJobFloor;
  for (const planet of projected.planets) {
    check(Object.hasOwn(planet, "demolition") && planet.demolition === null, "Historical r9 migration may add only null demolition");
    delete planet.demolition; delete planet.terraformerFields;
  }
  exact(projected, row.oldReaderOutput.state, "Historical whole-state migration is not additive");
  check(initial.terraformerGrantJobFloor === initial.orders.nextJobId && initial.planets.every(p => p.terraformerFields.base === p.fieldsMax && p.terraformerFields.grantedLevels === 0), "Historical r11 floor/ledger are not additive zero grants");
  let current = catchUp(clone(initial), 0).state;
  put(`legacy-${name}-migrated`, current);
  const levels: number[] = [];
  for (let second = 0; second < 5; second++) { current = tick(current, 1); levels.push(activePlanet(current).buildings.terraformer); }
  put(`legacy-${name}-firstCompleted`, current);
  check(activePlanet(current).buildings.terraformer === 3 && activePlanet(current).fieldsMax === activePlanet(initial).fieldsMax && activePlanet(current).terraformerFields.grantedLevels === 0, "Historical paid upgrade changed fields");
  let remainingSeconds = 0;
  while (activePlanet(current).buildQueue.length) { check(++remainingSeconds <= 1000, "Historical continuous queue did not finish"); current = tick(current, 1); }
  put(`legacy-${name}-completed`, current);
  check(activePlanet(current).buildings.terraformer === (name === "continuous_manual" ? 4 : 3) && activePlanet(current).fieldsMax === (name === "full10000_plan" ? 10000 : 163) && activePlanet(current).terraformerFields.grantedLevels === 0, "Historical final level/field golden changed");
  legacy[name] = { row, initialSave: migrated, firstSeconds: 5, remainingSeconds, levels };
}
process.stdout.write(JSON.stringify({ description: "Five unchanged natural milestone handoffs, not continuous human play. Date/performance/RAF are simulated, economy/timers are unchanged. Native browser pays/completes/cancels through real UI. Separate synthetic legacy and DM-zero faults are never natural evidence.", key: STORAGE_KEY, epoch: EPOCH, homeId: HOME, colonyId: COLONY, source: { reportSha256: hash, sourceSha: report.source.sourceSha, gitHead: report.source.gitHead, sourceScopeStatusPorcelain: report.source.sourceScopeStatusPorcelain, worktreeStatusPorcelain: report.source.worktreeStatusPorcelain, origin: report.origin, provenance: report.provenance }, naturalMilestones: milestones, base: milestones.ready.save, golden: GOLD, execution: { templateId, templateName, firstJob, colonyJob, planJob: planJob.jobId, taskId: waitingTask.id, retiredTaskId: retiredTask.id, planSeconds, ordinarySeconds, firstLog, confirmation, preview }, dmFault: saved(dmFault), legacy: { sourceSha: historical.sourceSha, cases: legacy }, expected }, null, 2) + "\n");
