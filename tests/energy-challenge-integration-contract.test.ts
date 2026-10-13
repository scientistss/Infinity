/** Source contract complements real domain/save/controller tests; no runtime UI claim. */
import { describe, expect, it } from "vitest";
const { readFileSync } = await import("node:fs" as string);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8") as string;
const space = readFileSync(new URL("../src/ui/space-panel.ts", import.meta.url), "utf8") as string;

describe("challenge host transaction and retirement wiring", () => {
  it("quotes, confirms and consumes before candidate save, adopting only verified saved state", () => {
    const start = main.indexOf('if (action.type === "energy-challenge")');
    const end = main.indexOf('} else if (action.type === "demolition-confirm"', start);
    const branch = main.slice(start, end);
    const quote = branch.indexOf("quoteEnergyChallenge(source, action.action)");
    const confirm = branch.indexOf("window.confirm(energyChallengeConfirmation");
    const consume = branch.indexOf("view.consumeEnergyChallengeAction(action, source)");
    const candidate = branch.indexOf("enterEnergyChallenge(source, quote)");
    const save = branch.indexOf("saveSession.save(result.state, Date.now(), accountedClock.lastTickAt)");
    const adopt = branch.indexOf("if (saved.ok) { state = result.state; observeWorldAdoption(); }");
    expect(quote).toBeGreaterThan(0); expect(confirm).toBeGreaterThan(quote); expect(consume).toBeGreaterThan(confirm);
    expect(candidate).toBeGreaterThan(consume); expect(save).toBeGreaterThan(candidate); expect(adopt).toBeGreaterThan(save);
    expect(branch).not.toMatch(/\bawait\b/); expect(branch).not.toContain("persist(");
    expect(branch).toContain('saveSession.mode !== "ready"'); expect(branch).toContain("notice = saveSession.notice");
  });
  it("retires both before file read and immediately after it, including stale reads", () => {
    const before = main.slice(main.indexOf("async function handleAction"), main.indexOf("saveSession.cancelPendingImport();", main.indexOf("async function handleAction")));
    expect(before).toContain('["import-text", "import-file", "reset", "prestige"]'); expect(before).toContain("view.retireEnergyChallenge()");
    expect(main).toContain("const prepared = await saveSession.prepareFile(action.file);\n    view.retireEnergyChallenge();\n    if (!saveSession.isCurrentPreparedFile");
    expect(main).toContain('document.addEventListener("visibilitychange", () => {\n  view.retireEnergyChallenge();');
  });
  it("routes an active ordinary launch to explicit choices before any ordinary evaluation", () => {
    const start = main.indexOf('} else if (action.type === "prestige")');
    const branch = main.slice(start, main.indexOf('} else if (action.type === "save")', start));
    expect(branch.indexOf("if (state.energyChallenge.active)")).toBeLessThan(branch.indexOf("evaluatePrestige(source)"));
    expect(branch).toContain("view.showEnergyChallengeChoice();\n      render();\n      return;");
    expect(space).toContain("energyChallengePanel.observe(state,writable,protectionMessage)");
    expect(space).toContain("invalidateOrderAuthority(){energyChallengePanel.retire()");
  });
});
