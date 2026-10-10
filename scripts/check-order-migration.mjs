/** Compare migrations of real preceding serializers and paid-queue primitives.
 * Inputs are synthetic, pre-funded states; this is not natural player progression.
 * Usage: node --import tsx scripts/check-order-migration.mjs r2-root r3-root r4-root r5-root r6-root r7-root r8-root
 */
import { assertR8StatePreserved } from "./r8-compatibility.mjs";
import { createLegacyR8Fixtures } from "./legacy-r8-fixture.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { importSave } from "../src/game/save.ts";
import { createLegacyR6Fixtures } from "./legacy-r6-fixture.ts";
import { createLegacyR7Fixtures } from "./legacy-r7-fixture.ts";

const roots = process.argv.slice(2);
if (roots.length !== 7) throw Error("Provide verified source directories for r2, r3, r4, r5, r6, r7 and r8");
function priorProjection(state, revision) {
  const s = structuredClone(state);
  if (Object.hasOwn(s, "buildingTemplates")) { assert.deepEqual(s.buildingTemplates, {nextTemplateId:1,templates:[]}); delete s.buildingTemplates; }
  delete s.researchTemplates;
  delete s.formations;
  for (const task of s.orders?.tasks ?? []) delete task.formationOrigin;
  for (const fleet of s.fleets ?? []) delete fleet.orderTransport;
  if (revision < 5) {
    delete s.orders;
    for (const planet of s.planets) {
      for (const job of planet.buildQueue) { delete job.jobId; delete job.taskId; }
      for (const job of planet.shipyardQueue) {
        delete job.jobId; delete job.taskId; delete job.orderedCount; delete job.paidPerUnit;
      }
    }
    for (const job of s.research.queue) { delete job.jobId; delete job.taskId; }
  } else {
    delete s.orders.nextWorkId;
    for (const task of s.orders.tasks) { delete task.transport; delete task.currentWork; }
  }
  if (revision < 4) {
    delete s.arcade.nextRunId; delete s.arcade.autoBatch;
    for (const ticket of s.arcade.runs) delete ticket.id;
  }
  if (revision === 2) delete s.deepSpace;
  return s;
}
const reports = [];
for (let index = 0; index < 4; index++) {
  const revision = index + 2;
  const load = file => import(pathToFileURL(resolve(roots[index], `src/game/${file}.ts`)).href);
  const [factory, save, queue, research, yard, logic, decimal] = await Promise.all(
    ["state", "save", "queue", "research", "shipyard", "logic", "decimal"].map(load));
  let state = factory.createInitialState(20261010 + revision);
  state.arcade.seed = 20261010 + revision;
  const planet = state.planets.find(p => p.id === state.activePlanetId);
  planet.name = `Synthetic r${revision} payer`;
  Object.assign(planet.buildings, {metal_mine:5,crystal_mine:3,solar_plant:8,robotics_factory:1,research_lab:4,shipyard:3});
  planet.resources = {metal:decimal.big(2e6),crystal:decimal.big(1e6),deuterium:decimal.big(3e5)};
  Object.assign(state.research.levels, {combustion_drive:2,energy_tech:3,astrophysics:1,computer_tech:2});
  state = logic.tick(state, 0); // Settle genuine one-time achievements before snapshots.
  for (const [label, result] of [
    ["building", () => queue.enqueue(state, "metal_mine", "manual")],
    ["research", () => research.enqueueResearch(state, "computer_tech", "manual")],
    ["shipyard", () => yard.enqueueUnits(state, "small_cargo", 7, "manual")],
  ]) {
    const next = result();
    assert.equal(next.ok, true, `r${revision} ${label} must really pay and enqueue: ${next.reason}`);
    state = next.state;
  }
  state = yard.advanceShipyard(state, yard.unitSeconds(state, "small_cargo") * 2.5, false).state;
  if (revision === 5) {
    const [orders, fleet] = await Promise.all([load("orders"), load("fleet")]);
    for (const target of [
      {kind:"building",building:"crystal_mine",targetLevel:5},
      {kind:"research",tech:"energy_tech",targetLevel:5},
      {kind:"shipyard",unit:"light_fighter",quantity:5},
    ]) {
      const result = orders.createOrderTask(state, {...target,planetId:state.activePlanetId,
        expectedNextTaskId:state.orders.nextTaskId,budget:{metal:"1000000",crystal:"1000000",deuterium:"1000000"}});
      assert.equal(result.ok,true,`r5 real finite plan creation failed: ${result.reason}`);
      state = result.state;
    }
    state = orders.advanceOrderPlans(state,10);
    assert.ok(state.orders.tasks.every(t=>t.activeJob), "All three real r5 plans must have paid work");
    // Cancel the remaining ordinary ship batch through its real refund path, then
    // partially build the plan-owned batch. Migration must retain its paid watermark.
    const cancellation = yard.cancelUnits(state,0);
    assert.equal(cancellation.ok,true,cancellation.reason);
    state = yard.advanceShipyard(cancellation.state,yard.unitSeconds(cancellation.state,"light_fighter")*2.5,false).state;
    assert.equal(state.orders.tasks.find(t=>t.kind==="shipyard").completedUnits,2);
    const origin = state.planets.find(p=>p.id===state.activePlanetId);
    state.planets.push(factory.createPlanet("synthetic-r5-colony", {...origin.coordinates,position:origin.coordinates.position===9?10:9}));
    const flight = fleet.sendFleet(state,{mission:"transport",target:state.planets.at(-1).coordinates,
      ships:{small_cargo:1},cargo:{metal:decimal.big(13),crystal:decimal.big(17),deuterium:decimal.big(19)},speedPercent:100});
    assert.equal(flight.ok,true,`r5 real manual flight failed: ${flight.reason}`);
    state = flight.state;
  }
  state = logic.tick(state, 0);
  const raw = save.exportSave(state, 1_000_000);
  assert.equal(JSON.parse(raw).revision, revision, "Source must actually emit the claimed old revision");
  const old = save.importSave(raw).state;
  assert.equal(Object.hasOwn(old, "buildingTemplates"), false);
  const migrated = importSave(raw).state;
  assert.deepEqual(migrated.buildingTemplates, { nextTemplateId: 1, templates: [] });
  assert.deepEqual(priorProjection(migrated, revision), priorProjection(old, revision), `r${revision} economic/timing state changed`);
  assert.deepEqual(migrated.formations,{nextFormationId:1,entries:[]},"Migration cannot invent fleet formations");
  assert.ok(migrated.orders.tasks.every(task=>task.formationOrigin===null),"Migration cannot invent formation order origins");
  assert.deepEqual(migrated.researchTemplates,{nextTemplateId:1,templates:[]},"Migration cannot invent research intent");
  assert.equal(migrated.orders.nextWorkId,1,"Migration cannot invent pending-work authorizations");
  assert.ok(migrated.orders.tasks.every(t=>t.transport===null && t.currentWork===null),"Old plans do not authorize new logistics");
  assert.ok(migrated.fleets.every(f=>f.orderTransport===null),"Old fleets remain ordinary unowned missions");
  const jobs = migrated.planets.flatMap(p => [...p.buildQueue, ...p.shipyardQueue]).concat(migrated.research.queue);
  if (revision < 5) {
    assert.equal(migrated.orders.tasks.length, 0, "Migration must not invent plans");
    assert.deepEqual(jobs.map(j => j.jobId), [1, 2, 3], "Identity assignment order must be deterministic");
    assert.ok(jobs.every(j => j.taskId === null), "Old manual jobs remain unowned");
    assert.equal(migrated.orders.nextJobId, 4);
    const batch = migrated.planets[0].shipyardQueue[0];
    assert.equal(batch.count, 5);
    assert.equal(batch.orderedCount, 5, "Migration must not invent already-completed plan work");
    assert.equal(batch.progress, old.planets[0].shipyardQueue[0].progress);
    reports.push({sourceRevision:revision,paidJobs:jobs.length,remainingShips:batch.count,result:"passed"});
  } else {
    assert.equal(migrated.orders.tasks.length,3);
    assert.equal(migrated.orders.tasks.find(t=>t.kind==="shipyard").completedUnits,2);
    assert.equal(migrated.planets[0].shipyardQueue[0].count,3);
    assert.equal(migrated.fleets.length,1);
    assert.equal(jobs.filter(j=>j.source==="plan").length,3);
    reports.push({sourceRevision:revision,paidJobs:jobs.length,paidPlans:3,planShipsCompleted:2,remainingShips:3,ordinaryFleets:1,result:"passed"});
  }
}
// r6 is its own additive branch: the complete old state must survive unchanged,
// including pending transport, real outbound/returning fleets, paid research and paused tasks.
const r6Save = await import(pathToFileURL(resolve(roots[4], "src/game/save.ts")).href);
for (const [phase, actual] of Object.entries(await createLegacyR6Fixtures(resolve(roots[4]), 1_000_000))) {
  const raw = JSON.stringify(actual), old = r6Save.importSave(raw).state;
  const migrated = importSave(raw).state;
  const { buildingTemplates, researchTemplates, formations, ...fullR6Projection } = structuredClone(migrated);
  assert.equal(Object.hasOwn(old, "buildingTemplates"), false);
  assert.deepEqual(buildingTemplates, { nextTemplateId: 1, templates: [] });
  assert.deepEqual(formations, { nextFormationId: 1, entries: [] });
  for (const task of fullR6Projection.orders.tasks) { assert.equal(task.formationOrigin, null); delete task.formationOrigin; }
  assert.deepEqual(researchTemplates, { nextTemplateId: 1, templates: [] });
  assert.deepEqual(fullR6Projection, old, `r6 ${phase}: complete old state changed`);
  assert.deepEqual(importSave(JSON.stringify(importSave(raw))), importSave(raw), "r9 round trip changed migrated r6 work");
  assert.equal(migrated.orders.tasks.length, 2);
  assert.ok(migrated.orders.tasks.every(task => task.status === "paused"));
  assert.equal(migrated.orders.tasks[0].currentWork.stage, "pending");
  assert.equal(migrated.orders.tasks[0].transport.trips[0].phase.kind, phase);
  assert.equal(migrated.research.queue.length, 1);
  assert.equal(migrated.research.queue[0].source, "plan");
  assert.ok(migrated.orders.tasks[1].activeJob);
  assert.equal(migrated.fleets.length, 1);
  assert.deepEqual(migrated.fleets[0].orderTransport, {
    taskId: migrated.orders.tasks[0].id, workId: migrated.orders.tasks[0].currentWork.workId,
  });
  reports.push({sourceRevision:6,phase,pausedPlans:2,paidResearchJobs:1,pendingTransportWork:1,ownedFleets:1,fullPriorProjection:"unchanged",result:"passed"});
}
// Actual r7 has nonempty research intent as well as the same transport subformat 6.
const r8GuardSave = await import(pathToFileURL(resolve(roots[6], "src/game/save.ts")).href);
const r7Save = await import(pathToFileURL(resolve(roots[5], "src/game/save.ts")).href);
for (const [phase, actual] of Object.entries(await createLegacyR7Fixtures(resolve(roots[5]), 1_000_000))) {
  const raw = JSON.stringify(actual), old = r7Save.importSave(raw).state, migrated = importSave(raw).state;
  const { buildingTemplates, formations, ...fullR7Projection } = structuredClone(migrated);
  assert.equal(Object.hasOwn(old, "buildingTemplates"), false);
  assert.deepEqual(buildingTemplates, { nextTemplateId: 1, templates: [] });
  assert.deepEqual(formations, { nextFormationId: 1, entries: [] });
  for (const task of fullR7Projection.orders.tasks) { assert.equal(task.formationOrigin, null); delete task.formationOrigin; }
  assert.deepEqual(fullR7Projection, old, `r7 ${phase}: complete old state changed`);
  assert.equal(migrated.researchTemplates.templates.length, 2);
  assert.equal(migrated.orders.tasks[0].transport.trips[0].phase.kind, phase);
  assert.equal(migrated.research.queue.length, 1);
  assert.equal(migrated.planets[0].shipyardQueue[0].count, 5);
  assert.deepEqual(importSave(JSON.stringify(importSave(raw))), importSave(raw), "r9 round trip changed migrated r7 work");
  assert.throws(() => r7Save.importSave(JSON.stringify(r8GuardSave.importSave(raw))), /修订不兼容/, "Actual r7 reader must reject actual r8 migrated bytes");
  assert.throws(() => r7Save.importSave(JSON.stringify(importSave(raw))), /修订不兼容/, "Actual r7 reader must also reject r9");
  reports.push({sourceRevision:7,phase,researchTemplates:2,paidResearchJobs:1,remainingPaidShips:5,ownedFleets:1,fullPriorProjection:"unchanged",oldReader:"real r8 and r9 both rejected; separate archived r7-to-r8 guard also retained",result:"passed"});
}
// Actual r8 source retains every field. Migration adds only the empty r9 library.
const pinnedR8 = JSON.parse(readFileSync(new URL("../tests/fixtures/building-templates-r8.json", import.meta.url), "utf8"));
assert.equal(pinnedR8.sourceSha, "4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b");
assert.equal(pinnedR8.generatedBy, "actual archived r8 factory/actions/exportSave via scripts/legacy-r8-fixture.ts");
assert.equal(pinnedR8.savedAt, 1_000_000);
const r8Save = await import(pathToFileURL(resolve(roots[6], "src/game/save.ts")).href);
for (const [phase, actual] of Object.entries(await createLegacyR8Fixtures(resolve(roots[6]), 1_000_000))) {
  const raw = JSON.stringify(actual), old = r8Save.importSave(raw).state, migratedFile = importSave(raw);
  const nativeRaw = JSON.stringify(actual, null, 2);
  assert.equal(nativeRaw, JSON.stringify(pinnedR8.fixtures[phase], null, 2), `r8 ${phase}: actual source regeneration must exactly match committed fixture bytes`);
  assert.equal(createHash("sha256").update(nativeRaw).digest("hex"), pinnedR8.sha256[phase], `r8 ${phase}: native byte hash`);
  assert.equal(actual.revision, 8);
  assert.equal(actual.version, 9);
  assert.equal(migratedFile.revision, 9);
  assertR8StatePreserved(migratedFile.state, old, `r8 ${phase}: complete prior state`);
  assert.equal(old.researchTemplates.templates.length, 2);
  assert.equal(old.formations.entries.length, 1);
  assert.equal(old.formations.entries[0].revision, 2);
  assert.equal(old.orders.tasks.at(-1).formationOrigin.formation.revision, 1);
  assert.equal(old.orders.tasks.at(-1).completedUnits, 2);
  assert.equal(old.orders.tasks[0].transport.trips[0].phase.kind, phase);
  assert.equal(old.research.queue.length, 1);
  assert.equal(old.planets[0].shipyardQueue[0].count, 5);
  assert.equal(old.planets[1].shipyardQueue[0].count, 1);
  assert.deepEqual(importSave(JSON.stringify(migratedFile)), migratedFile, "r9 round trip changed migrated r8 work");
  assert.throws(() => r8Save.importSave(JSON.stringify(migratedFile)), /修订不兼容/, "Actual r8 reader must reject r9");
  reports.push({sourceRevision:8,phase,researchTemplates:2,formations:1,immutableOrigins:1,paidResearchJobs:1,remainingManualShips:5,remainingFormationShips:1,ownedFleets:1,fullPriorState:"unchanged; sole addition is empty buildingTemplates",oldReader:"r9 rejected",result:"passed"});
}
console.log(JSON.stringify({scope:"real old-source paid queues, partial ship production, wallets, timers, payer, full prior-schema state, deterministic identity migration, real r5 paid plans and an ordinary in-flight transport; complete real r6/r7/r8 outbound/returning transport and paid research, plus retained nonempty r7 templates and a real paid ship remainder; r8 nonempty formations, immutable origins and partial replenishment",synthetic:true,revisions:reports,result:"passed"}, null, 2));
