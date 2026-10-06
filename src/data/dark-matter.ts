/**
 * Dark matter uses in P2 (design doc §8.8): halve / finish build and research, the item shop
 * (KRAKEN, NEWTRON, resource boosters) and resource packages. Prices come from balance.json → darkMatterPrices.
 * Officers, calling the merchant and planet relocation arrive in P4; changing class in P7.
 */
import balance from "./balance.json";

export const DM_PRICES = balance.darkMatterPrices;
export const DM_ACHIEVEMENT_REWARD = balance.darkMatter.achievementReward;

export type ShopItemId =
  | "kraken_bronze"
  | "kraken_silver"
  | "kraken_gold"
  | "newtron_bronze"
  | "newtron_silver"
  | "newtron_gold"
  | "booster_bronze"
  | "booster_silver"
  | "booster_gold";

export type ShopItemKind = "kraken" | "newtron" | "booster";

export interface ShopItemDef {
  id: ShopItemId;
  kind: ShopItemKind;
  nameZh: string;
  dm: number;
  /** KRAKEN / NEWTRON: OGame hours taken off the running build / research. */
  ogameHours?: number;
  /** Booster: production bonus in percent and OGame duration in days. */
  pct?: number;
  ogameDays?: number;
}

const items = DM_PRICES.items;

export const SHOP_ITEMS: readonly ShopItemDef[] = [
  { id: "kraken_bronze", kind: "kraken", nameZh: "克拉肯·铜", ...items.kraken_bronze },
  { id: "kraken_silver", kind: "kraken", nameZh: "克拉肯·银", ...items.kraken_silver },
  { id: "kraken_gold", kind: "kraken", nameZh: "克拉肯·金", ...items.kraken_gold },
  { id: "newtron_bronze", kind: "newtron", nameZh: "纽特隆·铜", ...items.newtron_bronze },
  { id: "newtron_silver", kind: "newtron", nameZh: "纽特隆·银", ...items.newtron_silver },
  { id: "newtron_gold", kind: "newtron", nameZh: "纽特隆·金", ...items.newtron_gold },
  { id: "booster_bronze", kind: "booster", nameZh: "资源加成·铜", ...items.booster_bronze },
  { id: "booster_silver", kind: "booster", nameZh: "资源加成·银", ...items.booster_silver },
  { id: "booster_gold", kind: "booster", nameZh: "资源加成·金", ...items.booster_gold },
];

export function shopItemById(id: ShopItemId): ShopItemDef {
  const def = SHOP_ITEMS.find((item) => item.id === id);
  if (!def) throw new Error(`Missing shop item ${id}`);
  return def;
}

export function isShopItemId(value: string): value is ShopItemId {
  return SHOP_ITEMS.some((item) => item.id === value);
}

/**
 * Items kept in the inventory (found in the ring machine's supply box, design doc §8.6.2).
 * 底特律 (shipyard) is a P3 item and is not dropped yet.
 */
export const INVENTORY_IDS = ["kraken_box", "newtron_box", "booster_box", "supply_pack"] as const;
export type InventoryItemId = (typeof INVENTORY_IDS)[number];

export const INVENTORY_LABEL: Record<InventoryItemId, { name: string; detail: string }> = {
  kraken_box: { name: "克拉肯", detail: "正在建造的建筑剩余时间 −30%" },
  newtron_box: { name: "纽特隆", detail: "正在进行的研究剩余时间 −30%" },
  booster_box: { name: "资源 +10%", detail: "三种矿产量 +10%，持续 1 小时游戏时间" },
  supply_pack: { name: "资源补给包", detail: "立即获得帝国 1 小时游戏时间的三种资源产量（受仓库上限限制）" },
};

export function isInventoryId(value: string): value is InventoryItemId {
  return (INVENTORY_IDS as readonly string[]).includes(value);
}

export const RESOURCE_PACKAGE = DM_PRICES.resourcePackage;
export const PACKAGE_FRACTIONS = [0.1, 0.25, 0.5, 1] as const;
