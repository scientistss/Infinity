import type { UnitDef } from "../data/units";
import { big } from "./decimal";
import type { ResourceCost } from "./formulas";

/** Catalog unit price, independent of queues and the payment ledger. */
export function unitCost(def: UnitDef, count = 1): ResourceCost {
  return { metal: big(def.cost.metal).mul(count), crystal: big(def.cost.crystal).mul(count), deuterium: big(def.cost.deuterium).mul(count) };
}
