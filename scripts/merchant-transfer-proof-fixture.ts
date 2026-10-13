/** Explicit anonymous synthetic fixtures for the unchanged released 6b merchant.
 * createOffer is real. Wallet and 3:2:1 edits are synthetic, never natural progress.
 * No trade is executed here: expected native outcomes are independent literals.
 * Copy this test-only file into the exact baseline scripts directory to execute.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void } };
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { createOffer, tradeQuote } from "../src/game/merchant";
import { catchUp } from "../src/core/offline";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { STORAGE_KEY } from "../src/game/content";
import { SaveSession } from "../src/game/save-session";
import { createInitialState } from "../src/game/state";

const { deepStrictEqual, strictEqual } = await import("node:assert/strict" as string);
const fs = await import("node:fs" as string);
const crypto = await import("node:crypto" as string);
const path = await import("node:path" as string);
const { execFileSync } = await import("node:child_process" as string);
const BASE = "6b985b88ec6b263a3eeb8f34252525383a9f110f";
const EPOCH = 1_791_849_600_000;
const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
strictEqual(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), BASE);
strictEqual(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }), "");

function differences(a: unknown, b: unknown, prefix = ""): unknown[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [{ path: prefix, before: a, after: b }];
    return a.flatMap((value, index) => differences(value, b[index], prefix + "/" + index));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object"
      && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
      .flatMap(key => differences(left[key] ?? null, right[key] ?? null, prefix + "/" + key));
  }
  return [{ path: prefix, before: a, after: b }];
}

function readExactly(raw: string) {
  const envelope = JSON.parse(raw);
  const accepted = importSave(raw);
  deepStrictEqual(accepted, envelope, "Reader must not migrate or alter the original envelope");
  const state = deserializeState(accepted.state);
  deepStrictEqual(serializeState(state), envelope.state, "Full canonical state must survive the actual reader");
  return { envelope, state };
}

if (process.argv[2] === "--verify-native") {
  const directory = path.resolve(process.argv[3]);
  const reportPath = path.join(directory, "report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  strictEqual(report.codeSourceSha, BASE);
  strictEqual(report.nativeCompleted, true);
  strictEqual(report.nativeBodyCompleted, true);
  strictEqual(report.cleanup.completed, true);
  strictEqual(report.cleanup.deadlineExceeded, false);
  deepStrictEqual(report.cleanupErrors, []);
  deepStrictEqual(report.cleanup.errors, []);
  strictEqual(report.cleanup.resources.length, 5);
  strictEqual(report.cleanup.resources.every((entry: { status: string }) => ["closed", "not-active"].includes(entry.status)), true);
  strictEqual(report.cleanup.hostElapsedSeconds >= 0 && report.cleanup.hostElapsedSeconds <= report.cleanup.budgetSeconds
    && report.cleanup.budgetSeconds <= 10, true);
  strictEqual(report.nativeBrowserElapsedSeconds >= 0 && report.nativeBrowserElapsedSeconds <= 150, true);
  strictEqual(report.nativeLifecycleElapsedSeconds >= 0 && report.nativeLifecycleElapsedSeconds <= 160, true);
  strictEqual(report.knownBugConfirmed, true);
  strictEqual(report.completed, false);
  strictEqual(report.productSafetyGate, false);
  deepStrictEqual(report.cases.map((c: { case: string }) => c.case), ["ordinary-control", "unrepresentable-seller"]);
  strictEqual(report.saveFiles.length, 10, "Five complete original/actual saves per case");
  deepStrictEqual(report.saveFiles.map((entry: { file: string }) => entry.file),
    ["ordinary-control", "unrepresentable-seller"].flatMap(name =>
      ["original", "before", "after", "manual-after", "reload-after"].map(stage => `${name}-${stage}.save.json`)));
  strictEqual(report.cases.every((entry: { completed: boolean }) => entry.completed === true), true);
  strictEqual(report.errors.length, 0);
  strictEqual(report.checks.every((entry: { passed: boolean }) => entry.passed === true), true);
  const acceptance = report.saveFiles.map((entry: { file: string; sha256: string }) => {
    strictEqual(path.basename(entry.file), entry.file);
    const raw = fs.readFileSync(path.join(directory, entry.file), "utf8");
    strictEqual(hash(raw), entry.sha256, "Verify exact native saved bytes, not a reconstructed substitute");
    const { envelope, state } = readExactly(raw);
    const zeroGapState = serializeState(catchUp(state, 0).state);
    const zeroGapDifferences = differences(envelope.state, zeroGapState);
    // The untouched original may legitimately acquire startup achievements. All
    // actual saves after adoption must already contain the entire adopted state.
    if (!entry.file.endsWith("-original.save.json")) deepStrictEqual(zeroGapState, envelope.state);
    return { ...entry, readerAccepted: true, wholeEnvelopeUnchanged: true,
      zeroGapStable: zeroGapDifferences.length === 0, zeroGapDifferences };
  });
  report.readerAcceptance = acceptance;
  report.completed = true;
  report.outcome = "PROOF COMPLETE: old released native merchant grants 646 crystal without representable seller debit; ordinary control succeeds. This does not certify product correctness.";
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ completed: true, knownBugConfirmed: true, productSafetyGate: false, codeSourceSha: BASE, readerAcceptedSaves: acceptance.length }) + "\n");
} else {
  strictEqual(process.argv.length, 2, "Only generation or --verify-native DIR is supported");
  const cases = [
    { name: "ordinary-control", metal: "100000", afterMetal: "99000", expectedDebit: "1000", bug: false },
    { name: "unrepresentable-seller", metal: "1e100", afterMetal: "1e+100", expectedDebit: "0", bug: true },
  ].map(spec => {
    const fresh = createInitialState(42, 42);
    const offered = createOffer(fresh, fresh.activePlanetId, 42, true);
    const generatedOffer = JSON.parse(exportSave(offered.state, EPOCH));
    // Deliberate synthetic setup, explicitly recorded before any browser action.
    activePlanet(offered.state).resources = { metal: big(spec.metal), crystal: big(0), deuterium: big(0) };
    offered.state.deepSpace.offers[0].ratios = { metal: 3, crystal: 2, deuterium: 1 };
    const raw = exportSave(offered.state, EPOCH);
    const { envelope, state } = readExactly(raw);
    const readerEnvelope = JSON.parse(exportSave(state, EPOCH));
    const catchUpEnvelope = JSON.parse(exportSave(catchUp(state, 0).state, EPOCH));
    const values = new Map<string, string>([[STORAGE_KEY, raw]]);
    const store = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } };
    const session = new SaveSession(store, EPOCH);
    strictEqual(session.mode, "ready");
    strictEqual(session.loaded.appliedSeconds, 0);
    strictEqual(store.getItem(STORAGE_KEY), raw, "Current-revision startup must retain untouched original raw");
    const sessionAdoptedEnvelope = JSON.parse(exportSave(session.loaded.state, EPOCH));
    deepStrictEqual(sessionAdoptedEnvelope, catchUpEnvelope, "Real SaveSession adopts full independent old catchUp(0) outcome");
    strictEqual(session.save(session.loaded.state, EPOCH, EPOCH).ok, true);
    const expectedFirstSaveRaw = store.getItem(STORAGE_KEY)!;
    const expectedFirstSaveEnvelope = JSON.parse(expectedFirstSaveRaw);
    deepStrictEqual(expectedFirstSaveEnvelope, sessionAdoptedEnvelope);
    const startup = { classification: "Original 6b domain reader, catchUp(0), and SaveSession oracle with in-memory domain storage; not browser evidence",
      readerEnvelope, catchUpEnvelope, sessionAdoptedEnvelope, expectedFirstSaveEnvelope,
      expectedFirstSaveSha256: hash(expectedFirstSaveRaw),
      originalToReaderDifferences: differences(envelope, readerEnvelope),
      readerToCatchUpDifferences: differences(readerEnvelope, catchUpEnvelope),
      catchUpToSessionDifferences: differences(catchUpEnvelope, sessionAdoptedEnvelope),
      originalToAdoptedDifferences: differences(envelope, sessionAdoptedEnvelope) };
    const quote = tradeQuote(session.loaded.state, offered.id, "metal", "crystal", "1000");
    strictEqual(quote.ok, true);
    deepStrictEqual([quote.spent.toString(), quote.received.toString(), quote.volume.toString()], ["1000", "646", "1000"]);
    strictEqual(state.deepSpace.offers[0].remainingMe, "200000");
    strictEqual(state.deepSpace.nextOfferId, 2);
    return {
      case: spec.name, classification: "anonymous explicitly synthetic current-reader-valid boundary fixture; not actual player data or naturally reached play",
      generation: { initialApi: "createInitialState(42, 42)", offerApi: "createOffer(state, homeworld, 42, true)", generatedOffer,
        edits: [{ path: "/state/planets/0/resources", value: envelope.state.planets[0].resources },
          { path: "/state/deepSpace/offers/0/ratios", value: { metal: 3, crystal: 2, deuterium: 1 } }] },
      raw, originalSha256: hash(raw), readerAccepted: true,
      zeroGapStable: startup.originalToAdoptedDifferences.length === 0, startup,
      action: { offer: offered.id, sell: "metal", buy: "crystal", amount: "1000" },
      expected: { metal: spec.afterMetal, crystal: "646", deuterium: "0", quota: "199000", canonicalSellerDebit: spec.expectedDebit, bug: spec.bug },
    };
  });
  process.stdout.write(JSON.stringify({ schema: "infinity-merchant-transfer-proof-fixture-v1", codeSourceSha: BASE, epoch: EPOCH,
    classification: "explicit synthetic current-reader-valid fixtures; domain setup only, no transaction execution", cases }, null, 2) + "\n");
}
