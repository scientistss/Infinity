import { OFFLINE_CAP_LABEL, OFFLINE_CAP_SECONDS } from "./game/content";
import { formatDuration } from "./game/format";
import { buy, prestige, scrape, tick } from "./game/logic";
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

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("Missing #app");

const store = localStorageSafe();
const loaded = store ? loadGame(store) : { state: createInitialState(), appliedSeconds: 0, rawSeconds: 0, capped: false };

let state: GameState = loaded.state;
let status = store ? "已读取本地存档" : "本地存储不可用，本局不会保存";
let banner: string | null = offlineBanner(loaded.appliedSeconds, loaded.capped);

const view = mountView(app, (action) => {
  void handleAction(action);
});
view.update(present(state, status, banner));

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
    const applied = Math.min(gap, OFFLINE_CAP_SECONDS);
    state = tick(state, applied);
    banner = offlineBanner(applied, gap > OFFLINE_CAP_SECONDS);
    persist("已追赶后台进度");
  } else if (gap > 0) {
    state = tick(state, gap);
  }
  view.update(present(state, status, banner));
  window.requestAnimationFrame(frame);
}

async function handleAction(action: UiAction): Promise<void> {
  if (action.type === "scrape") {
    state = scrape(state);
    status = "刮到 1 金属";
  } else if (action.type === "buy") {
    const before = state.producers[action.id];
    state = buy(state, action.id, action.mode);
    const gained = state.producers[action.id].sub(before);
    status = gained.gte(1) ? `已购买 ${gained.toFixed(0)} 台` : "资源不足";
    if (gained.gte(1)) persist();
  } else if (action.type === "prestige") {
    if (!window.confirm("轨道上行会重置地表库存和设施，只保留遥测。继续？")) return;
    const next = prestige(state);
    if (next === state) {
      status = "扩张分还不够上行";
      return;
    }
    state = next;
    status = "已完成轨道上行";
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
    banner = null;
    status = "已重置";
    view.setTransferText("");
  }
  view.update(present(state, status, banner));
}

function applyImport(json: string): void {
  try {
    const file = importSave(json);
    state = deserializeState(file.state);
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

function offlineBanner(appliedSeconds: number, capped: boolean): string | null {
  if (appliedSeconds < 1) return null;
  const extra = capped ? "超出上限的部分已丢弃。" : "";
  return `已结算离线进度 ${formatDuration(appliedSeconds)}（上限 ${OFFLINE_CAP_LABEL}）。${extra}`;
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
