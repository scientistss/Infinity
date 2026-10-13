/** Execute the benchmark's exact source gate with hostile evidence, without model timing. */
import { describe, expect, it } from "vitest";
const { default: assert } = await import("node:assert/strict" as string);
const { readFileSync } = await import("node:fs" as string);
const { createHash } = await import("node:crypto" as string);
const { execFileSync } = await import("node:child_process" as string);
const { resolve, dirname } = await import("node:path" as string);
const { fileURLToPath } = await import("node:url" as string);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "scripts/benchmark-presentation.mjs"), "utf8") as string;
const prefix = "const labBlockersSourceProof = ";
const start = source.indexOf(prefix), end = source.indexOf("\nconst currentSerializedPlanets =", start);
assert.ok(start >= 0 && end > start, "execute the one real benchmark source gate");
const prove = new Function("assert", "readFileSync", "resolve", "sha256", "execFileSync", "afterRoot",
  `return ${source.slice(start + prefix.length, end)}`);
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const baseline = "49303d3740cf223955386ff984b335ca9b110087";
const presentPath = "src/ui/present.ts";
const labPath = "tests/fixtures/lab-blockers-provenance.json";
const copyPath = "tests/fixtures/research-unlock-copy-provenance.json";
const copySha = "ee3d929da35f41aef0aad587a11ab6acba0726abde44f0de5f753a74c4cb6999";
const beforeSha = "86979014aff31ab9ea9c4c653e43940199151664ee2074f1f8a7e4368786cbfd";
const afterSha = "9f40aa07c776b40cd2b3be866a9dcc11a72ffdbca55d86d96029251d1f0de6f3";
const before = execFileSync("git", ["--no-replace-objects", "-C", root, "show", `${baseline}:${presentPath}`], { encoding: "utf8" }) as string;
const originalFiles = Object.fromEntries([labPath, copyPath, presentPath, "src/ui/lab-blockers-model.ts"]
  .map(path => [resolve(root, path), readFileSync(resolve(root, path), "utf8") as string]));
const validAudit = { contract: "exact-declared-research-unlock-copy-source-delta", sourceBaseline: baseline,
  manifestSha256: copySha, checks: 174, approvedSourceDeltaPaths: [presentPath] };
type Evidence = { files: Record<string, string>; adopted: string; audit: Record<string, unknown>; failVerifier: boolean; calls: string[] };
function specimen(): Evidence {
  return { files: { ...originalFiles }, adopted: before, audit: structuredClone(validAudit), failVerifier: false, calls: [] };
}
function run(value: Evidence) {
  return prove(assert, (path: string) => {
    assert.ok(Object.hasOwn(value.files, path), `exact expected source read: ${path}`);
    return value.files[path];
  }, resolve, hash, (command: string, args: string[], options?: Record<string, unknown>) => {
    value.calls.push(command);
    if (command === "python3") {
      assert.deepEqual(args, ["-B", "scripts/test_research_unlock_copy_provenance.py", "--verify-ui-baseline"]);
      assert.deepEqual(options, { cwd: root, encoding: "utf8" });
      if (value.failVerifier) throw Error("Full production inventory or an earlier seal failed");
      return JSON.stringify(value.audit);
    }
    assert.equal(command, "git");
    assert.deepEqual(args, ["--no-replace-objects", "-C", root, "show", `${baseline}:${presentPath}`]);
    return value.adopted;
  }, root);
}

describe("benchmark research unlock source contract", () => {
  it("reproduces the old hash mismatch, then links exact current bytes to the preserved old lab source", () => {
    const value = specimen(), result = run(value);
    expect(hash(before)).toBe(beforeSha);
    expect(hash(originalFiles[resolve(root, presentPath)])).toBe(afterSha);
    expect(() => assert.equal(afterSha, beforeSha)).toThrow();
    expect(value.calls).toEqual(["python3", "git"]);
    expect(result.manifestSha256).toBe("ea23cbbc562494b2e00ab37eac5f666c2fb2773904f2366d3f3f8b76d4c9afb8");
    expect(result.files[presentPath]).toBe(afterSha);
    expect(result.researchUnlockCopy).toEqual({ manifestPath: copyPath, manifestSha256: copySha,
      sourceBaseline: baseline, checks: 174, approvedSourceDeltaPaths: [presentPath],
      beforePresentSha256: beforeSha, afterPresentSha256: afterSha });
  });

  it("rejects old, partially corrected, or otherwise changed current presentation bytes", () => {
    const current = originalFiles[resolve(root, presentPath)];
    for (const bad of [before, current + "\n", current.replace("function researchEffect", "function changedResearchEffect"),
      before.replace("  const levels = state.research.levels;\n", "")]) {
      const value = specimen(); value.files[resolve(root, presentPath)] = bad;
      expect(() => run(value)).toThrow();
    }
  });

  it("still reads and verifies the old adopted source rather than trusting its declared hash", () => {
    for (const bad of ["", before + "\n", originalFiles[resolve(root, presentPath)]]) {
      const value = specimen(); value.adopted = bad;
      expect(() => run(value)).toThrow();
      expect(value.calls).toEqual(["python3", "git"]);
    }
  });

  it("rejects any changed lab seal, research seal, or lab model", () => {
    for (const path of [labPath, copyPath, "src/ui/lab-blockers-model.ts"]) {
      const value = specimen(); value.files[resolve(root, path)] += "\n";
      expect(() => run(value)).toThrow();
    }
  });

  it("cannot use the right current hash to bypass a failed complete source verification", () => {
    const value = specimen(); value.failVerifier = true;
    expect(() => run(value)).toThrow("Full production inventory or an earlier seal failed");
    expect(value.calls).toEqual(["python3"]);
  });

  it("rejects unrelated, incomplete, repinned, or broader verifier contracts", () => {
    for (const attack of [
      { contract: "exact-declared-lab-source-delta" }, { sourceBaseline: "HEAD" },
      { manifestSha256: beforeSha }, { approvedSourceDeltaPaths: [] },
      { approvedSourceDeltaPaths: [presentPath, "src/game/research.ts"] }, { checks: 0 }, { checks: 145 },
    ]) {
      const value = specimen(); Object.assign(value.audit, attack);
      expect(() => run(value)).toThrow();
      expect(value.calls).toEqual(["python3"]);
    }
  });

  it("keeps the historical reader, original source pin and all proof work outside timed callbacks", () => {
    expect(source).toContain('assertHistoricalSource(beforeRoot, "4a4a4d68d0a0cf467f10a734a690606487acd327")');
    expect(source).toContain('load(afterRoot, "src/ui/present.ts"), load(beforeRoot, "src/ui/present.ts")');
    const measurement = source.slice(source.indexOf("// Escaping the callback result"), source.indexOf("const sourceHashes ="));
    expect(measurement).not.toContain("execFileSync");
    expect(measurement).not.toContain("labBlockersSourceProof");
    expect(measurement).toContain("() => beforePresent.present(state, input), () => afterPresent.presentVisible(state, input, tab)");
  });
});
