import { evaluatePrestige } from "../game/logic";
import type { GameState } from "../game/types";
import { prestigePreview, previewChange, previewItems, previewResources, type PrestigePreview } from "./prestige-preview-model";
import "./prestige-preview.css";

export interface PrestigePreviewPanel {
  update(state: GameState, writable: boolean): void;
  invalidate(): void;
}

/** Additive, read-only panel. The original launch buttons remain the only launch entry points. */
export function installPrestigePreview(root: HTMLElement): PrestigePreviewPanel {
  const anchor = root.querySelector<HTMLElement>(".prestige-panel");
  const tab = root.querySelector<HTMLElement>('[data-tab-panel="curvature"]');
  if (!anchor || !tab) throw Error("缺少曲率预览挂载位置");
  const panel = document.createElement("section");
  panel.id = "prestige-preview";
  panel.className = "prestige-preview";
  panel.setAttribute("aria-labelledby", "prestige-preview-title");
  const title = document.createElement("h3");
  title.id = "prestige-preview-title";
  title.textContent = "本次发射预览";
  panel.append(title);
  const line = (id: string, parent: HTMLElement = panel): HTMLParagraphElement => {
    const paragraph = document.createElement("p");
    paragraph.id = `prestige-preview-${id}`;
    parent.append(paragraph);
    return paragraph;
  };
  const status = line("status");
  const gain = line("gain"), losses = line("losses"), kept = line("kept");
  const details = document.createElement("details");
  details.id = "prestige-preview-details";
  const summary = document.createElement("summary");
  summary.textContent = "查看完整汇总与明细";
  details.append(summary);
  panel.append(details);
  const cores = line("cores", details), home = line("home", details), worlds = line("worlds", details);
  const paid = line("paid", details), fleets = line("fleets", details), orders = line("orders", details);
  const protocols = line("protocols", details), rewards = line("rewards", details), retained = line("retained", details);
  const accounting = line("accounting", details);
  accounting.textContent = "各类资产分别列示，不合并成重复计价的“总损失”。已付成本已离开库存；历史预算、charged/refunded、运输回执货物与已消耗燃料不再加到现有资产。已完成单位只计入驻留单位或当前舰队。";
  const list = document.createElement("ul");
  list.id = "prestige-preview-rows";
  details.append(list);
  const omitted = line("omitted", details);
  const notice = line("notice");
  notice.className = "muted";
  notice.textContent = "仅在曲率页可见时约每秒更新；查看不推进时间、不结算奖励。点击原发射按钮会重新计算并要求确认。";
  anchor.insertAdjacentElement("afterend", panel);
  const put = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };
  let lastUpdated = -Infinity;
  let hasPreview = false;
  let visible = false;
  const render = (model: PrestigePreview) => {
    if (panel.dataset.eligible !== String(model.eligible)) panel.dataset.eligible = String(model.eligible);
    if (panel.dataset.score !== model.score) panel.dataset.score = model.score;
    if (panel.dataset.gain !== model.gain) panel.dataset.gain = model.gain;
    put(gain, `获得：规则核心 ${model.gain}；核心余额 ${model.cores.before} → ${model.cores.after}，实际变化 ${model.cores.change}。扩张分 ${model.score}。`);
    for (const node of [losses, kept, details]) if (node.hidden !== !model.eligible) node.hidden = !model.eligible;
    if (!model.eligible) return;
    put(losses, `失去 / 停止：旧世界 ${model.worlds.count} 颗星球（殖民地 ${model.worlds.colonies}）、${model.worlds.units} 驻留单位、${model.fleets.count} 支舰队；取消 ${model.paid.buildings + model.paid.research + model.paid.shipyard} 项/批已付工作，不退款；${model.orders.stopped} 个计划停止。`);
    put(kept, `保留：研究等级、账上暗物质/物品、${model.retained.templates} 份研究模板与 ${model.retained.formations} 份编成。设计与历史引用保留，须重新应用，不自动补船或派遣。`);
    put(cores, `核心余额：${previewChange(model.cores)}。未花费核心：${previewChange(model.unspent)}。核心被动加成（%）：${previewChange(model.passivePercent)}。仅表示核心被动，不保证重置后总产量提高。`);
    put(home, `新母星实际库存：${previewResources(model.newHome)}。包含本次候选实际生效的初始库存科技。`);
    put(worlds, `旧世界现有库存：${previewResources(model.worlds.resources)}；建筑合计 ${model.worlds.buildingLevels} 级，驻留舰船/卫星/防御 ${model.worlds.units}。旧母星和殖民地的库存、建筑、单位、本地队列、产量设置及本轮累计产出重置，选择回新母星。`);
    put(paid, `取消已付工作，不退款：建造 ${model.paid.buildings} 项（已付 ${previewResources(model.paid.buildingPaid)}）；研究 ${model.paid.research} 项（已付 ${previewResources(model.paid.researchPaid)}）；造船 ${model.paid.shipyard} 批，剩余 ${model.paid.remainingUnits} 单位（剩余已付 ${previewResources(model.paid.remainingUnitPaid)}）。已完成研究等级保留；付款不转给新母星。`);
    put(fleets, `消失舰队 ${model.fleets.count} 支 / 舰船 ${model.fleets.ships} 艘；当前货物 ${previewResources(model.fleets.cargo)}。未入港暗物质 ${model.fleets.darkMatter}；物品 ${previewItems(model.fleets.items)}；未结算押注托管 ${model.fleets.unsettledStake} 重氢。以上不入库。已结算押注不再次计损；已消耗燃料不退。`);
    put(orders, `停止 ${model.orders.stopped} 个运行/暂停计划，解除 ${model.orders.releasedWork} 份当前工作（其中 ${model.orders.releasedPending} 份未付款预留，解除不增加资源）。封存 ${model.orders.retiredTrips} 次在途运输：已交付 ${model.orders.deliveredRetiredTrips}、未交付 ${model.orders.undeliveredRetiredTrips}、尚无结果 ${model.orders.unresolvedRetiredTrips}；另保留 ${model.orders.returnedTrips} 次已返航历史。预算、付款/退款、完成量、旧星球引用和编号历史保留，不恢复授权。`);
    put(protocols, `可用协议槽 ${model.protocols.slotsBefore} → ${model.protocols.slotsAfter}；候选仍启用 ${model.protocols.enabledAfter} 张已配置协议卡（可用槽限制照常生效）。停止 ${model.protocols.ringCardsStopped} 张星环运行卡；${model.protocols.armedBatchStopped ? "已授权星环批次停止" : "没有正在授权的星环批次需要停止"}。其它配置按真实规则保留，协议累计计时归零。`);
    put(rewards, `真实候选差量：账上暗物质 ${previewChange(model.rewards.darkMatter)}；新增成就 ${model.rewards.achievements}、解锁卡 ${model.rewards.cards}、票据 ${model.rewards.tickets}。预览本身不会领奖。`);
    put(retained, `保留研究等级合计 ${model.retained.researchLevels}、库存物品 ${model.retained.items}、增益 ${model.retained.boosters} 份（结束时间不延长）、星环票据 ${model.retained.tickets} 张及其预掷结果、种子/保底/押注/历史。${model.retained.templates} 份模板和 ${model.retained.formations} 份当前编成保留 ID/修订；${model.orders.formationOrigins} 份计划历史仍保存旧编成修订与原报价，${model.retained.referencedFormations} 份设计仍受历史引用删除限制。保留深空报告 ${model.retained.reports} 份、消息 ${model.retained.messages} 条和累计游戏时间 ${model.retained.totalTime} 秒；回放不补发未入港奖励。移除报价 ${model.removed.offers} 份与残骸 ${model.removed.debris} 处。`);
    // Patch bounded text nodes only: never replace the details/summary or a focused control.
    while (list.children.length > model.rows.length) list.lastElementChild!.remove();
    for (const [index, value] of model.rows.entries()) {
      let item = list.children[index] as HTMLLIElement | undefined;
      if (!item) { item = document.createElement("li"); list.append(item); }
      if (item.dataset.previewRow !== String(index)) item.dataset.previewRow = String(index);
      if (item.dataset.previewKind !== value.kind) item.dataset.previewKind = value.kind;
      put(item, value.text);
    }
    if (list.dataset.totalRows !== String(model.totalRows)) list.dataset.totalRows = String(model.totalRows);
    put(omitted, model.omittedRows ? `已显示前 ${model.rows.length} 条明细，共 ${model.totalRows} 条，另有 ${model.omittedRows} 条未展开；以上汇总包含全部数据。` : `共 ${model.totalRows} 条明细，已全部显示。`);
  };
  const invalidate = () => {
    hasPreview = false;
    lastUpdated = -Infinity;
    if (!panel.hidden) panel.hidden = true;
    delete panel.dataset.eligible;
    delete panel.dataset.score;
    delete panel.dataset.gain;
  };
  return {
    invalidate,
    update(state, writable) {
      if (tab.hidden || document.hidden) {
        // There is no stored candidate or state reference to retain off-screen.
        visible = false;
        hasPreview = false;
        lastUpdated = -Infinity;
        return;
      }
      const now = performance.now();
      if (!visible || !hasPreview || now - lastUpdated >= 1000) {
        // This one local candidate is released after projection, never offered for submission.
        render(prestigePreview(state, evaluatePrestige(state)));
        hasPreview = true;
        lastUpdated = now;
      }
      visible = true;
      if (panel.hidden) panel.hidden = false;
      if (panel.dataset.writable !== String(writable)) panel.dataset.writable = String(writable);
      put(status, !writable ? "存档处于保护模式：当前不能发射。这里只展示预览。"
        : panel.dataset.eligible === "true" ? "达到发射门槛。请先核对真实收益与本轮损失。"
        : "当前无法发射：规则获得不足 1 颗核心。没有执行重置，也不代表重置无损。" );
    },
  };
}
