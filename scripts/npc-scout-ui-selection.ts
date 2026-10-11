/** Frozen NPC acceptance input, not a save normalization.
 * space-panel renders every flyable SHIP_IDS entry and reads every input,
 * including its explicit zero. Keep this literal independent of production
 * enumeration; the focused regression checks that both schemas still agree.
 */
export const NPC_SCOUT_UI_SELECTION = Object.freeze({
  small_cargo: 0,
  large_cargo: 0,
  light_fighter: 0,
  heavy_fighter: 0,
  cruiser: 0,
  battleship: 0,
  battlecruiser: 0,
  bomber: 0,
  destroyer: 0,
  deathstar: 0,
  recycler: 0,
  espionage_probe: 1,
  colony_ship: 0,
});
