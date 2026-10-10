import { unitById } from "../data/units";
import { formationAuthorityKey } from "../game/formations";
import type { FleetFormation } from "../game/formation-state";
import type { OrderMoney } from "../game/order-state";
import type { GameState } from "../game/types";

export const FORMATION_RESOURCES = [["metal", "金属"], ["crystal", "晶体"], ["deuterium", "重氢"]] as const;
export const formationMoney = (money: OrderMoney) => FORMATION_RESOURCES.map(([id, label]) => `${label} ${money[id]}`).join(" / ");
export const formationShips = (formation: FleetFormation) => Object.entries(formation.ships).map(([id, count]) => `${unitById(id as keyof FleetFormation["ships"]).nameZh} × ${count}`).join(" · ");
export const formationPlanet = (state: GameState, id: string) => state.planets.find(planet => planet.id === id)?.name ?? `${id}（已不存在）`;
/** Bounded, shared economic dependencies. No repricing or nonce renewal in animation updates. */
export const formationAuthoritySignature = formationAuthorityKey;
