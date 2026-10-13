/** Exercise the exact current-source gate without running benchmark or native timing. */
import { describe, expect, it } from "vitest";
const { default: assert } = await import("node:assert/strict" as string);
const { readFileSync } = await import("node:fs" as string);
const { createHash } = await import("node:crypto" as string);
const { resolve, dirname } = await import("node:path" as string);
const { fileURLToPath } = await import("node:url" as string);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "scripts/benchmark-presentation.mjs"), "utf8") as string;
const prefix = "const buildingBatchSourceProof = ";
const start = source.indexOf(prefix), end = source.indexOf("\n// This adapter is intentionally specific", start);
assert.ok(start >= 0 && end > start, "execute the exact current benchmark source gate");
const prove = new Function("assert", "readFileSync", "resolve", "sha256", "execFileSync", "afterRoot",
  `return ${source.slice(start + prefix.length, end)}`);
const manifestPath = "tests/fixtures/building-batch-provenance.json";
const manifestRaw = readFileSync(resolve(root, manifestPath), "utf8") as string;
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const manifestSha256 = "218ba04e9d310501b60d2fb4e37aa6b1b070f9039cc5af872a4a3cdc33f01ece";
const paths = ["src/game/building-template-batch-state.ts", "src/game/building-template-batch.ts", "src/main.ts",
  "src/ui/building-template-batch-panel.ts", "src/ui/building-template-batch-present.ts", "src/ui/building-template-batch.css", "src/ui/space-panel.ts"];
const baseline = "6f73735534ffc1b0e47a01935d8c6e3ff786c989";
const manifest = JSON.parse(manifestRaw);
const validAudit = { contract: "exact-declared-building-batch-source-delta", sourceBaseline: baseline, manifestSha256,
  checks: 193, approvedSourceDeltaPaths: paths, originalUiBaseline: manifest.originalUiBaseline };
type Evidence = { raw: string; audit: Record<string, unknown>; failVerifier: boolean; calls: string[]; dishonestHash: boolean };
function specimen(): Evidence {
  return { raw: manifestRaw, audit: structuredClone(validAudit), failVerifier: false, calls: [], dishonestHash: false };
}
function run(value: Evidence) {
  return prove(assert, (path: string) => {
    assert.equal(path, resolve(root, manifestPath));
    return value.raw;
  }, resolve, (raw: string) => value.dishonestHash ? manifestSha256 : hash(raw),
  (command: string, args: string[], options: Record<string, unknown>) => {
    value.calls.push(command);
    assert.equal(command, "python3");
    assert.deepEqual(args, ["-B", "scripts/test_building_batch_provenance.py", "--verify-ui-baseline"]);
    assert.deepEqual(options, { cwd: root, encoding: "utf8" });
    if (value.failVerifier) throw Error("Full current inventory, exact adapters or a prior seal failed");
    return JSON.stringify(value.audit);
  }, root);
}

describe("benchmark complete building-batch source contract", () => {
  it("binds the explicit current 215-entry and fourteen-prior-seal contract", () => {
    const value = specimen(), result = run(value);
    expect(hash(manifestRaw)).toBe(manifestSha256);
    expect(value.calls).toEqual(["python3"]);
    expect(result).toMatchObject({ contract: validAudit.contract, sourceBaseline: baseline,
      manifestPath, manifestSha256, productionEntries: 215, previousSeals: 14, approvedSourceDeltaPaths: paths });
    expect(result.scope).toContain("210-entry research proof is explicitly historical");
  });

  it("rejects missing, stale, changed or repinned manifest bytes before running the verifier", () => {
    for (const raw of ["", manifestRaw + "\n", "{}", manifestRaw.replace(baseline, "0".repeat(40))]) {
      const value = specimen(); value.raw = raw;
      expect(() => run(value)).toThrow();
      expect(value.calls).toEqual([]);
    }
  });

  it("propagates a complete current source verification failure", () => {
    const value = specimen(); value.failVerifier = true;
    expect(() => run(value)).toThrow("Full current inventory, exact adapters or a prior seal failed");
    expect(value.calls).toEqual(["python3"]);
  });

  it("rejects historical-only, incomplete and broader current proofs", () => {
    for (const attack of [
      { contract: "exact-declared-research-unlock-copy-source-delta" }, { sourceBaseline: "HEAD" },
      { manifestSha256: "0".repeat(64) }, { approvedSourceDeltaPaths: [] },
      { approvedSourceDeltaPaths: paths.slice(1) }, { approvedSourceDeltaPaths: [...paths, "src/game/save.ts"] },
      { approvedSourceDeltaPaths: [...paths].reverse() }, { checks: 0 }, { checks: 174 }, { checks: 174.5 },
      { originalUiBaseline: {} },
    ]) {
      const value = specimen(); Object.assign(value.audit, attack);
      expect(() => run(value)).toThrow();
      expect(value.calls).toEqual(["python3"]);
    }
  });

  it("independently rejects metadata and inventory drift even behind a dishonest hash witness", () => {
    const mutations = [
      (m: any) => { m.schema = "unknown"; },
      (m: any) => { m.previousAdoptionSourceSha = "HEAD"; },
      (m: any) => { delete m.productionInventory["src/main.ts"]; },
      (m: any) => { m.previousManifests.pop(); },
      (m: any) => { m.previousManifests.reverse(); },
      (m: any) => { m.previousManifests[13].sha256 = "0".repeat(64); },
      (m: any) => { m.changedPaths.pop(); },
      (m: any) => { m.changedPaths.reverse(); },
    ];
    for (const mutate of mutations) {
      const value = specimen(), changed = structuredClone(manifest);
      mutate(changed); value.raw = JSON.stringify(changed); value.dishonestHash = true;
      expect(() => run(value)).toThrow();
    }
  });

  it("retains both historical research and old benchmark assertions outside every timed callback", () => {
    expect(source).toContain('Object.keys(copyManifest.productionInventory).length, 210');
    expect(source).toContain('copyManifest.previousManifests.length, 13');
    expect(source).toContain('assert.ok(sourceAudit.checks > 145');
    expect(source).toContain('currentBuildingBatch: buildingBatchSourceProof');
    const measurement = source.slice(source.indexOf("// Escaping the callback result"), source.indexOf("const sourceHashes ="));
    expect(measurement).not.toContain("execFileSync");
    expect(measurement).not.toContain("buildingBatchSourceProof");
    expect(measurement).toContain("() => beforePresent.present(state, input), () => afterPresent.presentVisible(state, input, tab)");
  });
});
