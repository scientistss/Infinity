import { mountView as mountSurfaceView, type GameView, type UiAction as SurfaceAction } from "./view";

export type UiAction = SurfaceAction | { type: "select-planet"; id: string };

/** Add only the P4 world switcher. The original view, CSS and artwork remain unchanged. */
export function mountView(root: HTMLElement, onAction: (action: UiAction) => void): GameView {
  const surface = mountSurfaceView(root, onAction);
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
      "原版 P4 开发存档使用独立位置，不读取或覆盖线上版本。接受 schema=infinity-original-p4 的 v9 / r4 存档；有效 r2 / r3 先备份后升级，旧自动跑灯授权不会沿用。v8 和其他分支格式不会导入。读取失败时保留原件并暂停保存，可用“导出”取回。离线进度最多结算 ",
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
      surface.update(model);
    },
  };
}
