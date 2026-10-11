/** Anonymous synthetic pressure inputs, never a natural-progress milestone.
 * Run: node --import tsx scripts/npc-pressure-fixture.ts [output-directory] [GAME_SOURCE_SHA]
 * Production code is unchanged. Battles and live fleet identities are produced
 * by paid public sendFleet/advanceFleets calls, never copied or hand-authored.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void }; cwd(): string };
import { grantRun, revealRun } from "../src/game/arcade";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { advanceFleets, emptyCargo, nextFleetEvent, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { coordinateKey, npcAt, SPACE, type Coordinates } from "../src/game/galaxy";
import { tick } from "../src/game/logic";
import { npcWalletContext } from "../src/game/npc-attack";
import { createNpcBattleState, NPC_SITE_LIMIT, NPC_TERMINAL_REPORT_LIMIT, NPC_UNFINISHED_ATTACK_LIMIT } from "../src/game/npc-attack-state";
import { createNpcWallet, materializeNpcAtPaidLaunch } from "../src/game/npc-wallet";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const [{ mkdirSync, writeFileSync, readFileSync }, { createHash }, { execFileSync }] = await Promise.all([
  import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string),
]);
function check(value: unknown, reason: string): asserts value { if (!value) throw Error(reason); }
const hash = (value: string) => createHash("sha256").update(value).digest("hex") as string;
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const equal = (a: unknown, b: unknown, label: string) => check(stable(a) === stable(b), label);
const stamp = 1700000000000;
const generatorSourceSha = String(execFileSync("git", ["rev-parse", "HEAD"])).trim();
const requestedGameSourceSha = process.argv[3] ?? generatorSourceSha;
check(/^[0-9a-f]{40}$/i.test(requestedGameSourceSha), "GAME_SOURCE_SHA must be a full commit SHA");
const sourceSha = String(execFileSync("git", ["rev-parse", "--verify", `${requestedGameSourceSha}^{commit}`])).trim();
const sourceTreeSha = String(execFileSync("git", ["rev-parse", `${sourceSha}:src`])).trim();
const generatorSourceTreeSha = String(execFileSync("git", ["rev-parse", "HEAD:src"])).trim();
const generatorScriptGitStatus = String(execFileSync("git", ["status", "--porcelain", "--", "scripts/npc-pressure-fixture.ts"])).trim();
check(sourceTreeSha === generatorSourceTreeSha, "Requested game source and imported current checkout must have identical src trees");
const allowedSourceTrees: Record<string, string> = {
  d97d37c9b664a450e83bd152c84848cf1e617d6a: "900f78b5866d4cb9cc6e5c3026e415558ea07e3b",
  "8f2ea441a42f36ded7eeb60f03c3c2b0fbed073b": "b982437c729910e705ef2e44b202ef03dc2034df",
};
check(allowedSourceTrees[sourceSha] === sourceTreeSha, "Fixture requires one exact designated source commit/tree pair");
check(String(execFileSync("git", ["diff", "HEAD", "--", "src"])).length === 0, "Production source must be unchanged");
check(String(execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "src"])).trim() === "", "Whole actual imported src tree must be clean, including untracked files");
const generatorScriptWasTracked = String(execFileSync("git", ["ls-tree", "HEAD", "--", "scripts/npc-pressure-fixture.ts"])).trim() !== "";
const generatorOriginalScriptSha256 = generatorScriptWasTracked ? hash(String(execFileSync("git", ["show", "HEAD:scripts/npc-pressure-fixture.ts"]))) : null;
const strict = (state: GameState): GameState => deserializeState(importSave(exportSave(state, stamp, stamp)).state);
let pressure = createInitialState(20261010, 97531);
const home = activePlanet(pressure);
home.name = "Anonymous fixture";
home.resources = { metal: big(1_000_000), crystal: big(1_000_000), deuterium: big(1_000_000) };
home.buildings.shipyard = 4;
Object.assign(home.units, { light_fighter: 10_000, small_cargo: 1_000, recycler: 200 });
Object.assign(pressure.research.levels, { combustion_drive: 6, computer_tech: 100, weapons_tech: 1, shielding_tech: 2, astrophysics: 1 });
pressure.protocols.slots.forEach(slot => { slot.card = null; });
pressure.arcade.stats.manualRuns = 10;
pressure.arcade.stats.runs = 10;
pressure.arcade.stats.hits.empty = 10;
const bonus = grantRun(pressure, "bonus");
check(bonus.granted, "One explicitly synthetic bonus ring ticket must be granted");
pressure = strict(bonus.state);
check(!pressure.arcade.autoBatch?.armed, "CPU fixtures must start with auto unarmed");
check(Object.values(pressure.arcade.bets).every(value => value === 0), "Ring fixture must have zero bets");
const targets: Coordinates[] = [];
for (let galaxy = 1; galaxy <= SPACE.galaxies; galaxy++)
  for (let system = 1; system <= SPACE.systems; system++)
    for (let position = 1; position <= 15; position++) {
      const target = { galaxy, system, position };
      if (npcAt(pressure, target)) targets.push(target);
    }
const terminalTargets = targets.filter(target => target.galaxy === 1).slice(0, NPC_TERMINAL_REPORT_LIMIT);
const outboundTargets = targets.filter(target => target.galaxy === 3).slice(0, NPC_UNFINISHED_ATTACK_LIMIT);
check(terminalTargets.length === 60 && outboundTargets.length === 64, "Enough distinct valid NPC coordinates are required");
let totalFuel = 0, battleArrivals = 0, returnArrivals = 0;
function launch(state: GameState, request: FleetRequest): GameState {
  // Explicit fixture refueling isolates workload size from repeated Decimal debit precision.
  state = { ...state, planets: state.planets.map(planet => ({ ...planet, resources: { ...planet.resources, deuterium: big(1_000_000) }, npcResourceRemainder: { ...planet.npcResourceRemainder, deuterium: "0" } })) };
  const quote = quoteFlight(state, request);
  check(quote.ok, `Real public flight quote failed: ${quote.reason}`);
  const sent = sendFleet(state, request);
  check(sent.ok, `Real paid public launch failed: ${sent.reason}`);
  totalFuel += Number(quote.npcFuelIntent!.expectedFuelInteger);
  return sent.state;
}
for (const target of terminalTargets) {
  pressure = launch(pressure, { mission: "attack", target, ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 });
  pressure = advanceFleets(pressure, nextFleetEvent(pressure));
  battleArrivals++;
  if (pressure.fleets.length) {
    check(pressure.fleets.length === 1 && pressure.fleets[0].returning, "Battle may leave only its real returning fleet");
    pressure = advanceFleets(pressure, nextFleetEvent(pressure));
    returnArrivals++;
  }
  check(pressure.fleets.length === 0, "Terminal report generation must finish its real fleet");
}
check(pressure.npcBattles.reports.length === 60, "Exactly60 independently generated terminal reports required");
for (const target of outboundTargets) pressure = launch(pressure, {
  mission: "attack", target, ships: { light_fighter: 20, recycler: 2 }, cargo: emptyCargo(), speedPercent: 10,
});
const blocked = sendFleet(pressure, { mission: "attack", target: outboundTargets[0], ships: { light_fighter: 1 }, cargo: emptyCargo(), speedPercent: 10 });
check(!blocked.ok && blocked.reason.includes("64") && blocked.state === pressure, "65th attack must be denied unchanged by production cap");
const context = npcWalletContext(pressure);
for (const target of targets) {
  if (Object.keys(pressure.npcEconomy.sites).length === NPC_SITE_LIMIT) break;
  pressure = { ...pressure, npcEconomy: materializeNpcAtPaidLaunch(pressure.npcEconomy, target, context) };
}
pressure = strict(pressure);
// Paired control deliberately shares the final ordinary economy, including paid
// launch costs and landed survivors; only the enumerated NPC/fleet workload differs.
const control = strict({ ...pressure, npcEconomy: createNpcWallet(), npcBattles: createNpcBattleState(), fleets: [], nextFleetId: 1, messages: [] });
function counts(state: GameState) {
  return { siteCount: Object.keys(state.npcEconomy.sites).length,
    unfinishedAttackCount: state.fleets.filter(fleet => fleet.mission === "attack").length,
    terminalReportCount: state.npcBattles.reports.filter(report => report.delivery !== "returning").length,
    pinnedReportCount: state.npcBattles.reports.filter(report => report.delivery === "returning").length,
    outboundAttackCount: state.fleets.filter(fleet => fleet.npcAttack?.phase.kind === "outbound").length,
    planetCount: state.planets.length, ringTicketCount: state.arcade.runs.length, autoArmed: state.arcade.autoBatch?.armed ?? false };
}
const expected = { siteCount: 512, unfinishedAttackCount: 64, terminalReportCount: 60, pinnedReportCount: 0 };
for (const [field, value] of Object.entries(expected)) check(counts(pressure)[field as keyof ReturnType<typeof counts>] === value, `Pressure ${field} mismatch`);
check(counts(control).siteCount === 0 && !control.fleets.length && !control.npcBattles.reports.length, "Control must have no NPC/fleet workload");
const minimumRemainingSeconds = Math.min(...pressure.fleets.map(fleet => fleet.remaining));
check(minimumRemainingSeconds > 310, "Natural quoted outbound flights must survive the bounded 300-second comparison plus ten seconds");
const workloadFields = ["npcEconomy", "npcBattles", "fleets", "nextFleetId", "messages"];
const ordinary = (state: GameState) => Object.fromEntries(Object.entries(serializeState(state)).filter(([key]) => !workloadFields.includes(key)));
equal(ordinary(control), ordinary(pressure), "Paired ordinary economies must match exactly");
const raw = { control: serializeState(control), pressure: serializeState(pressure) };
const saves = { control: exportSave(control, stamp, stamp), pressure: exportSave(pressure, stamp, stamp) };
for (const [name, state] of Object.entries({ control, pressure })) {
  const source = JSON.stringify(serializeState(state));
  equal(serializeState(deserializeState(JSON.parse(source))), serializeState(state), `${name} strict raw roundtrip`);
  equal(serializeState(deserializeState(importSave(exportSave(state, stamp, stamp)).state)), serializeState(state), `${name} strict save roundtrip`);
  const at240 = tick(state, 240);
  strict(at240);
  for (const field of ["siteCount", "unfinishedAttackCount", "terminalReportCount", "pinnedReportCount", "outboundAttackCount"] as const)
    check(counts(at240)[field] === counts(state)[field], `${name} ${field} must remain stable for240 simulated seconds`);
  const after = tick(state, 310);
  strict(after);
  for (const field of ["siteCount", "unfinishedAttackCount", "terminalReportCount", "pinnedReportCount", "outboundAttackCount"] as const)
    check(counts(after)[field] === counts(state)[field], `${name} ${field} must remain stable for310 simulated seconds`);
  // Manual reveals are not run at startup. This proves the one granted ticket
  // can resolve without bet expenditure; native auto authorization is separate.
  const reveal = revealRun(state, "manual");
  check(reveal.ok, `${name} single zero-bet ring reveal unavailable: ${reveal.reason}`);
  strict(reveal.state);
  check(JSON.stringify(serializeState(state)) === source, `${name} validation mutated its source`);
}
const output = process.argv[2] ?? "/tmp/infinity-cff0ff86-npc-pressure-fixtures";
mkdirSync(output, { recursive: true });
const manifest = { schemaVersion: 1, key: STORAGE_KEY, sourceSha, sourceTreeSha, sourceTreeScope: "sourceSha:src",
  generatorSourceSha, generatorSourceTreeSha, generatorScriptGitStatus,
  generatorToolOverlay: { previouslyTracked: generatorScriptWasTracked, path: "scripts/npc-pressure-fixture.ts", originalScriptSha256: generatorOriginalScriptSha256, actualScriptSha256: hash(String(readFileSync("scripts/npc-pressure-fixture.ts"))) },
  generatorProvenance: "Current checkout HEAD is recorded separately from the designated game commit. Actual fixture script bytes are hashed; imports use the verified identical current src tree.", synthetic: true,
  stamp, expected, control: saves.control, pressure: saves.pressure, controlRaw: raw.control, pressureRaw: raw.pressure,
  counts: { control: counts(control), pressure: counts(pressure) }, minimumRemainingSeconds,
  ordinaryEconomyIdentical: true, workloadFields,
  hashes: { controlSave: hash(saves.control), pressureSave: hash(saves.pressure), controlRaw: hash(JSON.stringify(raw.control)), pressureRaw: hash(JSON.stringify(raw.pressure)),
    fixtureSource: hash(String(readFileSync("scripts/npc-pressure-fixture.ts"))) },
  ring: { count: 1, cap: "0", autoArmed: false, ticketId: pressure.arcade.runs[0].id, authorization: "Authorize one zero-bet auto reveal using the native UI after CPU observation" },
  setup: ["Anonymous deterministic synthetic prerequisites; not natural player progression or a personal save.",
    "One homeworld, seed97531, 1000000 of each starting resource, shipyard4, 10000 light fighters, 1000 small cargo and200 recyclers.",
    "Synthetic combustion6, computer100, weapons1, shielding2, astrophysics1; protocol slots cleared; ten empty manual ring outcomes and one bonus ticket granted.",
    "60 distinct galaxy1 NPCs attacked with20 light fighters plus2 small cargo at100percent; real paid sendFleet, real advanceFleets battle and return boundaries.",
    "Before each paid launch, synthetic deuterium is reset to1000000 and its pending remainder to0 to isolate pressure from repeated debit precision; every launch still makes its production fuel payment.",
    "Fleet-only API time advancement does not advance ordinary economy or NPC production; this is explicit synthetic workload preparation.",
    "64 distinct galaxy3 NPCs attacked with20 light fighters plus2 recyclers at10percent; real quoted durations retained unchanged.",
    "Remaining persistent NPC sites materialized through production wallet helper to512; no invented battle, contract, cargo or receipt fields.",
    "Control copied from final pressure ordinary economy; only enumerated workload fields reset. Auto ring remains unarmed during observation."],
  operations: { paidLaunches: 124, battleArrivals, returnArrivals, totalFuel, reportTargets: terminalTargets.map(coordinateKey), outboundTargets: outboundTargets.map(coordinateKey) },
  validation: { strictRawRoundtrip: true, strictEnvelopeRoundtrip: true, stableAt240SimulatedSeconds: true, stableAt310SimulatedSeconds: true, sixtyFifthAttackRejected: true, sourceUnchanged: true,
    singleZeroBetManualReveal: true, productionSourceUnchanged: true, designatedGameTreeMatchesImportedTree: true } };
for (const [name, value] of Object.entries({ control0: control, max512: pressure })) {
  writeFileSync(`${output}/${name}.raw.json`, JSON.stringify(serializeState(value)));
  writeFileSync(`${output}/${name}.save.txt`, exportSave(value, stamp, stamp));
}
writeFileSync(`${output}/fixtures.json`, JSON.stringify(manifest, null, 2));
writeFileSync(`${output}/manifest.json`, JSON.stringify({ ...manifest, control: undefined, pressure: undefined, controlRaw: undefined, pressureRaw: undefined }, null, 2));
process.stdout.write(JSON.stringify({ output, sourceSha, sourceTreeSha, generatorSourceSha, generatorSourceTreeSha, generatorScriptGitStatus, counts: manifest.counts, minimumRemainingSeconds, operations: manifest.operations, hashes: manifest.hashes, validation: manifest.validation }, null, 2) + "\n");
