import { describe, expect, it } from "vitest";
import { big, type BigNumber } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import {
  checkedNpcCargoCredit, checkedNpcFuelDebit, checkedNpcLootCargo, readNpcLootCargo,
  type NpcTransferResult,
} from "../src/game/npc-transfer";
import { checkedWalletTransfer } from "../src/game/order-wallet";
import { createPlanet } from "../src/game/planet";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type ResourceAmounts } from "../src/game/types";

const resources = (metal: string | number = 0, crystal: string | number = 0, deuterium: string | number = 0): ResourceAmounts =>
  ({ metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) });
const accept = <T>(result: NpcTransferResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.reason);
  return result.value;
};
const image = (value: BigNumber) => [value.mantissa, value.exponent, value.toString()];
const resourceImage = (value: ResourceAmounts) => RESOURCE_IDS.map(id => image(value[id]));

// Independent oracle: every bounded fixture is embedded on ONE fixed integer
// grid. This neither imports the production decimal equation proof nor mimics
// its variable-exponent elimination/construction algorithm.
const SCALE = 10n ** 24n;
function fixedUnits(text: string): bigint {
  const [significand, exponentText = "0"] = text.toLowerCase().split("e");
  const [integer, fraction = ""] = significand!.split(".");
  const shift = 24 + Number(exponentText) - fraction.length;
  if (!/^\d+$/.test(integer!) || !/^\d*$/.test(fraction) || !Number.isInteger(shift) || shift < 0 || shift > 80) {
    throw Error(`Independent fixed-grid fixture is out of bounds: ${text}`);
  }
  return BigInt(integer! + fraction) * 10n ** BigInt(shift);
}
function plainUnits(units: bigint): string {
  if (units < 0n) throw Error("Negative oracle result");
  const digits = units.toString().padStart(25, "0");
  const fraction = digits.slice(-24).replace(/0+$/, "");
  return `${digits.slice(0, -24)}${fraction ? `.${fraction}` : ""}`;
}
function stable(value: BigNumber): boolean {
  const text = value.toString(), reloaded = big(JSON.parse(JSON.stringify(value)) as string);
  return Number.isFinite(value.mantissa) && Number.isFinite(value.exponent) && value.mantissa >= 0
    && reloaded.mantissa === value.mantissa && reloaded.exponent === value.exponent && reloaded.toString() === text;
}
function exactReload(value: BigNumber, expectedUnits: bigint): void {
  expect(stable(value)).toBe(true);
  expect(fixedUnits(value.toString())).toBe(expectedUnits);
  const restored = big(JSON.parse(JSON.stringify(value)) as string);
  expect(image(restored)).toEqual(image(value));
}

// These are deliberately independent literal regressions rather than expected
// values obtained from Decimal.add/sub, which caused the original defect.
describe("independent exact NPC transfer construction", () => {
  it("credits the actual natural-route balance without its old 0.0000000003 overcredit", () => {
    const before = resources("2911027.71225653"), cargo = resources(265);
    expect(before.metal.toString()).toBe("2911027.71225653");
    expect(stable(before.metal)).toBe(true);
    const oldAddition = before.metal.add(cargo.metal);
    expect(oldAddition.toString()).toBe("2911292.7122565303");
    expect(fixedUnits(oldAddition.toString()) - fixedUnits(before.metal.toString()) - 265n * SCALE).toBe(3n * 10n ** 14n);
    const snapshots = [resourceImage(before), resourceImage(cargo)];
    const after = accept(checkedNpcCargoCredit(before, cargo));
    expect(after.metal.toString()).toBe("2911292.71225653");
    exactReload(after.metal, 291129271225653n * 10n ** 16n);
    expect(after.crystal).toBe(before.crystal);
    expect(after.deuterium).toBe(before.deuterium);
    expect([resourceImage(before), resourceImage(cargo)]).toEqual(snapshots);
    const state = createInitialState(42);
    state.planets[0]!.resources = after;
    const raw = serializeState(state);
    expect(serializeState(deserializeState(raw))).toEqual(raw);
    expect(raw.planets[0]!.resources.metal).toBe("2911292.71225653");
  });

  it("subtracts from the actual canonical source and retains an exact fractional result", () => {
    const before = big("2911292.71225653"), fuel = big(265), snapshots = [image(before), image(fuel)];
    const after = accept(checkedNpcFuelDebit(before, fuel, "265"));
    expect(after.toString()).toBe("2911027.71225653");
    exactReload(after, fixedUnits(before.toString()) - 265n * SCALE);
    expect([image(before), image(fuel)]).toEqual(snapshots);
  });

  it("does not use the old tolerance helper as the NPC proof or change that global helper", () => {
    const before = big("2911027.71225653"), incoming = big(265);
    const oldWallet = checkedWalletTransfer(before, incoming, true);
    expect(oldWallet?.toString()).toBe("2911292.7122565303");
    const next = accept(checkedNpcCargoCredit({ ...resources(), metal: before }, { ...resources(), metal: incoming }));
    expect(next.metal.toString()).toBe("2911292.71225653");
  });

  const seeds = [
    "0", "0.1", "0.125", "0.000001", "1e-10", "1e-20", "1", "1.0000000001", "9.9999999999",
    "99.125", "999.999", "10000", "999999.5", "1000000", "1000000.000000001", "2911027.71225653",
    "2911292.71225653", "1073741823999", "1073741824000", "1e20",
  ];
  it.each(seeds)("proves credits and debits from actual persisted source %s on an independent fixed grid", seed => {
    for (const integer of [0, 1, 2, 64, 265, 5000]) {
      const before = big(seed), fuel = big(integer), original = image(before), source = fixedUnits(before.toString());
      for (const credit of [false, true]) {
        const result = credit
          ? checkedNpcCargoCredit({ ...resources(), metal: before }, resources(integer))
          : checkedNpcFuelDebit(before, fuel, BigInt(integer));
        if (integer === 0) {
          expect(result.ok).toBe(true);
          if (result.ok) expect(credit ? (result.value as ResourceAmounts).metal : result.value).toBe(before);
          continue;
        }
        if (big(before.toString()).toString() !== before.toString()) {
          expect(result).toEqual({ ok: false, reason: "precision" });
          continue;
        }
        const intended = source + (credit ? 1n : -1n) * BigInt(integer) * SCALE;
        if (intended < 0n) {
          expect(result).toEqual({ ok: false, reason: "insufficient-funds" });
          continue;
        }
        const directCandidate = big(plainUnits(intended));
        // Whenever the direct exact text has a legal save representation, an
        // intermediate add/sub rounding artifact must not reject the transfer.
        if (stable(directCandidate) && fixedUnits(directCandidate.toString()) === intended) expect(result.ok).toBe(true);
        if (result.ok) exactReload(credit ? (result.value as ResourceAmounts).metal : result.value as BigNumber, intended);
        else expect(result.reason).toBe("precision");
      }
      expect(image(before)).toEqual(original);
      expect(fuel.toString()).toBe(String(integer));
    }
  });

  it("uses stable source canonical value even when reading changes its internal mantissa", () => {
    const before = big(1); before.mantissa = 1.0000000000000002;
    expect(before.toString()).toBe("1");
    expect(stable(before)).toBe(false);
    expect(big(before.toString()).toString()).toBe(before.toString());
    const original = image(before);
    const after = accept(checkedNpcCargoCredit({ ...resources(), metal: before }, resources(1)));
    exactReload(after.metal, 2n * SCALE);
    exactReload(accept(checkedNpcFuelDebit(before, big(1), "1")), 0n);
    expect(image(before)).toEqual(original);
  });

  it("accepts the real production-event source whose canonical value survives its one-bit readback change", () => {
    // Captured from the unmodified natural 18-second checkpoint, followed by
    // tick(state, fleet.remaining = 0.7995572561016484), before first loot dock.
    const before = resources("2910911.83616177", "447710.15680556995", "68825.7241553523");
    before.deuterium.mantissa = 6.88257241553523;
    before.deuterium.exponent = 4;
    const original = resourceImage(before), reloaded = big(before.deuterium.toString());
    expect(before.deuterium.toString()).toBe("68825.7241553523");
    expect(reloaded.mantissa).toBe(6.882572415535231);
    expect(reloaded.toString()).toBe(before.deuterium.toString());
    const after = accept(checkedNpcCargoCredit(before, resources(265, 132, 23)));
    expect(RESOURCE_IDS.map(id => after[id].toString())).toEqual(["2911176.83616177", "447842.15680556995", "68848.7241553523"]);
    for (const id of RESOURCE_IDS) exactReload(after[id], fixedUnits(before[id].toString()) + fixedUnits(resources(265, 132, 23)[id].toString()));
    expect(resourceImage(before)).toEqual(original);
  });

  it("still rejects an old-reader-finite source whose canonical text is unsupported", () => {
    const before = big("1e9000000000000000"), original = image(before);
    expect(Number.isFinite(before.mantissa)).toBe(true);
    expect(Number.isFinite(before.exponent)).toBe(true);
    expect(before.toString()).toBe("Infinity");
    expect(checkedNpcCargoCredit({ ...resources(), metal: before }, resources(1))).toEqual({ ok: false, reason: "precision" });
    expect(image(before)).toEqual(original);
  });

  it("checks target exactness independently of valid source and cargo representations", () => {
    const before = resources("1073741823999"), cargo = resources(1), original = resourceImage(before);
    expect(before.metal.toString()).toBe("1073741823999");
    expect(stable(before.metal)).toBe(true);
    expect(stable(cargo.metal)).toBe(true);
    // Stable approximate output is still not the authorized exact target.
    expect(big("1073741824000").toString()).toBe("1073741824000.0001");
    expect(stable(big("1073741824000"))).toBe(true);
    expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "precision" });
    expect(resourceImage(before)).toEqual(original);
  });

  it("never repairs or accepts a stable but incorrect final fuel quote", () => {
    const wallet = big("2147483648000"), quoted = big("1073741824000"), original = [image(wallet), image(quoted)];
    expect(quoted.toString()).toBe("1073741824000.0001");
    expect(checkedNpcFuelDebit(wallet, quoted, "1073741824000")).toEqual({ ok: false, reason: "precision" });
    expect([image(wallet), image(quoted)]).toEqual(original);
    expect(checkedNpcFuelDebit(big(100), big(0), "1")).toEqual({ ok: false, reason: "precision" });
  });
});

describe("independent bounded work and all-resource atomicity", () => {
  it.each(["1e400", "1e8999999999999999", "1e-400", "1e-8999999999999999"])(
    "rejects a nonzero exponent-gap credit on valid %s without expanding that exponent", text => {
      const before = resources(text), original = resourceImage(before);
      expect(stable(before.metal)).toBe(true);
      expect(checkedNpcCargoCredit(before, resources(1))).toEqual({ ok: false, reason: "precision" });
      expect(resourceImage(before)).toEqual(original);
      expect(accept(checkedNpcCargoCredit(before, resources()))).toBe(before);
    },
  );

  it("still supports exact enormous shared-exponent debits and exact cancellation", () => {
    for (const exponent of [400, 8_999_999_999_999_999]) {
      const before = big(`2e${exponent}`), fuel = big(`1e${exponent}`), original = [image(before), image(fuel)];
      const after = accept(checkedNpcFuelDebit(before, fuel, `1e${exponent}`));
      expect(image(after)).toEqual(image(fuel));
      expect(stable(after)).toBe(true);
      expect(accept(checkedNpcFuelDebit(before, before, `2e${exponent}`)).toString()).toBe("0");
      expect([image(before), image(fuel)]).toEqual(original);
    }
  });

  it.each(RESOURCE_IDS)("rejects every resource when the %s candidate is inexact after other valid candidates", failing => {
    const before = resources("2911027.71225653", "2911027.71225653", "2911027.71225653");
    before[failing] = big("1073741823999");
    const cargo = resources(1, 1, 1), original = [resourceImage(before), resourceImage(cargo)], refs = { ...before };
    expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "precision" });
    expect([resourceImage(before), resourceImage(cargo)]).toEqual(original);
    for (const id of RESOURCE_IDS) expect(before[id]).toBe(refs[id]);
  });

  it("commits three exact candidates only as one returned value and preserves every input", () => {
    const before = resources("2911027.71225653", "1000.5", "25.125"), cargo = accept(checkedNpcLootCargo([265, 12, 5]));
    const original = [resourceImage(before), resourceImage(cargo)];
    const after = accept(checkedNpcCargoCredit(before, cargo));
    for (const id of RESOURCE_IDS) exactReload(after[id], fixedUnits(before[id].toString()) + fixedUnits(cargo[id].toString()));
    expect([after.metal.toString(), after.crystal.toString(), after.deuterium.toString()]).toEqual(["2911292.71225653", "1012.5", "30.125"]);
    expect([resourceImage(before), resourceImage(cargo)]).toEqual(original);
  });

  it("retains all-zero wallet identity and negative zero without silently normalizing it", () => {
    const signedZero = big(0); signedZero.mantissa = -0;
    const displacedZero = big(0); displacedZero.exponent = 123;
    const noncanonical = big(1); noncanonical.mantissa = 1.0000000000000002;
    const before = { metal: signedZero, crystal: displacedZero, deuterium: noncanonical }, original = resourceImage(before);
    expect(accept(checkedNpcCargoCredit(before, resources()))).toBe(before);
    expect(accept(checkedNpcFuelDebit(signedZero, big(-0), "0"))).toBe(signedZero);
    expect(accept(checkedNpcFuelDebit(displacedZero, signedZero, 0n))).toBe(displacedZero);
    expect(accept(checkedNpcFuelDebit(noncanonical, signedZero, "0"))).toBe(noncanonical);
    expect(Object.is(before.metal.mantissa, -0)).toBe(true);
    expect(resourceImage(before)).toEqual(original);
  });

  it.each(RESOURCE_IDS)("rejects a %s container getter before executing it, even during a zero transfer", id => {
    for (const sourceIsHostile of [false, true]) {
      let reads = 0;
      const hostile = Object.defineProperty(resources(), id, { enumerable: true, get() { reads++; throw Error("Getter ran"); } });
      const before = sourceIsHostile ? hostile : resources("2911027.71225653"), cargo = sourceIsHostile ? resources() : hostile;
      expect(checkedNpcCargoCredit(before, cargo)).toEqual({ ok: false, reason: "invalid-amount" });
      expect(reads).toBe(0);
      if (!sourceIsHostile) expect(readNpcLootCargo(hostile)).toEqual({ ok: false, reason: "invalid-amount" });
      expect(reads).toBe(0);
    }
  });
});

describe("ordinary speed-90 route preserves the unchanged quote and strict target boundary", () => {
  it("keeps the strict target rejection while the new tail-backed route pays unchanged fuel exactly", () => {
    const source = createInitialState(20261010, 97531), planet = activePlanet(source);
    expect(planet.coordinates).toEqual({ galaxy: 1, system: 56, position: 11 });
    planet.resources = resources(1e6, 1e6, 1e6);
    planet.buildings.shipyard = 2;
    Object.assign(planet.units, { light_fighter: 20, small_cargo: 2 });
    Object.assign(source.research.levels, { combustion_drive: 2, computer_tech: 10, weapons_tech: 1 });
    source.protocols.slots.forEach(slot => { slot.card = null; });
    const ready = deserializeState(serializeState(source));
    const order: FleetRequest = { mission: "attack", target: { galaxy: 1, system: 56, position: 6 },
      ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 90 };
    // An owned-transport quote isolates the unchanged legacy formula. No action
    // is sent, and this synthetic colony is never added to the attack source.
    const reference = { ...ready, planets: [...ready.planets, createPlanet("formula-reference", order.target)] };
    const quote = quoteFlight(reference, { ...order, mission: "transport" });
    expect(quote.ok, quote.reason).toBe(true);
    expect(quote.fuel.toString()).toBe("64");
    expect(1_000_000n - 64n).toBe(999936n);
    const lower = big("9.99936e5");
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, lower.mantissa);
    bits.setBigUint64(0, bits.getBigUint64(0) + 1n);
    const upper = big(lower); upper.mantissa = bits.getFloat64(0);
    // Adjacent binary64 normalized mantissas straddle the target. There is no
    // hidden representable mantissa to recover by rounding or tolerance.
    expect(lower.toString()).toBe("999935.9999999999");
    expect(upper.toString()).toBe("999936.0000000001");
    expect(fixedUnits(lower.toString())).toBeLessThan(999936n * SCALE);
    expect(fixedUnits(upper.toString())).toBeGreaterThan(999936n * SCALE);
    expect(checkedNpcFuelDebit(activePlanet(ready).resources.deuterium, quote.fuel, "64")).toEqual({ ok: false, reason: "precision" });
    const original = serializeState(ready), draft = resourceImage(order.cargo);
    expect(quoteFlight(ready, order).ok).toBe(true);
    const result = sendFleet(ready, order);
    expect(result.ok).toBe(true);
    const paid = activePlanet(result.state);
    expect(paid.resources.deuterium.toString()).toBe("999935.9999999999");
    expect(paid.npcResourceRemainder.deuterium).toBe("0.0000000001");
    expect(fixedUnits(paid.resources.deuterium.toString()) + fixedUnits(paid.npcResourceRemainder.deuterium)).toBe(999936n * SCALE);
    expect(result.state.nextFleetId).toBe(ready.nextFleetId + 1);
    expect(serializeState(deserializeState(serializeState(result.state)))).toEqual(serializeState(result.state));
    expect(serializeState(ready)).toEqual(original);
    expect(resourceImage(order.cargo)).toEqual(draft);
  });
});
