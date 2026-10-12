import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { NPC_SCOUT_SNAPSHOT_MODEL } from "../src/game/npc-scout-state";
import source from "../src/ui/npc-scout-comparison-model.ts?raw";
import {
  buildNpcScoutComparison, isNpcScoutComparisonMessage, listNpcScoutComparisonCandidates,
  NPC_SCOUT_COMPARISON_PRECISION, NPC_SCOUT_COMPARISON_WARNING,
} from "../src/ui/npc-scout-comparison-model";

/** Synthetic boundary fixtures only; these do not assert paid-arrival provenance. */
function report(fleetId = 1, observedAt = "100.125"): any {
  return { id: `scout-${fleetId}`, at: big(observedAt).min(1e12).toNumber(), text: "历史报告文字不参与计算", npcScoutSnapshot: {
    model: NPC_SCOUT_SNAPSHOT_MODEL, fleetId, originId: "homeworld", target: { galaxy: 1, system: 56, position: 6 }, observedAt,
    stock: [100.1, 250, 1.2345678901234567], garrison: { light_fighter: 4, heavy_fighter: 1 },
    defenderTech: { weapons: 0, shields: 0, armour: 0 },
  } };
}

function oldText(id = "legacy"): any {
  return { id, at: 0, text: "侦察报告 [1:56:6]：金属 9999；轨道驻军 0。", npcScoutSnapshot: null };
}

function freezeTree(value: any): any {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeTree); Object.freeze(value); }
  return value;
}

describe("read-only same-target scout observation comparison", () => {
  it("uses retained array order for either anchor, never fleet IDs, capped at or equal original times", () => {
    const before = report(99, "1e+400"), after = report(2, "1e+400"), messages = [before, oldText(), after];
    after.npcScoutSnapshot.stock = [105.2, 250, 1.2345678901234567];
    expect(before.at).toBe(after.at);
    expect(before.npcScoutSnapshot.observedAt).toBe(after.npcScoutSnapshot.observedAt);
    const model = buildNpcScoutComparison(messages, after, before)!;
    expect(model.before.messageId).toBe("scout-99"); expect(model.after.messageId).toBe("scout-2");
    expect(model.before.observedAt).toBe("1e+400"); expect(model.after.observedAt).toBe("1e+400");
    expect(model.delta.stock).toEqual(["5.1", "0", "0"]);
    expect(buildNpcScoutComparison(messages, before, after)).toEqual(model);
    expect(listNpcScoutComparisonCandidates(messages, after)).toEqual([{ messageId: "scout-99", fleetId: 99, observedAt: "1e+400", index: 0 }]);
    // This is an explicit array-order contract, even for unusual imported ordering.
    expect(buildNpcScoutComparison([after, before], before, after)?.before.messageId).toBe("scout-2");
  });

  it("keeps distinct times that share a three-decimal display and preserves different paying origins", () => {
    const before = report(1, "100.1252"), after = report(2, "100.1253");
    after.npcScoutSnapshot.originId = "colony-2";
    expect(Number(before.npcScoutSnapshot.observedAt).toFixed(3)).toBe(Number(after.npcScoutSnapshot.observedAt).toFixed(3));
    const model = buildNpcScoutComparison([before, after], after, before)!;
    expect([model.before.observedAt, model.after.observedAt]).toEqual(["100.1252", "100.1253"]);
    expect([model.before.originId, model.after.originId]).toEqual(["homeworld", "colony-2"]);
    expect(model.target).toEqual({ galaxy: 1, system: 56, position: 6 });
  });

  it("lists only other valid same-coordinate snapshots in actual array order", () => {
    const first = report(40), second = report(3), otherTarget = report(4), last = report(5);
    otherTarget.npcScoutSnapshot.target.position = 7;
    const messages = [oldText(), first, second, otherTarget, last];
    expect(listNpcScoutComparisonCandidates(messages, second)).toEqual([
      { messageId: "scout-40", fleetId: 40, observedAt: "100.125", index: 1 },
      { messageId: "scout-5", fleetId: 5, observedAt: "100.125", index: 4 },
    ]);
    expect(buildNpcScoutComparison(messages, second, otherTarget)).toBeNull();
    expect(isNpcScoutComparisonMessage(first)).toBe(true); expect(isNpcScoutComparisonMessage(oldText())).toBe(false);
    expect(listNpcScoutComparisonCandidates(messages, oldText())).toEqual([]);
  });

  it("requires both actual retained objects and refuses clones, eviction and ID resurrection", () => {
    const before = report(), after = report(2), clone = structuredClone(before);
    expect(buildNpcScoutComparison([before, after], before, before)).toBeNull();
    expect(buildNpcScoutComparison([before, after], clone, after)).toBeNull();
    expect(buildNpcScoutComparison([clone, after], before, after)).toBeNull();
    expect(listNpcScoutComparisonCandidates([clone, after], before)).toEqual([]);
    const retained = [before, ...Array.from({ length: 148 }, (_, i) => oldText(`ordinary-${i}`)), after];
    expect(retained).toHaveLength(150); expect(buildNpcScoutComparison(retained, before, after)).not.toBeNull();
    const cropped = [...retained, oldText("new-message")].slice(-150);
    expect(buildNpcScoutComparison(cropped, before, after)).toBeNull();
    expect(listNpcScoutComparisonCandidates(cropped, before)).toEqual([]);
    expect(buildNpcScoutComparison([...retained, oldText("overflow")], before, after)).toBeNull();
  });

  it("never parses text-only or null history even when IDs and text resemble scout reports", () => {
    const before = report(), legacy = oldText("scout-2");
    expect(buildNpcScoutComparison([before, legacy], before, legacy)).toBeNull();
    expect(listNpcScoutComparisonCandidates([before, legacy], before)).toEqual([]);
    expect(isNpcScoutComparisonMessage({ ...legacy, npcScoutSnapshot: undefined })).toBe(false);
    expect(isNpcScoutComparisonMessage({ ...legacy, npcScoutSnapshot: JSON.stringify(report(2).npcScoutSnapshot) })).toBe(false);
  });

  it.each(["object", "id", "fleet", "snapshot", "target", "stock", "garrison", "defenderTech"])
  ("fails closed on duplicate %s identity rather than guessing a pair", kind => {
    const before = report(), after = report(2), messages = [before, after];
    if (kind === "object") messages.push(before);
    else if (kind === "id") messages.push(oldText(before.id));
    else if (kind === "fleet") { const duplicate = structuredClone(before); messages.push(duplicate); }
    else if (kind === "snapshot") after.npcScoutSnapshot = before.npcScoutSnapshot;
    else after.npcScoutSnapshot[kind] = before.npcScoutSnapshot[kind];
    expect(buildNpcScoutComparison(messages, before, after)).toBeNull();
    expect(listNpcScoutComparisonCandidates(messages, before)).toEqual([]);
  });

  it("preserves source Numbers and produces signed canonical decimal observation differences", () => {
    const before = report(), after = report(2);
    before.npcScoutSnapshot.stock = [0.1, 20.5, -0]; after.npcScoutSnapshot.stock = [0.3, 3.25, 0];
    after.npcScoutSnapshot.garrison = { light_fighter: 1, heavy_fighter: 0 };
    const model = buildNpcScoutComparison([before, after], before, after)!;
    expect(model.before.stock).toEqual([0.1, 20.5, -0]); expect(Object.is(model.before.stock[2], -0)).toBe(true);
    expect(model.after.stock).toEqual([0.3, 3.25, 0]);
    expect(model.delta.stock).toEqual(["0.2", "-17.25", "0"]);
    expect(model.delta.garrison).toEqual({ light_fighter: -3, heavy_fighter: -1 });
    expect(model.warning).toBe(NPC_SCOUT_COMPARISON_WARNING);
    expect(model.warning).toBe("只是两次观察差，不代表净产量、战利品或当前库存");
    expect(model.precision).toBe(NPC_SCOUT_COMPARISON_PRECISION);
    after.npcScoutSnapshot.stock[0] = 0.30000000000000004;
    // Keep precision already present in an original Number; only avoid a new subtraction tail.
    expect(buildNpcScoutComparison([before, after], before, after)?.delta.stock[0]).toBe("0.20000000000000004");
  });

  it("supports subnormal Numbers and full capped stocks without rounding, exponent output or negative zero", () => {
    const before = report(), after = report(2);
    before.npcScoutSnapshot.stock = [50_000, 0, 10_000]; after.npcScoutSnapshot.stock = [Number.MIN_VALUE, Number.MIN_VALUE, 0];
    const model = buildNpcScoutComparison([before, after], before, after)!;
    expect(model.delta.stock).toEqual([`-49999.${"9".repeat(323)}5`, `0.${"0".repeat(323)}5`, "-10000"]);
    expect(model.after.stock[0]).toBe(Number.MIN_VALUE);
    before.npcScoutSnapshot.stock = [0, 0, 0]; after.npcScoutSnapshot.stock = [50_000, 30_000, 10_000];
    after.npcScoutSnapshot.garrison = { light_fighter: 8, heavy_fighter: 1 };
    expect(buildNpcScoutComparison([before, after], before, after)?.delta.stock).toEqual(["50000", "30000", "10000"]);
    expect(buildNpcScoutComparison([before, after], before, after)?.delta.garrison).toEqual({ light_fighter: 4, heavy_fighter: 0 });
  });

  it("does not sort, mutate or freeze caller objects, and deeply freezes detached display results", () => {
    const before = report(), after = report(2), messages = [before, after], original = structuredClone(messages);
    const model = buildNpcScoutComparison(messages, after, before)!;
    expect(messages).toEqual(original); expect(messages[0]).toBe(before); expect(messages[1]).toBe(after);
    for (const value of [messages, before, after, before.npcScoutSnapshot.stock]) expect(Object.isFrozen(value)).toBe(false);
    const candidates = listNpcScoutComparisonCandidates(messages, before);
    for (const value of [model, model.target, model.before, model.before.stock, model.before.garrison, model.before.defenderTech,
      model.after, model.after.stock, model.after.garrison, model.after.defenderTech, model.delta, model.delta.stock, model.delta.garrison,
      candidates, candidates[0]]) expect(Object.isFrozen(value)).toBe(true);
    expect(model.target).not.toBe(before.npcScoutSnapshot.target); expect(model.before.stock).not.toBe(before.npcScoutSnapshot.stock);
    before.npcScoutSnapshot.stock[0] = 0; after.npcScoutSnapshot.garrison.light_fighter = 0;
    expect(model.before.stock[0]).toBe(100.1); expect(model.after.garrison.light_fighter).toBe(4);
    freezeTree(messages); expect(buildNpcScoutComparison(messages, before, after)).not.toBeNull();
  });

  it.each(["id", "at", "text", "npcScoutSnapshot"])("rejects malformed message %s fields without invoking getters", key => {
    let calls = 0;
    for (const kind of ["missing", "hidden", "getter", "inherited"]) {
      const before = report(), after = report(2), value = before[key]; delete before[key];
      if (kind === "hidden") Object.defineProperty(before, key, { value });
      if (kind === "getter") Object.defineProperty(before, key, { enumerable: true, get() { calls++; return value; } });
      if (kind === "inherited") Object.setPrototypeOf(before, { [key]: value });
      expect(isNpcScoutComparisonMessage(before)).toBe(false);
      expect(buildNpcScoutComparison([before, after], before, after)).toBeNull();
      expect(listNpcScoutComparisonCandidates([before, after], after)).toEqual([]);
    }
    expect(calls).toBe(0);
  });

  it.each(["hole", "getter", "hidden", "prototype", "extra", "symbol"])("rejects malformed current array %s without invoking getters", kind => {
    const before = report(), after = report(2), messages: any = [before, after]; let calls = 0;
    if (kind === "hole") delete messages[0];
    if (kind === "getter") Object.defineProperty(messages, "0", { enumerable: true, get() { calls++; return before; } });
    if (kind === "hidden") Object.defineProperty(messages, "0", { value: before, enumerable: false });
    if (kind === "prototype") Object.setPrototypeOf(messages, Object.create(Array.prototype));
    if (kind === "extra") messages.extra = 1;
    if (kind === "symbol") messages[Symbol("extra")] = 1;
    expect(buildNpcScoutComparison(messages, before, after)).toBeNull(); expect(listNpcScoutComparisonCandidates(messages, before)).toEqual([]);
    expect(calls).toBe(0);
  });

  it.each(["snapshot", "target", "stock", "garrison", "defenderTech"])("rejects malformed nested %s getters/prototypes", key => {
    let calls = 0;
    for (const kind of ["getter", "prototype"]) {
      const before = report(), after = report(2), nested = key === "snapshot" ? before.npcScoutSnapshot : before.npcScoutSnapshot[key];
      if (kind === "getter") Object.defineProperty(nested, Object.keys(nested)[0], { enumerable: true, get() { calls++; return 1; } });
      if (kind === "prototype") Object.setPrototypeOf(nested, { inherited: true });
      expect(buildNpcScoutComparison([before, after], before, after)).toBeNull(); expect(isNpcScoutComparisonMessage(before)).toBe(false);
    }
    expect(calls).toBe(0);
  });

  it("rejects a stock-field getter or injected array method without invoking either", () => {
    let calls = 0;
    for (const kind of ["field-getter", "array-method-getter", "array-method-value"]) {
      const before = report(), after = report(2);
      if (kind === "field-getter") Object.defineProperty(before.npcScoutSnapshot, "stock", { enumerable: true, get() { calls++; return [1, 2, 3]; } });
      if (kind === "array-method-getter") Object.defineProperty(before.npcScoutSnapshot.stock, "every", { get() { calls++; return () => true; } });
      if (kind === "array-method-value") before.npcScoutSnapshot.stock.every = () => { calls++; return true; };
      expect(isNpcScoutComparisonMessage(before)).toBe(false);
      expect(buildNpcScoutComparison([before, after], before, after)).toBeNull();
    }
    expect(calls).toBe(0);
  });

  it("refuses future models, invalid Number values, mismatched IDs/times, extra fields and noncanonical times", () => {
    for (const mutate of [
      (x: any) => { x.npcScoutSnapshot.model = "npc-scout-snapshot-v2"; },
      (x: any) => { x.id = "scout-999"; }, (x: any) => { x.at++; }, (x: any) => { x.at = Infinity; },
      (x: any) => { x.npcScoutSnapshot.observedAt = "100.1250"; },
      (x: any) => { x.npcScoutSnapshot.stock[0] = -1; }, (x: any) => { x.npcScoutSnapshot.stock[0] = NaN; },
      (x: any) => { x.npcScoutSnapshot.stock[0] = Infinity; }, (x: any) => { x.npcScoutSnapshot.stock[0] = "1"; },
      (x: any) => { x.npcScoutSnapshot.stock[0] = 50_000.00000000001; },
      (x: any) => { x.npcScoutSnapshot.stock[1] = 30_001; }, (x: any) => { x.npcScoutSnapshot.stock[2] = 10_001; },
      (x: any) => { x.npcScoutSnapshot.garrison.light_fighter = 9; }, (x: any) => { x.npcScoutSnapshot.defenderTech.armour = 1; },
      (x: any) => { x.npcScoutSnapshot.target.position = 16; }, (x: any) => { x.extra = undefined; },
    ]) {
      const before = report(), after = report(2); mutate(before);
      expect(isNpcScoutComparisonMessage(before)).toBe(false); expect(buildNpcScoutComparison([before, after], before, after)).toBeNull();
    }
  });

  it("accepts strict null-prototype records and rejects an unrelated malformed retained report conservatively", () => {
    const before = report(), after = report(2);
    for (const value of [before, before.npcScoutSnapshot, before.npcScoutSnapshot.target, before.npcScoutSnapshot.garrison, before.npcScoutSnapshot.defenderTech]) Object.setPrototypeOf(value, null);
    expect(buildNpcScoutComparison([before, after], before, after)).not.toBeNull();
    const invalid = report(3); invalid.npcScoutSnapshot.model = "future";
    expect(buildNpcScoutComparison([before, after, invalid], before, after)).toBeNull();
    expect(Object.isFrozen(listNpcScoutComparisonCandidates(null, before))).toBe(true);
  });

  it("contains no live-world, RNG, timer, dispatch or quote authority", () => {
    for (const forbidden of ["GameState", "npcAt", "projectNpc", "npcEconomy", "universe.seed", "sendFleet", "quoteFlight", "Math.random", "Date.now", "setTimeout", "setInterval", "toFixed(", "EPSILON"]) expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:npc-wallet|npc-attack|npc-scout-save|fleet)["']/);
  });
});
