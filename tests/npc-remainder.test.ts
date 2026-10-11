import { describe, expect, it } from "vitest";
import { big, type BigNumber } from "../src/game/decimal";
import {
  checkedNpcCargoCreditWithRemainder, checkedNpcFuelDebitWithRemainder,
  createNpcResourceRemainder, readNpcResourceRemainder, type NpcResourceRemainder,
} from "../src/game/npc-remainder";
import { checkedNpcFuelDebit, checkedNpcLootCargo, type NpcTransferResult } from "../src/game/npc-transfer";
import { RESOURCE_IDS, type ResourceAmounts } from "../src/game/types";

const money = (metal: string | number = 0, crystal: string | number = 0, deuterium: string | number = 0): ResourceAmounts =>
  ({ metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) });
const accept = <T>(result: NpcTransferResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.reason);
  return result.value;
};
const bits = (amount: BigNumber) => [amount.mantissa, amount.exponent, amount.toString()];
const image = (amounts: ResourceAmounts) => RESOURCE_IDS.map(id => bits(amounts[id]));
const stable = (amount: BigNumber) => expect(bits(big(amount.toString()))).toEqual(bits(amount));

// Independent common-grid oracle. All these fixture values fit the fixed grid;
// production uses variable alignment and a separate exponent-elimination proof.
const SCALE = 10n ** 256n;
function units(text: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match) throw Error(`Invalid fixture ${text}`);
  const fraction = match[2] ?? "", shift = 256 + Number(match[3] ?? "0") - fraction.length;
  if (!Number.isSafeInteger(shift) || shift < 0 || shift > 800) throw Error(`Out-of-grid fixture ${text}`);
  return BigInt(match[1] + fraction) * 10n ** BigInt(shift);
}
function conservation(before: BigNumber, prior: string, signedInteger: bigint, after: BigNumber, remainder: string): void {
  expect(units(before.toString()) + units(prior) + signedInteger * SCALE).toBe(units(after.toString()) + units(remainder));
  expect(units(remainder)).toBeGreaterThanOrEqual(0n);
  expect(units(remainder)).toBeLessThan(SCALE);
  stable(after);
}

describe("canonical bounded NPC remainder schema", () => {
  it("creates fresh independent zero records", () => {
    const first = createNpcResourceRemainder(), second = createNpcResourceRemainder();
    expect(first).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
    expect(first).not.toBe(second);
    first.metal = "0.25";
    expect(second.metal).toBe("0");
  });

  it.each(["0", "0.1", "0.25", `0.${"0".repeat(255)}1`, `0.${"9".repeat(256)}`])("preserves canonical %s exactly", text => {
    const source = { metal: text, crystal: text, deuterium: text };
    const result = readNpcResourceRemainder(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
  });

  it.each([undefined, null, 0, -0, 0.5, "", "-0", "+0", "0.0", "00", "00.1", ".1", "1", "1.0", "0.10", "0.000", "0.1 ", " 0.1", "NaN", "Infinity", "1e-1", "-0.1", `0.${"0".repeat(256)}1`])(
    "rejects invalid fractional encoding %s", input => {
      for (const id of RESOURCE_IDS) expect(readNpcResourceRemainder({ ...createNpcResourceRemainder(), [id]: input })).toBeNull();
    },
  );

  it("rejects extra, hidden, inherited and accessor fields without executing getters", () => {
    const missing = createNpcResourceRemainder(); delete (missing as Partial<NpcResourceRemainder>).metal;
    const hidden = createNpcResourceRemainder(); Object.defineProperty(hidden, "metal", { enumerable: false });
    const symbol = createNpcResourceRemainder(); Object.defineProperty(symbol, Symbol("extra"), { value: "0" });
    const hiddenExtra = createNpcResourceRemainder(); Object.defineProperty(hiddenExtra, "extra", { value: "0" });
    const inherited = Object.assign(Object.create({ metal: "0" }), { crystal: "0", deuterium: "0" });
    let reads = 0;
    const getter = Object.defineProperty(createNpcResourceRemainder(), "metal", { enumerable: true, get() { reads++; return "0"; } });
    for (const input of [null, [], new Date(), missing, hidden, symbol, hiddenExtra, inherited, getter,
      { ...createNpcResourceRemainder(), extra: "0" }, Object.assign(Object.create({ extra: "0" }), createNpcResourceRemainder())]) {
      expect(readNpcResourceRemainder(input)).toBeNull();
    }
    expect(reads).toBe(0);
    const frozen = Object.freeze(Object.assign(Object.create(null), createNpcResourceRemainder()));
    expect(readNpcResourceRemainder(frozen)).toEqual(createNpcResourceRemainder());
  });
});

describe("NPC-only positive remainder settlement", () => {
  it.each([12, 16, 26, 30, 50, 64])("settles ordinary 1e6 fuel %s without losing entitlement", fuel => {
    const before = big(1e6), quote = big(fuel), original = [bits(before), bits(quote)];
    const after = accept(checkedNpcFuelDebitWithRemainder(before, "0", quote, BigInt(fuel)));
    conservation(before, "0", -BigInt(fuel), after.wallet, after.remainder);
    expect([bits(before), bits(quote)]).toEqual(original);
    if (fuel === 64) {
      expect(after.wallet.toString()).toBe("999935.9999999999");
      expect(after.remainder).toBe("0.0000000001");
      expect(checkedNpcFuelDebit(before, quote, "64")).toEqual({ ok: false, reason: "precision" });
    }
  });

  it("merges only previously earned tail on the next positive credit or affordable fuel", () => {
    const before = big("100.9999999997"), prior = "0.0000000003";
    const debit = accept(checkedNpcFuelDebitWithRemainder(before, prior, big(1), "1"));
    expect([debit.wallet.toString(), debit.remainder]).toEqual(["100", "0"]);
    conservation(before, prior, -1n, debit.wallet, debit.remainder);
    const credit = accept(checkedNpcCargoCreditWithRemainder({ ...money(), metal: before },
      { ...createNpcResourceRemainder(), metal: prior }, money(1)));
    expect([credit.resources.metal.toString(), credit.remainder.metal]).toEqual(["102", "0"]);
    conservation(before, prior, 1n, credit.resources.metal, credit.remainder.metal);
  });

  it("never uses pending entitlement to authorize fuel the ordinary wallet cannot afford", () => {
    expect(checkedNpcFuelDebitWithRemainder(big("0.75"), "0.25", big(1), "1"))
      .toEqual({ ok: false, reason: "insufficient-funds" });
  });

  it("hydrates a stable candidate within an integer snap plateau", () => {
    const before = money(1), prior = { ...createNpcResourceRemainder(), metal: "0.00000000001" };
    const after = accept(checkedNpcCargoCreditWithRemainder(before, prior, money(1)));
    expect([after.resources.metal.toString(), after.remainder.metal]).toEqual(["2", "0.00000000001"]);
    conservation(before.metal, prior.metal, 1n, after.resources.metal, after.remainder.metal);
  });

  it("escapes a below-integer snap plateau with exact decimal truncation", () => {
    const before = money("0.99999999998");
    const after = accept(checkedNpcCargoCreditWithRemainder(before, createNpcResourceRemainder(), money(1)));
    // This is the greatest verified truncation, even closer than the contract's
    // illustrative 9-significant-digit candidate 1.99999999.
    expect([after.resources.metal.toString(), after.remainder.metal]).toEqual(["1.9999999999", "0.00000000008"]);
    conservation(before.metal, "0", 1n, after.resources.metal, after.remainder.metal);
  });

  it("accepts the complete 258-character tail and rejects a smaller unsupported tail", () => {
    const minimum = `0.${"0".repeat(255)}1`;
    const before = money("1e-256"), after = accept(checkedNpcCargoCreditWithRemainder(before, createNpcResourceRemainder(), money(1)));
    expect([after.resources.metal.toString(), after.remainder.metal]).toEqual(["1", minimum]);
    conservation(before.metal, "0", 1n, after.resources.metal, after.remainder.metal);
    const carried = accept(checkedNpcCargoCreditWithRemainder(after.resources, after.remainder, money(1)));
    expect([carried.resources.metal.toString(), carried.remainder.metal]).toEqual(["2", minimum]);
    expect(checkedNpcCargoCreditWithRemainder(money("1e-257"), createNpcResourceRemainder(), money(1)))
      .toEqual({ ok: false, reason: "precision" });
    const almostOne = `0.${"9".repeat(256)}`;
    const near = accept(checkedNpcCargoCreditWithRemainder(money(), { ...createNpcResourceRemainder(), metal: almostOne }, money(1)));
    conservation(big(0), almostOne, 1n, near.resources.metal, near.remainder.metal);
  });

  it("keeps quote and cargo checks strict, without repairing their original intended integer", () => {
    expect(checkedNpcFuelDebitWithRemainder(big("2147483648000"), "0.25", big("1073741824000"), "1073741824000"))
      .toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebitWithRemainder(big(100), "0", big(0), "1")).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebitWithRemainder(big(100), "0", big(1), "0")).toEqual({ ok: false, reason: "precision" });
    for (const expected of ["-1", "0.1", "NaN", "", "1e-1"]) {
      expect(checkedNpcFuelDebitWithRemainder(big(100), "0", big(1), expected)).toEqual({ ok: false, reason: "invalid-amount" });
    }
    const unstable = big(1); unstable.mantissa = 1.0000000000000002;
    expect(checkedNpcCargoCreditWithRemainder(money(), createNpcResourceRemainder(), { ...money(), metal: unstable }))
      .toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcCargoCreditWithRemainder(money(), createNpcResourceRemainder(), money(0.25)))
      .toEqual({ ok: false, reason: "invalid-loot" });
  });

  it("supports huge matching exponents but rejects an unsupported alignment span", () => {
    for (const exponent of [400, 8_999_999_999_999_999]) {
      const before = big(`2e${exponent}`), fuel = big(`1e${exponent}`);
      const after = accept(checkedNpcFuelDebitWithRemainder(before, "0", fuel, `1e${exponent}`));
      expect(bits(after.wallet)).toEqual(bits(fuel));
      expect(after.remainder).toBe("0");
      expect(accept(checkedNpcFuelDebitWithRemainder(before, "0", before, `2e${exponent}`)).wallet.toString()).toBe("0");
      expect(checkedNpcFuelDebitWithRemainder(before, `0.${"0".repeat(255)}1`, fuel, `1e${exponent}`))
        .toEqual({ ok: false, reason: "precision" });
    }
    for (const text of ["1e400", "1e512", "1e8999999999999999", "1e-400", "1e-8999999999999999"]) {
      expect(checkedNpcCargoCreditWithRemainder(money(text), createNpcResourceRemainder(), money(1)))
        .toEqual({ ok: false, reason: "precision" });
    }
  });

  it.each([
    ["2910911.83616177", "447710.15680556995", "68825.7241553523", 265, 132, 23],
    ["2918114.04481342", "452455.46257335896", "71767.1598467352", 44, 22, 4],
  ] as const)("settles all three exact natural-boundary rights at metal %s", (m, c, d, lm, lc, ld) => {
    const before = money(m, c, d), loot = [lm, lc, ld] as const, cargo = accept(checkedNpcLootCargo(loot));
    if (d === "68825.7241553523") before.deuterium.mantissa = 6.88257241553523;
    const original = image(before), prior = createNpcResourceRemainder();
    const after = accept(checkedNpcCargoCreditWithRemainder(before, prior, cargo));
    RESOURCE_IDS.forEach((id, index) => conservation(before[id], "0", BigInt(loot[index]!), after.resources[id], after.remainder[id]));
    expect(image(before)).toEqual(original);
    expect(prior).toEqual(createNpcResourceRemainder());
    // Repeated serializer/reader-equivalent hydration neither loses nor grants
    // a tail; full state save roundtrips are covered by storage integration.
    let persisted = JSON.stringify({ resources: after.resources, remainder: after.remainder });
    for (let cycle = 0; cycle < 10; cycle++) {
      const parsed = JSON.parse(persisted), resources = money(parsed.resources.metal, parsed.resources.crystal, parsed.resources.deuterium);
      const remainder = readNpcResourceRemainder(parsed.remainder)!;
      expect(image(resources)).toEqual(image(after.resources));
      expect(remainder).toEqual(after.remainder);
      expect(JSON.stringify({ resources, remainder })).toBe(persisted);
      persisted = JSON.stringify({ resources, remainder });
    }
  });

  it("preserves source canonical text when only runtime bits differ, and rejects unsupported text", () => {
    const source = big(1); source.mantissa = 1.0000000000000002;
    const after = accept(checkedNpcFuelDebitWithRemainder(source, "0.25", big(1), "1"));
    expect([after.wallet.toString(), after.remainder]).toEqual(["0.25", "0"]);
    expect(source.mantissa).toBe(1.0000000000000002);
    const huge = big("1e9000000000000000");
    expect(huge.toString()).toBe("Infinity");
    expect(checkedNpcFuelDebitWithRemainder(huge, "0", big(1), "1")).toEqual({ ok: false, reason: "precision" });
  });
});

describe("NPC remainder atomicity and capture", () => {
  it("preserves every unusual zero wallet and both whole-container identities on zero cargo", () => {
    const signed = big(0); signed.mantissa = -0;
    const displaced = big(0); displaced.exponent = 123;
    const before = { metal: signed, crystal: displaced, deuterium: big("1e400") };
    const prior = { metal: "0.25", crystal: "0.75", deuterium: "0.0000000001" };
    const after = accept(checkedNpcCargoCreditWithRemainder(before, prior, money()));
    expect(after.resources).toBe(before); expect(after.remainder).toBe(prior);
    for (const id of RESOURCE_IDS) {
      const zero = accept(checkedNpcFuelDebitWithRemainder(before[id], prior[id], signed, "0"));
      expect(zero.wallet).toBe(before[id]); expect(zero.remainder).toBe(prior[id]);
    }
    expect(Object.is(signed.mantissa, -0)).toBe(true); expect(displaced.exponent).toBe(123);
    const mixed = accept(checkedNpcCargoCreditWithRemainder({ ...before, metal: big(0) }, prior, money(1)));
    expect(mixed.resources.crystal).toBe(displaced); expect(mixed.remainder.crystal).toBe("0.75");
    expect(mixed.resources.deuterium).toBe(before.deuterium); expect(mixed.remainder.deuterium).toBe(prior.deuterium);
  });

  it.each(RESOURCE_IDS)("rejects the whole candidate if %s cannot preserve a subunit tail", failed => {
    const before = money(100, 100, 100), prior = { metal: "0.1", crystal: "0.2", deuterium: "0.3" }, cargo = money(1, 1, 1);
    before[failed] = big("1e20");
    const original = [image(before), { ...prior }, image(cargo)];
    for (let retry = 0; retry < 3; retry++) {
      expect(checkedNpcCargoCreditWithRemainder(before, prior, cargo)).toEqual({ ok: false, reason: "precision" });
      expect([image(before), prior, image(cargo)]).toEqual(original);
    }
  });

  it("captures all original descriptors once without later property reads", () => {
    const captures = [{ metal: 0, crystal: 0, deuterium: 0 }, { metal: 0, crystal: 0, deuterium: 0 }, { metal: 0, crystal: 0, deuterium: 0 }];
    let reads = 0;
    function probe<T extends object>(target: T, counts: typeof captures[number]): T {
      return new Proxy(target, {
        getOwnPropertyDescriptor(object, key) {
          const field = Reflect.getOwnPropertyDescriptor(object, key);
          if ((RESOURCE_IDS as readonly PropertyKey[]).includes(key)) counts[key as keyof typeof counts]++;
          return field;
        },
        get() { reads++; throw Error("Container was read after capture"); },
      });
    }
    const before = probe(money(100, 100, 100), captures[0]!), prior = probe(createNpcResourceRemainder(), captures[1]!), cargo = probe(money(1, 2, 3), captures[2]!);
    const after = accept(checkedNpcCargoCreditWithRemainder(before, prior, cargo));
    expect(RESOURCE_IDS.map(id => after.resources[id].toString())).toEqual(["101", "102", "103"]);
    expect(captures).toEqual(Array.from({ length: 3 }, () => ({ metal: 1, crystal: 1, deuterium: 1 })));
    expect(reads).toBe(0);
  });

  it("rejects wallet, cargo and remainder getters without executing them", () => {
    let reads = 0;
    const hostile = <T extends object>(object: T) => Object.defineProperty(object, "metal", { enumerable: true, get() { reads++; throw Error("Getter ran"); } });
    expect(checkedNpcCargoCreditWithRemainder(hostile(money()), createNpcResourceRemainder(), money()))
      .toEqual({ ok: false, reason: "invalid-amount" });
    expect(checkedNpcCargoCreditWithRemainder(money(), hostile(createNpcResourceRemainder()), money()))
      .toEqual({ ok: false, reason: "invalid-amount" });
    expect(checkedNpcCargoCreditWithRemainder(money(), createNpcResourceRemainder(), hostile(money())))
      .toEqual({ ok: false, reason: "invalid-amount" });
    expect(reads).toBe(0);
  });
});
