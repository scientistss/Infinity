/** CI preparation only. Fresh immutable 241a natural report in; no browser evidence out.
 * node --import tsx scripts/manual-unit-native-fixture.ts REPORT SOURCE_BINDING SOURCE_SHA
 * Natural branches retain the complete unmodified handoff and use ordinary paid APIs
 * and one-second live ticks. Unlocked/boundary inputs are explicitly synthetic.
 * This module deliberately does not import the new manual-unit quote/controller.
 */
declare const process: { argv: string[]; version: string; stdout: { write(value: string): void } };
import { SAVE_VERSION, SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { UNIT_IDS, unitById, type UnitId } from "../src/data/units";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyCargo, sendFleet } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { canBuildUnits, orderUnits } from "../src/game/shipyard";
import type { GameState } from "../src/game/types";
const [{ readFileSync }, { createHash }, { execFileSync }] = await Promise.all([
  import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string),
]);
const OLD_SHA = "241a51de31364e9086abcc304884bf9df7cd6912";
const REPORT_SHA = "9102da6f8fc52427b642883389d186726a8cf0c02747aa6c135150566458d8ea";
const hash = (value: unknown): string => String(createHash("sha256").update(value).digest("hex"));
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exact = (a: unknown, b: unknown, label: string) => check(stable(a) === stable(b), label);
const [reportPath, sourceBindingPath, sourceSha] = process.argv.slice(2);
check(process.argv.length === 5 && /^[a-f0-9]{40}$/.test(sourceSha ?? ""), "Exact report, old-source binding and current SHA required");
const git = (...args: string[]): string => String(execFileSync("git", args, { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000 })).trimEnd();
check(git("rev-parse", "HEAD") === sourceSha && git("status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ".github", "package.json", "package-lock.json") === "", "Clean committed fixture source required");
const reportBytes = readFileSync(reportPath), bindingBytes = readFileSync(sourceBindingPath);
check(hash(reportBytes) === REPORT_SHA, "Fresh immutable natural report differs from the known deterministic 241a report");
const natural = JSON.parse(String(reportBytes)), sourceBinding = JSON.parse(String(bindingBytes));
check(sourceBinding.complete === true && sourceBinding.codeSourceSha === OLD_SHA, "Fresh immutable 241a producer source binding required");
check(natural.outcome.status === "passed" && natural.provenance.injectedGameState === false
  && natural.seeds.world === 20261010 && natural.seeds.arcade === 20261010, "Natural report provenance failed");
check(SAVE_VERSION === 9 && SAVE_REVISION === 14, "No save-format change authorized");
const m05 = natural.milestones.find((row: { name: string }) => row.name === "05-home-research-naturally-paid-and-completed");
const m09 = natural.milestones.find((row: { name: string }) => row.name === "09-home-manufacturing-colony-research");
check(m05 && m09, "Exact natural handoffs required");
for (const m of [m05, m09]) exact(importSave(JSON.stringify(m.save)), m.save, "Historical handoff changed during current strict import");
const epoch: number = m05.save.savedAt;
const load = (save = m05.save): GameState => deserializeState(importSave(JSON.stringify(save)).state);
const clone = (s: GameState): GameState => deserializeState(importSave(exportSave(s, epoch)).state);
const accepted = (r: { state: GameState; ok: boolean; reason: string }): GameState => { check(r.ok, r.reason); return r.state; };
// Independent catalog golden: literal design prices, never derived from new quote code.
const GOLDEN: Record<UnitId, readonly [number, number, number]> = {
  small_cargo: [2000,2000,0], large_cargo: [6000,6000,0], light_fighter: [3000,1000,0], heavy_fighter: [6000,4000,0],
  cruiser: [20000,7000,2000], battleship: [45000,15000,0], battlecruiser: [30000,40000,15000], bomber: [50000,25000,15000],
  destroyer: [60000,50000,15000], deathstar: [5000000,4000000,1000000], recycler: [10000,6000,2000], espionage_probe: [0,1000,0],
  solar_satellite: [0,2000,500], colony_ship: [10000,20000,10000], rocket_launcher: [2000,0,0], light_laser: [1500,500,0],
  heavy_laser: [6000,2000,0], gauss_cannon: [20000,15000,2000], ion_cannon: [2000,6000,0], plasma_turret: [50000,50000,30000],
  small_shield_dome: [10000,10000,0], large_shield_dome: [50000,50000,0], anti_ballistic_missile: [8000,0,2000], interplanetary_missile: [12500,2500,10000],
};
const RES = ["metal", "crystal", "deuterium"] as const;
function price(id: UnitId, count: number) { return Object.fromEntries(RES.map((r, i) => [r, String(BigInt(GOLDEN[id][i]!) * BigInt(count))])); }
function paid(s: GameState, id: UnitId, count: number): GameState {
  const before = serializeState(s), value = accepted(orderUnits(s, id, count, "manual"));
  const after = serializeState(value), p = activePlanet(value), job = p.shipyardQueue.at(-1)!;
  check(job.jobId === before.orders.nextJobId && value.orders.nextJobId === before.orders.nextJobId + 1
    && value.stats.manualActions === s.stats.manualActions + 1 && job.count === count && job.orderedCount === count
    && job.taskId === null && job.source === "manual", "One ordinary paid job must consume one ID and one manual action");
  exact(Object.fromEntries(RES.map(r => [r, job.paidPerUnit[r].toString()])), price(id, 1), "Literal per-unit quote changed");
  for (const r of RES) check(p.resources[r].toString() === activePlanet(s).resources[r].sub(price(id,count)[r]!).toString(), "Exact ordinary wallet debit changed");
  const expected = JSON.parse(JSON.stringify(before));
  const target = expected.planets.find((row: { id: string }) => row.id === s.activePlanetId);
  target.resources = after.planets.find(row => row.id === s.activePlanetId)!.resources;
  target.shipyardQueue.push(after.planets.find(row => row.id === s.activePlanetId)!.shipyardQueue.at(-1));
  expected.orders.nextJobId++; expected.stats.manualActions++;
  exact(after, expected, "Paid transaction modified an unrelated full-state field");
  return value;
}
for (const id of UNIT_IDS) exact(unitById(id).cost, Object.fromEntries(RES.map((r,i) => [r,GOLDEN[id][i]])), "Literal catalog golden drift: " + id);
type Tape = { kind: string; [key: string]: unknown };
let state = load(), elapsed = 0;
const naturalTickAudit: Array<Record<string,unknown>> = [];
const tape: Tape[] = [], expected: Record<string, ReturnType<typeof serializeState>> = {};
function checkpoint(name: string) { expected[name] = serializeState(state); tape.push({kind:"checkpoint",name}); }
function pay(mode: "count"|"fill"|"max", raw: string, count: number, name: string) {
  const before = serializeState(state); state = paid(state,"small_cargo",count);
  tape.push({kind:"pay",mode,raw,count,unit:"small_cargo",jobId:before.orders.nextJobId,total:price("small_cargo",count),name}); checkpoint(name);
}
checkpoint("natural05-original"); pay("count","1",1,"natural-count-one-paid");
while (activePlanet(state).units.small_cargo !== 1 || activePlanet(state).resources.crystal.lt(10000)) {
  check(elapsed < 180, "Natural funding route exceeded bounded live ticks");
  const before = serializeState(state); state = tick(state,1,"live"); elapsed++;
  naturalTickAudit.push({second:elapsed,api:"tick(state, 1, live)",before,after:serializeState(state)});
}
tape.push({kind:"advance",seconds:elapsed}); checkpoint("natural-one-completed-and-next-batches-funded");
pay("count","2",2,"natural-count-two-paid-pending");
let partialSeconds = 0;
while (activePlanet(state).units.small_cargo === 1) {
  check(partialSeconds < 30, "Natural partial completion must be bounded");
  const before = serializeState(state); state = tick(state,1,"live"); elapsed++; partialSeconds++;
  naturalTickAudit.push({second:elapsed,api:"tick(state, 1, live)",before,after:serializeState(state)});
}
tape.push({kind:"advance",seconds:partialSeconds}); checkpoint("natural-paid-two-now-one-remaining");
check(activePlanet(state).units.small_cargo === 2 && activePlanet(state).shipyardQueue.filter(j=>j.unit==="small_cargo").reduce((n,j)=>n+j.count,0)===1
  && activePlanet(state).shipyardQueue.find(j=>j.unit==="small_cargo")?.orderedCount===2,"Natural fill must count two completed plus one paid remaining, not original orderedCount two");
pay("fill","5",2,"natural-fill-five-adds-two");
const maxCount = Math.min(...RES.flatMap((r,i) => GOLDEN.small_cargo[i] ? [Math.floor(activePlanet(state).resources[r].toNumber()/GOLDEN.small_cargo[i]!)] : []));
check(maxCount >= 1 && maxCount < 10, "Bounded natural max count expected"); pay("max","NaN",maxCount,"natural-max-ignores-retained-raw");
const naturalFinal = exportSave(state,epoch+elapsed*1000);
// The second untouched natural handoff supplies two genuinely produced cargo ships.
let transit = load(m09.save); const colony = transit.planets.find(p=>p.id!=="homeworld")!;
const transitRequest = { mission:"transport" as const,target:colony.coordinates,ships:{small_cargo:2},cargo:emptyCargo(),speedPercent:100 };
const transitBefore = serializeState(transit); transit = accepted(sendFleet(transit,transitRequest));
check(activePlanet(transit).units.small_cargo === 0 && transit.fleets.some(f=>(f.ships.small_cargo??0)===2),"Real outbound cargo ships required");
const transitBeforePay = serializeState(transit), transitPaid = paid(transit,"small_cargo",1);
function syntheticBase(): GameState {
  const s = load(m09.save);
  for (const p of s.planets) { p.resources={metal:big(20000000),crystal:big(20000000),deuterium:big(20000000)};
    p.buildings.shipyard=12; p.buildings.missile_silo=4; p.buildings.nanite_factory=0; }
  for (const key of Object.keys(s.research.levels) as Array<keyof typeof s.research.levels>) s.research.levels[key]=20;
  return selectPlanet(s,"homeworld");
}
const synthetic: Record<string, { classification: string; raw: string; expected: ReturnType<typeof serializeState>; [key: string]: unknown }> = {};
function put(name: string, s: GameState, detail: string, extra: Record<string,unknown> = {}) {
  const raw=exportSave(s,epoch), restored=importSave(raw);
  exact(serializeState(deserializeState(restored.state)),restored.state,name+": strict synthetic roundtrip");
  synthetic[name]={classification:"EXPLICIT SYNTHETIC: "+detail,raw,expected:restored.state,...extra};
}
const unlocked=syntheticBase(); put("all-unlocked",unlocked,"20,000,000 each resource and completed prerequisite levels are setup grants; never natural.",{
  positive: Object.fromEntries(UNIT_IDS.map(id=>[id,{count:1,total:price(id,1),expected:serializeState(paid(clone(unlocked),id,1))}])),
  legalRaw:{raw:" 0002 ",count:2,total:price("small_cargo",2),expected:serializeState(paid(clone(unlocked),"small_cargo",2))} });
let full=clone(unlocked); for(let i=0;i<10;i++) full=paid(full,"small_cargo",1);
put("queue-full",full,"Explicit unlocked/funded setup, all ten queue slots paid via unchanged ordinary APIs.");
const poor=clone(unlocked); activePlanet(poor).resources={metal:big(0),crystal:big(0),deuterium:big(0)};
put("insufficient",poor,"All three wallets explicitly zero; not natural progression.");
for(const id of ["small_shield_dome","large_shield_dome"] as const) {
  const s=clone(unlocked); activePlanet(s).units[id]=1; put("owned-"+id,s,"One existing shield explicitly injected; one-per-world boundary.");
  put("queued-"+id,paid(clone(unlocked),id,1),"One real paid shield queue on explicitly funded setup.");
}
for(const slots of [39,40]) {
  const s=clone(unlocked); activePlanet(s).units.anti_ballistic_missile=slots;
  put("silo-"+slots,s,"Explicit level-four silo and "+slots+" owned one-slot missiles; edge capacity fixture.",
    slots===39?{abmExpected:serializeState(paid(clone(s),"anti_ballistic_missile",1))}:{});
}
const saturated=clone(unlocked); activePlanet(saturated).units.small_cargo=1000000000000000;
put("unit-cap",saturated,"Explicit local 10^15 unit count; no natural claim.");
let plan=clone(unlocked); plan=accepted(createOrderTask(plan,{kind:"shipyard",planetId:"homeworld",unit:"small_cargo",quantity:1000,
  budget:{metal:"2000000",crystal:"2000000",deuterium:"0"},expectedNextTaskId:plan.orders.nextTaskId,transport:null}));
let afterPlanTick = clone(plan), planAdvanceSeconds = 0;
const planTickAudit: Array<Record<string,unknown>> = [];
const planTaskId = plan.orders.nextTaskId-1;
while (afterPlanTick.orders.tasks.find(task=>task.id===planTaskId)?.activeJob === null) {
  check(planAdvanceSeconds < 12,"Real ten-second scheduler cadence must pay within twelve ordinary one-second steps");
  const before = serializeState(afterPlanTick); afterPlanTick = tick(afterPlanTick,1,"live"); planAdvanceSeconds++;
  planTickAudit.push({second:planAdvanceSeconds,api:"tick(state, 1, live)",before,after:serializeState(afterPlanTick)});
}
const paidPlanTask = afterPlanTick.orders.tasks.find(task=>task.id===planTaskId)!;
const paidPlanJob = activePlanet(afterPlanTick).shipyardQueue.find(job=>job.taskId===planTaskId)!;
check(planAdvanceSeconds===10 && paidPlanTask.id===14 && paidPlanJob?.jobId===87 && afterPlanTick.orders.nextJobId===88
  && paidPlanJob.count===1000 && paidPlanJob.orderedCount===1000 && paidPlanJob.source==="plan", "Literal first ten-second plan receipt/identity changed");
exact(paidPlanTask.charged,{metal:"2000000",crystal:"2000000",deuterium:"0"},"Independent literal scheduled-plan charge changed");
exact(Object.fromEntries(RES.map(r=>[r,paidPlanJob.paidPerUnit[r].toString()])),{metal:"2000",crystal:"2000",deuterium:"0"},"Scheduled plan literal unit quote changed");
const freshMax = Math.min(...RES.flatMap((r,i) => GOLDEN.small_cargo[i] ? [Math.floor(activePlanet(afterPlanTick).resources[r].toNumber()/GOLDEN.small_cargo[i]!)] : []));
const freshFill = 1500-activePlanet(afterPlanTick).units.small_cargo-activePlanet(afterPlanTick).shipyardQueue.filter(j=>j.unit==="small_cargo").reduce((sum,j)=>sum+j.count,0);
check(freshMax===9000 && freshFill===498,"Literal changed max/fill quotes must follow the real scheduled payment");
put("latest-plan",plan,"Explicit funded setup and real unpaid finite plan; ten ordinary one-second ticks reach its unchanged real scheduler cadence.",{
  advanceSeconds:planAdvanceSeconds,tickAudit:planTickAudit,afterTick:serializeState(afterPlanTick),fresh:{max:{raw:"17",count:freshMax,expected:serializeState(paid(afterPlanTick,"small_cargo",freshMax))},
    fill:{raw:"1500",count:freshFill,expected:serializeState(paid(afterPlanTick,"small_cargo",freshFill))}}});
const wide=clone(unlocked); activePlanet(wide).resources={metal:big("999999999999999"),crystal:big("999999999999999"),deuterium:big("999999999999999")};
put("full-price",wide,"Explicit large wallets solely for complete untruncated three-resource display.",{
  unit:"deathstar",count:1000000,total:price("deathstar",1000000),expectedPaid:serializeState(paid(clone(wide),"deathstar",1000000))});
check(canBuildUnits(unlocked,"solar_satellite",1).ok && unitById("solar_satellite").drives.length===0,"Solar satellite remains buildable and non-flying");
process.stdout.write(JSON.stringify({schema:"infinity-manual-unit-native-fixture-v1",key:STORAGE_KEY,
  source:{sourceSha,fullTree:git("rev-parse","HEAD^{tree}"),scriptSha256:hash(readFileSync(new URL(import.meta.url))),runtimeNode:process.version},
  historical:{sourceSha:OLD_SHA,reportSha256:REPORT_SHA,sourceBindingSha256:hash(bindingBytes),freshProducer:"Unchanged exact241a scripts/natural-growth-journey.ts, executed in this CI job"},
  base:m05.save,initialRaw:JSON.stringify(m05.save),natural:{classification:"Untouched fresh natural05 handoff; every later unit is paid; only one-second live funding/completion ticks.",tape,expected,elapsed,tickAudit:naturalTickAudit,progressionNote:"Actual paid continuation is 94 funding steps plus 2 partial-completion steps. Completing the first ship unlocks first_ship and raises natural production; this is a new paid continuation from the unchanged historical handoff, not the original historical action route.",finalRaw:naturalFinal},
  transit:{classification:"Untouched fresh natural09; real two-cargo transport launch; in-transit stock does not cover fill.",raw:JSON.stringify(m09.save),before:transitBefore,
    request:{mission:transitRequest.mission,target:transitRequest.target,ships:transitRequest.ships,cargo:{metal:"0",crystal:"0",deuterium:"0"},speedPercent:100},
    afterDispatch:transitBeforePay,expected:serializeState(transitPaid),total:price("small_cargo",1)},
  golden:GOLDEN,synthetic},null,2));
