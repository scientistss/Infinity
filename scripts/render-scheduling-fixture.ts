/** Anonymous moderate browser fixture and independent full-engine trace oracle.
 * Initial wallets/buildings/technologies/inventory are explicit synthetic setup.
 * Actual APIs create every paid job, plan, flight, template, formation and ticket.
 * No main, presentation or scheduler module participates in expected outcomes.
 */
declare const process: { stdout: { write(text: string): void } };
import { equipCard } from "../src/automation/engine";
import { catchUp } from "../src/core/offline";
import { grantRun, revealAll, revealRun } from "../src/game/arcade";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, sendFleet } from "../src/game/fleet";
import { createFormation } from "../src/game/formations";
import { scrape, tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { createResearchTemplate } from "../src/game/research-templates";
import { BACKUP_KEY, deserializeState, exportSave, importSave } from "../src/game/save";
import { orderUnits } from "../src/game/shipyard";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";

const epoch = 1_792_000_000_000;
const save = (state: GameState) => JSON.parse(exportSave(state, epoch));
const clone = (state: GameState): GameState => deserializeState(importSave(exportSave(state, epoch)).state);
const ok = (result: {state: GameState; ok: boolean; reason: string}): GameState => {
  if (!result.ok) throw Error(result.reason);
  return result.state;
};
function settle(name: string, state: GameState): GameState {
  const result = clone(tick(clone(tick(state, 0)), 0));
  const text = JSON.stringify(result);
  if (JSON.stringify(clone(result)) !== text || JSON.stringify(tick(result, 0)) !== text ||
      JSON.stringify(catchUp(result, 0).state) !== text) throw Error(`${name}: strict-reader/startup instability`);
  return result;
}
let base = createInitialState(20261010, 20261010);
const homeId = base.activePlanetId;
const colony = createPlanet("render-colony", {galaxy:3, system:51, position:8});
base.planets.push(colony);
Object.assign(base.research.levels, {astrophysics:4,computer_tech:8,combustion_drive:6,impulse_drive:4});
for (const [index, planet] of base.planets.entries()) {
  planet.name = index ? "匿名调度殖民地" : "匿名调度母星";
  planet.resources = {metal:big(100_000),crystal:big(100_000),deuterium:big(100_000)};
  Object.assign(planet.buildings, {robotics_factory:2,shipyard:2,research_lab:2,
    metal_storage:4,crystal_storage:4,deuterium_tank:4});
  planet.units.small_cargo = index ? 0 : 20;
  planet.units.large_cargo = index ? 3 : 0;
}
base.manualClicks = 100;
base.warpCores = big(10);
base.darkMatter = big(100_000);
base = settle("initial inventory", base);
base = equipCard(base, 0, "auto_collect").state;
base = ok(enqueue(base, "metal_storage", "manual"));
base = ok(enqueueResearch(base, "energy_tech", "manual"));
base = ok(orderUnits(base, "light_fighter", 2, "manual"));
base = ok(createOrderTask(base, {kind:"building",planetId:colony.id,building:"metal_mine",targetLevel:2,
  expectedNextTaskId:base.orders.nextTaskId,budget:{metal:"10000",crystal:"10000",deuterium:"10000"}}));
base = ok(sendFleet(base, {mission:"transport",target:{...colony.coordinates},ships:{small_cargo:1},cargo:emptyCargo(),speedPercent:10}));
base = ok(createFormation(base, {expectedNextFormationId:1,name:"调度可保留运输编成",ships:{small_cargo:25}}));
base = ok(createResearchTemplate(base, {name:"调度能源研究模板",goals:[{tech:"energy_tech",targetLevel:1}]},1));
base = settle("base",base);
let incoming = clone(base); activePlanet(incoming).name = "匿名替换母星"; incoming = settle("incoming",incoming);
let automatic = clone(base);
automatic.lifetime = {metal:big(1e10),crystal:big(0),deuterium:big(0)};
automatic = settle("automatic",equipCard(automatic,1,"auto_prestige").state);
// Advance through actual simulation to 50ms before the real paid research completes.
const remaining = base.research.queue[0]!.remainingSeconds;
if (!(remaining > .05)) throw Error("Expected nontrivial paid research duration");
const fresh = settle("fresh research",tick(clone(base),remaining-.05));
if (fresh.research.levels.energy_tech !== 0 || tick(clone(fresh),.06).research.levels.energy_tech !== 1) {
  throw Error("Fresh-context premise: actual research must complete on a skipped 60ms frame");
}
let ring = clone(base);
while (ring.arcade.runs.length) ring = ok(revealRun(ring,"manual"));
for (let n=0;n<3;n++) {
  const granted = grantRun(ring,"bonus");
  if (!granted.granted) throw Error("Real bonus ticket capacity premise");
  ring = granted.state;
}
ring = settle("ring",ring);
const locked = settle("locked",createInitialState(20261012,20261012));
let rollover = ok(enqueueResearch(clone(base), "energy_tech", "manual"));
rollover = settle("research rollover",tick(rollover,remaining-.05));
if (rollover.research.queue.length !== 2 || tick(clone(rollover),.06).research.queue.length !== 1) throw Error("Two real paid research heads must roll over on 60ms");
const variants = {base,incoming,automatic,fresh,rollover,ring,locked};
const expected: Record<string, unknown> = {};
function record(name: string, state: GameState): void {
  const exported = save(state); importSave(JSON.stringify(exported)); expected[name] = exported.state;
}
for (const [name,state] of Object.entries(variants)) record(`${name}.initial`,state);
const traces: Record<string,{atMs:number;action?:"scrape"}[]> = {};
for (const hz of [60,120]) {
  const trace = Array.from({length:hz*2},(_,n)=>({atMs:Math.round((n+1)*1000/hz)}));
  traces[`steady${hz}`] = trace;
  let current=clone(base),last=0;
  for (const step of trace) {current=tick(current,(step.atMs-last)/1000);last=step.atMs;}
  record(`steady${hz}`,current);
}
traces.actions = [{atMs:17},{atMs:33,action:"scrape"},{atMs:50},{atMs:101},{atMs:117,action:"scrape"},
  {atMs:1000},{atMs:2000},{atMs:2001},{atMs:7010},{atMs:7018},{atMs:7100}];
let actions=clone(base),last=0;
for (const step of traces.actions) {
  const seconds=(step.atMs-last)/1000;
  actions=seconds>=5?catchUp(actions,seconds).state:tick(actions,seconds);last=step.atMs;
  if (step.action === "scrape") actions=scrape(actions);
}
record("actions",actions);
record("hidden",tick(tick(clone(base),.04),.04));
record("fresh60",tick(clone(fresh),.06));
record("rollover60",tick(clone(rollover),.06));
// The first frame paints at 9,950ms; the launch occurs on the next 50ms frame,
// inside the normal 100ms paint interval. Full engine adoption must still retire authority.
let skippedAuto=clone(automatic);
for (let n=0;n<9;n++) skippedAuto=tick(skippedAuto,1);
skippedAuto=tick(skippedAuto,.95);skippedAuto=tick(skippedAuto,.05);
if (skippedAuto.stats.launches !== 1) throw Error("Skipped-paint automatic prestige premise");
record("automatic.skipped",skippedAuto);
record("ring.single",ok(revealRun(clone(ring),"manual")));
record("ring.all",ok(revealAll(clone(ring),"manual")));
record("ring.singleAll",ok(revealAll(ok(revealRun(clone(ring),"manual")),"manual")));
const ready=save(base);
process.stdout.write(JSON.stringify({
  description:"Anonymous moderate strict-reader-stable fixture. Explicit synthetic initial wallets, buildings, technologies, inventory, manual-click unlock and curvature balance; actual APIs create queues, tasks, flight, templates, formations and tickets. Independent complete-state expectations invoke unchanged production tick/catchUp/actions, with no main or presentation imports. Controlled browser clocks are not native timing evidence.",
  key:STORAGE_KEY,backupKey:BACKUP_KEY,epoch,homeId,colonyId:colony.id,traces,expected,ready,save:JSON.stringify(ready),
  ...Object.fromEntries(Object.entries(variants).map(([name,state])=>[name,save(state)])),
},null,2));
