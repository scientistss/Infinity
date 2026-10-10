import { SHIP_IDS, UNIT_IDS, type UnitId } from "../data/units";
import { isValidAmount, type BigNumber } from "./decimal";
import type { Fleet } from "./fleet";
import type { GameState, ResourceAmounts } from "./types";
import { RESOURCE_IDS } from "./types";

/** Same limit as the save boundary and shipyard output guard. */
export const ORDER_MAX_LANDED_UNITS = 1e15;
export function walletAmountsNear(actual: BigNumber, expected: BigNumber): boolean {
  return isValidAmount(actual) && isValidAmount(expected) && (expected.eq(0) ? actual.eq(0) : actual.sub(expected).abs().div(expected).lte(1e-9));
}
/** A positive authorized movement must survive the actual wallet representation. */
export function checkedWalletTransfer(before: BigNumber, amount: BigNumber, refund: boolean): BigNumber | null {
  if (!isValidAmount(before) || !isValidAmount(amount)) return null;
  if (amount.eq(0)) return before;
  if (!refund && before.lt(amount)) return null;
  const after = refund ? before.add(amount) : before.sub(amount);
  if (!isValidAmount(after) || (refund ? !after.gt(before) : !after.lt(before))) return null;
  const movement = refund ? after.sub(before) : before.sub(after);
  return walletAmountsNear(movement, amount) ? after : null;
}
/** Preflight all resources, never return a partial credit. */
export function checkedCargoCredit(before: ResourceAmounts, cargo: ResourceAmounts): ResourceAmounts | null {
  const after = { ...before };
  for (const id of RESOURCE_IDS) {
    const result = checkedWalletTransfer(before[id], cargo[id], true);
    if (result === null) return null;
    after[id] = result;
  }
  return after;
}
/** The landing replaces a real fleet with local units; it never manufactures an extra fleet. */
export function checkedShipLanding(state: GameState, planetId: string, fleet: Fleet): Record<UnitId, number> | null {
  const planet = state.planets.find(value => value.id === planetId);
  if (!planet || state.fleets.filter(value => value.id === fleet.id).length !== 1 || state.fleets.find(value => value.id === fleet.id) !== fleet) return null;
  const units = { ...planet.units };
  for (const id of UNIT_IDS) {
    if (!Number.isSafeInteger(units[id]) || units[id] < 0 || units[id] > ORDER_MAX_LANDED_UNITS) return null;
  }
  for (const id of SHIP_IDS) {
    const inbound = fleet.ships[id] ?? 0;
    if (!Number.isSafeInteger(inbound) || inbound < 0) return null;
    const count = units[id] + inbound;
    if (!Number.isSafeInteger(count) || count > ORDER_MAX_LANDED_UNITS) return null;
    units[id] = count;
    let empire = 0;
    for (const world of state.planets) {
      const current = world.id === planetId ? count : world.units[id];
      if (!Number.isSafeInteger(current) || current < 0) return null;
      empire += current;
      if (!Number.isSafeInteger(empire)) return null;
    }
    for (const other of state.fleets) {
      if (other.id === fleet.id) continue;
      const current = other.ships[id] ?? 0;
      if (!Number.isSafeInteger(current) || current < 0) return null;
      empire += current;
      if (!Number.isSafeInteger(empire)) return null;
    }
  }
  return units;
}
