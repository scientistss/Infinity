import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { checkedCargoCredit, checkedShipLanding, checkedWalletTransfer, ORDER_MAX_LANDED_UNITS, walletAmountsNear } from "../src/game/order-wallet";
import { emptyCargo, type Fleet } from "../src/game/fleet";
import { createInitialState } from "../src/game/state";

const money = (metal: number | string, crystal: number | string = 0, deuterium: number | string = 0) => ({ metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) });
describe("checked plan wallet movements", () => {
  it("uses the existing 1e-9 relative movement boundary", () => {
    expect(walletAmountsNear(big(100.00000005), big(100))).toBe(true);
    expect(walletAmountsNear(big(100.0000002), big(100))).toBe(false);
    expect(checkedWalletTransfer(big(100), big(25), false)?.eq(75)).toBe(true);
    expect(checkedWalletTransfer(big(100), big(25), true)?.eq(125)).toBe(true);
    expect(checkedWalletTransfer(big(25), big(100), false)).toBeNull();
  });
  it("rejects swallowed positive debits and credits and keeps exact zero a no-op", () => {
    const huge = big("1e100");
    expect(checkedWalletTransfer(huge, big(1), false)).toBeNull();
    expect(checkedWalletTransfer(huge, big(1), true)).toBeNull();
    expect(checkedWalletTransfer(huge, big(0), true)).toBe(huge);
    expect(checkedWalletTransfer(big(-1), big(0), true)).toBeNull();
  });
  it("does not let a large deuterium cargo conceal a swallowed separate fuel debit", () => {
    const afterCargo = checkedWalletTransfer(big("1e100"), big("5e99"), false);
    expect(afterCargo).not.toBeNull();
    expect(checkedWalletTransfer(afterCargo!, big(2), false)).toBeNull();
  });
  it("preflights every cargo resource before publishing any credit", () => {
    const before = money(100, "1e100", 100), cargo = money(20, 1, 30);
    expect(checkedCargoCredit(before, cargo)).toBeNull();
    expect(before.metal.eq(100)).toBe(true);
    expect(before.deuterium.eq(100)).toBe(true);
    const success = checkedCargoCredit(money(100, 100, 100), cargo)!;
    expect(success.metal.eq(120)).toBe(true);
    expect(success.crystal.eq(101)).toBe(true);
    expect(success.deuterium.eq(130)).toBe(true);
  });
});
describe("checked owned ship landing", () => {
  function dock() {
    const state = createInitialState(42), planet = state.planets[0]!;
    const fleet: Fleet = { id: 1, orderTransport: null, originId: planet.id, target: { galaxy: 1, system: 2, position: 8 }, mission: "transport", ships: { small_cargo: 1 }, cargo: emptyCargo(), duration: 1, remaining: 0, returning: true, elapsed: 1 };
    state.fleets = [fleet]; state.nextFleetId = 2;
    return { state, planet, fleet };
  }
  it("enforces the persisted planet cap, not just Number.isSafeInteger", () => {
    const { state, planet, fleet } = dock();
    planet.units.small_cargo = ORDER_MAX_LANDED_UNITS;
    expect(Number.isSafeInteger(planet.units.small_cargo + 1)).toBe(true);
    expect(checkedShipLanding(state, planet.id, fleet)).toBeNull();
    planet.units.small_cargo--;
    expect(checkedShipLanding(state, planet.id, fleet)?.small_cargo).toBe(ORDER_MAX_LANDED_UNITS);
    expect(planet.units.small_cargo).toBe(ORDER_MAX_LANDED_UNITS - 1);
  });
  it("requires the real fleet exactly once", () => {
    const { state, planet, fleet } = dock();
    expect(checkedShipLanding({ ...state, fleets: [] }, planet.id, fleet)).toBeNull();
    expect(checkedShipLanding({ ...state, fleets: [fleet, fleet] }, planet.id, fleet)).toBeNull();
    expect(checkedShipLanding(state, planet.id, fleet)?.small_cargo).toBe(1);
  });
});
