import { describe, expect, it } from "vitest";
import { big, type BigNumber } from "../src/game/decimal";
import {
  checkedNpcCargoCreditWithRemainder, checkedNpcFuelDebitWithRemainder,
  readNpcResourceRemainder, type NpcResourceRemainder,
} from "../src/game/npc-remainder";
import { checkedNpcCargoCredit, checkedNpcFuelDebit, type NpcTransferResult } from "../src/game/npc-transfer";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type ResourceAmounts } from "../src/game/types";

// Independent oracle: every finite fixture below is embedded on the same
// 256-fractional-place integer grid. It imports no production parser, target
// constructor, remainder calculation, candidate search, or equality helper.
const GRID_PLACES = 256;
const UNIT = 10n ** BigInt(GRID_PLACES);
function units(text: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw Error(`Not an oracle decimal: ${text}`);
  const fraction = match[2] ?? "";
  const shift = BigInt(GRID_PLACES - fraction.length) + BigInt(match[3] ?? "0");
  if (shift < 0n || shift > 1024n) throw Error(`Outside independent fixed grid: ${text}`);
  return BigInt(match[1]! + fraction) * 10n ** shift;
}
const resources = (metal: string | number = 0, crystal: string | number = 0, deuterium: string | number = 0): ResourceAmounts =>
  ({ metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) });
const tails = (metal = "0", crystal = "0", deuterium = "0"): NpcResourceRemainder => ({ metal, crystal, deuterium });
const image = (value: BigNumber) => [value.mantissa, value.exponent, value.toString()] as const;
const images = (value: ResourceAmounts) => RESOURCE_IDS.map(id => image(value[id]));
function accept<T>(result: NpcTransferResult<T>, context = ""): T {
  expect(result.ok, context).toBe(true);
  if (!result.ok) throw Error(`${context}: ${result.reason}`);
  return result.value;
}
function prove(sourceText: string, prior: string, amount: bigint, after: BigNumber, remainder: string): void {
  expect(remainder === "0" || /^0\.\d{0,255}[1-9]$/.test(remainder)).toBe(true);
  const remainderUnits = units(remainder);
  expect(remainderUnits >= 0n && remainderUnits < UNIT).toBe(true);
  expect(units(after.toString()) + remainderUnits).toBe(units(sourceText) + units(prior) + amount * UNIT);
  expect(Number.isFinite(after.mantissa) && Number.isFinite(after.exponent) && after.mantissa >= 0).toBe(true);
  const restored = big(JSON.parse(JSON.stringify(after)) as string);
  expect(image(restored)).toEqual(image(after));
}
function snapshot(text: string, mantissa: number, exponent: number): BigNumber {
  const value = big(0); value.mantissa = mantissa; value.exponent = exponent;
  expect(value.toString()).toBe(text);
  return value;
}

// Frozen source representations from the original 6,006-case diagnostic,
// infinity-npc-transfer-usability-independent-canonical-source.json, whose
// natural-route input SHA-256 is
// 5c2fcef8b8012061a115ed10c454ef688f3f7dedf21eb69f8da84be80c9de163.
// Keep every preset and all 55 natural balances, not just prior failures.
const MATRIX_SOURCES: readonly (readonly [group: string, text: string, mantissa: number, exponent: number])[] = [
  ["preset-common-integers", "0", 0, 0],
  ["preset-common-integers", "1", 1, 0],
  ["preset-common-integers", "10", 1, 1],
  ["preset-common-integers", "20", 2, 1],
  ["preset-common-integers", "50", 5, 1],
  ["preset-common-integers", "100", 1, 2],
  ["preset-common-integers", "200", 2, 2],
  ["preset-common-integers", "500", 5, 2],
  ["preset-common-integers", "1000", 1, 3],
  ["preset-common-integers", "10000", 1, 4],
  ["preset-common-integers", "100000", 1, 5],
  ["preset-common-integers", "1000000", 1, 6],
  ["preset-common-fractions", "1.25", 1.25, 0],
  ["preset-common-fractions", "10.125", 1.0125, 1],
  ["preset-common-fractions", "100.49999999999999", 1.005, 2],
  ["preset-common-fractions", "1000.5", 1.0005, 3],
  ["preset-common-fractions", "10000.25", 1.000025, 4],
  ["preset-common-fractions", "100000.125", 1.00000125, 5],
  ["preset-common-fractions", "1000000.5000000001", 1.0000005, 6],
  ["natural-home-milestones", "2920000", 2.92, 6],
  ["natural-home-milestones", "446682.814645447", 4.46682814645447, 5],
  ["natural-home-milestones", "64292.8163582292", 6.42928163582292, 4],
  ["natural-home-milestones", "64288.8163582292", 6.42888163582292, 4],
  ["natural-home-milestones", "447067.25679276296", 4.47067256792763, 5],
  ["natural-home-milestones", "64533.019332511096", 6.45330193325111, 4],
  ["natural-home-milestones", "447451.698940079", 4.47451698940079, 5],
  ["natural-home-milestones", "64777.222306792995", 6.4777222306793, 4],
  ["natural-home-milestones", "2919200", 2.9192, 6],
  ["natural-home-milestones", "447251.698940079", 4.47251698940079, 5],
  ["natural-home-milestones", "2919778.1007209704", 2.91977810072097, 6],
  ["natural-home-milestones", "447636.14108739496", 4.47636141087395, 5],
  ["natural-home-milestones", "65021.4252810749", 6.50214252810749, 4],
  ["natural-home-milestones", "2910778.10072097", 2.91077810072097, 6],
  ["natural-home-milestones", "444636.141087395", 4.44636141087395, 5],
  ["natural-home-milestones", "2912512.4028838896", 2.91251240288389, 6],
  ["natural-home-milestones", "445789.467529343", 4.45789467529343, 5],
  ["natural-home-milestones", "65754.0342039206", 6.57540342039206, 4],
  ["natural-home-milestones", "65732.0342039206", 6.57320342039206, 4],
  ["natural-home-milestones", "2913090.50360486", 2.91309050360486, 6],
  ["natural-home-milestones", "446173.90967665805", 4.46173909676658, 5],
  ["natural-home-milestones", "65976.2371782025", 6.59762371782025, 4],
  ["natural-home-milestones", "2913668.60432583", 2.91366860432583, 6],
  ["natural-home-milestones", "446558.351823974", 4.46558351823974, 5],
  ["natural-home-milestones", "66220.4401524844", 6.62204401524844, 4],
  ["natural-home-milestones", "2914246.70504681", 2.91424670504681, 6],
  ["natural-home-milestones", "446942.79397129", 4.4694279397129, 5],
  ["natural-home-milestones", "66464.6431267664", 6.64646431267664, 4],
  ["natural-home-milestones", "2914824.8057677797", 2.91482480576778, 6],
  ["natural-home-milestones", "447327.23611860606", 4.47327236118606, 5],
  ["natural-home-milestones", "66708.8461010483", 6.67088461010483, 4],
  ["natural-home-milestones", "2915402.90648875", 2.91540290648875, 6],
  ["natural-home-milestones", "447711.678265921", 4.47711678265921, 5],
  ["natural-home-milestones", "66953.0490753302", 6.69530490753302, 4],
  ["natural-home-milestones", "2906402.90648875", 2.90640290648875, 6],
  ["natural-home-milestones", "444711.67826592096", 4.44711678265921, 5],
  ["natural-home-milestones", "2908137.2086516703", 2.90813720865167, 6],
  ["natural-home-milestones", "445865.00470786897", 4.45865004707869, 5],
  ["natural-home-milestones", "67685.6579981759", 6.76856579981759, 4],
  ["natural-home-milestones", "67653.6579981759", 6.76536579981759, 4],
  ["natural-home-milestones", "2908715.3093726397", 2.90871530937264, 6],
  ["natural-home-milestones", "446249.44685518503", 4.46249446855185, 5],
  ["natural-home-milestones", "67897.8609724578", 6.78978609724578, 4],
  ["natural-home-milestones", "2909293.41009361", 2.90929341009361, 6],
  ["natural-home-milestones", "446633.889002501", 4.46633889002501, 5],
  ["natural-home-milestones", "68142.0639467397", 6.8142063946739695, 4],
  ["natural-home-milestones", "2909871.51081459", 2.90987151081459, 6],
  ["natural-home-milestones", "447018.331149817", 4.47018331149817, 5],
  ["natural-home-milestones", "68386.2669210217", 6.83862669210217, 4],
  ["natural-home-milestones", "2910449.61153556", 2.91044961153556, 6],
  ["natural-home-milestones", "447402.77329713304", 4.47402773297133, 5],
  ["natural-home-milestones", "68630.4698953036", 6.86304698953036, 4],
  ["natural-home-milestones", "2911027.71225653", 2.91102771225653, 6],
  ["natural-home-milestones", "447787.215444448", 4.47787215444448, 5],
  ["natural-home-milestones", "68874.6728695855", 6.887467286958549, 4],
  ["actual-runtime-dock-boundary", "2910911.83616177", 2.91091183616177, 6],
  ["actual-runtime-dock-boundary", "447710.15680556995", 4.4771015680557, 5],
  ["actual-runtime-dock-boundary", "68825.7241553523", 6.88257241553523, 4],
];
const SMALL_AMOUNTS = [1, 2, 3, 5, 10, 12, 20, 23, 25, 50, 64, 68, 100, 132, 265, 500, 1000] as const;
const LEGAL_FUEL_AMOUNTS = [4, 6, 8, 12, 14, 16, 18, 20, 24, 26, 28, 30, 32, 34, 38, 42, 46, 50, 56, 60, 64, 70] as const;

describe("independent positive-remainder settlement conservation", () => {
  it("recovers every sufficient case in the original unfiltered 6,006-case matrix", () => {
    expect(MATRIX_SOURCES).toHaveLength(77);
    expect(MATRIX_SOURCES.filter(([group]) => group === "natural-home-milestones")).toHaveLength(55);
    let operations = 0, legacyNaturalFuelRejections = 0, legacyNaturalCreditRejections = 0;
    for (const [group, text, mantissa, exponent] of MATRIX_SOURCES) {
      for (const [movementGroup, amounts] of [["small", SMALL_AMOUNTS], ["fuel", LEGAL_FUEL_AMOUNTS]] as const) {
        for (const amount of amounts) {
          const before = snapshot(text, mantissa, exponent), original = image(before);
          const creditWallet = { ...resources(), metal: before }, prior = tails();
          const credit = accept(checkedNpcCargoCreditWithRemainder(creditWallet, prior, resources(amount)), `${group} credit ${text} + ${amount}`);
          prove(text, "0", BigInt(amount), credit.resources.metal, credit.remainder.metal);
          expect(credit.resources.crystal).toBe(creditWallet.crystal);
          expect(credit.resources.deuterium).toBe(creditWallet.deuterium);
          const debit = checkedNpcFuelDebitWithRemainder(before, "0", big(amount), BigInt(amount));
          if (units(text) < BigInt(amount) * UNIT) expect(debit).toEqual({ ok: false, reason: "insufficient-funds" });
          else {
            const paid = accept(debit, `${group} debit ${text} - ${amount}`);
            prove(text, "0", -BigInt(amount), paid.wallet, paid.remainder);
          }
          if (group === "natural-home-milestones") {
            if (movementGroup === "fuel" && !checkedNpcFuelDebit(before, big(amount), BigInt(amount)).ok) legacyNaturalFuelRejections++;
            if (movementGroup === "small" && !checkedNpcCargoCredit(creditWallet, resources(amount)).ok) legacyNaturalCreditRejections++;
          }
          expect(image(before)).toEqual(original);
          expect(prior).toEqual(tails());
          operations += 2;
        }
      }
    }
    expect(operations).toBe(6006);
    // These unchanged strict helpers remain the negative control. New recovery
    // does not come from loosening or deleting the preceding exact proof.
    expect(legacyNaturalFuelRejections).toBe(168);
    expect(legacyNaturalCreditRejections).toBe(137);
  }, 30_000);

  it.each([12, 16, 26, 30, 50, 64])("settles the formerly rejected ordinary 1e6 wallet fuel %i exactly", amount => {
    const before = big(1_000_000), quote = big(amount);
    expect(checkedNpcFuelDebit(before, quote, BigInt(amount))).toEqual({ ok: false, reason: "precision" });
    const paid = accept(checkedNpcFuelDebitWithRemainder(before, "0", quote, BigInt(amount)));
    prove("1000000", "0", -BigInt(amount), paid.wallet, paid.remainder);
    expect(units(paid.remainder)).toBeLessThan(UNIT);
  });

  it("proves all three actual first-dock rights, retaining the same-text different-bits source", () => {
    const before = resources("2910911.83616177", "447710.15680556995", "68825.7241553523");
    before.deuterium.mantissa = 6.88257241553523;
    expect(big(before.deuterium.toString()).mantissa).toBe(6.882572415535231);
    expect(big(before.deuterium.toString()).toString()).toBe(before.deuterium.toString());
    const original = images(before), prior = tails(), cargo = resources(265, 132, 23);
    const after = accept(checkedNpcCargoCreditWithRemainder(before, prior, cargo));
    for (const id of RESOURCE_IDS) prove(before[id].toString(), prior[id], BigInt(cargo[id].toString()), after.resources[id], after.remainder[id]);
    expect(images(before)).toEqual(original);
    expect(units(after.resources.metal.toString()) - units(before.metal.toString())).toBeGreaterThan(264n * UNIT);
  });

  it.each([
    ["actual 30.79955725610165-second event", "2918114.04481342", "452455.46257335896", "71767.1598467352"],
    ["unchanged 31-second blocked checkpoint", "2918229.92090818", "452532.521212237", "71816.1085609684"],
  ])("settles second natural arrival at %s without waiting for production", (_name, metal, crystal, deuterium) => {
    const before = resources(metal, crystal, deuterium), prior = tails(), cargo = resources(44, 22, 4);
    expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "precision" });
    const after = accept(checkedNpcCargoCreditWithRemainder(before, prior, cargo));
    for (const id of RESOURCE_IDS) prove(before[id].toString(), prior[id], BigInt(cargo[id].toString()), after.resources[id], after.remainder[id]);
  });

  it("uses the greatest proved decimal-truncation candidate below an integer plateau", () => {
    const before = resources("0.99999999998"), prior = tails();
    const after = accept(checkedNpcCargoCreditWithRemainder(before, prior, resources(1)));
    expect(after.resources.metal.toString()).toBe("1.9999999999");
    expect(after.remainder.metal).toBe("0.00000000008");
    prove("0.99999999998", "0", 1n, after.resources.metal, after.remainder.metal);
  });

  it("hydrates integer-snap plateaus while preserving the exact tiny entitlement", () => {
    const after = accept(checkedNpcCargoCreditWithRemainder(resources(1), tails("0.00000000001"), resources(1)));
    expect(after.resources.metal.toString()).toBe("2");
    expect(after.remainder.metal).toBe("0.00000000001");
    prove("1", "0.00000000001", 1n, after.resources.metal, after.remainder.metal);
  });

  it("never allows pending rights to fund otherwise unaffordable fuel", () => {
    expect(checkedNpcFuelDebitWithRemainder(big("0.75"), "0.25", big(1), "1"))
      .toEqual({ ok: false, reason: "insufficient-funds" });
    // Canonical monetary text can make the quote affordable even when a hidden
    // mantissa has a lower representation. The contract authorizes from text.
    const before = big(1); before.mantissa = 0.9999999999999999;
    expect(before.toString()).toBe("1");
    expect(before.lt(big(1))).toBe(true);
    const after = accept(checkedNpcFuelDebitWithRemainder(before, "0.25", big(1), "1"));
    prove("1", "0.25", -1n, after.wallet, after.remainder);
  });

  it("preserves old tails through repeated credits, affordable fuel, JSON saves, and carry release", () => {
    let wallet = resources("100.9999999997", "1", "1000000"), remainder = tails("0.0000000003", "0.00000000001", "0.9999999999999999999999999999");
    const originalComposite = RESOURCE_IDS.map(id => units(wallet[id].toString()) + units(remainder[id]));
    const total = [0n, 0n, 0n];
    for (let index = 0; index < 32; index++) {
      const cargo = resources(index % 2 ? 265 : 1, index % 3 ? 0 : 1, index % 2 ? 23 : 0);
      const after = accept(checkedNpcCargoCreditWithRemainder(wallet, remainder, cargo));
      for (const [i, id] of RESOURCE_IDS.entries()) {
        prove(wallet[id].toString(), remainder[id], BigInt(cargo[id].toString()), after.resources[id], after.remainder[id]);
        total[i] = total[i]! + BigInt(cargo[id].toString());
      }
      wallet = after.resources; remainder = after.remainder;
      const paid = accept(checkedNpcFuelDebitWithRemainder(wallet.deuterium, remainder.deuterium, big(12), "12"));
      prove(wallet.deuterium.toString(), remainder.deuterium, -12n, paid.wallet, paid.remainder);
      wallet = { ...wallet, deuterium: paid.wallet }; remainder = { ...remainder, deuterium: paid.remainder }; total[2] = total[2]! - 12n;
      const state = createInitialState(20261011); state.planets[0]!.resources = wallet; state.planets[0]!.npcResourceRemainder = remainder;
      const raw = serializeState(state), restored = deserializeState(raw);
      expect(restored.planets[0]!.npcResourceRemainder).toEqual(remainder);
      expect(images(restored.planets[0]!.resources)).toEqual(images(wallet));
      expect(serializeState(restored)).toEqual(raw);
      wallet = restored.planets[0]!.resources; remainder = restored.planets[0]!.npcResourceRemainder;
    }
    for (const [i, id] of RESOURCE_IDS.entries()) expect(units(wallet[id].toString()) + units(remainder[id])).toBe(originalComposite[i]! + total[i]! * UNIT);
    const credit = accept(checkedNpcCargoCreditWithRemainder(resources("100.9999999997"), tails("0.0000000003"), resources(1)));
    expect([credit.resources.metal.toString(), credit.remainder.metal]).toEqual(["102", "0"]);
    const debit = accept(checkedNpcFuelDebitWithRemainder(big("100.9999999997"), "0.0000000003", big(1), "1"));
    expect([debit.wallet.toString(), debit.remainder]).toEqual(["100", "0"]);
  });

  it("accepts the full 258-character remainder and preserves it exactly rather than reparsing as Decimal", () => {
    const tiny = `0.${"0".repeat(255)}1`, nearOne = `0.${"9".repeat(256)}`;
    expect(tiny).toHaveLength(258); expect(nearOne).toHaveLength(258);
    for (const prior of [tiny, nearOne]) {
      expect(readNpcResourceRemainder(tails(prior))).toEqual(tails(prior));
      const after = accept(checkedNpcCargoCreditWithRemainder(resources(1), tails(prior), resources(1)));
      prove("1", prior, 1n, after.resources.metal, after.remainder.metal);
      const paid = accept(checkedNpcFuelDebitWithRemainder(big(1), prior, big(1), "1"));
      prove("1", prior, -1n, paid.wallet, paid.remainder);
    }
  });
});

describe("independent fail-closed bounds, quote intent, identity, and atomicity", () => {
  const invalidTails: unknown[] = [undefined, null, 0, -0, 0.1, true, "", "00", "-0", "+0", "0.0", "0.10", "0.", ".1", "00.1", " 0.1", "0.1 ", "1", "1.0", "-0.1", "NaN", "Infinity", "1e-1", `0.${"0".repeat(256)}1`, new String("0.1")];
  it.each(invalidTails)("rejects noncanonical prior remainder %s even on zero operations", value => {
    expect(readNpcResourceRemainder({ ...tails(), metal: value as string })).toBeNull();
    expect(checkedNpcFuelDebitWithRemainder(big(1), value as string, big(0), "0")).toEqual({ ok: false, reason: "invalid-amount" });
    expect(checkedNpcCargoCreditWithRemainder(resources(1), { ...tails(), metal: value as string }, resources())).toEqual({ ok: false, reason: "invalid-amount" });
  });

  it("validates a full M/C/D own-data container before zero identity and never invokes accessors", () => {
    for (const id of RESOURCE_IDS) {
      let reads = 0;
      const hostile = Object.defineProperty(tails(), id, { enumerable: true, get() { reads++; throw Error("Getter ran"); } });
      expect(readNpcResourceRemainder(hostile)).toBeNull();
      expect(checkedNpcCargoCreditWithRemainder(resources(), hostile, resources())).toEqual({ ok: false, reason: "invalid-amount" });
      expect(reads).toBe(0);
      for (const sourceIsHostile of [false, true]) {
        const resourceGetter = Object.defineProperty(resources(), id, { enumerable: true, get() { reads++; throw Error("Getter ran"); } });
        expect(checkedNpcCargoCreditWithRemainder(sourceIsHostile ? resourceGetter : resources(), tails(), sourceIsHostile ? resources() : resourceGetter))
          .toEqual({ ok: false, reason: "invalid-amount" });
        expect(reads).toBe(0);
      }
    }
    const inherited = Object.create(tails()) as NpcResourceRemainder;
    const hidden = Object.defineProperty(tails(), "metal", { enumerable: false, value: "0" });
    for (const invalid of [inherited, hidden, { ...tails(), extra: "0" }, { ...tails(), [Symbol("extra")]: "0" }, ["0", "0", "0"]]) expect(readNpcResourceRemainder(invalid)).toBeNull();
    expect(readNpcResourceRemainder(Object.assign(Object.create(null) as object, tails()))).toEqual(tails());
  });

  it("zero amounts preserve wallet objects, unusual zeros, and every right without sweeping", () => {
    const negativeZero = big(0); negativeZero.mantissa = -0;
    const displacedZero = big(0); displacedZero.exponent = 123;
    const unstable = big(1); unstable.mantissa = 1.0000000000000002;
    const before = { metal: negativeZero, crystal: displacedZero, deuterium: unstable }, prior = tails("0.25", "0.00000000001", "0.999");
    const original = images(before), after = accept(checkedNpcCargoCreditWithRemainder(before, prior, resources()));
    expect(after.resources).toBe(before); expect(after.remainder).toBe(prior); expect(images(before)).toEqual(original);
    expect(Object.is(before.metal.mantissa, -0)).toBe(true);
    for (const id of RESOURCE_IDS) {
      const paid = accept(checkedNpcFuelDebitWithRemainder(before[id], prior[id], big(0), 0n));
      expect(paid.wallet).toBe(before[id]); expect(paid.remainder).toBe(prior[id]);
    }
    const mixed = accept(checkedNpcCargoCreditWithRemainder(before, prior, resources(0, 0, 1)));
    expect(mixed.resources.metal).toBe(negativeZero); expect(mixed.resources.crystal).toBe(displacedZero);
    expect(mixed.remainder.metal).toBe(prior.metal); expect(mixed.remainder.crystal).toBe(prior.crystal);
    prove("1", prior.deuterium, 1n, mixed.resources.deuterium, mixed.remainder.deuterium);
  });

  it("captures the original source canonical text exactly once", () => {
    const before = big("1000000"), originalToString = before.toString.bind(before);
    let calls = 0;
    before.toString = () => { calls++; return calls === 1 ? originalToString() : "999999999"; };
    const paid = accept(checkedNpcFuelDebitWithRemainder(before, "0.25", big(12), "12"));
    expect(calls).toBe(1);
    prove("1000000", "0.25", -12n, paid.wallet, paid.remainder);
  });

  it.each([
    [9.999999999999998, 5, "999999.9999999998", "999999.9999999997"],
    [9.999999999999998, -6, "0.000009999999999999997", "0.000009999999999999996"],
  ] as const)("rejects actual source-text drift from mantissa %s exponent %s atomically", (mantissa, exponent, text, restoredText) => {
    // Literal real-JS observations: these valid normalized source mantissas
    // stringify to a different monetary value after the existing reader.
    const before = snapshot(text, mantissa, exponent), restored = big(text);
    expect(restored.toString()).toBe(restoredText);
    expect(units(text)).not.toBe(units(restoredText));
    const wallet = { ...resources(), metal: before }, prior = tails("0.25"), original = images(wallet);
    expect(checkedNpcCargoCreditWithRemainder(wallet, prior, resources(1))).toEqual({ ok: false, reason: "precision" });
    expect(checkedNpcFuelDebitWithRemainder(before, "0.25", big(1), "1")).toEqual({ ok: false, reason: "precision" });
    expect(images(wallet)).toEqual(original); expect(prior).toEqual(tails("0.25"));
  });

  it("does not turn a rounded or mismatched original fuel quote into an authorized payment", () => {
    const wallet = big("2147483648000"), quote = big("1073741824000");
    expect(quote.toString()).toBe("1073741824000.0001");
    const original = [image(wallet), image(quote)];
    expect(checkedNpcFuelDebitWithRemainder(wallet, "0.9999999999", quote, "1073741824000")).toEqual({ ok: false, reason: "precision" });
    expect([image(wallet), image(quote)]).toEqual(original);
    for (const [amount, intent] of [[0, "1"], [1, "0"], [12, "14"]] as const) {
      expect(checkedNpcFuelDebitWithRemainder(big(100), "0.5", big(amount), intent)).toEqual({ ok: false, reason: "precision" });
    }
    expect(checkedNpcFuelDebitWithRemainder(big(100), "0", big(1), "1.1")).toEqual({ ok: false, reason: "invalid-amount" });
  });

  it.each(RESOURCE_IDS)("rejects the entire candidate when the %s resource cannot retain a subunit tail", failing => {
    const before = resources("2911027.71225653", "1000.5", "25.125"), prior = tails("0.1", "0.2", "0.3"), cargo = resources(1, 1, 1);
    before[failing] = big("1e40");
    const original = [images(before), { ...prior }, images(cargo)], refs = { ...before };
    for (let retry = 0; retry < 3; retry++) {
      expect(checkedNpcCargoCreditWithRemainder(before, prior, cargo)).toEqual({ ok: false, reason: "precision" });
      expect([images(before), prior, images(cargo)]).toEqual(original);
      for (const id of RESOURCE_IDS) expect(before[id]).toBe(refs[id]);
    }
  });

  it.each(["1e400", "1e8999999999999999", "1e-257", "1e-8999999999999999"])("rejects unsupported %s without an exponent-sized allocation or discarded entitlement", text => {
    const before = resources(text), prior = tails(), original = images(before);
    expect(checkedNpcCargoCreditWithRemainder(before, prior, resources(1))).toEqual({ ok: false, reason: "precision" });
    expect(images(before)).toEqual(original); expect(prior).toEqual(tails());
    expect(accept(checkedNpcCargoCreditWithRemainder(before, prior, resources())).resources).toBe(before);
  });

  it("supports exact huge shared-exponent cancellation and refuses unsupported 513-digit alignment", () => {
    for (const exponent of [400, 8_999_999_999_999_999]) {
      const before = big(`2e${exponent}`), fuel = big(`1e${exponent}`);
      const after = accept(checkedNpcFuelDebitWithRemainder(before, "0", fuel, `1e${exponent}`));
      expect(image(after.wallet)).toEqual(image(fuel)); expect(after.remainder).toBe("0");
      const zero = accept(checkedNpcFuelDebitWithRemainder(before, "0", before, `2e${exponent}`));
      expect([zero.wallet.toString(), zero.remainder]).toEqual(["0", "0"]);
    }
    const tiny = `0.${"0".repeat(255)}1`;
    const supported = accept(checkedNpcFuelDebitWithRemainder(big("1e255"), tiny, big("1e255"), "1e255"));
    prove("1e255", tiny, -(10n ** 255n), supported.wallet, supported.remainder);
    expect(checkedNpcFuelDebitWithRemainder(big("1e256"), tiny, big("1e256"), "1e256"))
      .toEqual({ ok: false, reason: "precision" });
  });
});
