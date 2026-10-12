import { SHIP_IDS, unitById } from "../data/units";
import { big, type BigNumber } from "./decimal";
import type { DebrisField, ShipCounts } from "./deep-state";
import { RESOURCE_IDS, type ResourceAmounts } from "./types";

export interface RecycleAmountsInput {
  ships: ShipCounts;
  cargo: ResourceAmounts;
  hyperspace: number;
  debris: Pick<DebrisField, "metal" | "crystal">;
}

export interface RecycleAmounts {
  capacity: BigNumber;
  collector: BigNumber;
  used: BigNumber;
  room: BigNumber;
  metal: BigNumber;
  crystal: BigNumber;
  leftMetal: BigNumber;
  leftCrystal: BigNumber;
}

/** Shared salvage arithmetic; preserve settlement's operation order and crystal residual. */
export function calculateRecycleAmounts(input: RecycleAmountsInput): RecycleAmounts {
  const factor = 1 + .05 * input.hyperspace;
  const capacity = SHIP_IDS.reduce((s, id) => s.add(big(unitById(id).cargo).mul(input.ships[id] ?? 0).mul(factor)), big(0));
  const collector = big(unitById("recycler").cargo).mul(input.ships.recycler ?? 0).mul(factor);
  const used = RESOURCE_IDS.reduce((sum, id) => sum.add(input.cargo[id]), big(0));
  const room = capacity.sub(used).max(0).min(collector), m = big(input.debris.metal), c = big(input.debris.crystal), total = m.add(c);
  const take = room.min(total), metal = total.gt(0) ? take.mul(m).div(total).floor() : big(0), crystal = take.sub(metal).min(c).floor();
  const leftMetal = m.sub(metal), leftCrystal = c.sub(crystal);
  // Decimal.add(0, value) may return value itself; do not expose cargo by alias.
  return { capacity, collector, used: big(used), room, metal, crystal, leftMetal, leftCrystal };
}
