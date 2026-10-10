/** Anonymous controlled fixtures; every paid job, design authorization and flight uses real APIs.
 * Synthetic prefunding, technology, initial inventory and selected RNG seeds are explicit setup.
 * No player data. Browser expectations are the actual shared prestige rule, not a second reset.
 */
declare const process: { stdout: { write(text: string): void } };
import { armAutoRunner, equipCard, refreshUnlocks } from "../src/automation/engine";
import { BOARD } from "../src/data/arcade";
import { grantRun, revealRun, setBet } from "../src/game/arcade";
import { PRESTIGE_SCORE_UNIT, STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { rollCharge } from "../src/game/deep-space";
import { selectPlanet } from "../src/game/empire";
import { emptyCargo, sendFleet } from "../src/game/fleet";
import { createFormation, createFormationReplenishment, editFormation, previewFormationReplenishment } from "../src/game/formations";
import { evaluatePrestige, expansionScore, scrape, tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { applyResearchTemplate, createResearchTemplate, quoteResearchTemplate } from "../src/game/research-templates";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { orderUnits, unitSeconds } from "../src/game/shipyard";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { prestigeConfirmation, prestigePreview } from "../src/ui/prestige-preview-model";

const ok = (result: {state: GameState; ok: boolean; reason: string}): GameState => {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
};
const clone = (state: GameState): GameState => deserializeState(importSave(exportSave(state)).state);
const serialized = (state: GameState) => JSON.parse(exportSave(state));
function settled(name: string, state: GameState): GameState {
  // Canonical readers can normalize display-only values. Settle those and real
  // startup achievements BEFORE establishing any whole-state expected snapshot.
  const result = clone(tick(clone(tick(state, 0)), 0));
  const before = JSON.stringify(result);
  if (JSON.stringify(clone(result)) !== before || JSON.stringify(tick(result, 0)) !== before) {
    throw new Error(`${name}: unsettled reader/startup fixture`);
  }
  return result;
}
function metalTicket(state: GameState): GameState {
  for (let seed = 1; seed < 100_000; seed++) {
    const grant = grantRun({...state, arcade: {...state.arcade, seed}}, "bonus");
    if (grant.granted && BOARD[grant.state.arcade.runs.at(-1)!.outcome.main.tile] === "metal") return grant.state;
  }
  throw new Error("No bounded synthetic metal-ticket seed");
}
let base = createInitialState(20261010, 20261010);
const HOME = base.activePlanetId;
const colony = createPlanet("prestige-colony", {galaxy:3,system:50,position:8});
base.planets.push(colony);
Object.assign(base.research.levels, {astrophysics:4,computer_tech:8,combustion_drive:6,impulse_drive:4,energy_tech:3});
for (const [index, planet] of base.planets.entries()) {
  planet.name = index ? "合成曲率殖民地" : "合成曲率旧母星";
  planet.resources = {metal:big(100_000),crystal:big(100_000),deuterium:big(100_000)};
  Object.assign(planet.buildings, {shipyard:2,robotics_factory:2,research_lab:2,metal_storage:4,crystal_storage:4,deuterium_tank:4});
  planet.productionPct = {...planet.productionPct,metal_mine:0,crystal_mine:0,deuterium_synth:0,solar_plant:0,fusion_reactor:0};
  planet.units.small_cargo = index ? 0 : 40;
  planet.units.light_fighter = index ? 0 : 3;
}
base.warpCores = big(10); base.curvature.seed_stock = 1;
base.lifetime = {metal:big(1e10),crystal:big(0),deuterium:big(0)};
base = tick(base, 0);
while (base.arcade.runs.length) base = ok(revealRun(base, "manual"));
while (base.arcade.stats.manualRuns < 10) base = ok(revealRun(metalTicket(base), "manual"));
base = refreshUnlocks(tick(base, 0));
// Re-establish explicit synthetic wallets after real reveal history; the snapshot
// below does not claim these balances were accumulated through natural play.
for (const planet of base.planets) planet.resources = {metal:big(100_000),crystal:big(100_000),deuterium:big(100_000)};
base = ok(createFormation(base, {expectedNextFormationId:1,name:"旧引用 <编成&🚀>",ships:{light_fighter:6}}));
base = ok(createFormation(base, {expectedNextFormationId:2,name:"可核对的独立运输设计",ships:{small_cargo:60}}));
base = ok(createResearchTemplate(base, {name:"保留研究意图",goals:[{tech:"energy_tech",targetLevel:4}]}, 1));
base = settled("base", base);

let rich = clone(base);
const formation = previewFormationReplenishment(rich, {formationId:1,formationRevision:1,planetId:colony.id});
if (!formation.ok || !formation.request) throw new Error("No real formation authorization");
rich = ok(createFormationReplenishment(rich, formation.request));
rich = ok(editFormation(rich, {formationId:1,expectedRevision:1,name:"已编辑的新版本",ships:{light_fighter:9}}));
rich = ok(orderUnits(rich, "light_fighter", 8, "manual"));
// A real transport request sees a price larger than the payer's remaining wallet.
// Its donor, finite ship/cargo limits and trip receipts are produced by the scheduler.
rich.planets[0]!.buildings.metal_mine = 19;
rich = ok(createOrderTask(rich, {kind:"building",planetId:HOME,building:"metal_mine",targetLevel:20,
  expectedNextTaskId:rich.orders.nextTaskId,budget:{metal:"300000",crystal:"100000",deuterium:"10000"},
  transport:{donorPlanetId:colony.id,ship:"small_cargo",count:20,speedPercent:10,maxTrips:2,
    grossCargoCap:{metal:"100000",crystal:"100000",deuterium:"0"}}}));
// Synthetic initial donor stock is stated above; a finite real transport owns it.
rich.planets[1]!.units.small_cargo = 20;
const template = quoteResearchTemplate(rich, 1, colony.id);
if (!template.ok || !template.totalQuote) throw new Error(template.reason);
rich = ok(applyResearchTemplate(rich, {templateId:1,expectedTemplateRevision:1,planetId:colony.id,
  expectedNextTaskId:template.nextTaskId,expectedReviewKey:template.reviewKey,
  budgets:template.rows.filter(row=>row.status === "new").map(row=>({tech:row.tech,budget:row.quote!}))}));
rich = tick(rich, 10 + unitSeconds(selectPlanet(rich,colony.id), "light_fighter") + .125);
const partial = rich.orders.tasks.find(task=>task.formationOrigin !== null && task.kind === "shipyard");
if (!partial || partial.kind !== "shipyard" || partial.completedUnits <= 0 || partial.completedUnits >= partial.quantity) throw new Error("Formation fixture is not actually partially built");
if (!rich.fleets.some(fleet=>fleet.orderTransport !== null)) throw new Error(`No actual owned transport in rich fixture: ${JSON.stringify(rich.orders.tasks.find(task=>task.transport !== null))}`);
rich = ok(enqueue(rich, "crystal_storage", "manual"));
rich = ok(enqueueResearch(rich, "combustion_drive", "manual"));
rich = ok(sendFleet(rich, {mission:"transport",target:{...colony.coordinates},ships:{small_cargo:1},
  cargo:{metal:big(37),crystal:big(11),deuterium:big(3)},speedPercent:10}));
rich = metalTicket(rich); rich = metalTicket(rich);
rich = equipCard(rich, 0, "auto_runner").state;
rich = ok(armAutoRunner(rich, 0, {planetId:HOME,count:2,maxDeuterium:"0"}));
rich.boosters = [{res:"metal",pct:20,until:rich.totalTime.toNumber()+3600}];
rich = settled("rich", rich);

let deepPending = clone(base);
deepPending = ok(setBet(deepPending, "metal", 1));
deepPending = ok(sendFleet(deepPending, {mission:"charge",target:{galaxy:3,system:50,position:16},
  ships:{small_cargo:5,light_fighter:2},cargo:emptyCargo(),speedPercent:10,holdSlots:1,chargeWithBets:true}));
deepPending = settled("deepPending", deepPending);
let deepReturning = tick(clone(deepPending), deepPending.fleets[0]!.duration);
const holding = deepReturning.fleets[0]!;
let rewardSeed = 0;
for (let seed = 1; seed < 20_000; seed++) {
  const trial = {...deepReturning,deepSpace:{...deepReturning.deepSpace,seed}};
  if (rollCharge(trial,holding).rawSymbol === "dark_matter") { rewardSeed = seed; break; }
}
if (!rewardSeed) throw new Error("No bounded synthetic deep reward seed");
deepReturning.deepSpace.seed = rewardSeed;
deepReturning = settled("deepReturning", tick(deepReturning, holding.remaining));
if (!(deepReturning.fleets[0]?.charge?.dm! > 0) || !deepReturning.fleets[0]!.returning) throw new Error("No true unsettled return reward");
const deepReturned = settled("deepReturned", tick(clone(deepReturning), deepReturning.fleets[0]!.remaining));

let fresh = clone(base);
fresh.lifetime = {metal:big(PRESTIGE_SCORE_UNIT).mul(4).sub(1),crystal:big(0),deuterium:big(0)};
fresh = settled("fresh", fresh);
const progressed = settled("progressed", scrape(clone(fresh)));
if (!evaluatePrestige(progressed).gain.gt(evaluatePrestige(fresh).gain)) throw new Error("Fresh-click fixture does not cross an actual gain boundary");
let below = clone(base); below.lifetime = {metal:big(0),crystal:big(0),deuterium:big(0)}; below = settled("below", below);
const automatic = settled("automatic", equipCard(clone(base),0,"auto_prestige").state);
let longAmounts = clone(base);
longAmounts.warpCores = big("1.23456789012345e200");
longAmounts.lifetime.metal = big("1.23456789012345e250");
for (const planet of longAmounts.planets) planet.resources = {metal:big("1.23456789012345e200"),crystal:big("9.87654321098765e150"),deuterium:big("5.55555555555555e100")};
longAmounts = settled("longAmounts", longAmounts);
const variants = {base,rich,deepPending,deepReturning,deepReturned,fresh,progressed,below,automatic,longAmounts};
const expected = Object.fromEntries(Object.entries(variants).map(([name,state])=>{
  const evaluation = evaluatePrestige(state);
  // Validate the exact candidate separately; do not canonicalize it before its
  // persisted comparison, which would hide a serializer/reader discrepancy.
  importSave(exportSave(evaluation.next));
  return [name,{candidate:serialized(evaluation.next),gain:evaluation.gain.toString(),score:expansionScore(state).toString(),
    preview:prestigePreview(state,evaluation),confirmation:prestigeConfirmation(state,evaluation)}];
}));
process.stdout.write(JSON.stringify({description:"Anonymous synthetic two-planet controlled-time acceptance. Real APIs create partial paid formation work and old revision origins, research-template plans, build/research/shipyard payments, owned finite transport, manual cargo fleet, ten manual ring reveals plus an armed batch, and separate real pending/returning/returned deep rewards selected by bounded saved seeds. Initial technology, wallets, inventory and lifetime score are explicit synthetic setup. All startup achievements and canonical readers settle before expected snapshots. Actual evaluatePrestige generates each candidate; no independent reset is implemented here.",
  key:STORAGE_KEY,homeId:HOME,colonyId:colony.id,colonyCoordinates:colony.coordinates,expected,
  ...Object.fromEntries(Object.entries(variants).map(([name,state])=>[name,serialized(state)]))},null,2));
