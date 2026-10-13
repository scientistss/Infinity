import { activePlanet } from "../game/empire";
import type { GameState } from "../game/types";
import type { RecyclePreview } from "./recycle-preview-model";

/** Static structure only. Draft and world text is patched with textContent. */
export function recyclePreviewHtml(): string {
  return `<div id="recycle-preview" class="recycle-preview muted" hidden>
    <p data-recycle="summary"></p>
    <details data-recycle="details"><summary>回收估算详情</summary>
      <p data-recycle="target"></p><p data-recycle="field"></p>
      <p data-recycle="capacity"></p><p data-recycle="room"></p>
      <p data-recycle="leftovers"></p><p data-recycle="notice"></p>
    </details>
    <p data-recycle="protection" hidden></p>
  </div>`;
}

/** Read-only disclosure. No quote, dispatch, draft editing or retained forecast. */
export function installRecyclePreviewPanel(root: HTMLElement) {
  function node<T extends HTMLElement = HTMLElement>(selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw Error(`缺少回收预览节点 ${selector}`);
    return found;
  }
  const fleet = node("#space-fleet"), panel = node("#recycle-preview");
  const mission = node<HTMLSelectElement>("#flight-mission");
  const details = node<HTMLDetailsElement>('[data-recycle="details"]');
  const fields = Object.fromEntries(["summary", "target", "field", "capacity", "room", "leftovers", "notice", "protection"]
    .map(key => [key, node(`[data-recycle="${key}"]`)]));
  const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-ship],#flight-mission,#flight-speed,#flight-galaxy,#flight-system,#flight-position,#cargo-metal,#cargo-crystal,#cargo-deuterium")];
  let universe: GameState["universe"] | null = null, origin = "", observed = false, writable = false, protection = "";
  let draft = "";
  const signature = () => JSON.stringify(inputs.map(input => input.value));
  const text = (key: string, value: string) => { if (fields[key]!.textContent !== value) fields[key]!.textContent = value; };
  const hidden = (node: HTMLElement, value: boolean) => { if (node.hidden !== value) node.hidden = value; };
  const visible = () => root.isConnected && !fleet.hidden && !document.hidden && mission.value === "recycle";
  function clear(close: boolean) {
    for (const key of Object.keys(fields)) text(key, "");
    hidden(fields.protection!, true);
    hidden(panel, true);
    if (close && details.open) details.open = false;
  }
  function pending(close = false) {
    if (!visible()) { clear(true); return; }
    for (const key of ["target", "field", "capacity", "room", "leftovers", "notice"]) text(key, "");
    hidden(panel, false);
    hidden(details, true);
    const protectedState = observed && !writable;
    hidden(fields.protection!, !protectedState);
    text("summary", protectedState ? "存档保护中：回收预览不可用（冻结进度）。" : "回收预览待更新。");
    text("protection", protectedState ? protection || "存档受保护；此预览不提供派遣许可。" : "");
    if (close && details.open) details.open = false;
  }
  function syncVisibility() {
    if (!visible()) clear(true);
    else if (observed && !writable) pending();
  }
  function edited() {
    const next = signature();
    if (next === draft) { syncVisibility(); return; }
    draft = next;
    pending(mission.value !== "recycle");
  }
  for (const type of ["input", "change"]) root.addEventListener(type, event => {
    if (inputs.includes(event.target as HTMLInputElement | HTMLSelectElement)) edited();
  });
  document.addEventListener("visibilitychange", syncVisibility);
  draft = signature();
  clear(true);
  return {
    edited, syncVisibility,
    invalidate() { pending(true); },
    observe(state: GameState, ready: boolean, reason: string) {
      const nextOrigin = activePlanet(state).id;
      const changed = observed && (universe !== state.universe || origin !== nextOrigin || writable !== ready);
      universe = state.universe; origin = nextOrigin; writable = ready; protection = reason; observed = true;
      if (changed) pending(true);
      else syncVisibility();
    },
    update(model: RecyclePreview | null) {
      if (!visible() || !model) { clear(true); return; }
      if (!observed || !writable) { pending(); return; }
      hidden(panel, false); hidden(details, false); hidden(fields.protection!, true);
      text("protection", "");
      text("summary", model.summary);
      text("target", `目标 [${model.target}]`);
      text("field", model.visibleDebris ? `当前可见残骸：金属 ${model.visibleDebris.metal} · 晶体 ${model.visibleDebris.crystal}` : "当前可见残骸：无可用数据");
      const amounts = model.amounts;
      text("capacity", amounts ? `总货舱 ${amounts.capacity} · 回收船上限 ${amounts.collector}` : "");
      text("room", amounts ? `现有货物占用 ${amounts.used} · 剩余可回收货舱 ${amounts.room}（受回收船上限约束）` : "");
      text("leftovers", amounts ? `按当前残骸计算的剩余：金属 ${amounts.leftMetal} · 晶体 ${amounts.leftCrystal}` : "");
      text("notice", model.notice);
    },
  };
}
