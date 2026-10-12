/** Authentic r12 paid two-scout continuation. Expected legacy fields are advanced by
 * the byte-pinned eef engine; NPC state/events have a separate literal oracle.
 * Test-oracle state is never supplied to the candidate. Browser replay is CI-only.
 * node --import tsx scripts/npc-attack-natural-route.ts --base-report PATH
 *   --base-report-sha256 SHA --legacy-root EEF_CHECKOUT --output NEW.json
 *   [--reload-schedule frequent-reload | native-main-four]
 */
import { activePlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, recallFleet, abandonColony } from "../src/game/fleet";
import { enqueueResearch } from "../src/game/research";
import { orderUnits } from "../src/game/shipyard";
import { tick, evaluatePrestige } from "../src/game/logic";
import { prestigeConfirmation } from "../src/ui/prestige-preview-model";
import { retryNpcAttackDock } from "../src/game/npc-attack";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { STORAGE_KEY } from "../src/game/content";
import { liftR13StateToR14 } from "./r14-compatibility.mjs";
import { NPC_SCOUT_UI_SELECTION } from "./npc-scout-ui-selection";
import type { GameState } from "../src/game/types";
declare const process: { argv: string[]; version: string; exitCode?: number; stdout: { write(text: string): void } };
// The pinned historical runtime has its own type identities. Keep its values opaque.
type RecordValue = Record<string, any>;
const [{ readFileSync, writeFileSync, existsSync, realpathSync }, { createHash }, { execFileSync }, { resolve, dirname }, { pathToFileURL }, { isDeepStrictEqual }] = await Promise.all([
  import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string), import("node:path" as string), import("node:url" as string), import("node:util" as string),
]);
const ROOT = realpathSync(new URL("../", import.meta.url));
const PIN = "eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81";
const RAW_SHA = "047d49cbf04fd5424bca4d7d45e861e0439a0d51c4ac54700f77e263bb8eadcc";
const TARGET = { galaxy: 1, system: 56, position: 6 }, KEY = "1:56:6";
const RES = ["metal", "crystal", "deuterium"] as const;
const RATE = [5, 2.5, 1], CAPS = [50000, 30000, 10000];
const DURATION = (10 + 35000 / 100 * Math.sqrt(10 * 1025 / (12500 * 1.3))) / 120;
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1];
  if (!["--base-report", "--base-report-sha256", "--legacy-root", "--output", "--reload-schedule"].includes(key) || !value || args.has(key)) throw Error("Require --base-report PATH --base-report-sha256 SHA --legacy-root EEF --output NEW.json");
  args.set(key, value);
}
if (!["--base-report", "--base-report-sha256", "--legacy-root", "--output"].every(key => args.has(key))) throw Error("Four required named arguments missing");
const RELOAD_SCHEDULE = args.get("--reload-schedule") ?? "frequent-reload";
if (!["frequent-reload", "native-main-four"].includes(RELOAD_SCHEDULE)) throw Error("Unknown --reload-schedule; require frequent-reload or native-main-four");
const NATIVE_RELOAD_CHECKPOINTS = ["attack7-paid-outbound", "attack8-paid-outbound", "win8-loot-delivered-once", "empty10-zero-round-loot-delivered"];
const nativeSchedule = RELOAD_SCHEDULE === "native-main-four";
const OUTPUT = resolve(args.get("--output")), LEGACY = realpathSync(args.get("--legacy-root"));
if (existsSync(OUTPUT) || /^(src|scripts|tests|public|docs|\.github|\.git)(\/|$)/.test(OUTPUT.slice(ROOT.length + 1))) throw Error("Output must be a new evidence file outside protected source paths");
realpathSync(dirname(OUTPUT));
const hash = (text: string | Uint8Array) => String(createHash("sha256").update(text).digest("hex"));
const git = (cwd: string, ...values: string[]) => String(execFileSync("git", values, { cwd, encoding: "utf8", timeout: 10000 })).trimEnd();
const checks: RecordValue[] = [], tape: RecordValue[] = [], milestones: RecordValue[] = [];
let stage = "source", elapsed = 0, startAt = 0, failure: string | null = null, mainComplete = false;
let state!: GameState;
let control: any, old: RecordValue, npc: RecordValue, reports: RecordValue[] = [], attacks: RecordValue[] = [];
let remainders: Record<string, Record<string, string>> = {};
// Independently observed old-engine arrivals; never derived from candidate messages.
const scoutSnapshots = new Map<string, RecordValue>();
const moneyWitnesses: RecordValue[] = [];
let original!: RecordValue;
let source!: RecordValue;
let branches: RecordValue = {};
const started = performance.now();
function check(name: string, condition: unknown) { checks.push({ stage, name, passed: !!condition }); if (!condition) throw Error(name); }
function exact(name: string, actual: unknown, expected: unknown) {
  if (!isDeepStrictEqual(actual, expected)) {
    writeFileSync(OUTPUT + ".mismatch.json", JSON.stringify({ stage, name, actual, expected }, null, 2));
  }
  check(name, isDeepStrictEqual(actual, expected));
}
function budget() { check("bounded natural route", elapsed <= 180 && tape.length <= 300 && (performance.now() - started) < 300000); }
function fnv(id: number) { let n = 2166136261; for (const c of `npc-battle-v1|20261010|${id}|1:56:6`) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0; return n; }
function battle(id: number, a: number, b: number) {
  // Independent LF-only six-round reference, fixed literal catalogue and tech.
  // No imports of current battle, RNG, loot, garrison, or wallet implementations.
  let random = fnv(id), ca = a, cb = b, ha = 400 * a, hb = 400 * b;
  const next = () => { random = (random + 0x6d2b79f5) >>> 0; let t = random; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rounds = [];
  for (let round = 1; round <= 6 && ca && cb; round++) {
    const ad = ca * 50 * 1.1 * (.9 + .2 * next()), bd = cb * 50 * (.9 + .2 * next());
    ha = Math.max(0, ha - Math.max(0, bd - ca * 15)); hb = Math.max(0, hb - Math.max(0, ad - cb * 10));
    ca = Math.min(ca, Math.ceil(ha / 400)); cb = Math.min(cb, Math.ceil(hb / 400));
    rounds.push({ round, attacker: ca, defender: cb, attackDamage: ad, defendDamage: bd });
  }
  return { mode: "squadron-v1", winner: ca && !cb ? "attacker" : cb && !ca ? "defender" : "draw", rounds,
    attackerBefore: a ? { light_fighter: a } : {}, defenderBefore: b ? { light_fighter: b } : {},
    attackerAfter: ca ? { light_fighter: ca } : {}, defenderAfter: cb ? { light_fighter: cb } : {} };
}
function stock() { const anchor = npc.sites[KEY] ?? npc.baseline; return anchor.stock.map((v: number, i: number) => Math.min(CAPS[i]!, v + RATE[i]! * (npc.now - anchor.mark))); }
function allocate(before: number[], count: number) {
  const half = before.map(v => Math.floor(v / 2)), total = half.reduce((a, b) => a + b, 0), wanted = Math.min(total, Math.floor(count * 50 * 1.4));
  if (!wanted) return [0, 0, 0];
  const loot = half.map(n => Math.floor(n * wanted / total)); let left = wanted - loot.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 3 && left; i++) if (loot[i]! < half[i]!) { loot[i]!++; left--; }
  return loot;
}
function addMessage(id: string, text: string) { control = { ...control, messages: [...control.messages, { id, at: control.totalTime.toNumber(), text }].slice(-150) }; }
function resourceOracleText() {
  const resources = stock(), names = ["金属", "晶体", "重氢"];
  const detail = resources.map((v: number, i: number) => `${names[i]} ${v.toFixed(3)}/${CAPS[i]!.toFixed(3)}，固定产量 ${RATE[i]!.toFixed(3)}/秒，${v >= CAPS[i]! ? "满仓停产" : "生产中"}`).join("；");
  const g = npc.sites[KEY]?.garrison ?? { light_fighter: 4, heavy_fighter: 0 };
  const guard = g.light_fighter || g.heavy_fighter ? `轨道驻军：轻型战斗机 ${g.light_fighter}，重型战斗机 ${g.heavy_fighter}；驻军战斗科技 0` : "轨道驻军：已清空（无驻军）；驻军战斗科技 0";
  return `侦察报告 [1:56:6]：晨星共同体 56-6（NPC npc-1:56:6；派系：晨星共同体）。抵达时快照（数值保留3位小数）：游戏时间 ${control.totalTime.toNumber().toFixed(3)} 秒。${detail}。${guard}。历史快照不会随时间更新。`;
}
function independentMessages(messages: RecordValue[]) {
  return messages.map((message: RecordValue) => {
    const snapshot = scoutSnapshots.get(message.id) ?? null;
    return { ...message, ...(snapshot ? { at: Math.min(1e12, old.decimal.big(snapshot.observedAt).toNumber()) } : {}), npcScoutSnapshot: snapshot ? structuredClone(snapshot) : null };
  });
}
function shadowState() {
  const value = old.save.serializeState(control); value.npcEconomy = structuredClone(npc); value.npcBattles = { model: "npc-battle-receipts-v1", reports: structuredClone(reports) };
  value.messages = independentMessages(value.messages);
  value.planets = value.planets.map((p: RecordValue) => ({ ...p, npcResourceRemainder: { ...remainders[p.id] } }));
  value.fleets = [...value.fleets, ...structuredClone(attacks)].sort((a: RecordValue, b: RecordValue) => a.id - b.id);
  return value;
}
function invariant() {
  exact("every state field equals independent NPC oracle + pinned eef legacy engine", serializeState(state), shadowState());
  exact("old reports remain historical", state.messages.slice(0, original.state.messages.length), liftR13StateToR14(original.state).messages);
  exact("ring and deep RNG/loot unaffected", [state.arcade, state.deepSpace], [deserializeState(importSave(original.raw).state).arcade, deserializeState(importSave(original.raw).state).deepSpace]);
  check("no actual fixture injection", state.totalTime.gte(25876)); budget();
}
function checkpoint(name: string) {
  stage = name; invariant(); const before = serializeState(state), at = startAt + elapsed * 1000;
  const raw = exportSave(state, at, at), parsed = importSave(raw); exact("strict full-state roundtrip", parsed.state, before);
  // Saving and strict validation must not silently replace the live Decimal
  // representation. Only an actual scheduled reload adopts a parsed state.
  const restored = deserializeState(parsed.state), canonical = exportSave(restored, at, at);
  const twice = deserializeState(importSave(canonical).state); exact("second strict roundtrip full state", serializeState(twice), before);
  exact("canonical export is stable", exportSave(twice, at, at), canonical);
  const adopted = !nativeSchedule || NATIVE_RELOAD_CHECKPOINTS.includes(name);
  if (adopted) {
    // Preserve the original frequent-reload regression's two candidate reads;
    // the native route has one browser startup read at each of four checkpoints.
    state = nativeSchedule ? restored : twice;
    // Historical control receives its own ordinary read on the same schedule,
    // without ever receiving candidate state or the independent NPC oracle.
    control = old.save.deserializeState(old.save.importSave(old.save.exportSave(control, at, at)).state);
  }
  invariant(); milestones.push({ name, elapsedSeconds: elapsed, raw: canonical, rawSha256: hash(canonical), save: JSON.parse(canonical),
    strictRoundtrips: 2, stateAdoptedFromReload: adopted, candidateReloadReads: adopted ? (nativeSchedule ? 1 : 2) : 0, controlReloadReads: adopted ? 1 : 0 });
  tape.push({ kind: "checkpoint", name });
}
// Independent ordinary-route oracle: a fixed 256-place integer grid, not the
// production parser, exponent-elimination proof, remainder module or target code.
// The broad magnitude/bounds and greatest-candidate contract have separate unit
// evidence; this route proves every actual transaction and entire live world.
const GRID = 10n ** 256n;
function grid(text: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) throw Error(`Independent amount syntax: ${text}`);
  const fraction = m[2] ?? "", shift = 256 + Number(m[3] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(shift) || shift < 0 || shift > 512) throw Error("Natural-route oracle fixed-grid bound exceeded");
  return BigInt(m[1]! + fraction) * 10n ** BigInt(shift);
}
function gridText(value: bigint): string {
  if (value < 0n) throw Error("Negative independent monetary amount");
  const digits = value.toString().padStart(257, "0"), whole = digits.slice(0, -256), fraction = digits.slice(-256).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
function validTail(text: string): boolean { return text === "0" || /^0\.\d{0,255}[1-9]$/.test(text); }
function independentSettlement(before: any, prior: string, signedInteger: number): { wallet: any; remainder: string } | null {
  if (!validTail(prior) || !Number.isSafeInteger(signedInteger)) return null;
  if (signedInteger === 0) return { wallet: before, remainder: prior };
  const sourceText = before.toString(), source = grid(sourceText), oldTail = grid(prior);
  if (old.decimal.big(sourceText).toString() !== sourceText || signedInteger < 0 && source < BigInt(-signedInteger) * GRID) return null;
  const target = source + oldTail + BigInt(signedInteger) * GRID;
  if (target < 0n) return null;
  let best: { wallet: any; remainder: string; represented: bigint } | null = null;
  const consider = (candidate: any) => {
    const text = candidate.toString();
    if (!Number.isFinite(candidate.mantissa) || !Number.isFinite(candidate.exponent) || candidate.mantissa < 0) return;
    const restored = old.decimal.big(text);
    if (restored.toString() !== text || restored.mantissa !== candidate.mantissa || restored.exponent !== candidate.exponent) return;
    const represented = grid(text), gap = target - represented;
    if (gap < 0n || gap >= GRID || best && represented <= best.represented) return;
    const remainder = gridText(gap);
    if (!validTail(remainder)) return;
    // Original five terms are re-parsed independently, not an assumed result of
    // target-minus-candidate construction. No floating or monetary tolerance.
    if (grid(sourceText) + grid(prior) + BigInt(signedInteger) * GRID - grid(text) - grid(remainder) !== 0n) throw Error("Independent five-term conservation failed");
    best = { wallet: candidate, remainder, represented };
  };
  const considerBoth = (value: any) => { consider(value); consider(old.decimal.big(value.toString())); };
  let candidate = old.decimal.big(gridText(target));
  for (let step = 0; step <= 64; step++) {
    considerBoth(candidate);
    if (candidate.mantissa <= 0) break;
    const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, candidate.mantissa);
    bits.setBigUint64(0, bits.getBigUint64(0) - 1n);
    candidate = old.decimal.big(0).fromMantissaExponent(bits.getFloat64(0), candidate.exponent);
  }
  const fixedDigits = target.toString(), significant = fixedDigits.replace(/0+$/, "");
  for (let keep = 17; keep >= 1; keep--) {
    if (keep >= significant.length) continue;
    const omitted = fixedDigits.length - keep, cut = target / 10n ** BigInt(omitted) * 10n ** BigInt(omitted);
    considerBoth(old.decimal.big(gridText(cut)));
  }
  // TypeScript cannot infer writes inside the bounded visitor closures.
  const result = best as { wallet: any; remainder: string; represented: bigint } | null;
  return result ? { wallet: result.wallet, remainder: result.remainder } : null;
}
function recordMoney(kind: string, fleetId: number, originId: string, resource: string, before: any, prior: string, signedInteger: number, pair: { wallet: any; remainder: string }) {
  const source = before.toString(), after = pair.wallet.toString();
  check("NPC signed five-term exact conservation", grid(source) + grid(prior) + BigInt(signedInteger) * GRID === grid(after) + grid(pair.remainder));
  check("NPC tail is canonical nonnegative strict subunit", validTail(pair.remainder) && grid(pair.remainder) >= 0n && grid(pair.remainder) < GRID);
  check("NPC main never exceeds exact target", grid(after) <= grid(source) + grid(prior) + BigInt(signedInteger) * GRID);
  if (signedInteger !== 0) { const read = old.decimal.big(after); check("NPC positive-transfer output is save-stable", read.toString() === after && read.mantissa === pair.wallet.mantissa && read.exponent === pair.wallet.exponent); }
  if (signedInteger < 0) check("pending tail never bypasses main-only fuel affordability", grid(source) >= BigInt(-signedInteger) * GRID);
  moneyWitnesses.push({ kind, fleetId, originId, resource, at: control.totalTime.toString(), beforeWallet: source, beforeRemainder: prior,
    signedInteger, afterWallet: after, afterRemainder: pair.remainder, fiveTermSum: "0", candidateConservative: true, exactSubunit: true });
}
function shadowArrival(f: RecordValue, retry = false) {
  if (f.returning) {
    const owners = control.planets.filter((x: RecordValue) => x.id === f.originId); exact("unique original docking owner", owners.length, 1);
    const p = owners[0], pairs = Object.fromEntries(RES.map(r => [r, independentSettlement(p.resources[r], remainders[p.id]![r]!, Number(f.cargo[r]))]));
    const resources = Object.fromEntries(RES.map(r => [r, pairs[r]?.wallet ?? null]));
    if (RES.some(r => resources[r] === null)) {
      if (retry || f.npcAttack.phase.dockBlocked) return false;
      attacks = attacks.map(x => x.id !== f.id ? x : { ...x, npcAttack: { ...x.npcAttack, phase: { ...x.npcAttack.phase, dockBlocked: true } } });
      addMessage(`npc-dock-blocked-${f.id}`, `攻击舰队 #${f.id} 返港入库受阻，全部舰船与货物已保留；调整母港库存或舰船数量后可重试。`); return false;
    }
    for (const r of RES) recordMoney("loot-dock", f.id, f.originId, r, p.resources[r], remainders[p.id]![r]!, Number(f.cargo[r]), pairs[r]!);
    remainders[p.id] = Object.fromEntries(RES.map(r => [r, pairs[r]!.remainder]));
    control = { ...control, planets: control.planets.map((p: RecordValue) => p.id !== f.originId ? p : { ...p,
      resources,
      units: { ...p.units, light_fighter: p.units.light_fighter + f.ships.light_fighter } }) };
    attacks = attacks.filter(x => x.id !== f.id); reports = reports.map(x => x.fleetId === f.id ? { ...x, delivery: "delivered" } : x);
    addMessage(`return-${f.id}`, `攻击舰队 #${f.id} 已返航，全部幸存舰船与战利品权益已安全入港。${RES.some(r => remainders[f.originId]![r] !== "0") ? "母港有不足 1 的待结算权益，已单独保留。" : ""}`); return true;
  }
  const fought = battle(f.id, f.ships.light_fighter, npc.sites[KEY].garrison.light_fighter), before = stock(), survivors = Number(fought.attackerAfter.light_fighter ?? 0);
  const loot = fought.winner === "attacker" && survivors ? allocate(before, survivors) : [0, 0, 0];
  const oldSite = npc.sites[KEY]; npc.sites[KEY] = { ...(loot.some(n => n) ? { stock: before.map((n: number, i: number) => n - loot[i]!), mark: npc.now } : { stock: oldSite.stock, mark: oldSite.mark }), garrison: { light_fighter: fought.defenderAfter.light_fighter ?? 0, heavy_fighter: 0 } };
  reports.push({ fleetId: f.id, originId: f.originId, target: TARGET, at: control.totalTime.toString(), seed: fnv(f.id), cargoFactor: 1.4,
    attackerTech: { weapons: 1, shields: 5, armour: 0 }, battle: fought, stockBefore: before, loot, delivery: survivors ? "returning" : "destroyed" });
  attacks = survivors ? attacks.map(x => x.id !== f.id ? x : { ...x, ships: fought.attackerAfter, cargo: Object.fromEntries(RES.map((r, i) => [r, String(loot[i])])), returning: true, remaining: x.duration, elapsed: 0, npcAttack: { ...x.npcAttack, phase: { kind: "returning", reason: "battle", dockBlocked: false } } }) : attacks.filter(x => x.id !== f.id);
  const text = !Object.keys(fought.defenderBefore).length ? "无驻军收集（0 轮）" : `${fought.rounds.length} 轮轨道战：${fought.winner === "attacker" ? "胜利" : fought.winner === "defender" ? "战败" : "平局"}`;
  addMessage(`npc-battle-${f.id}`, `攻击舰队 #${f.id} ${text}，${survivors ? "幸存舰船携战利品返航" : "舰队全损"}；永久损失与战利品详见战报。`);
}
function advance(seconds: number, name: string) {
  stage = name; const sourceState = state, before = serializeState(state); state = tick(state, seconds, "live");
  if (!branches.exactDockBoundary) {
    const blocked = state.fleets.find(f => f.npcAttack?.phase.kind === "returning" && f.npcAttack.phase.dockBlocked);
    const departed = blocked && sourceState.fleets.find(f => f.id === blocked.id && f.returning && f.remaining > 0);
    if (departed) {
      const event = tick(sourceState, departed.remaining, "live"), origin = event.planets.find(p => p.id === departed.originId)!;
      branches.exactDockBoundary = { classification: "Separate actual positive tick from the untouched preceding natural frame to the precise already-scheduled return. No changes to input fields or the main trajectory.",
        startElapsedSeconds: elapsed, stepSeconds: departed.remaining, gameTime: event.totalTime.toString(), state: serializeState(event),
        runtimeRepresentation: Object.fromEntries(RES.map(r => { const value = origin.resources[r], restored = old.decimal.big(value.toString());
          return [r, { text: value.toString(), runtimeMantissa: value.mantissa, runtimeExponent: value.exponent, restoredMantissa: restored.mantissa, restoredExponent: restored.exponent, stable: value.mantissa === restored.mantissa && value.exponent === restored.exponent }]; })) };
    }
  }
  let left = seconds;
  while (left > 1e-9) {
    let segment = Math.min(left, ...attacks.filter(f => !f.npcAttack.phase.dockBlocked).map(f => f.remaining));
    if (attacks.some(f => !f.npcAttack.phase.dockBlocked)) {
      // Mirror only old public event boundaries, using the pinned old engine's
      // economy. This prevents pretending a new attack timer saw one segment
      // when a player store actually became full in the middle of that second.
      segment = Math.min(segment, 1 - control.protocols.accumulator);
      for (const p of control.planets) {
        const eco = old.economy.economy({ ...control, activePlanetId: p.id });
        for (const r of RES) { const amount = p.resources[r].toNumber(); if (amount < eco.caps[r] && eco.net[r] > 0) segment = Math.min(segment, (eco.caps[r] - amount) / eco.net[r]); }
      }
    }
    const messages = new Set(control.messages.map((m: RecordValue) => m.id));
    const oldFleets = control.fleets;
    control = old.logic.tick(control, segment, "live"); npc.now = control.npcEconomy.elapsedSeconds;
    for (const message of control.messages) if (message.id.startsWith("scout-") && !messages.has(message.id)) {
      const fleetId = Number(message.id.slice(6)), fleet = oldFleets.find((f: RecordValue) => f.id === fleetId);
      check("new independent typed observation requires a real old-engine outbound scout", fleet && fleet.mission === "scout" && !fleet.returning);
      exact("independent observed scout target is the fixed natural NPC", fleet.target, TARGET);
      check("one typed observation per actual old-engine scout arrival", !scoutSnapshots.has(message.id));
      scoutSnapshots.set(message.id, { model: "npc-scout-snapshot-v1", fleetId, originId: fleet.originId, target: { ...TARGET },
        observedAt: control.totalTime.toString(), stock: stock().map((value: number) => value === 0 ? 0 : value),
        garrison: { ...(npc.sites[KEY]?.garrison ?? { light_fighter: 4, heavy_fighter: 0 }) },
        defenderTech: { weapons: 0, shields: 0, armour: 0 } });
      message.text = resourceOracleText();
    }
    attacks = attacks.map(f => f.npcAttack.phase.dockBlocked ? f : ({ ...f, remaining: Math.max(0, f.remaining - segment), elapsed: f.elapsed + segment }));
    for (const f of [...attacks].filter(f => f.remaining === 0 && !f.npcAttack.phase.dockBlocked).sort((a, b) => a.id - b.id)) shadowArrival(f);
    left -= segment; if (segment === 0 && !attacks.some(f => f.remaining === 0)) continue;
  }
  elapsed += seconds; tape.push({ kind: "advance", seconds, name });
  check("actual tick source remains immutable", isDeepStrictEqual(serializeState(sourceState), before)); invariant();
}
function action(kind: string, operation: () => { ok: boolean; reason: string; state: GameState }, reference: () => any, details: RecordValue = {}) {
  stage = kind;
  const beforeTails = state.planets.map(p => [p.id, { ...p.npcResourceRemainder }]), oldJobId = state.orders.nextJobId;
  const result = operation(); check(`real paid action accepted: ${result.reason}`, result.ok); state = result.state;
  exact("legacy paid action preserves every per-planet right", state.planets.map(p => [p.id, { ...p.npcResourceRemainder }]), beforeTails);
  if (kind === "research" || kind === "build") {
    const job = kind === "research" ? state.research.queue[0]! : activePlanet(state).shipyardQueue[0]!;
    exact("real paid job has independently expected identity/source", [job.jobId, job.source, job.taskId], [oldJobId, "manual", null]);
    const paid = kind === "research" ? RES.map(r => state.research.queue[0]!.paid[r].toString())
      : RES.map(r => activePlanet(state).shipyardQueue[0]!.paidPerUnit[r].mul(activePlanet(state).shipyardQueue[0]!.orderedCount).toString());
    exact("real paid job locks literal resource cost", paid, kind === "research" ? ["800", "200", "0"] : ["9000", "3000", "0"]);
  }
  const prior = reference(); check("pinned eef accepts same legal action", prior.ok); control = prior.state;
  tape.push({ kind, ...details }); invariant();
}
function request(mission: "scout" | "attack", count = 0) {
  return { mission, target: TARGET, ships: { ...NPC_SCOUT_UI_SELECTION, espionage_probe: mission === "scout" ? 1 : 0, light_fighter: count }, cargo: emptyCargo(), speedPercent: 100 };
}
function scout(name: string) { const r = request("scout"); action("scout", () => sendFleet(state, r), () => old.fleet.sendFleet(control, r)); checkpoint(name); }
function attack(count: number, name: string) {
  const r = request("attack", count);
  // Fixed authentic sequence: no representational waiting or alternate price.
  // A legal ordinary launch rejection is an acceptance failure.
  const quoteSource = serializeState(state), q = quoteFlight(state, r); exact("quote is pure across every wallet/right/identity", serializeState(state), quoteSource);
  const fuel = (Math.ceil(20 * count * (1025 / 35000) * 4) + 1) * 2;
  check(`${name}: quote accepted`, q.ok); exact("independent duration/fuel/capacity", [q.duration, q.fuel.toNumber(), q.capacity.toNumber()], [DURATION, fuel, count * 70]);
  const id = state.nextFleetId, sourcePlanet = control.planets.find((p: RecordValue) => p.id === "homeworld"), prior = remainders.homeworld!.deuterium!;
  const pair = independentSettlement(sourcePlanet.resources.deuterium, prior, -fuel);
  check("independent natural fuel settlement exists", pair !== null);
  const result = sendFleet(state, r); check(`${name}: real attack accepted`, result.ok); state = result.state;
  recordMoney("fuel-launch", id, "homeworld", "deuterium", sourcePlanet.resources.deuterium, prior, -fuel, pair!);
  remainders.homeworld!.deuterium = pair!.remainder;
  control = { ...control, nextFleetId: id + 1, planets: control.planets.map((p: RecordValue) => p.id !== "homeworld" ? p : { ...p,
    resources: { ...p.resources, deuterium: pair!.wallet }, units: { ...p.units, light_fighter: p.units.light_fighter - count } }) };
  if (!npc.sites[KEY]) npc.sites[KEY] = { stock: stock(), mark: npc.now, garrison: { light_fighter: 4, heavy_fighter: 0 } };
  attacks.push({ id, orderTransport: null, originId: "homeworld", target: TARGET, mission: "attack", ships: { light_fighter: count },
    cargo: { metal: "0", crystal: "0", deuterium: "0" }, duration: DURATION, remaining: DURATION, returning: false, elapsed: 0,
    npcAttack: { seed: fnv(id), cargoFactor: 1.4, phase: { kind: "outbound" } } });
  addMessage(`dispatch-${id}`, `轨道攻击舰队 #${id} 已从 母星 出发，目标 [1:56:6]。`);
  tape.push({ kind: "attack", count, fleetId: id, expectedFuel: fuel }); checkpoint(name); return id;
}
function untilNoFleet(name: string) {
  for (let n = 1; state.fleets.length && n <= 40; n++) {
    advance(1, `${name}-${n}`); checkpoint(`${name}-${n}`);
    for (const fleet of state.fleets.filter(f => f.npcAttack?.phase.kind === "returning" && f.npcAttack.phase.dockBlocked)) {
      const first = retryNpcAttackDock(state, fleet.id), second = retryNpcAttackDock(first.state, fleet.id);
      exact("second retry cannot credit twice or mutate the first retry's outcome", serializeState(second.state), serializeState(first.state));
      if (!first.ok) exact("failed retry preserves the original complete state", serializeState(first.state), serializeState(state));
      branches.naturalDockBlocker = { capturedFrameElapsedSeconds: elapsed, fleetId: fleet.id, raw: milestones.at(-1)!.raw,
        state: serializeState(state), diagnosticRetry: { accepted: first.ok, reason: first.reason, state: serializeState(first.state),
          classification: "Separate frame-end diagnostic only; never adopted into the natural main chain." },
        expectedDeliveredResources: Object.fromEntries(RES.map(r => [r, independentSettlement(activePlanet(state).resources[r], activePlanet(state).npcResourceRemainder[r], fleet.cargo[r].toNumber())?.wallet.toString() ?? null])),
        exactEvent: branches.exactDockBoundary ?? null,
        classification: "First ordinary natural arrival retained the complete fleet/cargo instead of delivering. Frame-end production can differ from exact-event amounts; no synthetic balances, no waiting-as-fix claim." };
      check("ordinary natural loot must dock without a representational retry lottery", false);

    }
  }
  check("bounded true return completed", !state.fleets.length);
}
function build(count: number, name: string) { action("build", () => orderUnits(state, "light_fighter", count, "manual"), () => old.shipyard.orderUnits(control, "light_fighter", count, "manual"), { unit: "light_fighter", count }); checkpoint(`${name}-paid`); for (let i = 0; i < 3; i++) advance(1, `${name}-construction-${i + 1}`); checkpoint(`${name}-complete`); }
try {
  const frozen = JSON.parse(String(readFileSync(new URL("../tests/fixtures/npc-attack-independent-goldens.json", import.meta.url))));
  exact("Python independently frozen draw7 rounds", battle(7, 4, 4), frozen.draw7);
  exact("Python independently frozen win8 rounds", battle(8, 6, 2), frozen.win8);
  const bytes = readFileSync(args.get("--base-report")), base = JSON.parse(String(bytes));
  check("input report independently hash bound", hash(bytes) === args.get("--base-report-sha256"));
  check("source is completed exact eef public natural 66-second two-scout route", base.schema === "infinity-npc-natural-r11-route-v1" && base.outcome.status === "passed" && base.source.sourceSha === PIN && base.source.sourceScopeStatusPorcelain === "" && base.timing.adoptedContinuationGameSeconds === 66);
  const row = base.milestones.find((m: RecordValue) => m.name === "final-returned-and-reloaded");
  check("original public r12 raw save pinned before candidate reader", row.rawSha256 === RAW_SHA && hash(row.raw) === RAW_SHA && row.save.revision === 12 && row.save.state.totalTime === "25876");
  exact("exact pinned historical oracle checkout", git(LEGACY, "rev-parse", "HEAD"), PIN);
  exact("historical source and lock unchanged", git(LEGACY, "diff", "HEAD", "--", "src", "package.json", "package-lock.json"), "");
  exact("historical source has no new modules", git(LEGACY, "ls-files", "--others", "--", "src"), "");
  exact("historical source has no ignored shadow modules", git(LEGACY, "ls-files", "--others", "--ignored", "--exclude-standard", "--", "src"), "");
  const historicalFiles = git(LEGACY, "ls-tree", "-r", "--name-only", PIN, "--", "src").split("\n").filter(Boolean).map((path: string) => {
    const bytes = readFileSync(resolve(LEGACY, path));
    check(`historical actual imported bytes equal pinned eef:${path}`, bytes.equals(execFileSync("git", ["show", `${PIN}:${path}`], { cwd: LEGACY, timeout: 10000 })));
    return { path, sha256: hash(bytes) };
  });
  old = Object.fromEntries(await Promise.all(["save", "logic", "fleet", "research", "shipyard", "decimal", "economy"].map(async name => [name, await import(pathToFileURL(resolve(LEGACY, `src/game/${name}.ts`)).href)])));
  for (const golden of frozen.remainderGoldens) {
    const pair = independentSettlement(old.decimal.big(golden.source), golden.prior, golden.signedInteger);
    exact(`independent frozen monetary pair: ${golden.name}`, pair ? [pair.wallet.toString(), pair.remainder] : [null, null], [golden.wallet, golden.remainder]);
  }
  const files = git(ROOT, "ls-files", "--cached", "--others", "--exclude-standard", "--", "src").split("\n").filter(Boolean).map((path: string) => ({ path, sha256: hash(readFileSync(resolve(ROOT, path))) }));
  source = { reloadSchedule: RELOAD_SCHEDULE, sourceSha: git(ROOT, "rev-parse", "HEAD"), gitHead: git(ROOT, "rev-parse", "HEAD"), sourceScopeStatusPorcelain: git(ROOT, "status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ":(glob)*.json", ":(glob)*.ts", ":(glob)*.mjs", "index.html", ".github"), sourceFiles: files, scriptSha256: hash(readFileSync(new URL(import.meta.url))), historicalProducer: { sourceSha: PIN, srcTree: git(LEGACY, "rev-parse", "HEAD:src"), sourceFiles: historicalFiles }, baseReportSha256: hash(bytes) };
  original = { ...row.save, raw: row.raw, rawSha256: RAW_SHA }; startAt = row.save.lastTickAt;
  state = deserializeState(importSave(row.raw).state); control = old.save.deserializeState(old.save.importSave(row.raw).state);
  // Oracle-only relative clock, never passed to candidate or browser as a save.
  control.npcEconomy = { model: "fixed-production-v1", elapsedSeconds: 0 };
  npc = { model: "npc-wallet-garrison-v1", now: 0, baseline: { stock: [830, 415, 66], mark: 0 }, sites: {} };
  remainders = Object.fromEntries(original.state.planets.map((p: RecordValue) => [p.id, { metal: "0", crystal: "0", deuterium: "0" }]));
  exact("legacy source grants zero tail to every migrated planet only", state.planets.map(p => p.npcResourceRemainder), Object.values(remainders));
  checkpoint("r12-final-migrated-r14");
  check("weapons0 genuinely blocks attack without partial mutation", !quoteFlight(state, request("attack", 1)).ok && sendFleet(state, request("attack", 1)).state === state);
  scout("new-scout6-outbound"); advance(1, "new-scout6-arrival"); checkpoint("new-scout6-historical-garrison"); advance(1, "new-scout6-return"); checkpoint("new-scout6-returned");
  action("research", () => enqueueResearch(state, "weapons_tech", "manual"), () => old.research.enqueueResearch(control, "weapons_tech", "manual"), { tech: "weapons_tech" }); checkpoint("weapons1-paid-unfinished");
  check("queued weapons1 cannot authorize attack", !quoteFlight(state, request("attack", 1)).ok); advance(1, "weapons1-real-completion"); checkpoint("weapons1-complete");
  build(3, "first-three-fighters"); const drawId = attack(4, "attack7-paid-outbound"); untilNoFleet("attack7-live-loop"); checkpoint("draw7-survivors-returned");
  const draw = state.npcBattles.reports.find(r => r.fleetId === drawId)!;
  exact("independent permanent-loss six-round golden", [draw.battle.winner, draw.battle.rounds.length, draw.battle.attackerAfter, draw.battle.defenderAfter, draw.loot], ["draw", 6, { light_fighter: 3 }, { light_fighter: 2 }, [0, 0, 0]]);
  build(3, "second-three-fighters"); const winId = attack(6, "attack8-paid-outbound"); untilNoFleet("attack8-live-loop"); checkpoint("win8-loot-delivered-once");
  const win = state.npcBattles.reports.find(r => r.fleetId === winId)!; exact("independent win and permanent NPC depletion", [win.battle.winner, win.battle.rounds.length, win.battle.attackerAfter, win.battle.defenderAfter], ["attacker", 3, { light_fighter: 6 }, {}]);
  check("actual cargo delivered with no reward mechanism", win.delivery === "delivered" && win.loot.reduce((a, b) => a + b, 0) === 420);
  for (let i = 0; i < 5; i++) advance(1, `same-npc-production-${i + 1}`);
  scout("rescout9-outbound"); advance(1, "rescout9-arrival"); checkpoint("rescout9-dead-garrison-still-zero"); advance(1, "rescout9-return"); checkpoint("rescout9-returned");
  attack(1, "empty10-paid-outbound"); untilNoFleet("empty10-live-loop"); checkpoint("empty10-zero-round-loot-delivered");
  const empty = state.npcBattles.reports.find(r => r.fleetId === 10)!; exact("no replenishment: zero-round paid collection", [empty.battle.rounds, empty.battle.defenderBefore, empty.battle.defenderAfter], [[], {}, {}]);
  exact("unchanged natural action/time sequence finishes at31 seconds", elapsed, 31);
  check("one player loss persists after all returns", activePlanet(state).units.light_fighter === 6); check("same actual probe safely returned", activePlanet(state).units.espionage_probe === 1);
  exact("all34 checkpoints retain both strict roundtrip validations", milestones.length, 34);
  exact("live adoption follows the selected complete reload schedule", milestones.filter(m => m.stateAdoptedFromReload).map(m => m.name),
    nativeSchedule ? NATIVE_RELOAD_CHECKPOINTS : milestones.map(m => m.name));
  mainComplete = true;
  // Refresh/offline use genuine complete saved milestones, no economic edits.
  stage = "branch-offline";
  const outbound = milestones.find(m => m.name === "attack8-paid-outbound")!;
  const memory = new Map([[STORAGE_KEY, outbound.raw]]), storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const now = outbound.save.lastTickAt + 10000, session = new SaveSession(storage, now); check("cold startup adopts genuine attack once", session.mode === "ready" && session.loaded.appliedSeconds === 10);
  check("offline battle preserves dedicated seed and expected outcome", isDeepStrictEqual(session.loaded.state.npcBattles.reports.find(r => r.fleetId === 8)?.battle, win.battle));
  check("offline state persists atomically", session.save(session.loaded.state, now, now).ok); const resumed = new SaveSession(storage, now); exact("same-time reload no second battle or credit", serializeState(resumed.loaded.state), serializeState(session.loaded.state));
  stage = "branch-recall";
  const recallBase = deserializeState(outbound.save.state); let recalled = tick(recallBase, 1, "live"); const recalledResult = recallFleet(recalled, 8); check("real outbound recall accepted", recalledResult.ok); recalled = tick(recalledResult.state, 1, "live");
  check("recall yields no battle, no loot, surviving full ships", !recalled.fleets.length && !recalled.npcBattles.reports.some(r => r.fleetId === 8) && activePlanet(recalled).units.light_fighter === 6);
  branches = { offline: { base: outbound.save, baseRaw: outbound.raw, now, rawGapSeconds: 10, expected: JSON.parse(memory.get(STORAGE_KEY)!), sameTimeReloadApplied: resumed.loaded.appliedSeconds }, recall: { base: outbound.save, baseRaw: outbound.raw, advanceBeforeRecall: 1, advanceAfterRecall: 1, expected: serializeState(recalled) } };
  stage = "branch-simultaneous";
  const simultaneousBase = milestones.find(m => m.name === "second-three-fighters-complete")!;
  let simultaneous = deserializeState(simultaneousBase.save.state);
  const both: number[] = [];
  for (let i = 0; i < 2; i++) {
    const paid = sendFleet(simultaneous, request("attack", 3)); check("same-arrival fork pays both genuine launches", paid.ok);
    simultaneous = paid.state; both.push(paid.fleetId!);
  }
  const simultaneousPaid = serializeState(simultaneous);
  for (let i = 0; i < 3; i++) simultaneous = tick(simultaneous, 1, "live");
  const simultaneousArrived = serializeState(simultaneous), actualReports = simultaneous.npcBattles.reports.filter(r => both.includes(r.fleetId));
  exact("same exact arrival reports use stable paid IDs", actualReports.map(r => r.fleetId), both);
  const first = battle(both[0]!, 3, 2), second = battle(both[1]!, 3, Number(first.defenderAfter.light_fighter ?? 0));
  exact("first same-arrival fight independent golden", actualReports[0]!.battle, first);
  exact("second same-arrival sees predecessor's permanent losses", actualReports[1]!.battle, second);
  for (let i = 0; i < 3; i++) simultaneous = tick(simultaneous, 1, "live");
  branches.simultaneous = { classification: "Separate real-action fork of a whole-state-proven natural milestone; no wallet, technology or ship injection. Current-engine complete envelopes have independently calculated combat goldens.",
    base: simultaneousBase.save, baseRaw: simultaneousBase.raw, count: 3, fleetIds: both, paid: simultaneousPaid, arrived: simultaneousArrived,
    returned: serializeState(simultaneous), advanceToArrival: 3, advanceToReturn: 3, independentBattles: [first, second] };

  // Boundary forks never feed their states back into the 31-second natural chain.
  // Only the explicitly listed synthetic field changes below are authorized.
  stage = "branch-earned-remainder-curvature";
  const finalRow = milestones.find(m => m.name === "empty10-zero-round-loot-delivered")!;
  const finalBefore = serializeState(state), evaluation = evaluatePrestige(state);
  check("unaltered natural final is genuinely curvature eligible", evaluation.next !== state && evaluation.gain.gte(1));
  check("unaltered natural final owns earned nonzero rights", state.planets.some(p => RES.some(r => p.npcResourceRemainder[r] !== "0")));
  exact("curvature evaluation leaves complete natural source unchanged", serializeState(state), finalBefore);
  const oldEvaluation = old.logic.evaluatePrestige(control), curvatureExpected = old.save.serializeState(oldEvaluation.next);
  curvatureExpected.messages = independentMessages(curvatureExpected.messages);
  curvatureExpected.npcEconomy = structuredClone(npc); curvatureExpected.npcBattles = { model: "npc-battle-receipts-v1", reports: structuredClone(reports) };
  curvatureExpected.planets = curvatureExpected.planets.map((p: RecordValue) => ({ ...p, npcResourceRemainder: { metal: "0", crystal: "0", deuterium: "0" } }));
  exact("curvature entire state equals pinned old evaluator plus independent retained NPC state and zero new rights", serializeState(evaluation.next), curvatureExpected);
  const confirmation = prestigeConfirmation(state, evaluation);
  check("curvature exact confirmation discloses earned right and no transfer/refund", confirmation.includes("母星 [homeworld]：金属 0 / 晶体 0.00000000006 / 重氢 0") && confirmation.includes("新母星的待结算权益归零，不转移或退款。"));
  branches.curvature = { classification: "Unedited whole-state-proven natural final31 fork with actually earned rights and naturally reached curvature eligibility. Exact economic reset is independently compared with pinned eef evaluation; confirmation string is the real UI formatter, separately checked for the literal earned right.",
    base: finalRow.save, baseRaw: finalRow.raw, gain: evaluation.gain.toString(), confirmation, expected: curvatureExpected };

  stage = "branch-synthetic-colony-right-abandon";
  const abandonmentInput = structuredClone(finalRow.save.state);
  const syntheticColony = abandonmentInput.planets.find((p: RecordValue) => p.id === "colony-1")!;
  exact("actual final colony starts with no right", syntheticColony.npcResourceRemainder, { metal: "0", crystal: "0", deuterium: "0" });
  syntheticColony.npcResourceRemainder.metal = "0.25";
  const abandonmentRaw = exportSave(deserializeState(abandonmentInput), finalRow.save.savedAt, finalRow.save.lastTickAt);
  const abandonmentBase = importSave(abandonmentRaw), abandonmentState = deserializeState(abandonmentBase.state);
  exact("single synthetic colony right survives strict reader without other edits", serializeState(abandonmentState), abandonmentInput);
  const abandoned = abandonColony(abandonmentState, "colony-1"); check("actual final colony can legally be abandoned", abandoned.ok);
  const abandonmentExpected = { ...abandonmentInput, planets: abandonmentInput.planets.filter((p: RecordValue) => p.id !== "colony-1"),
    deepSpace: { ...abandonmentInput.deepSpace, offers: abandonmentInput.deepSpace.offers.filter((o: RecordValue) => o.planetId !== "colony-1") } };
  exact("abandonment removes only owned colony/offers and never transfers its right", serializeState(abandoned.state), abandonmentExpected);
  exact("abandonment leaves complete input intact", serializeState(abandonmentState), abandonmentInput);
  branches.abandon = { classification: "EXPLICIT SYNTHETIC BOUNDARY: genuine natural final31, only colony-1 metal pending right changed from 0 to 0.25. No ordinary resource, score, technology, ship or time changes. This quarter-unit was not naturally earned.",
    syntheticChanges: [{ path: "planets[colony-1].npcResourceRemainder.metal", before: "0", after: "0.25" }],
    base: JSON.parse(abandonmentRaw), baseRaw: abandonmentRaw,
    confirmation: "放弃这颗殖民地？其资源、建筑、舰船和本地队列将永久丢失。\n该星球不足 1 的待结算权益也将丢失：金属 0.25。", expected: abandonmentExpected };

  stage = "branch-synthetic-report-source-identity";
  const identityInput = structuredClone(finalRow.save.state);
  const identityColony = identityInput.planets.find((p: RecordValue) => p.id === "colony-1")!;
  const identityReceipt = identityInput.npcBattles.reports.find((r: RecordValue) => r.fleetId === 8)!;
  const previousColonyName = identityColony.name;
  exact("report identity boundary starts with genuine delivered home report", [identityReceipt.originId, identityReceipt.delivery], ["homeworld", "delivered"]);
  identityColony.name = "远航殖民地 <星光 & 北岸> 测试";
  identityReceipt.originId = "colony-1";
  const identityRaw = exportSave(deserializeState(identityInput), finalRow.save.savedAt, finalRow.save.lastTickAt);
  const identityBase = importSave(identityRaw), identityState = deserializeState(identityBase.state);
  exact("only enumerated report identity edits survive complete strict readback", serializeState(identityState), identityInput);
  const identityReverted: RecordValue = structuredClone(identityBase.state);
  identityReverted.planets.find((p: RecordValue) => p.id === "colony-1")!.name = previousColonyName;
  identityReverted.npcBattles.reports.find((r: RecordValue) => r.fleetId === 8)!.originId = "homeworld";
  exact("identity fixture does not alter any other natural field", identityReverted, finalRow.save.state);
  const identityAbandoned = abandonColony(identityState, "colony-1");
  check("terminal report does not prevent lawful colony abandonment", identityAbandoned.ok);
  const identityExpected = { ...identityInput, planets: identityInput.planets.filter((p: RecordValue) => p.id !== "colony-1"),
    deepSpace: { ...identityInput.deepSpace, offers: identityInput.deepSpace.offers.filter((o: RecordValue) => o.planetId !== "colony-1") } };
  exact("missing source preserves the full immutable report and all other state", serializeState(identityAbandoned.state), identityExpected);
  exact("identity abandonment does not mutate its complete source", serializeState(identityState), identityInput);
  exact("missing-source report survives strict save reload", importSave(exportSave(identityAbandoned.state, finalRow.save.savedAt, finalRow.save.lastTickAt)).state, identityExpected);
  branches.reportIdentity = { classification: "EXPLICIT SYNTHETIC UI BOUNDARY: genuine natural final31, only colony-1 name and delivered report8 originId are replaced as enumerated. This is not a naturally fought colony battle or a native rename action. No resource, score, technology, ship, time, combat, loot, delivery or remainder change. Actual abandonment then makes that report source unavailable.",
    syntheticChanges: [{ path: "planets[colony-1].name", before: previousColonyName, after: identityColony.name },
      { path: "npcBattles.reports[8].originId", before: "homeworld", after: "colony-1" }],
    reportId: 8, base: identityBase, baseRaw: identityRaw,
    confirmation: "放弃这颗殖民地？其资源、建筑、舰船和本地队列将永久丢失。", expected: identityExpected };

  stage = "branch-synthetic-landed-limit-dock-retry";
  const preDockRow = milestones.find(m => m.name === "attack8-live-loop-4")!;
  const blockedInput = structuredClone(preDockRow.save.state);
  const blockedHome = blockedInput.planets.find((p: RecordValue) => p.id === "homeworld")!;
  const beforeSyntheticShips = blockedHome.units.light_fighter;
  blockedHome.units.light_fighter = 1e15;
  const blockedBaseRaw = exportSave(deserializeState(blockedInput), preDockRow.save.savedAt, preDockRow.save.lastTickAt);
  let blockedState = deserializeState(importSave(blockedBaseRaw).state);
  exact("synthetic landed-limit state survives strict current reader", serializeState(blockedState), blockedInput);
  blockedState = tick(blockedState, 1, "live");
  const blockedSave = serializeState(blockedState), blockedFleet = blockedState.fleets.find(f => f.id === 8)!;
  check("real paid return retains all six ships and cargo at genuine landed limit", blockedFleet.remaining === 0 && blockedFleet.npcAttack?.phase.kind === "returning" && blockedFleet.npcAttack.phase.dockBlocked && blockedFleet.ships.light_fighter === 6);
  exact("blocked return retains exact legitimate loot", RES.map(r => blockedFleet.cargo[r].toString()), ["265", "132", "23"]);
  const refused = retryNpcAttackDock(blockedState, 8); check("native retry still fails until ship capacity is released", !refused.ok);
  exact("failed retry preserves every source field", serializeState(refused.state), blockedSave);
  const blockedAt = preDockRow.save.savedAt + 1000;
  const blockedRaw = exportSave(blockedState, blockedAt, blockedAt);
  const blockedReloadedCopy = deserializeState(importSave(blockedRaw).state);
  exact("blocked return strictly reloads complete ship/cargo/right ownership", serializeState(blockedReloadedCopy), blockedSave);
  if (!nativeSchedule) blockedState = blockedReloadedCopy; // Preserve original frequent-reload branch coverage.
  const capacityQuote = quoteFlight(blockedState, request("attack", 6)); check("new attack permits legal release from stationed 1e15 without changing flight limit", capacityQuote.ok);
  const freed = sendFleet(blockedState, request("attack", 6)); check("six real paid outgoing ships release exactly six landed slots", freed.ok);
  const freedSave = serializeState(freed.state), oldHome = activePlanet(blockedState), freedHome = activePlanet(freed.state);
  exact("capacity release has exact ship count", freedHome.units.light_fighter, 1e15 - 6);
  const releasePair = independentSettlement(oldHome.resources.deuterium, oldHome.npcResourceRemainder.deuterium, -32)!;
  exact("capacity release pays independent exact fuel pair", [freedHome.resources.deuterium.toString(), freedHome.npcResourceRemainder.deuterium], [releasePair.wallet.toString(), releasePair.remainder]);
  const docked = retryNpcAttackDock(freed.state, 8); check("retry succeeds after actual paid capacity release", docked.ok);
  const dockedHome = activePlanet(docked.state), retryMoney = [];
  for (const r of RES) {
    const amount = blockedFleet.cargo[r].toNumber(), pair = independentSettlement(freedHome.resources[r], freedHome.npcResourceRemainder[r], amount)!;
    exact(`retry exact ${r} five-term pair`, [dockedHome.resources[r].toString(), dockedHome.npcResourceRemainder[r]], [pair.wallet.toString(), pair.remainder]);
    check(`retry independent ${r} conservation`, grid(freedHome.resources[r].toString()) + grid(freedHome.npcResourceRemainder[r]) + BigInt(amount) * GRID === grid(dockedHome.resources[r].toString()) + grid(dockedHome.npcResourceRemainder[r]));
    retryMoney.push({ resource: r, beforeWallet: freedHome.resources[r].toString(), beforeRemainder: freedHome.npcResourceRemainder[r], signedInteger: amount, afterWallet: dockedHome.resources[r].toString(), afterRemainder: dockedHome.npcResourceRemainder[r] });
  }
  exact("retry fills only the original home slots once", dockedHome.units.light_fighter, 1e15);
  check("retry removes only original fleet and marks only its receipt delivered", !docked.state.fleets.some(f => f.id === 8) && docked.state.fleets.some(f => f.id === freed.fleetId) && docked.state.npcBattles.reports.find(r => r.fleetId === 8)?.delivery === "delivered");
  const repeated = retryNpcAttackDock(docked.state, 8); check("second successful-retry attempt is rejected", !repeated.ok);
  exact("second retry is all-state no-op", serializeState(repeated.state), serializeState(docked.state));
  exact("successful retry cannot alter NPC stock or garrison", docked.state.npcEconomy, freed.state.npcEconomy);
  exact("successful retry never transfers rights to another planet", docked.state.planets.filter(p => p.id !== "homeworld"), freed.state.planets.filter(p => p.id !== "homeworld"));
  const finalRetryRaw = exportSave(docked.state, blockedAt, blockedAt);
  exact("successful retry full state is strict-reader stable", importSave(finalRetryRaw).state, serializeState(docked.state));
  branches.blockedRetry = { classification: "EXPLICIT SYNTHETIC BOUNDARY: real paid attack8 return from natural18, only home landed LF count set to 1e15. Strict reader accepts it. Real arrival blocks, unchanged retry fails, genuine paid attack sends six ships, one retry deposits original six ships and original loot exactly once. No resource, technology, NPC, fleet, cargo or time injection.",
    syntheticChanges: [{ path: "planets[homeworld].units.light_fighter", before: beforeSyntheticShips, after: 1e15 }],
    base: JSON.parse(blockedBaseRaw), baseRaw: blockedBaseRaw, advanceToBlocked: 1, fleetId: 8, releaseCount: 6, releaseFleetId: freed.fleetId,
    stateAdoptedFromReload: !nativeSchedule, strictRoundtrips: 1, blocked: blockedSave, blockedRaw, refusal: refused.reason, released: freedSave, expected: serializeState(docked.state), moneyWitnesses: retryMoney };

  stage = "source-recheck";
  check("historical bytes unchanged during route", historicalFiles.every((f: RecordValue) => hash(readFileSync(resolve(LEGACY, f.path))) === f.sha256));
  check("candidate bytes unchanged during route", files.every((f: RecordValue) => hash(readFileSync(resolve(ROOT, f.path))) === f.sha256));
} catch (error) { failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
const expected = Object.fromEntries(milestones.map(m => [m.name, m.save.state]));
const report = { schema: "infinity-npc-attack-natural-route-v2", source: source!, key: STORAGE_KEY, homeId: "homeworld", colonyId: "colony-1",
  description: "Exact public eef r12 66-second two-scout save → real r14 typed scout6 → paid weapons1 and six built LF → draw7 permanent loss → win8 loot/return → production/rescout9 → empty10 collection. Independent LF combat/loot plus exact pinned eef whole-state legacy control.",
  origin: original!, originalSave: original! ? JSON.parse(original!.raw) : null, originalSaveRaw: original?.raw, base: milestones[0]?.save,
  importedSave: milestones[0]?.save, provenance: { scope: "Natural main and non-synthetic forks only; branches.abandon, branches.blockedRetry and branches.reportIdentity enumerate all synthetic changes", syntheticBranches: ["abandon", "blockedRetry", "reportIdentity"], injectedGameState: false, noWalletTechnologyShipClockInjection: true, originalR12RawSha256: RAW_SHA, legacyOracleSource: PIN, oracleStateNeverAdoptedByCandidate: true },
  literalGoldens: { originalTotalTime: 25876, originalNpcStock: [830, 415, 66], weaponsCost: [800, 200, 0], eachThreeFighterCost: [9000, 3000, 0], lightFighterSeconds: .96, distance: 1025, duration: DURATION, attack7Seed: 1037330552, attack8Seed: 1344031299, draw7: battle(7, 4, 4), win8: battle(8, 6, 2), winCapacity: 420, finalFighters: 6 },
  moneyWitnesses, remainderGoldens: JSON.parse(String(readFileSync(new URL("../tests/fixtures/npc-attack-independent-goldens.json", import.meta.url)))).remainderGoldens, remainderOracle: "Independent fixed256-place BigInt grid; old eef Decimal represents candidate values only. Five-term conservation is proven for each exact-event fuel/loot settlement. Bounded greatest-candidate enumeration is independently implemented and cross-checked with frozen literal amount goldens; no production remainder helper imports.",
  reloadSchedule: { name: nativeSchedule ? "native-four-reload-oracle" : "frequent-reload-regression", mode: RELOAD_SCHEDULE,
    checkpointNames: milestones.filter(m => m.stateAdoptedFromReload).map(m => m.name), strictRoundtripsPerCheckpoint: 2,
    validation: "detached-copies", candidateReadsPerReload: nativeSchedule ? 1 : 2, controlReadsPerReload: 1,
    blockedRetryAdoptsReload: !nativeSchedule },
  tape, milestones, naturalMilestones: Object.fromEntries(milestones.map(m => [m.name, m])), expected, branches,
  timing: { wallElapsedSeconds: (performance.now() - started) / 1000, adoptedContinuationGameSeconds: elapsed }, checks,
  outcome: { status: failure ? "failed" : "passed", mainStatus: mainComplete ? "passed" : "failed", failure, lastStage: stage, finalStateSha256: state! ? hash(JSON.stringify(serializeState(state!))) : null, totalGameSeconds: state!?.totalTime.toString() } };
writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ status: report.outcome.status, failure, elapsed, checks: checks.length, report: OUTPUT }) + "\n");
