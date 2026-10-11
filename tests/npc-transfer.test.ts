import { describe, expect, it } from "vitest";
import { big, type BigNumber } from "../src/game/decimal";
import {
  checkedNpcCargoCredit, checkedNpcFuelDebit, checkedNpcLootCargo, npcExactDecimalSumEquals,
  NPC_LOOT_CAPS, NPC_MAX_LOOT, readNpcLootCargo, type NpcTransferResult,
} from "../src/game/npc-transfer";
import { checkedWalletTransfer } from "../src/game/order-wallet";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type ResourceAmounts } from "../src/game/types";

const money = (metal: number | string = 0, crystal: number | string = 0, deuterium: number | string = 0): ResourceAmounts =>
  ({ metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) });
const value = <T>(result: NpcTransferResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(`Unexpected NPC transfer failure: ${result.reason}`);
  return result.value;
};
const snapshot = (amounts: ResourceAmounts) => RESOURCE_IDS.map(id => [amounts[id].mantissa, amounts[id].exponent, amounts[id].toString()]);
const roundtrip = (amount: BigNumber) => {
  const restored = big(JSON.parse(JSON.stringify(amount)) as string);
  expect(restored.mantissa).toBe(amount.mantissa);
  expect(restored.exponent).toBe(amount.exponent);
  expect(restored.toString()).toBe(amount.toString());
  return restored;
};

describe("NPC exact decimal equation proof", () => {
  it.each([
    ["0.1", "0.2", "0.3"],
    ["1e20", "1", "100000000000000000001"],
    ["1.000000000000000001", "0.000000000000000001", "1.000000000000000002"],
    ["0.00000000000001", "1", "1.00000000000001"],
    ["1073741824000", "0.0001", "1073741824000.0001"],
    ["999", "1", "1e3"],
    ["1e-324", "4e-324", "5e-324"],
    ["00010.00e-0", "00e+123", "1e1"],
    ["10e999999999999999999", "20e999999999999999999", "3e1000000000000000000"],
    ["1e-999999999999999999", "2e-999999999999999999", "3e-999999999999999999"],
    ["0e-999999999999999999", "1e999999999999999999", "1e999999999999999999"],
    ["1e999999999999999999", "0e-999999999999999999", "1e999999999999999999"],
  ])("proves the mathematical golden %s + %s = %s", (a, b, c) => {
    expect(npcExactDecimalSumEquals(a, b, c)).toBe(true);
    expect(npcExactDecimalSumEquals(b, a, c)).toBe(true);
  });

  it.each([
    ["0.1", "0.2", "0.30000000000000004"],
    ["1e20", "1", "1e20"],
    ["1073741824000", "0", "1073741824000.0001"],
    ["1073741824000", "0", "1073741823999.9999"],
    ["1e-999999999999999999", "0", "0"],
    ["1e999999999999999999", "1", "1e999999999999999999"],
    ["1", "1e999999999999999999", "1e999999999999999999"],
    ["0", "1e999999999999999999", "1"],
    ["1e100", "1e100", "1e100"],
    ["1e-100", "1e-100", "1e-100"],
  ])("rejects the false equation %s + %s = %s", (a, b, c) => {
    expect(npcExactDecimalSumEquals(a, b, c)).toBe(false);
  });

  it("handles the maximum input exponent length without materializing its power", () => {
    const exponent = "9".repeat(250), positive = `1e${exponent}`, negative = `1e-${exponent}`;
    expect(npcExactDecimalSumEquals(positive, "0", positive)).toBe(true);
    expect(npcExactDecimalSumEquals(negative, "0", negative)).toBe(true);
    expect(npcExactDecimalSumEquals(positive, negative, positive)).toBe(false);
    expect(npcExactDecimalSumEquals(`0e-${exponent}`, positive, positive)).toBe(true);
    expect(npcExactDecimalSumEquals("9".repeat(256), "1", "1e256")).toBe(true);
    const adjacent = 10n ** 200n;
    expect(npcExactDecimalSumEquals(`9e${adjacent}`, `1e${adjacent}`, `1e${adjacent + 1n}`)).toBe(true);
  });

  it("agrees with an independent common-scale integer oracle across bounded signed gaps", () => {
    // Unlike production elimination, this oracle expands each bounded power at
    // one fixed scale. Cases include carries, leading/trailing zeros and a
    // negative total coefficient at every possible position in the sorted sum.
    const coefficients = [0n, 1n, 9n, 10n, 99n, 1001n];
    for (let aExp = -4; aExp <= 4; aExp++) for (let bExp = -4; bExp <= 4; bExp++) {
      for (const a of coefficients) for (const b of coefficients) {
        const scaled = a * 10n ** BigInt(aExp + 4) + b * 10n ** BigInt(bExp + 4);
        const left = `${a}e${aExp}`, right = `${b}e${bExp}`;
        expect(npcExactDecimalSumEquals(left, right, `${scaled}e-4`)).toBe(true);
        expect(npcExactDecimalSumEquals(left, right, `${scaled + 1n}e-4`)).toBe(false);
        if (scaled > 0n) expect(npcExactDecimalSumEquals(left, right, `${scaled - 1n}e-4`)).toBe(false);
      }
    }
  });

  it.each([null, 1, "", "-0", "-1", "+1", "NaN", "Infinity", " 1", "1 ", "1e", "1e1.5", ".1", "1.", "1".repeat(257)])(
    "rejects malformed or unsupported text %s", input => {
      expect(npcExactDecimalSumEquals(input, "0", "0")).toBe(false);
      expect(npcExactDecimalSumEquals("0", input, "0")).toBe(false);
      expect(npcExactDecimalSumEquals("0", "0", input)).toBe(false);
    },
  );
});

describe("NPC dedicated exact fuel debit", () => {
  it.each([[100, 25, "75"], [1.25, 1, "0.25"], [1, 1, "0"]])(
    "uses the unchanged fuel quote for %s minus %s", (before, fuel, expected) => {
      const wallet = big(before), quote = big(fuel), saved = [wallet.toString(), quote.toString()];
      const after = value(checkedNpcFuelDebit(wallet, quote, String(fuel)));
      expect(after.toString()).toBe(expected);
      expect(npcExactDecimalSumEquals(after.toString(), quote.toString(), wallet.toString())).toBe(true);
      expect([wallet.toString(), quote.toString()]).toEqual(saved);
      roundtrip(after);
    },
  );

  it("distinguishes insufficient funds from unrepresentable movement", () => {
    expect(checkedNpcFuelDebit(big(1), big(2), "2")).toEqual({ ok: false, reason: "insufficient-funds" });
    expect(checkedNpcFuelDebit(big("1e20"), big(1), "1")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big("1e400"), big(1), "1")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big(-1), big(0), "0")).toEqual({ ok: false, reason: "invalid-amount" });
    expect(checkedNpcFuelDebit(big(1), big(-1), "1")).toEqual({ ok: false, reason: "invalid-amount" });
    expect(checkedNpcFuelDebit(big(NaN), big(0), "0")).toEqual({ ok: false, reason: "invalid-amount" });
  });

  it("retains legal huge and noncanonical wallet objects on zero operations", () => {
    const unstable = big(1); unstable.mantissa = 1.0000000000000002;
    const noncanonicalZero = big(0); noncanonicalZero.exponent = 123;
    for (const wallet of [big("1e400"), big("1.23456789012345e400"), big("1e8999999999999999"), big("1e9000000000000000"), unstable, noncanonicalZero, big(-0)]) {
      expect(value(checkedNpcFuelDebit(wallet, big(0), "0"))).toBe(wallet);
      expect(value(checkedNpcFuelDebit(wallet, big(-0), 0n))).toBe(wallet);
      expect(value(checkedNpcFuelDebit(wallet, noncanonicalZero, "0"))).toBe(wallet);
    }
    expect(checkedNpcFuelDebit(unstable, big(1), "1")).toEqual({ ok: false, reason: "precision" });
    const signedZero = big(0); signedZero.mantissa = -0;
    expect(value(checkedNpcFuelDebit(unstable, signedZero, "0"))).toBe(unstable);
    expect(Object.is(signedZero.mantissa, -0)).toBe(true);
    expect(checkedNpcFuelDebit(big(1), big("1e-9000000000000000"), "0")).toEqual({ ok: false, reason: "precision" });
  });

  it("keeps representable tiny remaining balances rather than rounding them away", () => {
    const before = big("1.0000000001"), quote = big(1);
    const after = value(checkedNpcFuelDebit(before, quote, "1"));
    expect(npcExactDecimalSumEquals(after.toString(), "1", "1.0000000001")).toBe(true);
    expect(after.toString()).toBe("1e-10");
    roundtrip(after);
  });

  it("rejects losing an unrepresentable tiny remainder or altering the fuel quote", () => {
    expect(checkedNpcFuelDebit(big("1.000000000000001"), big(1), "1")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big("1.00000000000001"), big(1), "1")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big(1), big("1e-20"), "0")).toEqual({ ok: false, reason: "precision" });
    const quote = big("0.10000000000000002");
    expect(checkedNpcFuelDebit(big(1), quote, "1")).toEqual({ ok: false, reason: "precision" });
    expect(quote.mantissa).toBe(big("0.10000000000000002").mantissa);
  });

  it("can prove large exact payments without globally capping a wallet or building level", () => {
    const after = value(checkedNpcFuelDebit(big("2e400"), big("1e400"), "1e400"));
    expect(after.toString()).toBe("1e+400");
    roundtrip(after);
  });

  it("rejects the storage32 representation boundary instead of billing its different canonical quote", () => {
    const price = big("1073741824000"), before = big("2147483648000");
    expect(npcExactDecimalSumEquals("1073741824000", "1073741824000", "2147483648000")).toBe(true);
    // The old Decimal constructor has already changed these input literals.
    // This NPC boundary receives the quoted Decimal, not its lost source text.
    // Its proof must never be presented as proving the original integer price.
    expect(price.toString()).toBe("1073741824000.0001");
    expect(before.toString()).toBe("2147483648000.0002");
    expect(npcExactDecimalSumEquals("1073741824000", "0", price.toString())).toBe(false);
    expect(npcExactDecimalSumEquals(price.toString(), "0", "1073741824000")).toBe(false);
    expect(npcExactDecimalSumEquals(price.toString(), price.toString(), before.toString())).toBe(true);
    expect(checkedNpcFuelDebit(before, price, "1073741824000")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(before, price, 1073741824000n)).toEqual({ ok: false, reason: "precision" });
    expect(before.toString()).toBe("2147483648000.0002");
    expect(price.toString()).toBe("1073741824000.0001");
  });

  it("requires the independent integer intent even if an incorrect quote is stable", () => {
    expect(checkedNpcFuelDebit(big("2e20"), big("1e20"), "100000000000000000001")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big(100), big(0), "1")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebit(big(100), big(1), "0")).toEqual({ ok: false, reason: "precision" });
    for (const invalid of ["0.1", "1e-1", "-1", "NaN", "", "1e1.5"]) {
      expect(checkedNpcFuelDebit(big(100), big(1), invalid)).toEqual({ ok: false, reason: "invalid-amount" });
    }
    expect(value(checkedNpcFuelDebit(big(100), big(10), "100e-1")).toString()).toBe("90");
  });
});

describe("NPC integer cargo and atomic landing credit", () => {
  it("constructs and reloads every allowed integer in each resource", () => {
    expect(NPC_MAX_LOOT).toBe(45_000);
    for (let index = 0; index < 3; index++) for (let integer = 0; integer <= NPC_LOOT_CAPS[index]!; integer++) {
      const loot = [0, 0, 0]; loot[index] = integer;
      const cargo = value(checkedNpcLootCargo(loot));
      const restored = money(cargo.metal.toString(), cargo.crystal.toString(), cargo.deuterium.toString());
      expect(value(readNpcLootCargo(cargo))).toEqual(loot);
      expect(value(readNpcLootCargo(restored))).toEqual(loot);
    }
  });

  it.each([[25_001, 0, 0], [0, 15_001, 0], [0, 0, 5_001], [-1, 0, 0], [0.1, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], [0, 0], [0, 0, 0, 0], new Array<number>(3)])(
    "rejects illegal integer loot %j", (...loot) => {
      expect(checkedNpcLootCargo(loot)).toEqual({ ok: false, reason: "invalid-loot" });
    },
  );

  it("checks all cargo bounds and rejects fractional or huge in-flight amounts", () => {
    expect(value(readNpcLootCargo(value(checkedNpcLootCargo([25_000, 15_000, 5_000]))))).toEqual([25_000, 15_000, 5_000]);
    for (const cargo of [money(25_001), money(0, 15_001), money(0, 0, 5_001), money(0.5), money("1e400")]) {
      expect(readNpcLootCargo(cargo)).toEqual({ ok: false, reason: "invalid-loot" });
    }
    const unstable = big(1); unstable.mantissa = 1.0000000000000002;
    expect(readNpcLootCargo({ ...money(0), metal: unstable })).toEqual({ ok: false, reason: "precision" });
  });

  it("credits the complete candidate, retaining zero-resource identities", () => {
    const before = money(100, 0.25, "1.23456789012345e400"), cargo = value(checkedNpcLootCargo([25, 1, 0]));
    const original = snapshot(before), carried = snapshot(cargo);
    const after = value(checkedNpcCargoCredit(before, cargo));
    expect(after).not.toBe(before);
    expect(after.metal.toString()).toBe("125");
    expect(after.crystal.toString()).toBe("1.25");
    expect(after.deuterium).toBe(before.deuterium);
    expect(snapshot(before)).toEqual(original);
    expect(snapshot(cargo)).toEqual(carried);
    for (const id of RESOURCE_IDS) roundtrip(after[id]);
  });

  it.each(["metal", "crystal", "deuterium"] as const)("rejects the whole landing when %s swallows its positive credit", badResource => {
    const before = money(100, 100, 100), cargo = value(checkedNpcLootCargo([1, 1, 1]));
    before[badResource] = big("1e20");
    const original = snapshot(before), carried = snapshot(cargo), refs = { ...before };
    expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "precision" });
    expect(snapshot(before)).toEqual(original);
    expect(snapshot(cargo)).toEqual(carried);
    for (const id of RESOURCE_IDS) expect(before[id]).toBe(refs[id]);
  });

  it("preserves huge wallets and sub-integer balances for zero loot", () => {
    const before = money("1e400", "1.23456789012345e400", Number.MIN_VALUE);
    expect(value(checkedNpcCargoCredit(before, money(0)))).toBe(before);
    expect(checkedNpcCargoCredit(before, money(1))).toEqual({ ok: false, reason: "precision" });
    const tiny = money("1e-20");
    expect(checkedNpcCargoCredit(tiny, money(1))).toEqual({ ok: false, reason: "precision" });
    expect(tiny.metal.toString()).toBe("1e-20");
  });

  it("is stricter than the old relative tolerance while leaving that helper alone", () => {
    const before = big("1000000.000000001"), incoming = big(1);
    expect(checkedWalletTransfer(before, incoming, true)).not.toBeNull();
    expect(checkedNpcCargoCredit({ ...money(0), metal: before }, money(1))).toEqual({ ok: false, reason: "precision" });
  });

  it("does not narrow the existing save reader or rewrite any other state", () => {
    const state = createInitialState(42);
    state.planets[0]!.resources = money("1.23456789012345e400", "1e20", "1e400");
    state.totalTime = big("1e400");
    const saved = serializeState(state), loaded = deserializeState(saved), original = serializeState(loaded);
    expect(checkedNpcCargoCredit(loaded.planets[0]!.resources, money(1))).toEqual({ ok: false, reason: "precision" });
    expect(serializeState(loaded)).toEqual(original);
    expect(original).toEqual(saved);
    expect(value(checkedNpcCargoCredit(loaded.planets[0]!.resources, money(0)))).toBe(loaded.planets[0]!.resources);
  });
});

describe("NPC captured data-container boundaries", () => {
  it("rejects the original changing-cargo getter before its first read", () => {
    const before = money(), original = snapshot(before);
    let reads = 0;
    const cargo = Object.defineProperty(money(), "metal", {
      enumerable: true,
      get() { reads++; return big(reads === 1 ? 1 : 25_000); },
    });
    // The original code read this twice and credited 25,000 after validating 1.
    expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "invalid-amount" });
    expect(readNpcLootCargo(cargo)).toEqual({ ok: false, reason: "invalid-amount" });
    expect(reads).toBe(0);
    expect(snapshot(before)).toEqual(original);
  });

  it("rejects source-wallet getters without executing them, including zero credit", () => {
    let reads = 0;
    const before = Object.defineProperty(money(100), "metal", {
      enumerable: true,
      get() { reads++; throw Error("Wallet getter must never run"); },
    });
    expect(checkedNpcCargoCredit(before, money(1))).toEqual({ ok: false, reason: "invalid-amount" });
    expect(checkedNpcCargoCredit(before, money())).toEqual({ ok: false, reason: "invalid-amount" });
    expect(reads).toBe(0);
  });

  it("requires exactly three own enumerable resource data fields on ordinary or null prototypes", () => {
    const missing = money(); delete (missing as Partial<ResourceAmounts>).metal;
    const hidden = money(); Object.defineProperty(hidden, "metal", { enumerable: false });
    const symbol = money(); Object.defineProperty(symbol, Symbol("extra"), { value: 0 });
    const extra = { ...money(), extra: 0 };
    const hiddenExtra = money(); Object.defineProperty(hiddenExtra, "extra", { value: 0 });
    const inherited = Object.assign(Object.create({ metal: big(0) }), { crystal: big(0), deuterium: big(0) });
    const customPrototype = Object.assign(Object.create({ unrelated: 0 }), money());
    const setter = Object.defineProperty(money(), "metal", { enumerable: true, set() { throw Error("No setter calls"); } });
    for (const malformed of [null, [], new Date(0), missing, hidden, symbol, extra, hiddenExtra, inherited, customPrototype, setter]) {
      const candidate = malformed as ResourceAmounts;
      expect(readNpcLootCargo(candidate)).toEqual({ ok: false, reason: "invalid-amount" });
      expect(checkedNpcCargoCredit(money(), candidate)).toEqual({ ok: false, reason: "invalid-amount" });
      expect(checkedNpcCargoCredit(candidate, money())).toEqual({ ok: false, reason: "invalid-amount" });
    }
  });

  it("uses one descriptor snapshot for validation and credit without reading container properties", () => {
    const sourceReads = { metal: 0, crystal: 0, deuterium: 0 };
    const cargoReads = { metal: 0, crystal: 0, deuterium: 0 };
    let propertyReads = 0;
    const captureProbe = (amounts: ResourceAmounts, counts: typeof sourceReads, laterMetal: number) => new Proxy(amounts, {
      getOwnPropertyDescriptor(target, key) {
        const field = Reflect.getOwnPropertyDescriptor(target, key)!;
        if ((RESOURCE_IDS as readonly PropertyKey[]).includes(key)) {
          const id = key as keyof ResourceAmounts;
          counts[id]++;
          if (id === "metal" && counts[id] > 1) return { ...field, value: big(laterMetal) };
        }
        return field;
      },
      get() { propertyReads++; throw Error("Captured containers must not be read again"); },
    });
    const before = captureProbe(money(100, 100, 100), sourceReads, 1_000_000);
    const cargo = captureProbe(money(1, 2, 3), cargoReads, 25_000);
    const after = value(checkedNpcCargoCredit(before, cargo));
    expect(RESOURCE_IDS.map(id => after[id].toString())).toEqual(["101", "102", "103"]);
    expect(sourceReads).toEqual({ metal: 1, crystal: 1, deuterium: 1 });
    expect(cargoReads).toEqual({ metal: 1, crystal: 1, deuterium: 1 });
    expect(propertyReads).toBe(0);
  });

  it("accepts frozen and null-prototype resource containers while preserving zero identities", () => {
    const before = Object.freeze(Object.assign(Object.create(null), money("1e400", "1e20", 0))) as ResourceAmounts;
    const zero = Object.freeze(Object.assign(Object.create(null), money())) as ResourceAmounts;
    expect(value(readNpcLootCargo(zero))).toEqual([0, 0, 0]);
    expect(value(checkedNpcCargoCredit(before, zero))).toBe(before);
    const affordable = Object.freeze(Object.assign(Object.create(null), money(100, 100, 100))) as ResourceAmounts;
    const cargo = Object.freeze(value(checkedNpcLootCargo(Object.freeze([1, 2, 3]))));
    expect(value(checkedNpcCargoCredit(affordable, cargo)).metal.toString()).toBe("101");
  });

  it("rejects loot accessors without executing either a first or a changed second value", () => {
    let reads = 0;
    const loot = Object.defineProperty([0, 0, 0], "0", {
      enumerable: true,
      get() { reads++; return reads === 1 ? 1 : 25_000; },
    });
    expect(checkedNpcLootCargo(loot)).toEqual({ ok: false, reason: "invalid-loot" });
    expect(reads).toBe(0);
  });

  it("rejects holes, symbols, extras, nonenumerable or inherited slots, and nonplain loot arrays", () => {
    const sparse = [0, 0, 0]; delete sparse[0];
    const hidden = [0, 0, 0]; Object.defineProperty(hidden, "0", { enumerable: false });
    const symbol = [0, 0, 0]; Object.defineProperty(symbol, Symbol("extra"), { value: 0 });
    const extra = [0, 0, 0]; Object.defineProperty(extra, "extra", { value: 0, enumerable: true });
    const hiddenExtra = [0, 0, 0]; Object.defineProperty(hiddenExtra, "extra", { value: 0 });
    const inherited = [0, 0, 0]; delete inherited[0]; Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: 0 }));
    const customPrototype = [0, 0, 0]; Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
    const nullPrototype = [0, 0, 0]; Object.setPrototypeOf(nullPrototype, null);
    const setter = Object.defineProperty([0, 0, 0], "0", { enumerable: true, set() { throw Error("No setter calls"); } });
    for (const malformed of [sparse, hidden, symbol, extra, hiddenExtra, inherited, customPrototype, nullPrototype, setter]) {
      expect(checkedNpcLootCargo(malformed)).toEqual({ ok: false, reason: "invalid-loot" });
    }
  });

  it("captures each loot descriptor once and never reconstructs from changed array reads", () => {
    const descriptorReads = [0, 0, 0]; let propertyReads = 0;
    const loot = new Proxy([1, 2, 3], {
      getOwnPropertyDescriptor(target, key) {
        const field = Reflect.getOwnPropertyDescriptor(target, key)!;
        if (key === "0" || key === "1" || key === "2") {
          const index = Number(key); descriptorReads[index]++;
          if (descriptorReads[index] > 1) return { ...field, value: NPC_LOOT_CAPS[index]! };
        }
        return field;
      },
      get() { propertyReads++; throw Error("Captured loot must not be read again"); },
    });
    expect(value(readNpcLootCargo(value(checkedNpcLootCargo(loot))))).toEqual([1, 2, 3]);
    expect(descriptorReads).toEqual([1, 1, 1]);
    expect(propertyReads).toBe(0);
  });

  it("keeps raw noncanonical zero wallets usable while rejecting raw noncanonical zero cargo", () => {
    const rawZero = big(0); rawZero.exponent = 7;
    const before = { ...money("1e400"), deuterium: rawZero };
    expect(value(checkedNpcCargoCredit(before, money()))).toBe(before);
    expect(before.deuterium).toBe(rawZero);
    expect(rawZero.exponent).toBe(7);
    const cargo = { ...money(), deuterium: rawZero };
    expect(readNpcLootCargo(cargo)).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "precision" });
  });
});
