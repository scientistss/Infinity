import type { BuildingId } from "../data/buildings";
import { activePlanet } from "../game/empire";
import { DEMOLITION_PRECISION_REASON, demolitionContextKey, quoteDemolition, type DemolitionQuote } from "../game/demolition";
import { checkedWalletTransfer } from "../game/order-wallet";
import { RESOURCE_IDS, type GameState } from "../game/types";

/** Ephemeral UI consent. Never serialized, renewed by ticks, or revived by A→B→A. */
export class DemolitionReview {
  private current: DemolitionQuote | null = null;
  private context = "";
  private world = "";
  private writable = false;
  private nonce = 0;
  reason = "";

  get quote(): DemolitionQuote | null { return this.current; }
  get token(): number { return this.nonce; }

  /** Wallet-only preflight is cheap enough for a live review; it never re-quotes. */
  paymentProblem(state: GameState): string {
    if (!this.current || !this.writable) return this.reason || "请重新核对拆除。";
    const planet = activePlanet(state);
    for (const id of RESOURCE_IDS) {
      if (planet.resources[id].lt(this.current.paid[id])) return "拆除资源不足，未扣款";
      if (checkedWalletTransfer(planet.resources[id], this.current.paid[id], false) === null) return DEMOLITION_PRECISION_REASON;
    }
    return "";
  }

  observe(state: GameState, writable: boolean): void {
    const world = `${state.universe.seed}:${state.stats.launches}:${activePlanet(state).id}`;
    if (this.world && this.world !== world) this.invalidate("星球或世界已改变，请重新核对拆除。");
    this.world = world;
    this.writable = writable;
    if (!writable) this.invalidate("存档受保护，不能拆除或取消工作。");
    if (this.current && demolitionContextKey(state, this.current.building) !== this.context) {
      this.invalidate("报价、施工或协议条件已改变，请重新核对拆除。");
    }
  }

  open(state: GameState, building: BuildingId, writable: boolean): DemolitionQuote | null {
    this.invalidate();
    this.observe(state, writable);
    if (!writable) return null;
    const result = quoteDemolition(state, building);
    this.reason = result.reason;
    if (!result.quote) return null;
    this.current = result.quote;
    this.context = demolitionContextKey(state, building);
    return this.current;
  }

  invalidate(reason = ""): void {
    this.current = null;
    this.context = "";
    this.nonce++;
    this.reason = reason;
  }

  /** Fresh quote on the explicit confirm click, then consume this one-shot intent. */
  consume(state: GameState, token: number): DemolitionQuote | null {
    this.observe(state, this.writable);
    if (!this.writable || token !== this.nonce || !this.current) return null;
    const old = this.current;
    const fresh = quoteDemolition(state, old.building);
    if (!fresh.ok || !fresh.quote || fresh.quote.fingerprint !== old.fingerprint) {
      this.invalidate(fresh.reason || "拆除条件已改变，请重新核对。");
      return null;
    }
    this.invalidate();
    return fresh.quote;
  }
}
