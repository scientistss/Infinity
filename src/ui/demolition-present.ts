import { BUILDINGS, buildingById } from "../data/buildings";
import { RESEARCH } from "../data/research";
import { CARD_CATALOG } from "../data/protocol-cards";
import { SILO_SLOTS_PER_LEVEL, UNITS } from "../data/units";
import { activePlanet, withPlanet } from "../game/empire";
import type { DemolitionQuote } from "../game/demolition";
import { economy } from "../game/economy";
import { formatDuration } from "../game/format";
import { usedFields } from "../game/planet";
import { siloUsed } from "../game/shipyard";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "../game/types";
import type { OfflineCatchup } from "../core/offline";

const names = { metal: "金属", crystal: "晶体", deuterium: "重氢" };
export function demolitionFee(paid: ResourceAmounts): string {
  return RESOURCE_IDS.map(id => `${names[id]} ${paid[id].toString()}`).join(" / ");
}

/** Preview only: no tick, payment, queue mutation, persisted state or rewards. */
export function demolitionLosses(state: GameState, quote: DemolitionQuote): string[] {
  const planet = activePlanet(state);
  const changed = { ...planet, buildings: { ...planet.buildings, [quote.building]: quote.toLevel } };
  const after = withPlanet(state, { planet: changed });
  const beforeEconomy = economy(state), afterEconomy = economy(after);
  const losses = [
    `完工才降为 ${quote.fromLevel} → ${quote.toLevel} 级；已用格 ${usedFields(planet)} → ${usedFields(changed)}，总格 ${planet.fieldsMax} 不变。施工中原功能保留。`,
    "完工不返还历史建造投入，不产出资源。完工前取消退还本次实际拆除费 100%；已用时间不退。",
    "其他已授权自动建造仍可运行，完工后可能占用释放的格子。",
  ];
  for (const id of RESOURCE_IDS) {
    if (beforeEconomy.caps[id] !== afterEconomy.caps[id]) losses.push(
      `${names[id]}仓容 ${beforeEconomy.caps[id]} → ${afterEconomy.caps[id]}。现有超仓资源保留；达到新仓容时对应自然生产暂停，既有消耗继续。`,
    );
  }
  if (beforeEconomy.supply !== afterEconomy.supply || beforeEconomy.demand !== afterEconomy.demand) losses.push(
    `能源供给 ${beforeEconomy.supply} → ${afterEconomy.supply}；需求 ${beforeEconomy.demand} → ${afterEconomy.demand}。生产按完工后的能源效率重算。`,
  );
  const requirements = [...BUILDINGS, ...RESEARCH, ...UNITS].filter(def => def.requires.some(req => req.kind === "building" && req.id === quote.building && req.level > quote.toLevel && req.level <= quote.fromLevel));
  if (requirements.length) losses.push(`失去未来付款前置：${requirements.map(def => def.nameZh).join("、")}。既有建筑、科研、船舰与防御保留。`);
  if (quote.building === "robotics_factory") {
    const relocked = quote.relockedSlots.map(number => {
      const card = state.protocols.slots[number - 1]?.card;
      const name = card ? CARD_CATALOG.find(def => def.id === card.id)?.labelZh ?? card.id : "空槽";
      return `槽${number}将锁定：${name}${card ? `（${card.enabled ? "已启用" : "已关闭"}）` : ""}`;
    });
    losses.push(`可用协议槽 ${quote.currentSlots} → ${quote.nextSlots}；${relocked.join("；") || "没有槽位回锁"}。锁槽保留配置与启用状态但不执行；可关闭或卸下，解锁后仍启用的卡可能重建。`);
  }
  if (quote.building === "robotics_factory" || quote.building === "nanite_factory") losses.push("建造加速下降；后续工程按届时等级重新计时。");
  if (quote.building === "research_lab") losses.push("施工中禁止新增研究，本站不参与研究网络；完工后实验室能力下降，已有研究等级保留。");
  if (quote.building === "shipyard" || quote.building === "nanite_factory") losses.push("施工中禁止本星新增造船与防御付款；其他星球照常运行。");
  if (quote.building === "missile_silo") losses.push(`导弹槽 ${quote.fromLevel * SILO_SLOTS_PER_LEVEL} → ${quote.toLevel * SILO_SLOTS_PER_LEVEL}；当前及已付排队占用 ${siloUsed(planet)}，不得超过新容量。`);
  return losses;
}

export function demolitionPreview(state: GameState, quote: DemolitionQuote) {
  const planet = state.planets.find(item => item.id === quote.planetId)!;
  return {
    title: `${planet.name} · ${buildingById(quote.building).nameZh} ${quote.fromLevel} → ${quote.toLevel}`,
    fee: `拆除费：${demolitionFee(quote.paid)}`,
    time: `耗时约 ${formatDuration(Math.ceil(quote.totalSeconds))}；离子减费不缩短时间。`,
    totalSeconds: quote.totalSeconds,
    losses: demolitionLosses(state, quote),
  };
}

export function demolitionOfflineRows(catchup: OfflineCatchup | null): string[] {
  return (catchup?.completedDemolitions ?? []).map(done => {
    const planet = catchup!.state.planets.find(value => value.id === done.planetId);
    return `${planet?.name ?? done.planetId ?? "星球"} · ${buildingById(done.building).nameZh} ${done.fromLevel} → ${done.toLevel} · #${done.jobId}：释放 1 格，无资源返还。`;
  });
}
