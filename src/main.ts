import { applyFormationAction } from "./game/formations";
import { applyResearchTemplateAction } from "./game/research-templates";
import { applyOrderAction } from "./game/orders";
import { ordersView } from "./ui/orders-present";
import { summonMerchant, trade } from "./game/merchant";
import { sendFleet, recallFleet, abandonColony } from "./game/fleet";
import { spaceFleetView, spaceGalaxyView, spaceMessagesView, spaceOrigin } from "./ui/space-present";
import "./space.css";
import { activePlanet, selectPlanet } from "./game/empire";
import { catchUp, type OfflineCatchup } from "./core/offline";
import { AccountedClock, type ClockSample } from "./core/accounted-clock";
import { unlockBanner } from "./data/achievements";
import { evaluatePrestige, scrape, scrapeAmount, tick } from "./game/logic";
import { curvatureById } from "./data/curvature-tech";
import { buyCurvature } from "./prestige/tree";
import {
  armAutoRunner,
  clearSlot,
  equipCard,
  equipFirstEmpty,
  moveSlot,
  patchSlot,
  setProductionPct,
  stopAutoRunner,
  toggleSlot,
} from "./automation/engine";
import { buildingById } from "./data/buildings";
import { big } from "./game/decimal";
import { formatAmount } from "./game/format";
import { enqueue } from "./game/queue";
import { enqueueResearch } from "./game/research";
import { orderUnits } from "./game/shipyard";
import { buyPackage, buyShopItem, speedUp, useInventory } from "./game/dark-matter";
import { revealAll, revealRun, setBet, topUp } from "./game/arcade";
import { researchById } from "./data/research";
import type { KeyValueStore } from "./game/save";
import { SaveSession, type ReplacementResult } from "./game/save-session";
import type { GameState } from "./game/types";
import { presentVisible, resolveVisibleTab } from "./ui/present";
import { RenderScheduler } from "./ui/render-scheduler";
import { maySpeedUp, queueHeads, sameQueueHeads, type QueueHeads } from "./ui/queue-head-authority";
import { prestigeConfirmation } from "./ui/prestige-preview-model";
import { mountView, type UiAction } from "./ui/space-panel";
import "./style.css";

const AUTOSAVE_MS = 15_000;
const BACKGROUND_NOTICE_SECONDS = 5;
const OFFLINE_MODAL_SECONDS = 30;

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("Missing #app");

const store = localStorageSafe();
const startupClock = sampleClock();
const accountedClock = new AccountedClock(startupClock);
const saveSession = new SaveSession(store, startupClock.wallAt);
const loaded = saveSession.loaded;
let notice = saveSession.notice;
let status = saveSession.message;

let state: GameState = loaded.state;
let adoptedLaunches = state.stats.launches;
let catchup: OfflineCatchup | null = loaded.appliedSeconds >= BACKGROUND_NOTICE_SECONDS ? loaded : null;
let banner: string | null = unlockBanner(loaded.newAchievementIds);

const renderScheduler = new RenderScheduler();
let paintedHeads: QueueHeads | null = null;
// Register before extension capture handlers, some of which stop propagation.
// Only invalidate here: even a microtask can run between trusted DOM listeners
// and detach the clicked capability. The existing next RAF paints after dispatch.
for (const type of ["click", "input", "change", "compositionend", "toggle"]) {
  app.addEventListener(type, () => renderScheduler.invalidate(), true);
}
const view = mountView(app, (action) => {
  void handleAction(action);
});
view.setOrigin(activePlanet(state).coordinates);
view.observeContexts(state, saveSession.mode === "ready");
render();

window.requestAnimationFrame(frame);

window.setInterval(() => persist("已自动保存", true), AUTOSAVE_MS);
window.addEventListener("beforeunload", () => persist());
window.addEventListener("storage", (event) => {
  if (event.storageArea !== store || !saveSession.handleStorageEvent(event.key)) return;
  status = saveSession.message;
  notice = saveSession.notice;
  render();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist(undefined, true);
  // Account the full resume gap in the existing frame before displaying it.
  else renderScheduler.invalidate();
});

function frame(now: number): void {
  const gap = accountedClock.gapSeconds(now);
  // Protected progress is read-only. A failed migration must not become a new live game.
  if (saveSession.mode !== "ready") {
    render(false, now);
    window.requestAnimationFrame(frame);
    return;
  }
  if (gap >= BACKGROUND_NOTICE_SECONDS) {
    const result = catchUp(state, gap);
    state = result.state;
    observePresentationContext();
    // Consume the whole observed gap, including time discarded by the existing
    // offline cap. A later save/reload must not reclaim that discarded portion.
    accountedClock.account(now);
    if (result.appliedSeconds >= OFFLINE_MODAL_SECONDS) catchup = result;
    const unlocked = unlockBanner(result.newAchievementIds);
    if (unlocked) banner = unlocked;
    persist("已追赶后台进度", true);
  } else if (gap > 0) {
    const before = state.unlocked;
    state = tick(state, gap);
    observePresentationContext();
    accountedClock.account(now);
    const unlocked = unlockBanner(state.unlocked.filter((id) => !before.includes(id)));
    if (unlocked) banner = unlocked;
  }
  render(false, now);
  window.requestAnimationFrame(frame);
}

function observePresentationContext(): void {
  // Retire old-world capabilities immediately, even on a skipped/hidden paint.
  observeWorldAdoption();
  view.observeContexts(state, saveSession.mode === "ready");
  // Original speedup controls target the head, unlike stable-ID cancellation.
  // A newly active paid job must not inherit the previous job's displayed button.
  if (!sameQueueHeads(paintedHeads, queueHeads(state))) renderScheduler.invalidate();
}

function visibleTab(): string {
  return app!.querySelector<HTMLElement>("[data-tab-panel]:not([hidden])")?.dataset.tabPanel ?? "facilities";
}

function render(urgent = true, now = performance.now()): void {
  observePresentationContext();
  if (urgent) renderScheduler.invalidate();
  const requested = visibleTab();
  const tab = resolveVisibleTab(state, requested);
  const ready = saveSession.mode === "ready";
  if (!renderScheduler.shouldPaint(now, { hidden: document.hidden, ready, visibleTab: tab })) return;
  if (tab !== requested) {
    // Use the original navigation path so a persisted, initially locked tab
    // receives the same selection and preference update as a normal fallback.
    app!.querySelector<HTMLButtonElement>('[data-tab="facilities"]')?.click();
  }
  view.update(presentVisible(state, { status, banner, notice, catchup }, tab));
  view.setOrigin(activePlanet(state).coordinates);
  view.updateSpaceChrome(spaceOrigin(state), status);
  if (tab === "galaxy") view.updateSpaceGalaxy(spaceGalaxyView(state, view.cursor()));
  if (tab === "fleet") view.updateSpaceFleet(spaceFleetView(state, view.readRequest()));
  if (tab === "messages") view.updateSpaceMessages(spaceMessagesView(state));
  view.updateDeep(state);
  if (tab === "orders") view.updateOrders(ordersView(state), ready);
  view.updateResearchTemplates(state, ready);
  view.updateFormations(state, ready);
  // Their hidden paths are cheap and must observe leaving their surfaces.
  view.updatePrestigePreview(state, ready);
  view.updateExpansionNavigation(state, view.cursor());
  paintedHeads = queueHeads(state);
  renderScheduler.didPaint(now, tab);
}

async function handleAction(action: UiAction): Promise<void> {
  saveSession.cancelPendingImport();
  const recoveryAction = ["save", "export", "export-legacy", "import-text", "import-file", "reset", "dismiss-notice", "dismiss-offline"].includes(action.type);
  if (saveSession.mode !== "ready" && !recoveryAction) {
    status = saveSession.message;
    render();
    return;
  }
  const actionSource = state;
  const before = state.unlocked;
  if (action.type === "formation-fill") {
    const formation = state.formations.entries.find(item => item.id === action.formationId && item.revision === action.expectedRevision);
    if (formation) {
      view.fillFormationShips(formation);
      status = `已填入 #${formation.id} ${formation.name} 的派遣数量；任务与其他输入保持原值，尚未派遣或付款`;
    } else status = "编成已改变，请重新选择后填入";
    view.completeFormationAction(status, !!formation);
  } else if (action.type === "formation-create" || action.type === "formation-edit" || action.type === "formation-delete" || action.type === "formation-replenish") {
    const result = applyFormationAction(state, action);
    const changed = result.state !== state;
    state = result.state; status = result.reason;
    if (changed) persist();
    view.completeFormationAction(status, result.ok && saveSession.mode === "ready");
  } else if (action.type === "research-template-create" || action.type === "research-template-edit" || action.type === "research-template-delete" || action.type === "research-template-apply") {
    const result = applyResearchTemplateAction(state, action);
    const changed = result.state !== state;
    state = result.state; status = result.reason;
    if (changed) persist();
    view.completeResearchTemplateAction(status, result.ok && saveSession.mode === "ready");
  } else if (action.type === "order-create" || action.type === "order-pause" || action.type === "order-resume" || action.type === "order-cancel" || action.type === "order-dismiss" || action.type === "order-retry-dock" || action.type === "cancel-paid-job") {
    const result = applyOrderAction(state, action);
    const changed = result.state !== state;
    state = result.state;
    status = result.reason;
    // Safety failures can intentionally pause a task. Persist those state changes too.
    if (changed) persist();
  } else if(action.type==="summon-merchant"||action.type==="trade"){
    const result=action.type==="summon-merchant"?summonMerchant(state):trade(state,action.offer,action.sell,action.buy,action.amount);
    state=result.state;status=result.reason;if(result.ok)persist();
  } else if(action.type==="export-legacy"){
    try {
      const raw = store?.getItem("infinity.save.v1");
      if (raw !== null && raw !== undefined) { view.setTransferText(raw); status = "旧站原始存档已放入文本框，请复制另存，不会自动导入本版本"; }
      else status = "未找到旧站原始存档";
    } catch { status = "无法读取旧站存档，未改动存档"; }
  } else if (action.type === "send-fleet" || action.type === "recall-fleet" || action.type === "abandon-colony") {
    if (action.type === "abandon-colony" && !window.confirm("放弃这颗殖民地？其资源、建筑、舰船和本地队列将永久丢失。")) return;
    const result=action.type === "send-fleet" ? sendFleet(state,action.request) : action.type === "recall-fleet" ? recallFleet(state,action.id) : abandonColony(state,action.id);
    const changed=result.state!==state;
    state=result.state;status=result.reason;if(changed)persist();
  } else if (action.type === "select-planet") {
    const next = selectPlanet(state, action.id);
    if (next !== state) { state = next; status = `已切换至${activePlanet(state).name}，协议卡只作用于当前星球`; persist(); }
  } else if (action.type === "dismiss-offline") {
    catchup = null;
  } else if (action.type === "dismiss-notice") {
    notice = null;
  } else if (action.type === "scrape") {
    const mined = scrapeAmount(state);
    state = scrape(state);
    status = `采集 +${formatAmount(big(mined))} 金属`;
  } else if (action.type === "enqueue") {
    const result = enqueue(state, action.id, "manual");
    state = result.state;
    status = result.ok ? result.reason : `${buildingById(action.id).nameZh}：${result.reason}`;
    if (result.ok) persist();
  } else if (action.type === "cancelQueue") {
    // Index-only cancellation must never resolve against a newer queue snapshot.
    status = "队列已更新，请使用当前工作的取消按钮";
  } else if (action.type === "enqueueResearch") {
    const result = enqueueResearch(state, action.id, "manual");
    state = result.state;
    status = result.ok ? result.reason : `${researchById(action.id).nameZh}：${result.reason}`;
    if (result.ok) persist();
  } else if (action.type === "cancelResearch") {
    // Index-only cancellation must never resolve against a newer queue snapshot.
    status = "队列已更新，请使用当前工作的取消按钮";
  } else if (action.type === "build-units") {
    const amount = action.mode === "max" ? "max" : action.mode === "fill" ? { fillTo: action.count } : action.count;
    const result = orderUnits(state, action.id, amount, "manual");
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "cancel-units") {
    // Index-only cancellation must never resolve against a newer queue snapshot.
    status = "队列已更新，请使用当前工作的取消按钮";
  } else if (action.type === "dm-speedup") {
    if (!maySpeedUp(paintedHeads, queueHeads(state), action.target)) {
      status = "当前工作已改变，请查看刷新后的加速按钮";
    } else {
      const result = speedUp(state, action.target, action.mode);
      state = result.state;
      status = result.reason;
      if (result.ok) persist();
    }
  } else if (action.type === "dm-shop") {
    const result = buyShopItem(state, action.id, action.res);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "dm-package") {
    const result = buyPackage(state, action.kind, action.fraction);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "dm-use") {
    const result = useInventory(state, action.id);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "ring-auto-arm") {
    const result = armAutoRunner(state, action.slotIndex, {planetId: action.planetId, count: action.count, maxDeuterium: action.maxDeuterium});
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "ring-auto-stop") {
    state = stopAutoRunner(state);
    status = "已停止自动开奖；重新授权后才会继续";
    persist();
  } else if (action.type === "arcade-run") {
    const result = revealRun(state, "manual");
    state = result.state;
    status = result.reason;
    if (result.result) view.playArcade([result.result]);
    if (result.ok) persist();
  } else if (action.type === "arcade-all") {
    const result = revealAll(state, "manual");
    state = result.state;
    status = result.reason;
    if (result.results.length > 0) view.playArcade(result.results);
    if (result.ok) persist();
  } else if (action.type === "arcade-topup") {
    const result = topUp(state);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "arcade-bet") {
    const result = setBet(state, action.symbol, state.arcade.bets[action.symbol] + action.delta);
    state = result.state;
    status = result.reason;
    persist();
  } else if (action.type === "arcade-bet-clear") {
    state = stopAutoRunner(state);
    state = { ...state, arcade: { ...state.arcade, bets: { metal: 0, crystal: 0, deuterium: 0, drifter: 0 } } };
    status = "已清空押注";
    persist();
  } else if (action.type === "setProduction") {
    state = setProductionPct(state, action.id, action.pct);
    status = `${buildingById(action.id).nameZh}产量设为 ${activePlanet(state).productionPct[action.id]}%`;
    persist();
  } else if (action.type === "protocol-palette") {
    const result = equipFirstEmpty(state, action.cardId);
    state = result.state;
    status = result.status;
    if (result.status.startsWith("已装配")) persist();
  } else if (action.type === "protocol-equip") {
    const result = equipCard(state, action.index, action.cardId);
    state = result.state;
    status = result.status;
    if (result.status.startsWith("已装配")) persist();
  } else if (action.type === "protocol-toggle") {
    state = toggleSlot(state, action.index, action.enabled);
    status = action.enabled ? "已启用协议卡" : "已关闭协议卡";
    persist();
  } else if (action.type === "protocol-clear") {
    state = clearSlot(state, action.index);
    status = "已卸下协议卡";
    persist();
  } else if (action.type === "protocol-move") {
    state = moveSlot(state, action.from, action.to);
    status = "已调整协议槽顺序";
    persist();
  } else if (action.type === "protocol-param") {
    state = patchSlot(state, action.index, action.path, action.value);
    status = "已调整协议参数";
    persist();

  } else if (action.type === "buy-tech") {
    const next = buyCurvature(state, action.id);
    if (next === state) {
      const node = curvatureById(action.id);
      status = state.curvature[action.id] >= node.maxRank ? "已经买满" : "曲率核心不足";
    } else {
      state = next;
      status = "已花费曲率核心";
      persist();
    }
  } else if (action.type === "prestige") {
    const source = state;
    // A visible preview is information, never execution authority. Confirm a fresh
    // candidate from the exact same rule that manual and automated launches use.
    const evaluation = evaluatePrestige(source);
    if (evaluation.next === source) {
      status = "扩张分还不够发射";
    } else {
      if (!window.confirm(prestigeConfirmation(source, evaluation))) return;
      if (state !== source || saveSession.mode !== "ready") {
        status = "进度或存档会话已改变，未采用发射结果；请重新查看";
        notice = saveSession.notice;
      } else {
        // Do not use persist(): it observes/adopts the global world before saving.
        // Read-back success is required before changing visible state or retiring
        // old-world controls. An uncertain write remains protected by SaveSession.
        const saved = saveSession.save(evaluation.next, Date.now(), accountedClock.lastTickAt);
        if (saved.ok) {
          state = evaluation.next;
          status = "已发射殖民舰并存入本地";
          observeWorldAdoption();
        } else {
          status = `发射结果未采用，当前可见进度保持原样：${saved.message}`;
          notice = saveSession.notice;
        }
      }
    }
  } else if (action.type === "save") {
    persist("已保存到本地");
  } else if (action.type === "export") {
    try {
      const exported = saveSession.export(state, Date.now(), accountedClock.lastTickAt);
      view.setTransferText(exported.raw);
      download(exported.raw);
      status = exported.protected ? "已导出受保护原始存档" : "已导出 JSON";
    } catch { status = "原始存档目前无法读取，未导出；请恢复本地存储权限后重试"; }
  } else if (action.type === "import-text") {
    const sample = sampleClock();
    applyReplacement(saveSession.importText(action.text, sample.wallAt), "导入", sample);
  } else if (action.type === "import-file") {
    // Reading validates data only. Background saves may continue; no old
    // replacement intent survives the read or authorizes overwriting new progress.
    const prepared = await saveSession.prepareFile(action.file);
    if (!saveSession.isCurrentPreparedFile(prepared) || (!prepared.ok && prepared.code === "stale")) return;
    if (!prepared.ok) {
      status = `导入失败，当前进度未改动：${prepared.message}`;
      notice = saveSession.notice;
    } else {
      const confirmationState = state;
      const accepted = window.confirm(
        `已读取存档 v${prepared.sourceVersion}/r${prepared.sourceRevision}。\n` +
        `是否替换当前进度（第 ${state.stats.launches + 1} 轮，${state.planets.length} 颗星球，当前“${activePlanet(state).name}”）？\n` +
        "读取期间产生的变化也会被替换。保留当前已保存原件，写入校验成功后才采用。",
      );
      // Dialog return must not revive an action, conflict or different world.
      if (!saveSession.isCurrentPreparedFile(prepared) || state !== confirmationState) return;
      if (!accepted) {
        saveSession.cancelPendingImport();
        status = "已取消文件导入，当前进度未改动";
      } else {
        // New explicit consent, a fresh paired clock sample, and synchronous
        // storage replacement/adoption. No await remains in this transaction.
        const sample = sampleClock();
        applyReplacement(saveSession.importText(prepared.raw, sample.wallAt), "导入", sample);
      }
    }
  } else if (action.type === "reset") {
    if (!window.confirm("备份当前原始存档并重新开始？新存档写入成功后才会替换当前进度。")) return;
    const sample = sampleClock();
    applyReplacement(saveSession.reset(sample.wallAt), "重置", sample);
  }
  if (
    action.type === "scrape" ||
    action.type === "enqueue" ||
    action.type === "enqueueResearch" ||
    action.type === "build-units" ||
    action.type === "prestige"
  ) {
    const note = unlockBanner(state.unlocked.filter((id) => !before.includes(id)));
    if (note) banner = note;
  }
  if (state !== actionSource) view.invalidatePrestigePreview();
  render();
}

function applyReplacement(result: ReplacementResult, action: "导入" | "重置", sample: ClockSample | null): void {
  if (!result.ok) {
    status = `${action}失败，当前进度未改动：${result.message}`;
    notice = saveSession.notice;
    return;
  }
  if (!saveSession.isCurrentReplacement(result)) return;
  if (sample === null) throw new Error("A committed replacement must have a paired clock sample");
  // Task/job counters are scoped to a save. Do not let controls or draft nonces
  // from the old namespace attach themselves to matching IDs in the new one.
  view.invalidateOrderAuthority();
  paintedHeads = null;
  renderScheduler.reset();
  state = result.state;
  accountedClock.rebase(sample);
  adoptedLaunches = state.stats.launches;
  catchup = null;
  banner = null;
  notice = null;
  status = action === "导入" ? "已导入并存入本地" : "已重置并存入本地";
  view.setTransferText(action === "导入" ? result.raw : "");
}

/** One adoption guard covers manual, protocol and offline curvature launches.
 * A cancelled or rejected launch leaves the generation untouched. */
function observeWorldAdoption(): void {
  if (state.stats.launches === adoptedLaunches) return;
  saveSession.cancelPendingImport();
  view.invalidateOrderAuthority();
  paintedHeads = null;
  renderScheduler.reset();
  adoptedLaunches = state.stats.launches;
}

function persist(nextStatus?: string, background = false): void {
  observeWorldAdoption();
  const beforeStatus = status;
  const beforeNotice = notice;
  const beforeMode = saveSession.mode;
  const result = background
    ? saveSession.saveBackground(state, Date.now(), accountedClock.lastTickAt)
    : saveSession.save(state, Date.now(), accountedClock.lastTickAt);
  if (result.ok) {
    if (nextStatus) status = nextStatus;
  } else {
    status = result.message;
    notice = saveSession.notice;
  }
  if (status !== beforeStatus || notice !== beforeNotice || saveSession.mode !== beforeMode) renderScheduler.invalidate();
  view.observeContexts(state, saveSession.mode === "ready");
}

function sampleClock(): ClockSample {
  return { wallAt: Date.now(), frameAt: performance.now() };
}

function download(json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "infinity-save.json";
  link.click();
  URL.revokeObjectURL(url);
}

function localStorageSafe(): KeyValueStore | null {
  try {
    // A write probe could hide readable saves when quota is full. Read/write failures
    // are handled by SaveSession without losing access to the original bytes.
    return window.localStorage;
  } catch {
    return null;
  }
}
