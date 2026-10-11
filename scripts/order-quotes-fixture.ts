/** Anonymous synthetic quote acceptance. No player data or natural-growth claim. */
declare const process: { stdout: { write(text: string): void } };
import { catchUp } from "../src/core/offline";
import { unitById } from "../src/data/units";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { selectPlanet } from "../src/game/empire";
import { evaluatePrestige, tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { costFor, enqueue, cancel } from "../src/game/queue";
import type { OrderTarget } from "../src/game/order-state";
import { enqueueResearch, researchCostFor } from "../src/game/research";
import { deserializeState, exportSave, importSave } from "../src/game/save";
import { orderUnits, unitCost, unitSeconds } from "../src/game/shipyard";
import { createInitialState, createPlanet } from "../src/game/state";
import { RESOURCE_IDS, type GameState } from "../src/game/types";
import { buyCurvature } from "../src/prestige/tree";

const ok = (result: { state: GameState; ok: boolean; reason: string }): GameState => {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
};
const clone = (state: GameState): GameState => deserializeState(importSave(exportSave(state)).state);
function settle(name: string, state: GameState): GameState {
  const result = clone(tick(clone(tick(state, 0)), 0));
  const before = JSON.stringify(result);
  if (JSON.stringify(clone(result)) !== before || JSON.stringify(tick(result, 0)) !== before) {
    throw new Error(`${name}: strict full-state reader/startup drift`);
  }
  if (result.orders.tasks.length || result.orders.nextTaskId !== 1) throw new Error(`${name}: preauthorized order`);
  return result;
}
let base = createInitialState(20261010, 20261010);
const homeId = base.activePlanetId;
base.planets[0]!.name = "合成报价付款母星";
base.research.levels.astrophysics = 1;
base.research.levels.combustion_drive = 2;
const colony = createPlanet("quote-colony", { ...base.planets[0]!.coordinates,
  position: base.planets[0]!.coordinates.position === 9 ? 10 : 9 });
colony.name = "合成报价另一星球";
base.planets.push(colony);
for (const planet of base.planets) {
  // Explicit synthetic setup above warehouse caps, with production disabled.
  // Real queue APIs below create every paid job and existing ship.
  planet.resources = { metal: big(1_000_000), crystal: big(1_000_000), deuterium: big(1_000_000) };
  Object.assign(planet.buildings, { robotics_factory: 2, research_lab: 2, shipyard: 2, metal_mine: 1 });
  planet.productionPct = { metal_mine: 0, crystal_mine: 0, deuterium_synth: 0, solar_plant: 0, fusion_reactor: 0 };
}
base.warpCores = big(10);
base.lifetime = { metal: big(1e10), crystal: big(0), deuterium: big(0) };
base = tick(base, 0);
base = ok(orderUnits(base, "light_fighter", 7, "manual"));
base = settle("base", tick(base, unitSeconds(base, "light_fighter") * 7 + 1));
if (base.planets[0]!.units.light_fighter !== 7 || base.planets[0]!.shipyardQueue.length) throw new Error("Existing ships were not actually completed");

let manual = ok(enqueue(clone(base), "metal_mine", "manual"));
manual = ok(enqueueResearch(manual, "energy_tech", "manual"));
manual = settle("manual", ok(orderUnits(manual, "light_fighter", 3, "manual")));
const curved = settle("curved", buyCurvature(clone(base), "growth_cut"));
const variants = { base, manual, curved };

// Independent expected totals use the established production cost APIs, never
// the new quote helper. Paid levels are excluded; ships always mean additional.
function expected(state: GameState) {
  const planet = state.planets[0]!;
  const buildStart = planet.buildings.metal_mine + planet.buildQueue.filter(job => job.building === "metal_mine").length + 1;
  const researchStart = state.research.levels.energy_tech + state.research.queue.filter(job => job.tech === "energy_tech").length + 1;
  return {
    building: Object.fromEntries(RESOURCE_IDS.map(resource => [resource,
      Array.from({ length: Math.max(0, 4 - buildStart) }, (_, n) => costFor(state, "metal_mine", buildStart + n)[resource])
        .reduce((sum, value) => sum.add(value), big(0)).toString()])),
    research: Object.fromEntries(RESOURCE_IDS.map(resource => [resource,
      Array.from({ length: Math.max(0, 3 - researchStart) }, (_, n) => researchCostFor("energy_tech", researchStart + n)[resource])
        .reduce((sum, value) => sum.add(value), big(0)).toString()])),
    shipyard: Object.fromEntries(RESOURCE_IDS.map(resource => [resource, unitCost(unitById("light_fighter"))[resource].mul(5).toString()])),
  };
}
const expectedQuotes = Object.fromEntries(Object.entries(variants).map(([name, state]) => [name, expected(state)]));
const fixed = {
  base: { building: { metal: "225", crystal: "55", deuterium: "0" }, research: { metal: "0", crystal: "2400", deuterium: "1200" }, shipyard: { metal: "15000", crystal: "5000", deuterium: "0" } },
  manual: { building: { metal: "135", crystal: "33", deuterium: "0" }, research: { metal: "0", crystal: "1600", deuterium: "800" }, shipyard: { metal: "15000", crystal: "5000", deuterium: "0" } },
  curved: { building: { metal: "222", crystal: "55", deuterium: "0" }, research: { metal: "0", crystal: "2400", deuterium: "1200" }, shipyard: { metal: "15000", crystal: "5000", deuterium: "0" } },
};
if (JSON.stringify(expectedQuotes) !== JSON.stringify(fixed)) throw new Error(`Independent quote fixture changed: ${JSON.stringify(expectedQuotes)}`);
// Whole-state execution oracles use existing order/queue/tick APIs, never the
// new quote helper. Keep the original floating-wallet boundary, including dust.
function snapshot(state: GameState) {
  const file = JSON.parse(exportSave(state));
  importSave(JSON.stringify(file));
  const once = clone(state), twice = clone(once);
  if (JSON.stringify(once) !== JSON.stringify(twice)) throw new Error("Execution oracle strict-reader roundtrip drift");
  return file.state;
}
const targets: OrderTarget[] = [
  { kind: "building", planetId: homeId, building: "metal_mine", targetLevel: 3 },
  { kind: "research", planetId: homeId, tech: "energy_tech", targetLevel: 2 },
  { kind: "shipyard", planetId: homeId, unit: "light_fighter", quantity: 5 },
];
const execution = Object.fromEntries(targets.map(target => {
  const baseline = selectPlanet(clone(base), colony.id);
  const created = ok(createOrderTask(baseline, { ...target, expectedNextTaskId: baseline.orders.nextTaskId,
    budget: fixed.base[target.kind], transport: null }));
  // The browser's original frame routes these >=5-second controlled gaps through
  // catchUp (offline protocol cadence), and SaveSession reload uses catchUp(0).
  const paid = catchUp(created, 10).state;
  const reloadedPaid = catchUp(clone(paid), 0).state;
  // Observe each level's real payment without changing the total controlled gap.
  // Ships have one paid batch, so their original uninterrupted path is retained.
  const secondPaid = target.kind === "shipyard" ? null : catchUp(reloadedPaid, 10).state;
  const finished = catchUp(secondPaid ?? reloadedPaid, secondPaid ? 170 : 180).state;
  const later = catchUp(finished, 60).state;
  return [target.kind, Object.fromEntries(Object.entries({ baseline, created, paid, reloadedPaid,
    ...(secondPaid ? { secondPaid } : {}), finished, later })
    .map(([name, state]) => [name, snapshot(state)]))];
}));
const belowCreated = ok(createOrderTask(clone(base), { kind: "building", planetId: homeId, building: "metal_mine", targetLevel: 3,
  expectedNextTaskId: 1, budget: { metal: "100", crystal: "55", deuterium: "0" }, transport: null }));
const belowWaiting = catchUp(belowCreated, 180).state;
const belowQuote = { created: snapshot(belowCreated), waiting: snapshot(belowWaiting), later: snapshot(catchUp(belowWaiting, 60).state) };
const enqueued = ok(enqueue(clone(base), "metal_mine", "manual"));
const queueAba = { enqueued: snapshot(enqueued), cancelled: snapshot(ok(cancel(enqueued, 0))) };
// Preserve the lead's original independently run preflight as named evidence.
// Legacy BigNumber wallets have bounded representational dust; the order ledger
// and immutable job prices below remain exact, without tolerances or rounding.
const originalPaymentProbe = [
  { kind: "building", before: { metal: "978999.9999999999", crystal: "993000", deuterium: "1000000" }, after: { metal: "978910", crystal: "992977.9999999999", deuterium: "1000000" }, ledger: { metal: "90", crystal: "22", deuterium: "0" } },
  { kind: "research", before: { metal: "978999.9999999999", crystal: "993000", deuterium: "1000000" }, after: { metal: "978999.9999999999", crystal: "992200.0000000001", deuterium: "999600" }, ledger: { metal: "0", crystal: "800", deuterium: "400" } },
  { kind: "shipyard", before: { metal: "978999.9999999999", crystal: "993000", deuterium: "1000000" }, after: { metal: "964000", crystal: "988000.0000000001", deuterium: "1000000" }, ledger: { metal: "15000", crystal: "5000", deuterium: "0" } },
];
for (const probe of originalPaymentProbe) {
  const oracle = execution[probe.kind]!;
  const actual = { kind: probe.kind, before: oracle.baseline!.planets[0].resources,
    after: oracle.paid!.planets[0].resources, ledger: oracle.paid!.orders.tasks[0].charged };
  if (JSON.stringify(actual) !== JSON.stringify(probe)) throw new Error(`Original legacy-wallet payment boundary changed: ${probe.kind}`);
}
const prestige = evaluatePrestige(base);
if (prestige.next === base || !prestige.gain.gt(0)) throw new Error("Synthetic prestige source is ineligible");
importSave(exportSave(prestige.next));
process.stdout.write(JSON.stringify({
  description: "Anonymous synthetic pre-funded two-planet local-order quote acceptance. Initial buildings, research, wallets, cores and lifetime score are explicit setup. Seven existing ships and all manual paid jobs use real queue APIs. Strict initial readers/tick(0) are settled twice. Independent fixed costs and full-state execution, reload, each payment, completion, underbudget and enqueue/cancel oracles use established production APIs, never the quote helper. Controlled gaps are 10/10/170/60 seconds for building and research, and the original 10/180/60 for the single ship batch; both match main.frame's actual catchUp/offline route with equal total elapsed time. Reload matches SaveSession catchUp(0). Original 1e-10 legacy-wallet dust is preserved; exact ledgers have no tolerance. Controlled Date/performance/RAF are not natural play.",
  key: STORAGE_KEY, homeId, colonyId: colony.id, expectedQuotes, execution, belowQuote, queueAba,
  originalPaymentProbe, walletRepresentationBound: "0.000000001",
  ...Object.fromEntries(Object.entries(variants).map(([name, state]) => [name, JSON.parse(exportSave(state))])),
}, null, 2));
