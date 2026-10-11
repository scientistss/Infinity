import type { NpcWalletState } from "../src/game/npc-wallet";

/** Independent literal no-attack fixture: local adopted time has not reached H. */
export function expectedFreshNpcWallet(now = 0): NpcWalletState {
  if (!Number.isFinite(now) || now < 0 || now >= 12000) throw Error("Expected local NPC time in [0,12000)");
  return { model: "npc-wallet-garrison-v1", now, baseline: { stock: [500, 250, 0], mark: 0 }, sites: {} };
}

/** Independent literal state after a fixed H boundary has saturated initial stores. */
export function expectedFullNpcWallet(now = 0): NpcWalletState {
  if (!Number.isFinite(now) || now < 0 || now >= 12000) throw Error("Expected local NPC time in [0,12000)");
  return { model: "npc-wallet-garrison-v1", now, baseline: { stock: [50000, 30000, 10000], mark: 0 }, sites: {} };
}

export const expectedEmptyNpcBattles = () => ({ model: "npc-battle-receipts-v1" as const, reports: [] });
