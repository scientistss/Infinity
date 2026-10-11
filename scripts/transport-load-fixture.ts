/** Natural milestone handoff plus explicitly labeled debit-only fuel fault.
 * Run: node --import tsx scripts/transport-load-fixture.ts natural-growth-report.json
 * No grant, technology/inventory patch, production freeze, or new economic rule.
 * Goldens use only the existing quoteFlight/sendFleet/tick/catchUp engines.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void } };
import { catchUp } from "../src/core/offline";
import { SHIP_IDS } from "../src/data/units";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";

const [{ readFileSync }, { createHash }] = await Promise.all([import("node:fs" as string), import("node:crypto" as string)]);
const reportPath = process.argv[2] ?? "natural-growth-report.json";
const sourceBytes = readFileSync(reportPath);
const report = JSON.parse(String(sourceBytes));
const milestoneName = "08-colony-established-by-fleet-arrival";
const matches = report.milestones.filter((value: { name: string }) => value.name === milestoneName);
function check(condition: unknown, reason: string): asserts condition { if (!condition) throw Error(reason); }
check(matches.length === 1, "Exactly one named natural milestone must exist");
const milestone = matches[0];
check(report.provenance.injectedGameState === false && milestone.gameSeconds === 1682,
  "The original natural-growth provenance or milestone time changed");
const naturalBaseline = milestone.save;
const EPOCH = naturalBaseline.lastTickAt;
const clone = (state: GameState): GameState => deserializeState(importSave(exportSave(state, EPOCH)).state);
const saved = (state: GameState) => JSON.parse(exportSave(state, EPOCH));
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exact = (left: unknown, right: unknown, label: string) => check(stable(left) === stable(right), label);
const base = deserializeState(importSave(JSON.stringify(naturalBaseline)).state);
exact(serializeState(base), naturalBaseline.state, "Strict reader must preserve the full unmodified natural baseline");
exact(serializeState(catchUp(clone(base), 0).state), naturalBaseline.state, "Native startup must preserve the full natural baseline");
const home = activePlanet(base), colony = base.planets.find(planet => planet.id !== home.id)!;
check(home.id === "homeworld" && colony.id === "colony-1" && base.nextFleetId === 2 && !base.fleets.length,
  "Natural route identities changed");
exact(home.coordinates, { galaxy: 1, system: 56, position: 11 }, "Natural home coordinate changed");
exact(colony.coordinates, { galaxy: 1, system: 56, position: 10 }, "Natural colony coordinate changed");
check(home.units.small_cargo === 2 && !base.research.queue.length && base.planets.every(planet =>
  !planet.buildQueue.length && !planet.shipyardQueue.length) && base.orders.tasks.every(task => task.status === "completed"),
  "Natural source must have exactly two available small cargo ships and no pending paid work");
const request: FleetRequest = { mission: "transport", target: { ...colony.coordinates },
  ships: Object.fromEntries(SHIP_IDS.filter(id => id !== "solar_satellite").map(id => [id, id === "small_cargo" ? 2 : 0])),
  cargo: emptyCargo(), speedPercent: 100, holdSlots: 1, chargeWithBets: false };
function flightProbe(command: FleetRequest) {
  const quote = quoteFlight(base, command);
  check(quote.ok, `Existing flight engine rejected independent empty-cargo probe: ${quote.reason}`);
  return { capacity: quote.capacity.toString(), fuel: quote.fuel.toString(), duration: quote.duration,
    metalMaximum: quote.capacity.sub(quote.fuel).sub(command.cargo.crystal).sub(command.cargo.deuterium).toString() };
}
const emptyProbe = flightProbe(request);
exact({ capacity: emptyProbe.capacity, fuel: emptyProbe.fuel, metalMaximum: emptyProbe.metalMaximum },
  { capacity: "10000", fuel: "8", metalMaximum: "9992" }, "Independent natural route preflight changed");
const mixedProbe = flightProbe({ ...request, cargo: { ...emptyCargo(), crystal: big(500) } });
check(mixedProbe.metalMaximum === "9492", "Independent 500-crystal maximum changed");
const overload = quoteFlight(base, { ...request, cargo: { ...emptyCargo(), metal: big(10000) } });
check(!overload.ok && overload.reason.includes("货舱"), "Original 10000-metal request must remain an overcapacity failure");
const launched = sendFleet(clone(base), { ...request, cargo: { ...emptyCargo(), metal: big(9992) } });
check(launched.ok && launched.fleetId === 2, `Existing manual launch failed: ${launched.reason}`);
const departed = launched.state, fleet = departed.fleets.find(value => value.id === 2)!;
check(fleet && fleet.mission === "transport" && fleet.orderTransport === null && fleet.cargo.metal.eq(9992)
  && fleet.cargo.crystal.eq(0) && fleet.cargo.deuterium.eq(0) && fleet.ships.small_cargo === 2
  && fleet.duration > 1 && fleet.duration < 6, "Independent real manual fleet identity/cargo/duration changed");
exact(base.orders, departed.orders, "Manual transport may not create, charge, or change a plan");
// 1 second remains in the normal live branch. The next 5-second gaps use the
// actual main.frame >=5 catchUp branch, including native production and clocks.
const inflight = tick(departed, 1);
const reloadedInflight = catchUp(clone(inflight), 0).state;
const delivered = catchUp(reloadedInflight, 5).state;
check(delivered.fleets.length === 1 && delivered.fleets[0]!.returning && delivered.fleets[0]!.cargo.metal.eq(0),
  "First controlled catchUp must observe actual delivery while fleet is still returning");
const returned = catchUp(delivered, 5).state;
check(!returned.fleets.length && activePlanet(returned).units.small_cargo === 2,
  "Second controlled catchUp must return the original ships");
const later = catchUp(returned, 60).state;
check(later.nextFleetId === 3 && !later.fleets.length, "Waiting may not redispatch a completed manual transport");
const expected: Record<string, unknown> = {};
for (const [name, state] of Object.entries({ baseline: base, departed, inflight, reloadedInflight, delivered, returned, later,
  selectedColony: selectPlanet(clone(base), colony.id), naturalFiveSeconds: catchUp(clone(base), 5).state })) {
  const file = saved(state); importSave(JSON.stringify(file)); expected[name] = file.state;
}
let responsive = clone(base);
for (let second = 1; second <= 12; second++) {
  responsive = tick(responsive, 1);
  if (second % 3 === 0) expected[`responsive${second}LiveSeconds`] = saved(responsive).state;
}
// One explicit debit-only fault derived from the exact natural source. It is
// never used by the successful journey and is never called natural progression.
const noFuel = clone(base); activePlanet(noFuel).resources.deuterium = big(7);
const restoredFault = clone(noFuel);
exact(serializeState(restoredFault), serializeState(noFuel), "Fuel-fault strict reader drift");
const noFuelQuote = quoteFlight(noFuel, request);
check(!noFuelQuote.ok && noFuelQuote.reason.includes("重氢"), "Debit-only fuel fault must fail in the original engine");
const stockMaximum = { crystal: home.resources.crystal.toString(),
  deuterium: home.resources.deuterium.sub(big(8)).toString() };
exact(stockMaximum, { crystal: "554.808618111057", deuterium: "7942.03903587735" }, "Natural fractional inventory boundaries changed");
for (const resource of ["crystal", "deuterium"] as const) {
  const maximumQuote = quoteFlight(base, { ...request, cargo: { ...emptyCargo(), [resource]: big(stockMaximum[resource]) } });
  check(maximumQuote.ok, `Existing engine must approve the exact fractional ${resource} maximum`);
}
const reverseFault = saved(noFuel).state;
reverseFault.planets.find((planet: { id: string }) => planet.id === home.id).resources.deuterium = home.resources.deuterium.toString();
exact(reverseFault, naturalBaseline.state, "Fuel fault must change precisely one resource field and nothing else");
process.stdout.write(JSON.stringify({
  description: "Unmodified natural milestone08 (1682 one-second natural-growth seconds) is handed to the real browser. No prefunding, production freeze, invented ships, technology patch or new economy. Only save-envelope timestamps change to the controlled browser clock. Full-state launch/live/catchUp/reload oracles call the existing engines and preserve every game field, natural production, fractional wallets, historical plan/job/fleet IDs and message. This handoff is not continuous natural browser play. The separate noFuel save is explicitly a debit-only fault: home deuterium is changed to 7 and no other field changes.",
  epoch: EPOCH, key: STORAGE_KEY, homeId: home.id, colonyId: colony.id, target: colony.coordinates,
  source: { path: reportPath, reportSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    milestone: milestoneName, gameSeconds: milestone.gameSeconds, provenance: report.provenance,
    note: "The browser independently reads and hashes the source report, then compares this complete original milestone." },
  naturalMilestone: milestone, naturalBaseline, base: naturalBaseline,
  noFuel: saved(noFuel), faults: { noFuel: { classification: "Explicit debit-only fault; not natural progression",
    soleChange: { planetId: home.id, path: "resources.deuterium", before: home.resources.deuterium.toString(), after: "7" } } },
  independentProbes: { empty: emptyProbe, with500Crystal: mixedProbe, stockMaximum,
    oneShip: flightProbe({ ...request, ships: { ...request.ships, small_cargo: 1 } }),
    speed10: flightProbe({ ...request, speedPercent: 10 }), overloadReason: overload.reason },
  execution: { fleetId: 2, cargo: { metal: "9992", crystal: "0", deuterium: "0" }, fuel: "8",
    capacity: "10000", durations: { inflightSeconds: 1, deliveryGapSeconds: 5, returnGapSeconds: 5, laterGapSeconds: 60 },
    clockRule: "main.frame gap <5 uses tick; gap >=5 uses catchUp. Native reload uses catchUp(clone, 0).", expected },
}, null, 2));
