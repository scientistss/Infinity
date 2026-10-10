/** Compare migrations of real preceding serializers and paid-queue primitives.
 * Inputs are synthetic, pre-funded states; this is not natural player progression.
 * Usage: node --import tsx scripts/check-order-migration.mjs r2-root r3-root r4-root
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { importSave } from "../src/game/save.ts";

const roots = process.argv.slice(2);
if (roots.length !== 3) throw Error("Provide verified source directories for r2, r3 and r4");
function priorProjection(state, revision) {
  const s = structuredClone(state);
  delete s.orders;
  for (const planet of s.planets) {
    for (const job of planet.buildQueue) { delete job.jobId; delete job.taskId; }
    for (const job of planet.shipyardQueue) {
      delete job.jobId; delete job.taskId; delete job.orderedCount; delete job.paidPerUnit;
    }
  }
  for (const job of s.research.queue) { delete job.jobId; delete job.taskId; }
  if (revision < 4) {
    delete s.arcade.nextRunId; delete s.arcade.autoBatch;
    for (const ticket of s.arcade.runs) delete ticket.id;
  }
  if (revision === 2) delete s.deepSpace;
  return s;
}
const reports = [];
for (let index = 0; index < roots.length; index++) {
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
  state = logic.tick(state, 0);
  const raw = save.exportSave(state, 1_000_000);
  assert.equal(JSON.parse(raw).revision, revision, "Source must actually emit the claimed old revision");
  const old = save.importSave(raw).state;
  const migrated = importSave(raw).state;
  assert.deepEqual(priorProjection(migrated, revision), priorProjection(old, revision), `r${revision} economic/timing state changed`);
  assert.equal(migrated.orders.tasks.length, 0, "Migration must not invent plans");
  const jobs = migrated.planets.flatMap(p => [...p.buildQueue, ...p.shipyardQueue]).concat(migrated.research.queue);
  assert.deepEqual(jobs.map(j => j.jobId), [1, 2, 3], "Identity assignment order must be deterministic");
  assert.ok(jobs.every(j => j.taskId === null), "Old manual jobs remain unowned");
  assert.equal(migrated.orders.nextJobId, 4);
  const batch = migrated.planets[0].shipyardQueue[0];
  assert.equal(batch.count, 5);
  assert.equal(batch.orderedCount, 5, "Migration must not invent already-completed plan work");
  assert.equal(batch.progress, old.planets[0].shipyardQueue[0].progress);
  reports.push({sourceRevision:revision,paidJobs:jobs.length,remainingShips:batch.count,result:"passed"});
}
console.log(JSON.stringify({scope:"real old-source paid queues, partial ship production, wallets, timers, payer, full prior-schema state and deterministic identity migration",synthetic:true,revisions:reports,result:"passed"}, null, 2));
