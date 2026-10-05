import { CURVATURE_EFFECTS, CURVATURE_TECH, curvatureById } from "../data/curvature-tech";
import { big, type BigNumber } from "../game/decimal";
import { CORE_BONUS_PER_CORE } from "../game/content";
import { CURVATURE_IDS, type CurvatureId, type GameState } from "../game/types";

export function emptyCurvature(): Record<CurvatureId, number> {
  const ranks = {} as Record<CurvatureId, number>;
  for (const id of CURVATURE_IDS) ranks[id] = 0;
  return ranks;
}

export function techRank(state: GameState, id: CurvatureId): number {
  return state.curvature[id] ?? 0;
}

export function spentCores(state: GameState): BigNumber {
  let spent = 0;
  for (const node of CURVATURE_TECH) spent += node.cost * techRank(state, node.id);
  return big(spent);
}

/** Cores that still grant +2% each. Bought ranks are spent and drop out. */
export function unspentCores(state: GameState): BigNumber {
  const left = state.warpCores.sub(spentCores(state));
  return left.gt(0) ? left : big(0);
}

export function passiveCoreBonus(state: GameState): BigNumber {
  return unspentCores(state).mul(CORE_BONUS_PER_CORE);
}

export function producerOutputScale(state: GameState): number {
  return techRank(state, "output_double") > 0 ? CURVATURE_EFFECTS.outputMultiplier : 1;
}

export function growthRatio(state: GameState, baseRatio: number): number {
  const cut = techRank(state, "growth_cut") > 0 ? CURVATURE_EFFECTS.growthReduction : 0;
  return Math.max(CURVATURE_EFFECTS.minGrowth, baseRatio - cut);
}

export function protocolSlotBonus(state: GameState): number {
  return techRank(state, "slot_plus") > 0 ? CURVATURE_EFFECTS.slotBonus : 0;
}

export function manualClickAmount(state: GameState): number {
  return techRank(state, "manual_ten") > 0 ? CURVATURE_EFFECTS.manualAmount : 1;
}

export function protocolsRelaxed(state: GameState): boolean {
  return techRank(state, "early_protocols") > 0;
}

/** Card 6's warp-core unlock drops from its catalog count to 3 after early protocols. */
export function relaxedWarpCoreCount(state: GameState, baseCount: number): number {
  return protocolsRelaxed(state) ? Math.min(baseCount, 3) : baseCount;
}

export function scoreMultiplier(state: GameState): BigNumber {
  return techRank(state, "score_boost") > 0 ? big(CURVATURE_EFFECTS.scoreMultiplier) : big(1);
}

/** Grant seed stock into the bank, not into this-run score. */
export function applySeedStock(state: GameState): GameState {
  if (techRank(state, "seed_stock") <= 0) return state;
  const seed = CURVATURE_EFFECTS.seed;
  return {
    ...state,
    resources: {
      metal: state.resources.metal.add(seed.metal),
      crystal: state.resources.crystal.add(seed.crystal),
      deuterium: state.resources.deuterium.add(seed.deuterium),
    },
  };
}

export function offlineHoursFromTech(state: GameState): number {
  return techRank(state, "offline_extend") * CURVATURE_EFFECTS.offlineHoursPerRank;
}

export function buyCurvature(state: GameState, id: CurvatureId): GameState {
  const node = curvatureById(id);
  const rank = techRank(state, id);
  if (rank >= node.maxRank) return state;
  if (unspentCores(state).lt(node.cost)) return state;
  const curvature = { ...state.curvature, [id]: rank + 1 };
  const next = { ...state, curvature };
  return {
    ...next,
    offlineBonusHours: Math.max(state.offlineBonusHours, offlineHoursFromTech(next)),
  };
}
