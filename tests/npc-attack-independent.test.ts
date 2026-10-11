import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, sendFleet } from "../src/game/fleet";
import { NpcSettlementError, resolveNpcAttackArrivals } from "../src/game/npc-attack";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";

const TARGET = { galaxy: 1, system: 56, position: 6 };
function launched() {
  const state = createInitialState(20261010, 97531), planet = activePlanet(state);
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  planet.buildings.shipyard = 2;
  Object.assign(planet.units, { light_fighter: 1000, small_cargo: 1000 });
  Object.assign(state.research.levels, { combustion_drive: 2, computer_tech: 10, weapons_tech: 1 });
  // Fixture-only setup: the established reader refreshes eligible protocol cards.
  // Normalize before the tested real payment; never normalize its resulting state.
  const ready = deserializeState(serializeState(state));
  const result = sendFleet(ready, { mission: "attack", target: TARGET,
    ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 });
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

describe("independent NPC attack boundary audit", () => {
  it("accepts the unmodified paid launch used by hostile-shape regressions", () => {
    const state = launched(), before = JSON.stringify(serializeState(state));
    const raw = serializeState(state), rawBefore = JSON.stringify(raw);
    const read = deserializeState(raw);
    expect(serializeState(read)).toEqual(raw);
    expect(JSON.stringify(raw)).toBe(rawBefore);
    expect(JSON.stringify(serializeState(state))).toBe(before);
  });

  it.each(["symbol", "non-enumerable", "prototype"])("rejects %s attack ships before normalization can erase it", kind => {
    const state = launched(), sourceBefore = JSON.stringify(serializeState(state));
    const raw = structuredClone(serializeState(state));
    const ships = raw.fleets[0]!.ships;
    if (kind === "symbol") Object.defineProperty(ships, Symbol("hidden-authority"), { value: 1, enumerable: true });
    if (kind === "non-enumerable") Object.defineProperty(ships, "hidden-authority", { value: 1, enumerable: false });
    if (kind === "prototype") Object.setPrototypeOf(ships, { hiddenAuthority: 1 });
    const rawBefore = JSON.stringify(raw), keysBefore = Reflect.ownKeys(ships);
    const descriptorsBefore = Object.getOwnPropertyDescriptors(ships), prototypeBefore = Object.getPrototypeOf(ships);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => deserializeState(raw)).toThrow();
      expect(JSON.stringify(raw)).toBe(rawBefore);
      expect(Reflect.ownKeys(ships)).toEqual(keysBefore);
      expect(Object.getOwnPropertyDescriptors(ships)).toEqual(descriptorsBefore);
      expect(Object.getPrototypeOf(ships)).toBe(prototypeBefore);
      expect(JSON.stringify(serializeState(state))).toBe(sourceBefore);
    }
  });

  it("does not leak the first successful settlement when a later exact-tie candidate fails", () => {
    const first = launched();
    // Pay for a second real task before corrupting only its due-arrival cargo.
    const result = sendFleet(first, { mission: "attack", target: TARGET,
      ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 });
    expect(result.ok, result.reason).toBe(true);
    const state = { ...result.state, fleets: result.state.fleets.map(fleet => ({ ...fleet,
      remaining: 0, elapsed: fleet.duration,
      cargo: fleet.id === 2 ? { ...fleet.cargo, metal: big(1) } : fleet.cargo })) };
    const before = JSON.stringify(state);
    expect(() => resolveNpcAttackArrivals(state)).toThrow(NpcSettlementError);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.npcBattles.reports).toEqual([]);
    expect(state.fleets.map(fleet => fleet.returning)).toEqual([false, false]);
  });
});
