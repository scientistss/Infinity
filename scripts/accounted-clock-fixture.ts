/** Anonymous starting inventory/technologies are explicit synthetic setup.
 * Paid queues, finite plans, protocol cards, flight and curvature use production APIs.
 * Expected snapshots call the unchanged production tick/catchUp directly; neither
 * AccountedClock nor main.ts is imported by this independent engine oracle.
 */
declare const process: { stdout: { write(text: string): void } };
import { equipCard } from "../src/automation/engine";
import { catchUp, offlineCapSeconds } from "../src/core/offline";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, sendFleet } from "../src/game/fleet";
import { createFormation } from "../src/game/formations";
import { evaluatePrestige, tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { BACKUP_KEY, deserializeState, exportSave, importSave } from "../src/game/save";
import { orderUnits } from "../src/game/shipyard";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { buyCurvature } from "../src/prestige/tree";

const EPOCH = 1_792_000_000_000;
const serialize = (state: GameState) => JSON.parse(exportSave(state, EPOCH));
const clone = (state: GameState): GameState => deserializeState(importSave(exportSave(state, EPOCH)).state);
const ok = (result: { state: GameState; ok: boolean; reason: string }): GameState => {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
};
function settled(name: string, state: GameState): GameState {
  const result = clone(tick(clone(tick(state, 0)), 0));
  const text = JSON.stringify(result);
  if (JSON.stringify(clone(result)) !== text || JSON.stringify(tick(result, 0)) !== text ||
      JSON.stringify(catchUp(result, 0).state) !== text) throw new Error(`${name}: strict-reader/startup drift`);
  return result;
}
const live = (state: GameState, seconds: number) => tick(state, seconds);
const offline = (state: GameState, seconds: number) => catchUp(state, seconds).state;
const reload = (state: GameState, seconds: number) => offline(clone(state), seconds);

let base = settled("base", createInitialState(20261010, 20261010));
let mixed = createInitialState(20261011, 20261011);
const home = activePlanet(mixed);
home.name = "匿名计时旧母星";
home.resources = { metal: big(100_000), crystal: big(100_000), deuterium: big(100_000) };
Object.assign(home.buildings, { robotics_factory: 2, shipyard: 2, research_lab: 2,
  metal_storage: 4, crystal_storage: 4, deuterium_tank: 4 });
home.units.small_cargo = 4;
Object.assign(mixed.research.levels, { astrophysics: 2, computer_tech: 4, combustion_drive: 3 });
// This is anonymous deterministic initial inventory, not a claim of natural progression.
mixed.manualClicks = 100;
const colony = createPlanet("clock-colony", { ...home.coordinates, position: home.coordinates.position === 9 ? 10 : 9 });
colony.name = "匿名计时殖民地";
mixed.planets.push(colony);
mixed = settled("mixed-inventory", mixed);
mixed = equipCard(mixed, 0, "auto_collect").state;
if (mixed.protocols.slots[0]?.card?.action.kind !== "collect") throw new Error("Real auto-collect card must be equipped");
mixed = ok(enqueue(mixed, "metal_storage", "manual"));
mixed = ok(enqueueResearch(mixed, "energy_tech", "manual"));
mixed = ok(orderUnits(mixed, "light_fighter", 2, "manual"));
mixed = ok(createOrderTask(mixed, { kind: "building", planetId: colony.id,
  building: "metal_mine", targetLevel: 1, expectedNextTaskId: mixed.orders.nextTaskId,
  budget: { metal: "1000", crystal: "1000", deuterium: "1000" } }));
mixed = ok(sendFleet(mixed, { mission: "transport", target: { ...colony.coordinates },
  ships: { small_cargo: 1 }, cargo: emptyCargo(), speedPercent: 100 }));
mixed = ok(createFormation(mixed, { expectedNextFormationId: 1, name: "保留计时编成", ships: { small_cargo: 2 } }));
mixed = settled("mixed", mixed);
if (!activePlanet(mixed).buildQueue.length || !activePlanet(mixed).shipyardQueue.length ||
    !mixed.research.queue.length || !mixed.fleets.length || !mixed.orders.tasks.length) {
  throw new Error("Mixed engine fixture must contain paid build/research/ship queues, a real flight and a real finite plan");
}
let incoming = clone(mixed); activePlanet(incoming).name = "匿名计时替换母星";
incoming = settled("incoming", incoming);
let cap8 = clone(mixed); cap8.warpCores = big(10);
for (let rank = 0; rank < 3; rank++) cap8 = buyCurvature(cap8, "offline_extend");
cap8 = settled("cap8", cap8);
if (offlineCapSeconds(mixed) !== 7200 || offlineCapSeconds(cap8) !== 28800) throw new Error("Real curvature must establish exact 2h/8h caps");
let prestige = clone(mixed);
prestige.lifetime = { metal: big(1e10), crystal: big(0), deuterium: big(0) };
prestige.warpCores = big(10);
prestige = settled("prestige", prestige);
const candidate = evaluatePrestige(prestige).next;
if (candidate === prestige || candidate.stats.launches !== prestige.stats.launches + 1) throw new Error("Real prestige must be eligible");
let automatic = equipCard(clone(prestige), 1, "auto_prestige").state;
automatic = settled("automatic", automatic);
if (automatic.protocols.slots[1]?.card?.action.kind !== "prestige") throw new Error("Automatic launch must be actually armed");
const variants = { base, mixed, incoming, cap8, prestige, automatic };
const expected: Record<string, unknown> = {};
function expect(name: string, state: GameState): void {
  // Validate every expected complete output with the production reader. Do not
  // settle away an engine difference after producing an expected result.
  const saved = serialize(state);
  importSave(JSON.stringify(saved));
  expected[name] = saved.state;
}
for (const [name, state] of Object.entries(variants)) {
  expect(`${name}.initial`, state);
  expect(`${name}.offline61`, offline(state, 61));
  expect(`${name}.offline61.reload1`, reload(offline(state, 61), 1));
  expect(`${name}.live1`, live(state, 1));
}
for (const seconds of [4.999, 5, 29.999, 30]) {
  expect(`boundary.${seconds}`, seconds < 5 ? live(mixed, seconds) : offline(mixed, seconds));
}
expect("mixed.live1.offline60", offline(live(mixed, 1), 60));
expect("mixed.live1.reload60", reload(live(mixed, 1), 60));
expect("mixed.offline60.live1", live(offline(mixed, 60), 1));
expect("mixed.offline62", offline(mixed, 62));
expect("incoming.live2", live(incoming, 2));
expect("prestige.candidate", candidate);
expect("prestige.candidate.offline61", offline(candidate, 61));
expect("prestige.candidate.offline61.reload1", reload(offline(candidate, 61), 1));
expect("prestige.candidate.reload100", reload(candidate, 100));
expect("automatic.offline60", offline(automatic, 60));
let automatedLive = automatic;
for (let n = 0; n < 10; n++) automatedLive = live(automatedLive, 1);
expect("automatic.tenLive1", automatedLive);
if (automatedLive.stats.launches !== 1 || offline(automatic, 60).stats.launches !== 1) throw new Error("Live/offline automatic launch premise failed");
for (const [name, state] of [["mixed", mixed], ["cap8", cap8]] as const) {
  const raw = offlineCapSeconds(state) + 3600;
  expect(`${name}.capped`, offline(state, raw));
  expect(`${name}.capped.reload1`, reload(offline(state, raw), 1));
}
process.stdout.write(JSON.stringify({
  description: "Anonymous strictly settled initial fixtures. Explicit prefunding, completed technologies and initial inventories; real production APIs create every queue, finite plan, formation, protocol and flight. Whole-state expected outputs independently call production tick/catchUp and strict serializers, without importing the accounted clock or main. Browser Date/performance/RAF/interval dispatch are controlled, not genuine OS-background evidence. Reset checks deliberately compare timestamp/elapsed-time invariants because new-world entropy remains native.",
  epoch: EPOCH, key: STORAGE_KEY, backupKey: BACKUP_KEY, homeId: mixed.activePlanetId,
  expected, ...Object.fromEntries(Object.entries(variants).map(([name, state]) => [name, serialize(state)])),
}, null, 2));
