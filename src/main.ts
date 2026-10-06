import { sendFleet, quoteFlight, recallFleet, abandonColony } from "./game/fleet";
import { validCoordinates } from "./game/galaxy";
import { activePlanet, selectPlanet } from "./game/empire";
import { catchUp, emptyCatchup, type OfflineCatchup } from "./core/offline";
import { unlockBanner } from "./data/achievements";
import { prestige, scrape, scrapeAmount, tick } from "./game/logic";
import { curvatureById } from "./data/curvature-tech";
import { buyCurvature } from "./prestige/tree";
import {
  clearSlot,
  equipCard,
  equipFirstEmpty,
  moveSlot,
  patchSlot,
  setProductionPct,
  toggleSlot,
} from "./automation/engine";
import { buildingById } from "./data/buildings";
import { big } from "./game/decimal";
import { formatAmount, formatDuration } from "./game/format";
import { cancel, enqueue } from "./game/queue";
import { cancelResearch, enqueueResearch } from "./game/research";
import { cancelUnits, orderUnits } from "./game/shipyard";
import { buyPackage, buyShopItem, speedUp, useInventory } from "./game/dark-matter";
import { revealAll, revealRun, setBet, topUp } from "./game/arcade";
import { researchById } from "./data/research";
import {
  clearSave,
  preserveSave,
  readBackup,
  deserializeState,
  exportSave,
  importSave,
  loadGame,
  writeSave,
  type KeyValueStore,
} from "./game/save";
import { STORAGE_KEY } from "./game/content";
import { createInitialState } from "./game/state";
import type { GameState } from "./game/types";
import { present } from "./ui/present";
import { mountView, type UiAction } from "./ui/view";
import "./style.css";
import "./visual.css";

const AUTOSAVE_MS = 15_000;
const BACKGROUND_NOTICE_SECONDS = 5;
const OFFLINE_MODAL_SECONDS = 30;

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("Missing #app");

const store = localStorageSafe();
let loaded: OfflineCatchup = emptyCatchup(createInitialState());
let notice: string | null = null;
let saveBlocked = false;
let status = store ? "已读取本地存档" : "本地存储不可用，本局不会保存";
if (store) {
  try {
    const result = loadGame(store);
    loaded = result;
    notice = result.notice;
    saveBlocked = result.saveBlocked === true;
  } catch {
    loaded = emptyCatchup(createInitialState());
    saveBlocked = true;
    notice = "原存档读取失败，自动保存已暂停。请先导出原件，当前只运行临时游戏。";
    status = "原存档未覆盖";
  }
}

let state: GameState = loaded.state;
let galaxyCursor = { galaxy: activePlanet(state).coordinates.galaxy, system: activePlanet(state).coordinates.system };
let catchup: OfflineCatchup | null = loaded.appliedSeconds >= BACKGROUND_NOTICE_SECONDS ? loaded : null;
let banner: string | null = unlockBanner(loaded.newAchievementIds);

const view = mountView(app, (action) => {
  void handleAction(action);
});
// Only verified migrations may be written immediately.
if (notice && !saveBlocked) persist();
render();

let lastFrame = performance.now();
window.requestAnimationFrame(frame);

window.setInterval(() => persist("已自动保存"), AUTOSAVE_MS);
window.addEventListener("beforeunload", () => persist());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});

function frame(now: number): void {
  const gap = (now - lastFrame) / 1000;
  lastFrame = now;
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
  view.update(present(state, { status, banner, notice, catchup, galaxyCursor }));
  const protection = document.querySelector("#save-protection");
  if (protection) protection.textContent = saveBlocked
    ? "保护模式：自动保存已暂停。原存档仍保留在本地，请先导出原件。当前临时游戏可单独导出。"
    : "自动保存已启用。v8 升级原件和导入前的进度会保留为本地备份。";
}

async function handleAction(action: UiAction): Promise<void> {
  const before = state.unlocked;
  if (action.type === "select-planet") {
    state = selectPlanet(state, action.id);
    status = `已切换至 ${activePlanet(state).name}，库存和建筑均为该星球独立数据`;
    persist();
  } else if (action.type === "galaxy-browse") {
    if (validCoordinates({ galaxy: action.galaxy, system: action.system, position: 1 })) galaxyCursor = { galaxy: action.galaxy, system: action.system };
    else status = "银河或恒星系编号超出范围";
  } else if (action.type === "preview-flight") {
    const quote = quoteFlight(state, action.request);
    status = quote.ok ? `单程 ${formatDuration(quote.duration)} · 往返燃料 ${formatAmount(quote.fuel)} 重氢 · 货舱 ${formatAmount(quote.capacity)}（含燃料）` : quote.reason;
  } else if (action.type === "send-fleet") {
    const result = sendFleet(state, action.request);
    state = result.state; status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "recall-fleet") {
    const result = recallFleet(state, action.id);
    state = result.state; status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "abandon-colony") {
    if (!window.confirm("放弃当前殖民地会永久删除其资源、建筑、队列及驻留舰船，不退款。确定继续？")) return;
    const result = abandonColony(state, state.activePlanetId);
    state = result.state; status = result.reason;
    if (result.ok) persist();
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
    const result = cancel(state, action.index);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "enqueueResearch") {
    const result = enqueueResearch(state, action.id, "manual");
    state = result.state;
    status = result.ok ? result.reason : `${researchById(action.id).nameZh}：${result.reason}`;
    if (result.ok) persist();
  } else if (action.type === "cancelResearch") {
    const result = cancelResearch(state, action.index);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "build-units") {
    const amount = action.mode === "max" ? "max" : action.mode === "fill" ? { fillTo: action.count } : action.count;
    const result = orderUnits(state, action.id, amount, "manual");
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
  } else if (action.type === "cancel-units") {
    const result = cancelUnits(state, action.index);
    state = result.state;
    status = result.reason;
    if (result.ok) persist();
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
    if (!window.confirm("发射殖民舰会清空全部殖民地、在途舰队和所有星球资源、建筑、舰船、防御及队列，只保留新母星；进行中的研究也会取消（不退款）。保留曲率核心、曲率科技、研究等级、暗物质、成就和协议卡。继续？")) return;
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
    const json = exportSave(state);
    view.setTransferText(json);
    download(json);
    status = "已导出 JSON";
    persist();
  } else if (action.type === "export-backup") {
    try {
      const raw = store ? (saveBlocked ? store.getItem(STORAGE_KEY) : readBackup(store)) : null;
      if (!raw) status = "当前没有保留的原存档";
      else { view.setTransferText(raw); download(raw, "infinity-original-save.json"); status = "已导出原存档原件，未修改当前进度"; }
    } catch { status = "无法读取原存档，请检查浏览器本地存储权限"; }
  } else if (action.type === "import-text") {
    applyImport(action.text);
  } else if (action.type === "import-file") {
    applyImport(await action.file.text());
  } else if (action.type === "reset") {
    if (!window.confirm("清空本地存档并重新开始？")) return;
    if (store) {
      try {
        const original = store.getItem(STORAGE_KEY);
        if (original) preserveSave(store, original);
        clearSave(store);
      } catch { status = "备份失败，未清空原存档。请先导出原件并释放浏览器空间"; render(); return; }
    }
    saveBlocked = false;
    state = createInitialState();
    catchup = null;
    banner = null;
    notice = null;
    status = "已重置";
    view.setTransferText("");
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

function applyImport(json: string): void {
  try {
    const file = importSave(json);
    const restored = deserializeState(file.state);
    // Back up current in-memory progress, not a stale autosave.
    if (store) {
      const original = saveBlocked ? store.getItem(STORAGE_KEY) : exportSave(state);
      if (original) preserveSave(store, original);
    }
    state = restored;
    saveBlocked = false;
    catchup = null;
    banner = null;
    notice = null;
    status = "已导入存档";
    persist("已导入并存入本地");
    view.setTransferText(exportSave(state, file.savedAt));
  } catch (error) {
    // The current game is untouched: importSave throws before anything is replaced.
    status = `导入失败，当前进度未改动：${error instanceof Error ? error.message : "未知错误"}`;
  }
}

function persist(nextStatus?: string): void {
  if (saveBlocked) {
    if (nextStatus) status = "原存档保护中，未写入。请在存档页导出原件或当前临时游戏";
    return;
  }
  if (!store) {
    if (nextStatus) status = "无法写入本地存储";
    return;
  }
  try {
    writeSave(store, state);
    if (nextStatus) status = nextStatus;
  } catch {
    status = "写入本地存储失败";
  }
}

function download(json: string, filename = "infinity-save.json"): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function localStorageSafe(): KeyValueStore | null {
  try {
    // Read access still enables recovery when writes fail due to quota.
    const storage = window.localStorage;
    storage.getItem(STORAGE_KEY);
    return storage;
  } catch {
    return null;
  }
}
