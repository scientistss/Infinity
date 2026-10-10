/** Read-only projection of the exact candidate used by the real launch rules. */
import { unlockedSlotCount } from "../automation/engine";
import { buildingById } from "../data/buildings";
import { INVENTORY_LABEL, type InventoryItemId } from "../data/dark-matter";
import { researchById } from "../data/research";
import { unitById } from "../data/units";
import { big, type BigNumber } from "../game/decimal";
import { expansionScore, type PrestigeEvaluation } from "../game/logic";
import { HOMEWORLD_ID } from "../game/planet";
import { RESOURCE_IDS, type GameState, type ResourceAmounts, type ResourceId } from "../game/types";
import { passiveCoreBonus, unspentCores } from "../prestige/tree";

export const PRESTIGE_PREVIEW_ROW_LIMIT = 20;
export type PreviewResources = Record<ResourceId, string>;
export interface PreviewChange { before: string; after: string; change: string }
export interface PrestigePreviewRow { kind: "planet" | "paid" | "fleet" | "order" | "trip" | "formation" | "template"; text: string }
export interface PrestigePreview {
  eligible: boolean;
  score: string;
  gain: string;
  cores: PreviewChange;
  unspent: PreviewChange;
  passivePercent: PreviewChange;
  newHome: PreviewResources;
  worlds: { count: number; colonies: number; resources: PreviewResources; buildingLevels: string; units: string };
  paid: { buildings: number; research: number; shipyard: number; remainingUnits: string; buildingPaid: PreviewResources; researchPaid: PreviewResources; remainingUnitPaid: PreviewResources };
  fleets: { count: number; ships: string; cargo: PreviewResources; unsettledStake: string; darkMatter: string; items: Record<string, string> };
  orders: { stopped: number; releasedWork: number; releasedPending: number; formationOrigins: number; retiredTrips: number; deliveredRetiredTrips: number; undeliveredRetiredTrips: number; unresolvedRetiredTrips: number; returnedTrips: number };
  retained: { formations: number; templates: number; referencedFormations: number; researchLevels: number; items: number; boosters: number; tickets: number; reports: number; messages: number; totalTime: string };
  protocols: { slotsBefore: number; slotsAfter: number; enabledAfter: number; ringCardsStopped: number; armedBatchStopped: boolean };
  rewards: { darkMatter: PreviewChange; achievements: number; cards: number; tickets: number };
  removed: { offers: number; debris: number };
  rows: PrestigePreviewRow[];
  totalRows: number;
  omittedRows: number;
}

const zero = (): ResourceAmounts => ({ metal: big(0), crystal: big(0), deuterium: big(0) });
function add(target: ResourceAmounts, source: ResourceAmounts, count = 1): void {
  for (const id of RESOURCE_IDS) target[id] = target[id].add(source[id].mul(count));
}
function resourceStrings(value: ResourceAmounts): PreviewResources {
  return { metal: value.metal.toString(), crystal: value.crystal.toString(), deuterium: value.deuterium.toString() };
}
function change(before: BigNumber, after: BigNumber): PreviewChange {
  return { before: before.toString(), after: after.toString(), change: after.sub(before).toString() };
}
function sumCounts(value: Record<string, number | undefined>): BigNumber {
  return Object.values(value).reduce<BigNumber>((sum, amount) => sum.add(amount ?? 0), big(0));
}
export function previewResources(value: PreviewResources): string {
  return `金属 ${value.metal} / 晶体 ${value.crystal} / 重氢 ${value.deuterium}`;
}
function inventoryName(id: string): string { return INVENTORY_LABEL[id as InventoryItemId]?.name ?? id; }
export function previewItems(items: Record<string, string>): string {
  const values = Object.entries(items).filter(([, amount]) => big(amount).gt(0));
  return values.length ? values.map(([id, amount]) => `${inventoryName(id)} ${amount}`).join(" / ") : "无";
}
export function previewChange(value: PreviewChange): string {
  return `${value.before} → ${value.after}（实际变化 ${big(value.change).gt(0) ? "+" : ""}${value.change}）`;
}

/** No reset, repricing, ticking, random draw, persistence or input writes occur here. */
export function prestigePreview(before: GameState, evaluation: PrestigeEvaluation): PrestigePreview {
  const next = evaluation.next;
  const eligible = next !== before;
  const rows: PrestigePreviewRow[] = [];
  let totalRows = 0;
  // Count every row, but never format or retain more than the visible bound.
  const row = (kind: PrestigePreviewRow["kind"], text: () => string) => {
    totalRows++;
    if (rows.length < PRESTIGE_PREVIEW_ROW_LIMIT) rows.push({ kind, text: text() });
  };
  const worldResources = zero(), buildingPaid = zero(), researchPaid = zero(), remainingUnitPaid = zero(), fleetCargo = zero();
  let buildingLevels = big(0), units = big(0), remainingUnits = big(0), ships = big(0), unsettledStake = big(0), undockedDm = big(0);
  let buildings = 0, research = 0, shipyard = 0;
  const fleetItems: Record<string, BigNumber> = {};
  const nextFleets = new Set(next.fleets.map(fleet => fleet.id));
  const nextTasks = new Map(next.orders.tasks.map(task => [task.id, task]));
  const orders = { stopped: 0, releasedWork: 0, releasedPending: 0, formationOrigins: 0, retiredTrips: 0, deliveredRetiredTrips: 0, undeliveredRetiredTrips: 0, unresolvedRetiredTrips: 0, returnedTrips: 0 };
  // Below the threshold there is no launch, so do not label existing assets as losses.
  if (eligible) {
    for (const planet of before.planets) {
      add(worldResources, planet.resources);
      buildingLevels = buildingLevels.add(sumCounts(planet.buildings));
      units = units.add(sumCounts(planet.units));
      row("planet", () => `${planet.name} [${planet.id}]：${previewResources(resourceStrings(planet.resources))}；建筑 ${sumCounts(planet.buildings)} 级，驻留舰船/卫星/防御 ${sumCounts(planet.units)}。旧库存与本地设置重置。`);
      buildings += planet.buildQueue.length;
      shipyard += planet.shipyardQueue.length;
      for (const job of planet.buildQueue) {
        add(buildingPaid, job.paid);
        row("paid", () => `${planet.name} · 建造 #${job.jobId} ${buildingById(job.building).nameZh} → ${job.targetLevel}：已付 ${previewResources(resourceStrings(job.paid))}，取消不退款。`);
      }
      for (const job of planet.shipyardQueue) {
        remainingUnits = remainingUnits.add(job.count);
        add(remainingUnitPaid, job.paidPerUnit, job.count);
        row("paid", () => `${planet.name} · 造船 #${job.jobId} ${unitById(job.unit).nameZh}：剩余 ${job.count} / 原订 ${job.orderedCount}，当前进度 ${job.progress}；剩余已付成本 ${previewResources(resourceStrings({ metal: job.paidPerUnit.metal.mul(job.count), crystal: job.paidPerUnit.crystal.mul(job.count), deuterium: job.paidPerUnit.deuterium.mul(job.count) }))}，取消不退款。已完成单位只计入驻留/舰队。`);
      }
    }
    research = before.research.queue.length;
    for (const job of before.research.queue) {
      add(researchPaid, job.paid);
      row("paid", () => `研究 #${job.jobId} ${researchById(job.tech).nameZh} → ${job.targetLevel}；付款星球 ${job.planetId}；已付 ${previewResources(resourceStrings(job.paid))}，取消不退款。`);
    }
    for (const fleet of before.fleets) {
      if (nextFleets.has(fleet.id)) continue;
      ships = ships.add(sumCounts(fleet.ships));
      add(fleetCargo, fleet.cargo);
      const charge = fleet.charge;
      // A settled stake was already spent. Only still-unsettled escrow is a current asset.
      if (charge && charge.reportId === null) unsettledStake = unsettledStake.add(charge.stake);
      if (charge) {
        undockedDm = undockedDm.add(charge.dm);
        for (const [id, count] of Object.entries(charge.items)) fleetItems[id] = (fleetItems[id] ?? big(0)).add(count ?? 0);
      }
      row("fleet", () => `舰队 #${fleet.id}（${charge?.phase === "holding" ? "驻留" : fleet.returning ? "返航/待入港" : "出航"}）：${sumCounts(fleet.ships)} 艘；当前货物 ${previewResources(resourceStrings(fleet.cargo))}${charge ? `；未入港暗物质 ${charge.dm}，物品 ${previewItems(Object.fromEntries(Object.entries(charge.items).map(([id, count]) => [id, String(count ?? 0)])))}；${charge.reportId === null ? `未结算押注 ${charge.stake}` : "押注已结算，不重复计损"}` : ""}。舰队消失，不入库；燃料不退。`);
    }
    for (const task of before.orders.tasks) {
      const after = nextTasks.get(task.id);
      if ((task.status === "running" || task.status === "paused") && after?.status === "cancelled") orders.stopped++;
      if (task.currentWork && !after?.currentWork) {
        orders.releasedWork++;
        if (task.currentWork.stage === "pending") orders.releasedPending++;
      }
      row("order", () => `计划 #${task.id}：${task.status} → ${after?.status ?? "移除"}${after?.formationOrigin ? `；历史编成 #${after.formationOrigin.formation.id} ${after.formationOrigin.formation.name} · 修订 ${after.formationOrigin.formation.revision}；原报价 ${previewResources(after.formationOrigin.quotedUnitCost)} 保留` : ""}。预算与 charged/refunded 是历史账本，不是现有库存；未付款预留解除不产生资源。`);
      if (task.transport) {
        const afterTrips = new Map(after?.transport?.trips.map(trip => [trip.fleetId, trip]) ?? []);
        for (const trip of task.transport.trips) {
          const afterTrip = afterTrips.get(trip.fleetId);
          if ((trip.phase.kind === "outbound" || trip.phase.kind === "returning") && afterTrip?.phase.kind === "prestige-retired") {
            orders.retiredTrips++;
            const outcome = afterTrip.phase.outcome;
            if (!outcome) orders.unresolvedRetiredTrips++;
            else if (outcome.kind === "delivered") orders.deliveredRetiredTrips++;
            else orders.undeliveredRetiredTrips++;
          }
          if (afterTrip?.phase.kind === "returned") orders.returnedTrips++;
          row("trip", () => {
            const phase = afterTrip?.phase;
            const outcome = phase && phase.kind !== "outbound" ? phase.outcome : null;
            return `运输回执 #${trip.fleetId}：${trip.phase.kind} → ${phase?.kind ?? "移除"}；${outcome?.kind === "delivered" ? "已交付结果保留" : outcome?.kind === "not-delivered" ? `未交付（${outcome.reason}）` : "尚无交付结果"}。历史货物/燃料只作记录，已交付货物不再计为在途货物；旧星球 ID 不重新授权。`;
          });
        }
      }
    }
  }
  const referenced = new Set<number>();
  for (const task of next.orders.tasks) if (task.formationOrigin) {
    orders.formationOrigins++;
    referenced.add(task.formationOrigin.formation.id);
  }
  if (eligible) {
    for (const formation of next.formations.entries) row("formation", () => `保留当前编成 #${formation.id} ${formation.name} · 修订 ${formation.revision}，设计 ${sumCounts(formation.ships)} 艘；不会自动补船或派遣${referenced.has(formation.id) ? "；历史计划仍引用，仍阻止直接删除" : ""}。`);
    for (const template of next.researchTemplates.templates) row("template", () => `保留模板 #${template.id} ${template.name} · 修订 ${template.revision}，${template.goals.length} 项目标；须重新选择付款星球并确认应用。`);
  }
  const home = next.planets.find(planet => planet.id === HOMEWORLD_ID);
  const oldAchievements = new Set(before.unlocked), oldCards = new Set(before.unlockedCards), oldTickets = new Set(before.arcade.runs.map(run => run.id));
  return {
    eligible, score: expansionScore(before).toString(), gain: evaluation.gain.toString(),
    cores: change(before.warpCores, next.warpCores),
    unspent: change(unspentCores(before), unspentCores(next)),
    passivePercent: change(passiveCoreBonus(before).mul(100), passiveCoreBonus(next).mul(100)),
    newHome: resourceStrings(home?.resources ?? zero()),
    worlds: { count: eligible ? before.planets.length : 0, colonies: eligible ? before.planets.filter(planet => planet.id !== HOMEWORLD_ID).length : 0, resources: resourceStrings(worldResources), buildingLevels: buildingLevels.toString(), units: units.toString() },
    paid: { buildings, research, shipyard, remainingUnits: remainingUnits.toString(), buildingPaid: resourceStrings(buildingPaid), researchPaid: resourceStrings(researchPaid), remainingUnitPaid: resourceStrings(remainingUnitPaid) },
    fleets: { count: eligible ? before.fleets.filter(fleet => !nextFleets.has(fleet.id)).length : 0, ships: ships.toString(), cargo: resourceStrings(fleetCargo), unsettledStake: unsettledStake.toString(), darkMatter: undockedDm.toString(), items: Object.fromEntries(Object.entries(fleetItems).map(([id, amount]) => [id, amount.toString()])) },
    orders,
    retained: { formations: next.formations.entries.length, templates: next.researchTemplates.templates.length, referencedFormations: next.formations.entries.filter(formation => referenced.has(formation.id)).length, researchLevels: Object.values(next.research.levels).reduce((sum, level) => sum + level, 0), items: Object.values(next.items).reduce((sum, count) => sum + count, 0), boosters: next.boosters.length, tickets: next.arcade.runs.length, reports: next.deepSpace.reports.length, messages: next.messages.length, totalTime: next.totalTime.toString() },
    protocols: {
      slotsBefore: unlockedSlotCount(before), slotsAfter: unlockedSlotCount(next), enabledAfter: next.protocols.slots.filter(slot => slot.card?.enabled).length,
      ringCardsStopped: before.protocols.slots.filter((slot, index) => slot.card?.enabled && slot.card.action.kind === "runLights" && !next.protocols.slots[index]?.card?.enabled).length,
      armedBatchStopped: !!before.arcade.autoBatch?.armed && !next.arcade.autoBatch?.armed,
    },
    rewards: { darkMatter: change(before.darkMatter, next.darkMatter), achievements: next.unlocked.filter(id => !oldAchievements.has(id)).length, cards: next.unlockedCards.filter(id => !oldCards.has(id)).length, tickets: next.arcade.runs.filter(run => !oldTickets.has(run.id)).length },
    removed: { offers: before.deepSpace.offers.length - next.deepSpace.offers.length, debris: before.deepSpace.debris.length - next.deepSpace.debris.length },
    rows, totalRows, omittedRows: totalRows - rows.length,
  };
}

/** Always called with the fresh manual-click evaluation, never a rendered cache. */
export function prestigeConfirmation(before: GameState, evaluation: PrestigeEvaluation): string {
  const model = prestigePreview(before, evaluation);
  if (!model.eligible) return `当前无法发射：扩张分 ${model.score}，预计核心 ${model.gain}，尚未达到至少 1 颗核心的门槛。`;
  return [
    `确认发射殖民舰？扩张分 ${model.score}；规则获得 ${model.gain} 颗核心；核心余额 ${previewChange(model.cores)}。`,
    `旧世界 ${model.worlds.count} 颗星球（含 ${model.worlds.colonies} 颗殖民地）全部重置；现有库存 ${previewResources(model.worlds.resources)}，驻留舰船/卫星/防御 ${model.worlds.units}。`,
    `${model.fleets.count} 支舰队、${model.fleets.ships} 艘舰船及其当前货物 ${previewResources(model.fleets.cargo)} 消失，不入库。未入港暗物质 ${model.fleets.darkMatter}；物品 ${previewItems(model.fleets.items)}；未结算押注 ${model.fleets.unsettledStake} 重氢。`,
    `取消已付建造 ${model.paid.buildings} 项、研究 ${model.paid.research} 项、造船 ${model.paid.shipyard} 批（剩余 ${model.paid.remainingUnits} 单位），不退款。${model.orders.stopped} 个计划停止，${model.orders.retiredTrips} 次在途运输封存；预留解除不增加资源。`,
    `保留研究等级、${model.retained.templates} 份模板、${model.retained.formations} 份编成和历史引用；设计须重新应用，不自动补船。`,
    `新母星实际库存：${previewResources(model.newHome)}。账上暗物质 ${previewChange(model.rewards.darkMatter)}。`,
    "确认后会先尝试保存；仅保存验证成功才采用新世界。",
  ].join("\n\n");
}
