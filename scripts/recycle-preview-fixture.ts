/** CI preparation only: explicit funded/prerequisite/seed-selected synthetic origin.
 * Real sendFleet -> live tick arrival -> pirate battle/debris -> return. This is
 * engine evidence, NOT a natural progression or native-browser payment claim.
 * Usage: node --import tsx scripts/recycle-preview-fixture.ts INPUT INPUT_SHA SOURCE_SHA
 */
declare const process: { argv: string[]; version: string; stdout: { write(value: string): void } };
import { SAVE_VERSION, SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { SHIP_IDS, unitById } from "../src/data/units";
import { RESOURCE_IDS, type GameState } from "../src/game/types";
import { formatAmount, formatDuration } from "../src/game/format";
const [{ readFileSync }, { createHash }, { execFileSync }, { deepStrictEqual }] = await Promise.all([
  import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string), import("node:assert/strict" as string),
]);
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const hash = (value: unknown) => String(createHash("sha256").update(value).digest("hex"));
const [inputPath, inputHash, sourceSha] = process.argv.slice(2);
check(process.argv.length === 5 && /^[a-f0-9]{64}$/.test(inputHash ?? "") && /^[a-f0-9]{40}$/.test(sourceSha ?? ""), "Exact input and committed source hashes required");
const git = (...args: string[]) => String(execFileSync("git", args, { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000 })).trimEnd();
check(git("rev-parse", "HEAD") === sourceSha && git("diff", "HEAD", "--") === "", "Clean exact committed producer required");
check(git("status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ".github", "package.json", "package-lock.json") === "", "Source scope must be clean");
check(SAVE_VERSION === 9 && SAVE_REVISION === 14, "No save schema change is authorized");
const inputBytes = readFileSync(inputPath); check(hash(inputBytes) === inputHash, "Exact pirate input byte mismatch");
const inputRaw = String(inputBytes), input = importSave(inputRaw), epoch = input.savedAt;
check(JSON.stringify(input) === JSON.stringify(JSON.parse(inputRaw)), "Strict input must not migrate or normalize");
let state = deserializeState(input.state);
check(state.fleets.length === 0 && state.deepSpace.debris.length === 0 && state.deepSpace.completed === 0, "Original prepared pirate input required");
check(state.arcade.seed === 771 && state.research.levels.hyperspace_tech === 2 && activePlanet(state).units.recycler === 20, "Existing deep-fixture pirate setup contract changed");
const steps: unknown[] = [];
function checkpoint(name: string, before: GameState, operation: unknown) {
  const raw = exportSave(state, epoch);
  // The established fleet reader emits elapsed before returning; live export
  // emits returning before elapsed. Compare complete typed values here while
  // preserving the original export bytes/hash and never adopting the reread.
  deepStrictEqual(importSave(raw), JSON.parse(raw), "Checkpoint strict roundtrip changed");
  steps.push({ name, operation, before: serializeState(before), result: serializeState(state), raw, rawSha256: hash(raw) });
}
const request: FleetRequest = { mission: "charge", target: { ...activePlanet(state).coordinates, position: 16 },
  ships: { small_cargo: 5, light_fighter: 30, cruiser: 8 }, cargo: emptyCargo(), speedPercent: 100, holdSlots: 1 };
let before = state; const quote = quoteFlight(state, request), dispatched = sendFleet(state, request);
check(quote.ok && quote.fuel.gt(0) && dispatched.ok, "Paid charge dispatch failed"); state = dispatched.state;
check(activePlanet(state).resources.deuterium.eq(activePlanet(before).resources.deuterium.sub(quote.fuel)), "Real fuel debit missing");
checkpoint("paid-dispatch", before, { kind: "sendFleet", request, quote });
for (const [name, seconds] of [["outbound-arrival", state.fleets[0]!.duration], ["pirate-battle", 60]] as const) {
  before = state; state = tick(state, seconds, "live"); checkpoint(name, before, { kind: "tick", seconds, mode: "live" });
}
const report = state.deepSpace.reports[0];
check(state.deepSpace.completed === 1 && report?.symbol === "pirate" && !!report.battle && report.battle.rounds.length > 0
  && report.battle.rounds.length <= 6 && state.deepSpace.debris.length === 1, "Real pirate battle and visible debris required");
check(state.fleets.length === 1 && state.fleets[0]!.returning, "This bounded fixture requires surviving actual return");
before = state; const returnSeconds = state.fleets[0]!.remaining; state = tick(state, returnSeconds, "live");
checkpoint("survivors-returned", before, { kind: "tick", seconds: returnSeconds, mode: "live" });
check(state.fleets.length === 0 && state.deepSpace.reports[0]!.returned, "Actual return did not finish");
const field = state.deepSpace.debris[0]!;
/** Independent verbatim operation order of pre-refactor recycleDebris arithmetic.
 * Deliberately NEVER import calculateRecycleAmounts, recyclePreview or a UI view.
 */
function oldAmounts(request: FleetRequest) {
  const factor = 1 + .05 * state.research.levels.hyperspace_tech;
  const capacity = SHIP_IDS.reduce((sum, id) => sum.add(big(unitById(id).cargo).mul(request.ships[id] ?? 0).mul(factor)), big(0));
  const collector = big(unitById("recycler").cargo).mul(request.ships.recycler ?? 0).mul(factor);
  const used = RESOURCE_IDS.reduce((sum, id) => sum.add(request.cargo[id]), big(0));
  const room = capacity.sub(used).max(0).min(collector), metal = big(field.metal), crystal = big(field.crystal), total = metal.add(crystal);
  const take = room.min(total), pickedMetal = total.gt(0) ? take.mul(metal).div(total).floor() : big(0);
  const pickedCrystal = take.sub(pickedMetal).min(crystal).floor();
  return Object.fromEntries(Object.entries({ capacity, collector, used, room, metal: pickedMetal, crystal: pickedCrystal,
    leftMetal: metal.sub(pickedMetal), leftCrystal: crystal.sub(pickedCrystal) }).map(([key, value]) => [key, value.toString()]));
}
const cases = [
  { name: "one-recycler", recyclers: 1, metal: 0, crystal: 0, deuterium: 0, speed: 100 },
  { name: "two-recyclers", recyclers: 2, metal: 0, crystal: 0, deuterium: 0, speed: 100 },
  { name: "carried-cargo", recyclers: 1, metal: 1000, crystal: 1000, deuterium: 500, speed: 100 },
  { name: "speed-change", recyclers: 1, metal: 1000, crystal: 1000, deuterium: 500, speed: 50 },
].map(spec => {
  const request: FleetRequest = { mission: "recycle", target: { ...field.target }, ships: { recycler: spec.recyclers },
    cargo: { metal: big(spec.metal), crystal: big(spec.crystal), deuterium: big(spec.deuterium) }, speedPercent: spec.speed };
  const quote = quoteFlight(state, request); check(quote.ok, "Legal preview scenario required: " + spec.name);
  return { name: spec.name, request, expected: oldAmounts(request), quote,
    quoteText: `单程 ${formatDuration(Math.ceil(quote.duration))} · 往返燃料 ${formatAmount(quote.fuel)} 重氢 · 总货舱 ${formatAmount(quote.capacity)}` };
});
const initialRaw = exportSave(state, epoch), base = importSave(initialRaw);
deepStrictEqual(base, JSON.parse(initialRaw), "Final envelope strict values changed");
// Loading itself leaves original native storage untouched. These are separately
// labeled expected bytes after loading and explicitly saving, not a new input.
const adoptedRaw = exportSave(deserializeState(base.state), epoch);
deepStrictEqual(JSON.parse(adoptedRaw), base, "Post-load Save must preserve every typed value");
check(exportSave(deserializeState(importSave(adoptedRaw).state), epoch) === adoptedRaw, "Post-load Save must be a byte-exact fixed point");
const source = { sourceSha, fullTree: git("rev-parse", "HEAD^{tree}"),
  scriptSha256: hash(readFileSync(new URL("./recycle-preview-fixture.ts", import.meta.url))),
  inputProducerSha256: hash(readFileSync(new URL("./deep-fixture.ts", import.meta.url))),
  dependencyLockSha256: hash(readFileSync(new URL("../package-lock.json", import.meta.url))), runtimeNode: process.version };
process.stdout.write(JSON.stringify({ schema: "infinity-recycle-preview-fixture-v1", source, key: STORAGE_KEY,
  classification: "explicit-synthetic-origin-real-engine-transitions", provenance: {
    syntheticInitialFunds: true, syntheticInitialPrerequisites: true, seedSelectedForPirate: true,
    naturalProgression: false, nativeBrowserPayments: false, directStatePatchesAfterInput: false,
    transitions: "real paid sendFleet, live tick arrival, real pirate battle/debris, live tick return" },
  input: { raw: inputRaw, rawSha256: inputHash, envelope: input, producer: "scripts/deep-fixture.ts pirate" },
  steps, initialRaw, initialRawSha256: hash(initialRaw), base, adoptedRaw, adoptedRawSha256: hash(adoptedRaw),
  adoptionScope: "Expected bytes after native load and explicit Save; loading alone retains initialRaw", field, cases,
  literalGoldens: { classification: "independent-synthetic-arithmetic-only-not-browser-fixtures",
    debris: { metal: "40000", crystal: "20000" }, hyperspace: 2,
    one: { capacity: "22000", collector: "22000", used: "0", room: "22000", metal: "14666", crystal: "7334", leftMetal: "25334", leftCrystal: "12666" },
    carried: { capacity: "22000", collector: "22000", used: "2500", room: "19500", metal: "13000", crystal: "6500", leftMetal: "27000", leftCrystal: "13500" } },
}, null, 2));
