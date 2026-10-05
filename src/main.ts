import { catchUp, emptyCatchup, type OfflineCatchup } from "./core/offline";
import { unlockBanner } from "./data/achievements";
import { buy, prestige, scrape, tick } from "./game/logic";
import { curvatureById } from "./data/curvature-tech";
import { buyCurvature, manualClickAmount } from "./prestige/tree";
import { clearSlot, equipCard, equipFirstEmpty, moveSlot, patchSlot, toggleSlot } from "./automation/engine";
import {
  clearSave,
  deserializeState,
  exportSave,
  importSave,
  loadGame,
  writeSave,
  type KeyValueStore,
} from "./game/save";
import { createInitialState } from "./game/state";
import type { GameState } from "./game/types";
import { present } from "./ui/present";
import { mountView, type UiAction } from "./ui/view";
import "./style.css";

const AUTOSAVE_MS = 15_000;
const BACKGROUND_NOTICE_SECONDS = 5;
const OFFLINE_MODAL_SECONDS = 30;

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("Missing #app");

const store = localStorageSafe();
let loaded: OfflineCatchup = emptyCatchup(createInitialState());
let status = store ? "已读取本地存档" : "本地存储不可用，本局不会保存";
if (store) {
  try {
    loaded = loadGame(store);
  } catch {
    loaded = emptyCatchup(createInitialState());
    status = "存档无法读取，已重新开始";
  }
}

let state: GameState = loaded.state;
let catchup: OfflineCatchup | null = loaded.appliedSeconds >= BACKGROUND_NOTICE_SECONDS ? loaded : null;
let banner: string | null = unlockBanner(loaded.newAchievementIds);

const view = mountView(app, (action) => {
  void handleAction(action);
});
view.update(present(state, status, banner, catchup));

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
  view.update(present(state, status, banner, catchup));
  window.requestAnimationFrame(frame);
}

async function handleAction(action: UiAction): Promise<void> {
  const before = state.unlocked;
  if (action.type === "dismiss-offline") {
    catchup = null;
  } else if (action.type === "scrape") {
    const mined = manualClickAmount(state);
    state = scrape(state);
    status = `采集 +${mined} 金属`;
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
  } else if (action.type === "buy") {
    const before = state.producers[action.id];
    state = buy(state, action.id, action.mode === "max" ? "max" : 1);
    const gained = state.producers[action.id].sub(before);
    status = gained.gte(1) ? `已购买 ${gained.toFixed(0)} 台` : "资源不足";
    if (gained.gte(1)) persist();
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
    if (!window.confirm("发射殖民舰会重置资源与设施，保留曲率核心、曲率科技、成就和协议卡。继续？")) return;
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
  } else if (action.type === "import-text") {
    applyImport(action.text);
  } else if (action.type === "import-file") {
    applyImport(await action.file.text());
  } else if (action.type === "reset") {
    if (!window.confirm("清空本地存档并重新开始？")) return;
    if (store) clearSave(store);
    state = createInitialState();
    catchup = null;
    banner = null;
    status = "已重置";
    view.setTransferText("");
  }
  if (action.type === "scrape" || action.type === "buy" || action.type === "prestige") {
    const note = unlockBanner(state.unlocked.filter((id) => !before.includes(id)));
    if (note) banner = note;
  }
  view.update(present(state, status, banner, catchup));
}

function applyImport(json: string): void {
  try {
    const file = importSave(json);
    state = deserializeState(file.state);
    catchup = null;
    banner = null;
    status = "已导入存档";
    persist("已导入并存入本地");
    view.setTransferText(exportSave(state, file.savedAt));
  } catch (error) {
    status = error instanceof Error ? error.message : "导入失败";
  }
}

function persist(nextStatus?: string): void {
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
    const probe = "__infinity_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
