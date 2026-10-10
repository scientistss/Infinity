import { SAVE_REVISION, SAVE_SCHEMA, SAVE_VERSION } from "../game/content";
import type { CancelPaidJobRequest, OrderAction, OrderKind } from "../game/order-state";
import type { QueueView } from "./present";
import { mountView as mountSurfaceView, type GameView, type UiAction as SurfaceAction } from "./view";

export type UiAction = SurfaceAction | OrderAction | { type: "select-planet"; id: string };

/** Add only the P4 world switcher. The original view, CSS and artwork remain unchanged. */
export function mountView(root: HTMLElement, onAction: (action: UiAction) => void): GameView & { invalidateOrderAuthority(): void } {
  const surface = mountSurfaceView(root, onAction);
  // Bind only the identity in the exact displayed snapshot. Never infer an index
  // from current state; even invalid or forged legacy buttons are swallowed.
  let paidButtons = new WeakMap<HTMLButtonElement, CancelPaidJobRequest>();
  root.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action="cancel-queue"],button[data-action="cancel-research"],button[data-action="cancel-units"]') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const ref = paidButtons.get(button);
    if (!button.disabled && ref && button.dataset.paidKind === ref.kind && button.dataset.paidPlanet === ref.planetId && button.dataset.paidJob === String(ref.jobId)) {
      onAction({type: "cancel-paid-job", request: {...ref}});
    }
  }, true);
  const queueNodes = new Map<string, Map<string, HTMLElement>>();
  function reconcileQueue(prefix: string, suffixes: readonly string[], kind: OrderKind, queue: QueueView) {
    for (const suffix of suffixes) {
      const bind = `${prefix}-list${suffix}`;
      const list = root.querySelector<HTMLElement>(`[data-bind="${bind}"]`);
      if (!list) continue;
      const old = queueNodes.get(bind) ?? new Map<string, HTMLElement>();
      const next = new Map<string, HTMLElement>();
      const rendered = [...list.querySelectorAll<HTMLElement>(".queue-item")];
      queue.items.forEach((item,index) => {
        const fresh = rendered[index];
        if (!fresh) return;
        const row = old.get(item.key) ?? fresh;
        if (row !== fresh) {
          // Retain the logical job's original nodes through unrelated queue edits.
          // Copy rendered properties without replacing its controls or text nodes.
          row.className = fresh.className;
          for (const key of ["label","detail","halve","finish"] as const) {
            const from = fresh.querySelector<HTMLElement>(`[data-q="${key}"]`);
            const to = row.querySelector<HTMLElement>(`[data-q="${key}"]`);
            if (!from || !to) continue;
            if (to.textContent !== from.textContent) to.textContent = from.textContent;
            to.title = from.title;
            if (from instanceof HTMLButtonElement && to instanceof HTMLButtonElement) to.disabled = from.disabled;
          }
          const fill = row.querySelector<HTMLElement>('[data-q="fill"]');
          const newFill = fresh.querySelector<HTMLElement>('[data-q="fill"]');
          if (fill && newFill) fill.style.width = newFill.style.width;
          const dm = row.querySelector<HTMLElement>('[data-q="dm"]');
          const newDm = fresh.querySelector<HTMLElement>('[data-q="dm"]');
          if (dm && newDm) dm.hidden = newDm.hidden;
          fresh.replaceWith(row);
        }
        row.classList.toggle("active",item.active);
        row.dataset.paidKey = item.key;
        const button = row.querySelector<HTMLButtonElement>(".queue-cancel");
        if (button) {
          button.dataset.index = String(item.index);
          button.dataset.paidKind = kind;
          button.dataset.paidPlanet = item.planetId;
          button.dataset.paidJob = String(item.jobId);
          if (Number.isSafeInteger(item.jobId) && item.jobId > 0 && item.planetId) paidButtons.set(button,{kind,planetId:item.planetId,jobId:item.jobId});
          else paidButtons.delete(button);
        }
        next.set(item.key,row);
      });
      queueNodes.set(bind,next);
    }
  }
  const strip = root.querySelector(".res-strip");
  if (!strip) throw new Error("缺少原版资源栏");
  const label = document.createElement("label");
  label.className = "chip";
  label.dataset.bind = "planet-selector";
  label.append("当前星球 ");
  label.hidden = true;
  const select = document.createElement("select");
  select.id = "planet-select";
  select.setAttribute("aria-label", "切换星球");
  label.append(select);
  const toolbar = document.createElement("div");
  toolbar.className = "res-strip";
  toolbar.hidden = true;
  toolbar.append(label);
  strip.before(toolbar);
  select.addEventListener("change", () => onAction({ type: "select-planet", id: select.value }));

  const saveNote = root.querySelector('[data-tab-panel="save"] p');
  if (saveNote) {
    saveNote.replaceChildren(document.createTextNode(
      `原版 P4 开发存档使用独立位置，不读取或覆盖线上版本。接受 schema=${SAVE_SCHEMA} 的 v${SAVE_VERSION} / r${SAVE_REVISION} 存档；有效 r2–r${SAVE_REVISION - 1} 先备份后升级，仅 r2 / r3 的旧自动跑灯授权不会沿用。v8 和其他分支格式不会导入。读取失败时保留原件并暂停保存，可用“导出”取回。离线进度最多结算 `,
    ));
    const cap = document.createElement("strong");
    cap.dataset.bind = "offline-cap";
    saveNote.append(cap, "。");
  }
  // Preserve table content and desktop style; narrow screens may scroll instead of clipping numbers.
  for (const table of root.querySelectorAll<HTMLTableElement>(".ov-table")) {
    const scroll = document.createElement("div");
    scroll.style.overflowX = "auto";
    scroll.style.maxWidth = "100%";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "数据表，可横向滚动查看全部数值");
    table.before(scroll);
    scroll.append(table);
  }
  let signature = "";
  return {
    ...surface,
    invalidateOrderAuthority() {
      // An adopted save is a new ID namespace, even when every numeric ID and
      // planet name happens to match. Retire all prior rendered capabilities.
      paidButtons = new WeakMap<HTMLButtonElement, CancelPaidJobRequest>();
      queueNodes.clear();
      for (const list of root.querySelectorAll<HTMLElement>(".queue-list")) {
        delete list.dataset.sig;
        list.replaceChildren();
      }
    },
    update(model) {
      toolbar.hidden = model.planets.length <= 1;
      label.hidden = toolbar.hidden;
      const nextSignature = JSON.stringify(model.planets);
      if (signature !== nextSignature) {
        signature = nextSignature;
        select.replaceChildren(...model.planets.map(p => {
          const option = document.createElement("option");
          option.value = p.id;
          option.textContent = p.name;
          return option;
        }));
      }
      if (select.value !== model.activePlanetId) select.value = model.activePlanetId;
      const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
      surface.update(model);
      reconcileQueue("queue", ["", "-ov"], "building", model.queue);
      reconcileQueue("rqueue", ["", "-ov"], "research", model.research.queue);
      reconcileQueue("squeue", ["", "-def", "-ov"], "shipyard", model.shipyard.queue);
      if (focused?.isConnected && document.activeElement !== focused && focused.closest(".queue-item")) focused.focus({preventScroll:true});
    },
  };
}
