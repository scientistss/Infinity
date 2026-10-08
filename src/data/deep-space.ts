import type { ArcadeSymbol } from "./arcade";
/** Provisional tuning where ARCHITECTURE does not specify a value; see docs/DEEP_SPACE.md. */
export const DEEP = {
  segmentSeconds: 60, maxHoldSlots: 3, beginnerProtection: 20, blackholeCooldown: 30,
  fleetShareProtection: 0.5, reportLimit: 60, offerLimit: 100, debrisLimit: 8000,
  merchantSeconds: 600, merchantCallDm: 3500, merchantFee: 0.03,
  merchantBudget: 200000, debrisFraction: 0.30, combatRounds: 6,
  maxStoredRuns: 40, maxReceiptLines: 30,
} as const;
export const CHARGE_CHANCE: Record<ArcadeSymbol, number> = {
  metal:18, crystal:13, deuterium:9, drifter:8, dark_matter:7, supply:4, empty:20,
  turbulence:5, tailwind:5, pirate:4, alien:2, merchant:2, blackhole:1, lucky:1, jackpot:1,
};
export function chargeChances(slots: number): Record<ArcadeSymbol, number> {
  if (!Number.isInteger(slots) || slots<1 || slots>3) throw Error("驻留必须为 1–3 段");
  const extra=slots-1;
  return {...CHARGE_CHANCE, empty:CHARGE_CHANCE.empty-extra*4,
    metal:CHARGE_CHANCE.metal+extra*2, crystal:CHARGE_CHANCE.crystal+extra, deuterium:CHARGE_CHANCE.deuterium+extra};
}
