/** Compare real old and new rule engines. Usage: node --import tsx scripts/check-original-parity.mjs /path/to/69eca71 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import * as nowState from "../src/game/state.ts";
import * as nowSave from "../src/game/save.ts";
import * as nowLogic from "../src/game/logic.ts";
import * as nowQueue from "../src/game/queue.ts";
import * as nowResearch from "../src/game/research.ts";
import * as nowYard from "../src/game/shipyard.ts";
import * as nowEngine from "../src/automation/engine.ts";
import * as nowArcade from "../src/game/arcade.ts";
import { activePlanet } from "../src/game/empire.ts";
import { big } from "../src/game/decimal.ts";

const root = process.argv[2];
if (!root) throw new Error("请提供已核对的 69eca71 源码目录");
const load = (f) => import(pathToFileURL(resolve(root, `src/${f}.ts`)).href);
const [oldState,oldSave,oldLogic,oldQueue,oldResearch,oldYard,oldEngine,oldArcade] = await Promise.all([
  "game/state","game/save","game/logic","game/queue","game/research","game/shipyard","automation/engine","game/arcade",
].map(load));
function project(current) {
  const s = nowSave.serializeState(current);
  const { planets, activePlanetId: _active, deepSpace: _deep, universe: _universe, fleets: _fleets, messages: _messages, nextFleetId: _nextFleetId, orders: _orders, ...empire } = s;
  const { id: _id, coordinates: _coordinates, resources, ...planet } = planets[0];
  const { nextRunId: _nextRunId, autoBatch: _autoBatch, ...legacyArcade } = s.arcade;
  legacyArcade.runs = s.arcade.runs.map(({ id: _ticketId, ...run }) => run);
  planet.buildQueue = planet.buildQueue.map(({jobId: _job, taskId: _task, ...order}) => order);
  planet.shipyardQueue = planet.shipyardQueue.map(({jobId: _job, taskId: _task, orderedCount: _ordered, paidPerUnit: _unitCost, ...order}) => order);
  return { ...empire, arcade: legacyArcade, resources, planet, research: { ...s.research, queue: s.research.queue.map(({planetId: _payer, jobId: _job, taskId: _task, ...o})=>o) } };
}
let checked=0;
for(let seed=1;seed<=16;seed++) {
  let old=oldState.createInitialState(), current=nowState.createInitialState();
  for(const [s,p] of [[old,old.planet],[current,activePlanet(current)]]) {
    Object.assign(p.buildings, {metal_mine:seed,crystal_mine:Math.max(0,seed-2),deuterium_synth:Math.max(0,seed-4),solar_plant:seed+3,robotics_factory:2,research_lab:4,shipyard:3});
    const res={metal:big(2e6),crystal:big(1e6),deuterium:big(3e5)};
    if(s===old)s.resources=res;else p.resources=res;
    s.arcade.seed=seed*991;s.manualClicks=100;
    Object.assign(s.research.levels,{combustion_drive:2,energy_tech:3,astrophysics:1,computer_tech:2});
  }
  const check=()=>{assert.equal(current.orders.tasks.length, 0, "baseline must not create plans");assert.equal(current.orders.nextWorkId, 1, "baseline must not create logistics work authorizations");assert.equal(current.orders.accumulator, 0, "idle plans must not alter old timing");assert.equal(current.arcade.autoBatch, null, "baseline must never arm ring automation");assert.deepEqual(project(current),oldSave.serializeState(old),`seed ${seed}, check ${checked}`);checked++;};
  old=oldLogic.tick(old,0.1);current=nowLogic.tick(current,0.1);check();
  old=oldQueue.enqueue(old,"metal_mine","manual").state;current=nowQueue.enqueue(current,"metal_mine","manual").state;check();
  old=oldResearch.enqueueResearch(old,"computer_tech","manual").state;current=nowResearch.enqueueResearch(current,"computer_tech","manual").state;check();
  old=oldYard.orderUnits(old,"small_cargo",3,"manual").state;current=nowYard.orderUnits(current,"small_cargo",3,"manual").state;check();
  old=oldEngine.equipCard(old,0,"auto_collect").state;current=nowEngine.equipCard(current,0,"auto_collect").state;
  for(const dt of [0.25,1,2.75,59.5,600,1800]) {old=oldLogic.tick(old,dt,"offline");current=nowLogic.tick(current,dt,"offline");check();}
  old=oldArcade.revealAll(old,"manual").state;current=nowArcade.revealAll(current,"manual").state;check();
  old=oldLogic.prestige(old);current=nowLogic.prestige(current);check();
}
console.log(JSON.stringify({baseline:"69eca7107980cce3c4c24ce4736a91993c051fbd",scenarios:16,comparisons:checked,result:"passed",scope:"single-world rule outputs, including queues, research, units, offline timing, protocols, ring results and reset"},null,2));
