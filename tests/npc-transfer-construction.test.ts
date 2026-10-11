import { describe, expect, it } from "vitest";
import { big, type BigNumber } from "../src/game/decimal";
import {
  checkedNpcCargoCredit, checkedNpcFuelDebit, checkedNpcLootCargo,
  npcExactDecimalSumEquals, type NpcTransferResult,
} from "../src/game/npc-transfer";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type ResourceAmounts } from "../src/game/types";

const money = (metal: string | number = 0, crystal: string | number = 0, deuterium: string | number = 0): ResourceAmounts =>
  ({ metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) });
const value = <T>(result: NpcTransferResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.reason);
  return result.value;
};
const snapshot = (amounts: ResourceAmounts) => RESOURCE_IDS.map(id =>
  [amounts[id].toString(), amounts[id].mantissa, amounts[id].exponent]);
const stable = (amount: BigNumber) => {
  const restored = big(JSON.parse(JSON.stringify(amount)) as string);
  expect(restored.toString()).toBe(amount.toString());
  expect(restored.mantissa).toBe(amount.mantissa);
  expect(restored.exponent).toBe(amount.exponent);
};

describe("NPC exact candidate construction before unchanged proof checks", () => {
  it("constructs the original natural-route sum, instead of its rounded arithmetic neighbor", () => {
    const before = money("2911027.71225653"), cargo = value(checkedNpcLootCargo([265, 0, 0]));
    const source = snapshot(before), incoming = snapshot(cargo);
    const rounded = before.metal.add(cargo.metal);
    expect(rounded.toString()).toBe("2911292.7122565303");
    expect(npcExactDecimalSumEquals(source[0]![0], "265", rounded.toString())).toBe(false);

    const after = value(checkedNpcCargoCredit(before, cargo));
    expect(after.metal.toString()).toBe("2911292.71225653");
    expect(after.metal.mantissa).toBe(2.9112927122565297);
    expect(after.metal.exponent).toBe(6);
    expect(after.metal.mantissa).not.toBe(rounded.mantissa);
    expect(after.metal).not.toBe(before.metal);
    expect(after.crystal).toBe(before.crystal);
    expect(after.deuterium).toBe(before.deuterium);
    expect(npcExactDecimalSumEquals("2911027.71225653", "265", after.metal.toString())).toBe(true);
    stable(after.metal);
    expect(snapshot(before)).toEqual(source);
    expect(snapshot(cargo)).toEqual(incoming);
  });

  it("uses the plain constructor path when equivalent scientific text selects a different mantissa", () => {
    const plain = big("2911292.71225653"), scientific = big("2.91129271225653e6");
    expect(plain.toString()).toBe("2911292.71225653");
    expect(scientific.toString()).toBe("2911292.7122565303");
    expect(plain.mantissa).not.toBe(scientific.mantissa);
    const after = value(checkedNpcCargoCredit(money("2911027.71225653"), money(265)));
    expect(after.metal.mantissa).toBe(plain.mantissa);
    stable(after.metal);
  });

  it.each([
    ["1073741824000.9999", "1", "1073741823999.9999"],
    ["2911292.71225653", "265", "2911027.71225653"],
    ["1000000", "70", "999930"],
    ["1000000", "74", "999926"],
    ["1.000001", "1", "0.000001"],
    ["1.0000001", "1", "1e-7"],
    ["1.0000000001", "1", "1e-10"],
    ["2e21", "1e21", "1e+21"],
    ["2e400", "1e400", "1e+400"],
  ])("constructs exact debit %s minus %s as %s", (source, integer, expected) => {
    const before = big(source), quote = big(integer), saved = [before.toString(), quote.toString()];
    const after = value(checkedNpcFuelDebit(before, quote, integer));
    expect(after.toString()).toBe(expected);
    expect(after).not.toBe(before);
    expect(npcExactDecimalSumEquals(expected, integer, saved[0])).toBe(true);
    stable(after);
    expect([before.toString(), quote.toString()]).toEqual(saved);
  });

  it("fixes subtraction construction without accepting the old rounded debit", () => {
    const before = big("1073741824000.9999"), quote = big(1);
    expect(before.sub(quote).toString()).toBe("1073741824000.0001");
    expect(npcExactDecimalSumEquals(before.sub(quote).toString(), "1", before.toString())).toBe(false);
    const after = value(checkedNpcFuelDebit(before, quote, "1"));
    expect(after.toString()).toBe("1073741823999.9999");
    stable(after);
  });

  it.each(RESOURCE_IDS)("preflights every resource and atomically rejects unrepresentable %s", failed => {
    const before = money("2911027.71225653", "2911027.71225653", "2911027.71225653");
    const cargo = money(265, 265, 265);
    before[failed] = big("1073741823999");
    cargo[failed] = big(1);
    const source = snapshot(before), incoming = snapshot(cargo), references = { ...before };
    expect(big("1073741824000").toString()).toBe("1073741824000.0001");
    expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "precision" });
    expect(snapshot(before)).toEqual(source);
    expect(snapshot(cargo)).toEqual(incoming);
    for (const id of RESOURCE_IDS) expect(before[id]).toBe(references[id]);
  });

  it("keeps true debit representation failures and independent fuel intent checks", () => {
    expect(big("999936").toString()).toBe("999935.9999999999");
    expect(checkedNpcFuelDebit(big(1e6), big(64), "64")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big("2147483648000"), big("1073741824000"), "1073741824000"))
      .toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big(1e6), big(70), "74")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big(1e6), big(0), "70")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big(1), big(2), "2")).toEqual({ ok: false, reason: "insufficient-funds" });
  });

  it.each(["1e512", "1e8999999999999999", "1e-512", "1e-8999999999999999"])(
    "bounds alignment work before expanding the exponent gap for %s", text => {
      const before = money(text), source = snapshot(before);
      expect(checkedNpcCargoCredit(before, money(1))).toEqual({ ok: false, reason: "precision" });
      expect(snapshot(before)).toEqual(source);
      expect(value(checkedNpcCargoCredit(before, money()))).toBe(before);
    },
  );

  it("retains exact cancellation at huge matching exponents without allocating their powers", () => {
    for (const text of ["1e512", "1e8999999999999999"]) {
      const after = value(checkedNpcFuelDebit(big(text), big(text), text));
      expect(after.toString()).toBe("0");
      stable(after);
    }
  });

  it("preserves signed and noncanonical zero operation identities", () => {
    const zero = big(0); zero.mantissa = -0;
    const rawZero = big(0); rawZero.exponent = 123;
    const before = { metal: zero, crystal: rawZero, deuterium: big("1e8999999999999999") };
    expect(value(checkedNpcCargoCredit(before, money()))).toBe(before);
    expect(value(checkedNpcFuelDebit(rawZero, zero, "0"))).toBe(rawZero);
    expect(Object.is(zero.mantissa, -0)).toBe(true);
    expect(rawZero.exponent).toBe(123);
    const credited = value(checkedNpcCargoCredit({ ...before, crystal: big(0) }, money(1)));
    expect(credited.metal.toString()).toBe("1");
    stable(credited.metal);
    expect(Object.is(zero.mantissa, -0)).toBe(true);
  });

  it("uses stable canonical source value when runtime mantissa is not its reader representation", () => {
    for (const text of ["1.000000000000001", "1.00000000000001"]) {
      const before = big(text), original = [before.toString(), before.mantissa, before.exponent];
      // The pre-existing serializer's authoritative text is already 1. This
      // transfer neither changes that text nor claims the source literal survived.
      expect(before.toString()).toBe("1");
      expect(before.mantissa).not.toBe(big(before.toString()).mantissa);
      expect(big(before.toString()).toString()).toBe(before.toString());
      expect(value(checkedNpcFuelDebit(before, big(1), "1")).toString()).toBe("0");
      expect([before.toString(), before.mantissa, before.exponent]).toEqual(original);
    }
  });

  it("credits all three exact natural-arrival wallets without requiring source-only mantissa identity", () => {
    const before = money("2910911.83616177", "447710.15680556995", "68825.7241553523");
    before.deuterium.mantissa = 6.88257241553523;
    const source = snapshot(before);
    expect(before.deuterium.exponent).toBe(4);
    expect(before.deuterium.toString()).toBe("68825.7241553523");
    const restored = big(JSON.parse(JSON.stringify(before.deuterium)) as string);
    expect(restored.mantissa).toBe(6.882572415535231);
    expect(restored.toString()).toBe(before.deuterium.toString());
    const after = value(checkedNpcCargoCredit(before, value(checkedNpcLootCargo([265, 132, 23]))));
    const expected = ["2911176.83616177", "447842.15680556995", "68848.7241553523"];
    for (let index = 0; index < RESOURCE_IDS.length; index++) {
      const id = RESOURCE_IDS[index]!;
      expect(after[id].toString()).toBe(expected[index]);
      expect(npcExactDecimalSumEquals(source[index]![0], String([265, 132, 23][index]), after[id].toString())).toBe(true);
      stable(after[id]);
    }
    expect(snapshot(before)).toEqual(source);
  });

  it("keeps the exact result and its mantissa through repeated complete save/read cycles", () => {
    let state = deserializeState(serializeState(createInitialState(42)));
    state.planets[0]!.resources = value(checkedNpcCargoCredit(
      money("2911027.71225653", "0.000001", "1e400"), money(265, 1, 0),
    ));
    const saved = serializeState(state), expected = snapshot(state.planets[0]!.resources);
    for (let cycle = 0; cycle < 10; cycle++) {
      state = deserializeState(serializeState(state));
      expect(serializeState(state)).toEqual(saved);
      expect(snapshot(state.planets[0]!.resources)).toEqual(expected);
    }
    expect(state.planets[0]!.resources.metal.toString()).toBe("2911292.71225653");
    expect(state.planets[0]!.resources.metal.mantissa).toBe(2.9112927122565297);
  });
});
