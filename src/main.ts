import { applyOrderAction } from "./game/orders";
import { ordersView } from "./ui/orders-present";
import { summonMerchant, trade } from "./game/merchant";
import { sendFleet, recallFleet, abandonColony } from "./game/fleet";
import { spaceView } from "./ui/space-present";
import "./space.css";
import { activePlanet, selectPlanet } from "./game/empire";
import { catchUp, type OfflineCatchup } from "./core/offline";
import { unlockBanner } from "./data/achievements";
import { prestige, scrape, scrapeAmount, tick } from "./game/logic";
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
import { present } from "./ui/present";
import { mountView, type UiAction } from "./ui/space-panel";
import "./style.css";

const AUTOSAVE_MS = 15_000;
const BACKGROUND_NOTICE_SECONDS = 5;
const OFFLINE_MODAL_SECONDS = 30;

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("Missing #app");

const store = localStorageSafe();
const saveSession = new SaveSession(store);
const loaded = saveSession.loaded;
let notice = saveSession.notice;
let status = saveSession.message;

let state: GameState = loaded.state;
let catchup: OfflineCatchup | null = loaded.appliedSeconds >= BACKGROUND_NOTICE_SECONDS ? loaded : null;
let banner: string | null = unlockBanner(loaded.newAchievementIds);

const view = mountView(app, (action) => {
  void handleAction(action);
});
render();

let lastFrame = performance.now();
window.requestAnimationFrame(frame);

window.setInterval(() => persist("已自动保存"), AUTOSAVE_MS);
window.addEventListener("beforeunload", () => persist());
window.addEventListener("storage", (event) => {
  if (event.storageArea !== store || !saveSession.handleStorageEvent(event.key)) return;
  status = saveSession.message;
  notice = saveSession.notice;
  render();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});

function frame(now: number): void {
  const gap = (now - lastFrame) / 1000;
  lastFrame = now;
  // Protected progress is read-only. A failed migration must not become a new live game.
  if (saveSession.mode !== "ready") {
    render();
    window.requestAnimationFrame(frame);
    return;
  }
  if (gap >= BACKGROUND_NOTICE_SECONDS) {
    const result = catchUp(state, gap);
    state = result.state;
    if (result.appliedSeconds >= OFFLINE_MODAL_SECONDS) catchup = result;
    const unlocked = unlockBanner(result.newAchievementIds);
    if (unlocked) banner = unlocked;
    persist("已追赶后台进度");
  } else if (gap > 0) {
    const before = state.unlocked;
    state = tick(state, gap);
    const unlocked = unlockBanner(state.unlocked.filter((id) => !before.includes(id)));
    if (unlocked) banner = unlocked;
  }
  render();
  window.requestAnimationFrame(frame);
}

function render(): void {
  view.update(present(state, { status, banner, notice, catchup }));
  view.setOrigin(activePlanet(state).coordinates);
  view.updateSpace(spaceView(state, view.cursor(), view.readRequest()), status);
  view.updateDeep(state);
  view.updateOrders(ordersView(state), saveSession.mode === "ready");
}

async function handleAction(action: UiAction): Promise<void> {
  saveSession.cancelPendingImport();
  const recoveryAction = ["save", "export", "export-legacy", "import-text", "import-file", "reset", "dismiss-notice", "dismiss-offline"].includes(action.type);
  if (saveSession.mode !== "ready" && !recoveryAction) {
    status = saveSession.message;
    render();
    return;
  }
  const before = state.unlocked;
  if (action.type === "order-create" || action.type === "order-pause" || action.type === "order-resume" || action.type === "order-cancel" || action.type === "order-dismiss" || action.type === "cancel-paid-job") {
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
    state=result.state;status=result.reason;if(result.ok)persist();
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
    const result = speedUp(state, action.target, action.mode);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
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
    if (!window.confirm("发射殖民舰会清空所有星球的资源、建筑、舰船、在途舰队与队列，只保留新母星，进行中的研究也会取消（不退款）。保留曲率核心、曲率科技、研究等级、暗物质、成就和协议卡。继续？")) return;
    const next = prestige(state);
    if (next === state) {
      status = "扩张分还不够发射";
      return;
    }
    state = next;
    status = "已发射殖民舰";
    persist();
  } else if (action.type === "save") {
    persist("已保存到本地");
  } else if (action.type === "export") {
    try {
      const exported = saveSession.export(state);
      view.setTransferText(exported.raw);
      download(exported.raw);
      status = exported.protected ? "已导出受保护原始存档" : "已导出 JSON";
    } catch { status = "原始存档目前无法读取，未导出；请恢复本地存储权限后重试"; }
  } else if (action.type === "import-text") {
    applyReplacement(saveSession.importText(action.text), "导入");
  } else if (action.type === "import-file") {
    const result = await saveSession.importFile(action.file);
    // A superseded read must not overwrite a newer action's state, text, or status.
    if (!saveSession.isCurrentFileResult(result) || (!result.ok && result.code === "stale")) return;
    applyReplacement(result, "导入");
  } else if (action.type === "reset") {
    if (!window.confirm("备份当前原始存档并重新开始？新存档写入成功后才会替换当前进度。")) return;
    applyReplacement(saveSession.reset(), "重置");
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
  render();
}

function applyReplacement(result: ReplacementResult, action: "导入" | "重置"): void {
  if (!result.ok) {
    status = `${action}失败，当前进度未改动：${result.message}`;
    notice = saveSession.notice;
    return;
  }
  if (!saveSession.isCurrentReplacement(result)) return;
  // Task/job counters are scoped to a save. Do not let controls or draft nonces
  // from the old namespace attach themselves to matching IDs in the new one.
  view.invalidateOrderAuthority();
  state = result.state;
  catchup = null;
  banner = null;
  notice = null;
  status = action === "导入" ? "已导入并存入本地" : "已重置并存入本地";
  view.setTransferText(action === "导入" ? result.raw : "");
}

function persist(nextStatus?: string): void {
  const result = saveSession.save(state);
  if (result.ok) {
    if (nextStatus) status = nextStatus;
  } else {
    status = result.message;
    notice = saveSession.notice;
  }
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
