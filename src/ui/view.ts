import { ACHIEVEMENTS } from "../data/achievements";
import { CURVATURE_TECH, isCurvatureId } from "../data/curvature-tech";
import { CARD_CATALOG } from "../data/protocol-cards";
import { isProducerId, PRESTIGE_SCORE_UNIT, PRODUCERS, RESOURCES } from "../game/content";
import { PROTOCOL_SLOT_COUNT, type CurvatureId, type ProducerId } from "../game/types";
import type { ViewModel } from "./present";

export type UiAction =
  | { type: "scrape" }
  | { type: "buy"; id: ProducerId; mode: "one" | "max" }
  | { type: "prestige" }
  | { type: "save" }
  | { type: "export" }
  | { type: "import-text"; text: string }
  | { type: "import-file"; file: File }
  | { type: "reset" }
  | { type: "dismiss-offline" }
  | { type: "buy-tech"; id: CurvatureId }
  | { type: "protocol-equip"; index: number; cardId: string }
  | { type: "protocol-palette"; cardId: string }
  | { type: "protocol-toggle"; index: number; enabled: boolean }
  | { type: "protocol-clear"; index: number }
  | { type: "protocol-move"; from: number; to: number }
  | { type: "protocol-param"; index: number; path: string; value: string };

export interface GameView {
  update(model: ViewModel): void;
  setTransferText(text: string): void;
}

export function mountView(root: HTMLElement, onAction: (action: UiAction) => void): GameView {
  root.innerHTML = shellMarkup();
  selectTab(root, readSavedTab());

  const transfer = requiredTextArea(root, "transfer");
  const fileInput = requiredInput(root, "import-file");

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    if (button.dataset.tab) {
      selectTab(root, button.dataset.tab);
      return;
    }
    const action = button.dataset.action;
    if (action === "scrape") onAction({ type: "scrape" });
    if (action === "prestige") onAction({ type: "prestige" });
    if (action === "save") onAction({ type: "save" });
    if (action === "export") onAction({ type: "export" });
    if (action === "import-text") onAction({ type: "import-text", text: transfer.value });
    if (action === "reset") onAction({ type: "reset" });
    if (action === "dismiss-offline") onAction({ type: "dismiss-offline" });
    if (action === "buy-tech") {
      const id = button.dataset.id ?? "";
      if (isCurvatureId(id)) onAction({ type: "buy-tech", id });
    }
    if (action === "buy") {
      const id = button.dataset.id ?? "";
      const mode = button.dataset.mode === "max" ? "max" : "one";
      if (isProducerId(id)) onAction({ type: "buy", id, mode });
    }
    if (action === "equip-card") {
      const cardId = button.dataset.card ?? "";
      if (cardId) onAction({ type: "protocol-palette", cardId });
    }
    if (action === "slot-clear") {
      const index = Number(button.dataset.index);
      if (Number.isInteger(index)) onAction({ type: "protocol-clear", index });
    }
    if (action === "slot-move") {
      const index = Number(button.dataset.index);
      const dir = button.dataset.dir === "-1" ? -1 : 1;
      if (Number.isInteger(index)) onAction({ type: "protocol-move", from: index, to: index + dir });
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) onAction({ type: "import-file", file });
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const slot = target.closest("[data-slot]");
    if (!(slot instanceof HTMLElement)) return;
    const index = Number(slot.dataset.slot);
    if (!Number.isInteger(index)) return;
    if (target instanceof HTMLInputElement && target.dataset.field === "enabled") {
      onAction({ type: "protocol-toggle", index, enabled: target.checked });
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.path) {
      onAction({ type: "protocol-param", index, path: target.dataset.path, value: target.value });
    }
  });

  root.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !event.dataTransfer) return;
    const card = target.closest("[data-card]");
    if (card instanceof HTMLElement && card.dataset.card) {
      event.dataTransfer.setData("text/plain", `card:${card.dataset.card}`);
      event.dataTransfer.effectAllowed = "copy";
      return;
    }
    const handle = target.closest("[data-slot-drag]");
    if (handle instanceof HTMLElement && handle.dataset.slotDrag) {
      event.dataTransfer.setData("text/plain", `slot:${handle.dataset.slotDrag}`);
      event.dataTransfer.effectAllowed = "move";
    }
  });

  root.addEventListener("dragover", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("[data-slot]")) event.preventDefault();
  });

  root.addEventListener("drop", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !event.dataTransfer) return;
    const slot = target.closest("[data-slot]");
    if (!(slot instanceof HTMLElement)) return;
    event.preventDefault();
    const index = Number(slot.dataset.slot);
    if (!Number.isInteger(index)) return;
    const text = event.dataTransfer.getData("text/plain");
    if (text.startsWith("card:")) onAction({ type: "protocol-equip", index, cardId: text.slice(5) });
    if (text.startsWith("slot:")) {
      const from = Number(text.slice(5));
      if (Number.isInteger(from)) onAction({ type: "protocol-move", from, to: index });
    }
  });

  return {
    update(model) {
      setText(root, "telemetry", model.telemetry);
      setText(root, "multiplier", `产量 ${model.multiplier}`);
      setText(root, "played", `累计 ${model.played}`);
      setText(root, "passive", model.passive);
      setText(root, "score", model.score);
      setText(root, "gain", model.gain);
      setText(root, "gain-detail", model.gain);
      setText(root, "energy-top", model.protocolEnergy);
      setText(root, "status", model.status);
      setText(root, "offline-cap", model.offlineCap);
      setText(root, "ach-summary", model.achievementSummary);
      setText(root, "unspent-line", model.unspentLine);
      setText(root, "action-scrape", model.scrapeLabel);

      for (const tech of model.techs) {
        setText(root, `tech-owned-${tech.id}`, tech.owned);
        setText(root, `tech-detail-${tech.id}`, tech.detail);
        setText(root, `tech-preview-${tech.id}`, tech.preview);
        const buy = requiredButton(root, `tech-buy-${tech.id}`);
        buy.disabled = !tech.canBuy;
        buy.textContent = tech.button;
      }

      for (const achievement of model.achievements) {
        setText(root, `ach-progress-${achievement.id}`, achievement.progress);
        requiredElement(root, `ach-${achievement.id}`).classList.toggle("unlocked", achievement.unlocked);
      }

      const modal = requiredElement(root, "offline-modal");
      modal.hidden = model.offline === null;
      if (model.offline) {
        setText(root, "offline-applied", model.offline.applied);
        setText(root, "offline-detail", model.offline.detail);
        setText(root, "offline-protocol", model.offline.protocol);
        const gains = requiredElement(root, "offline-gains");
        const signature = model.offline.gains.map((gain) => `${gain.id}:${gain.amount}`).join("|");
        if (gains.dataset.sig !== signature) {
          gains.dataset.sig = signature;
          gains.replaceChildren();
          for (const gain of model.offline.gains) {
            const item = document.createElement("li");
            item.textContent = `${gain.name} ${gain.amount}`;
            gains.append(item);
          }
        }
      }

      const banner = requiredElement(root, "banner");
      banner.hidden = model.banner === null;
      banner.textContent = model.banner ?? "";

      for (const resource of model.resources) {
        setText(root, `amount-${resource.id}`, resource.amount);
        setText(root, `rate-${resource.id}`, resource.rate);
      }

      const prestige = requiredButton(root, "action-prestige");
      prestige.disabled = !model.canPrestige;

      for (const producer of model.producers) {
        setText(root, `owned-${producer.id}`, producer.owned);
        setText(root, `rates-${producer.id}`, producer.rates);
        setText(root, `cost-${producer.id}`, producer.cost);
        const one = requiredButton(root, `buy-one-${producer.id}`);
        const max = requiredButton(root, `buy-max-${producer.id}`);
        one.disabled = !producer.canBuyOne;
        max.disabled = !producer.canBuyMax;
        max.textContent = producer.maxLabel;
      }

      setText(root, "protocol-energy", model.protocolEnergy);
      setText(root, "protocol-meta", model.protocolMeta);
      for (const card of model.catalog) {
        const button = requiredButton(root, `catalog-${card.id}`);
        button.disabled = !card.unlocked;
        button.draggable = card.unlocked;
        button.title = card.hint;
      }
      for (const slot of model.slots) {
        const locked = requiredElement(root, `slot-lock-${slot.index}`);
        const controls = requiredElement(root, `slot-controls-${slot.index}`);
        locked.hidden = slot.unlocked;
        controls.hidden = !slot.unlocked;
        locked.textContent = slot.lockHint;
        setText(root, `slot-sentence-${slot.index}`, slot.sentence);
        const lamp = requiredElement(root, `lamp-${slot.index}`);
        lamp.className = `lamp lamp-${slot.lamp}`;
        lamp.title = slot.reason;
        if (!slot.unlocked) continue;
        const enabled = requiredInput(root, `slot-enabled-${slot.index}`);
        enabled.disabled = slot.sentence === "";
        enabled.checked = slot.enabled;
        const params = requiredElement(root, `slot-params-${slot.index}`);
        if (params.dataset.key !== slot.fieldsKey && !params.contains(document.activeElement)) {
          params.dataset.key = slot.fieldsKey;
          params.innerHTML = slot.fields
            .map(
              (field) =>
                `<label class="param">${field.label}<select data-path="${field.path}">${field.options
                  .map((option) => `<option value="${option.value}">${option.label}</option>`)
                  .join("")}</select></label>`,
            )
            .join("");
        }
        for (const field of slot.fields) {
          const select = params.querySelector(`select[data-path="${field.path}"]`);
          if (select instanceof HTMLSelectElement && select.value !== field.value) select.value = field.value;
        }
      }
    },
    setTransferText(text) {
      transfer.value = text;
    },
  };
}

const ICON_BASE = `${import.meta.env.BASE_URL}icons/`;
const TAB_KEY = "infinity.ui.tab";
const TABS = [
  { id: "facilities", label: "设施", icon: "robotics_factory" },
  { id: "protocol", label: "协议卡", icon: "protocol_card" },
  { id: "curvature", label: "曲率", icon: "warp_core" },
  { id: "achievements", label: "成就", icon: "achievement" },
  { id: "save", label: "存档", icon: "save" },
] as const;

/** Single-color glyph drawn with a CSS mask so it inherits the surrounding accent color. */
function icon(name: string, extra = ""): string {
  return `<span class="icon icon-${name}${extra ? ` ${extra}` : ""}" style="--icon:url('${ICON_BASE}${name}.svg')" aria-hidden="true"></span>`;
}

function readSavedTab(): string {
  try {
    return localStorage.getItem(TAB_KEY) ?? TABS[0].id;
  } catch {
    return TABS[0].id;
  }
}

function selectTab(root: ParentNode, id: string): void {
  const tab = TABS.some((entry) => entry.id === id) ? id : TABS[0].id;
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of root.querySelectorAll<HTMLElement>("[data-tab-panel]")) {
    panel.hidden = panel.dataset.tabPanel !== tab;
  }
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Storage can be unavailable (private mode); the tab still switches.
  }
}

function shellMarkup(): string {
  const [mainResource, ...otherResources] = RESOURCES;
  const chips = otherResources
    .map(
      (resource) => `
        <div class="chip chip-${resource.id}" title="${resource.blurb}">
          ${icon(resource.id)}
          <span class="chip-name">${resource.name}</span>
          <strong data-bind="amount-${resource.id}">0.00</strong>
          <span class="chip-rate" data-bind="rate-${resource.id}">+0.00/s</span>
        </div>`,
    )
    .join("");

  const tabs = TABS.map(
    (tab) =>
      `<button type="button" class="tab" role="tab" data-tab="${tab.id}" aria-selected="false">${icon(tab.icon)}<span>${tab.label}</span></button>`,
  ).join("");

  const achievements = ACHIEVEMENTS.map(
    (achievement) => `
      <li class="ach" data-bind="ach-${achievement.id}" title="${achievement.detail}">
        ${icon("achievement", "ach-icon")}
        <strong>${achievement.name}</strong>
        <p>${achievement.detail}</p>
        <span class="ach-progress" data-bind="ach-progress-${achievement.id}">0 / 1</span>
      </li>`,
  ).join("");

  const producers = PRODUCERS.map((producer, index) => {
    const idx = String(index + 1).padStart(2, "0");
    return `
      <article class="dim-row">
        <div class="dim-name">
          ${icon(producer.id, "icon-row")}
          <div>
            <h3><span class="idx">${idx}</span>${producer.name} <small>${producer.nameEn}</small></h3>
            <p class="dim-desc">${producer.description}</p>
            <p class="rates" data-bind="rates-${producer.id}"></p>
          </div>
        </div>
        <div class="dim-owned">
          <span>拥有</span>
          <strong data-bind="owned-${producer.id}">0</strong>
        </div>
        <button type="button" class="buy-btn" data-action="buy" data-mode="one" data-id="${producer.id}" data-bind="buy-one-${producer.id}">
          <span class="buy-label">购买 1</span>
          <span class="btn-cost" data-bind="cost-${producer.id}"></span>
        </button>
        <button type="button" class="buy-btn buy-max" data-action="buy" data-mode="max" data-id="${producer.id}" data-bind="buy-max-${producer.id}">最大购买</button>
      </article>`;
  }).join("");

  return `
    <div class="modal" data-bind="offline-modal" hidden>
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="offline-title">
        <p class="kicker">Welcome back</p>
        <h2 id="offline-title">欢迎回来</h2>
        <p class="offline-applied">结算离线 <strong data-bind="offline-applied">0 秒</strong></p>
        <ul class="offline-gains" data-bind="offline-gains"></ul>
        <p data-bind="offline-detail"></p>
        <p data-bind="offline-protocol"></p>
        <button type="button" data-action="dismiss-offline">知道了</button>
      </div>
    </div>
    <header class="topbar">
      <div class="topbar-main">
        <div class="brand">
          <img class="logo" src="${import.meta.env.BASE_URL}favicon.svg" alt="" width="32" height="32" />
          <div>
            <h1>Infinity <span>无限</span></h1>
            <p class="kicker">Planet surface · v0.1</p>
          </div>
        </div>
        <div class="headline" title="${mainResource.blurb}">
          <p class="have">你拥有 ${icon(mainResource.id, "icon-head")}<strong class="big-amount" data-bind="amount-${mainResource.id}">0.00</strong> ${mainResource.name}</p>
          <p class="per-sec"><span data-bind="rate-${mainResource.id}">+0.00/s</span></p>
        </div>
        <div class="launch-box">
          <button type="button" class="btn-prestige" data-action="prestige" data-bind="action-prestige" disabled>
            ${icon("launch")}
            <span class="prestige-title">发射殖民舰</span>
            <span class="prestige-gain">+<span data-bind="gain">0</span> 曲率核心</span>
          </button>
        </div>
      </div>
      <div class="res-strip">
        ${chips}
        <div class="chip chip-energy" title="能量供需与效率">
          ${icon("energy")}
          <span class="chip-name">能量</span>
          <span class="chip-rate" data-bind="energy-top"></span>
        </div>
        <div class="chip chip-warp" title="曲率核心 Warp Core">
          ${icon("warp_core")}
          <span class="chip-name">曲率核心</span>
          <strong data-bind="telemetry">0</strong>
          <span class="chip-rate" data-bind="multiplier">产量 ×1.00</span>
          <span class="chip-rate" data-bind="played">累计 0 秒</span>
        </div>
      </div>
      <nav class="tabs" role="tablist" aria-label="主菜单">${tabs}</nav>
    </header>

    <main class="wrap">
      <p class="banner" data-bind="banner" role="status" hidden></p>

      <section class="tab-panel" data-tab-panel="facilities" aria-labelledby="facility-title">
        <div class="panel-head">
          <h2 id="facility-title">地表设施</h2>
          <p>价格按几何级数上涨。最大购买会在付得起的范围内一次买满。</p>
        </div>
        <div class="scrape-row">
          <button type="button" class="scrape-btn" data-action="scrape" data-bind="action-scrape">手动采集 +1</button>
          <span class="muted" data-bind="passive">风化拾取</span>
        </div>
        <div class="dim-table">${producers}</div>
      </section>

      <section class="tab-panel protocol-board" data-tab-panel="protocol" aria-labelledby="protocol-title" hidden>
        <div class="panel-head">
          <h2 id="protocol-title">协议卡</h2>
          <p data-bind="protocol-meta">槽位</p>
        </div>
        <p class="lede">把协议卡放进槽位。句子是「当…若…则…」。点击卡片装入第一个空槽，或拖到指定槽位。</p>
        <p class="rates">${icon("energy")} <span data-bind="protocol-energy"></span></p>
        <div class="catalog-row">${catalogButtons()}</div>
        <div class="protocol-slots">${protocolSlots()}</div>
      </section>

      <section class="tab-panel" data-tab-panel="curvature" aria-labelledby="prestige-title" hidden>
        <div class="prestige-panel">
          <div class="panel-head">
            <h2 id="prestige-title">${icon("launch")} 发射殖民舰</h2>
            <p>获得量 = ⌊√(扩张分 / ${PRESTIGE_SCORE_UNIT})⌋。扩张分 = 金属 + 3×晶体 + 10×重氢。重置资源与设施，保留曲率核心、曲率科技、成就和协议卡。每颗未花费核心使全局产量 +2%。</p>
          </div>
          <dl class="prestige-stats">
            <div>
              <dt>本轮扩张分</dt>
              <dd data-bind="score">0.00</dd>
            </div>
            <div>
              <dt>预计核心</dt>
              <dd>${icon("warp_core")} <span data-bind="gain-detail">0</span></dd>
            </div>
          </dl>
        </div>
        <div class="panel-head">
          <h2 id="tech-title">${icon("tech")} 曲率科技</h2>
          <p data-bind="unspent-line">未花费 0 / 已花费 0 · 被动 +0%</p>
        </div>
        <p class="blurb">花费曲率核心购买永久效果。买下后该核心不再提供 +2% 被动。无需确认。</p>
        <div class="tech-grid">${techCards()}</div>
      </section>

      <section class="tab-panel" data-tab-panel="achievements" aria-labelledby="ach-title" hidden>
        <div class="panel-head">
          <h2 id="ach-title">成就</h2>
          <p data-bind="ach-summary">已解锁 0 / 10 · 全局产出 +0%</p>
        </div>
        <p class="blurb">每个已解锁成就 +1% 全局产出，互相加算，再与曲率核心和机器人工厂相乘。发射殖民舰不会清空成就。</p>
        <ul class="ach-list">${achievements}</ul>
      </section>

      <section class="tab-panel" data-tab-panel="save" aria-labelledby="save-title" hidden>
        <div class="panel-head">
          <h2 id="save-title">存档</h2>
          <p>自动写入 localStorage。导出的 JSON 形如 { version, savedAt, lastTickAt, state }。版本 1–4 会补上成就和曲率科技。离线进度最多结算 <strong data-bind="offline-cap">2 小时</strong>。</p>
        </div>
        <div class="actions">
          <button type="button" data-action="save">立即保存</button>
          <button type="button" data-action="export">导出 JSON</button>
          <label class="file-button">
            导入文件
            <input data-bind="import-file" type="file" accept="application/json,.json" />
          </label>
          <button type="button" data-action="reset" class="danger">重置</button>
        </div>
        <label class="transfer-label" for="transfer">导入文本</label>
        <textarea id="transfer" data-bind="transfer" spellcheck="false" placeholder="在此粘贴存档 JSON，或用导出填入此框"></textarea>
        <button type="button" data-action="import-text">从文本导入</button>
        <p class="status" data-bind="status" role="status">就绪</p>
      </section>
    </main>`;
}

function techCards(): string {
  return CURVATURE_TECH.map((node, index) => {
    const idx = String(index + 1).padStart(2, "0");
    return `
      <article class="tech-card">
        <div class="tech-head">
          ${icon("tech", "icon-row")}
          <h3><span class="idx">${idx}</span>${node.name} <small>${node.nameEn}</small></h3>
          <strong class="tech-owned" data-bind="tech-owned-${node.id}">未购</strong>
        </div>
        <p data-bind="tech-detail-${node.id}">${node.effect}</p>
        <p class="cost" data-bind="tech-preview-${node.id}">花费 ${node.cost} 核心</p>
        <div class="tech-buy">
          ${icon("warp_core")}
          <button type="button" class="buy-btn" data-action="buy-tech" data-id="${node.id}" data-bind="tech-buy-${node.id}">花费 ${node.cost}</button>
        </div>
      </article>`;
  }).join("");
}

function catalogButtons(): string {
  return CARD_CATALOG.map(
    (entry) =>
      `<button type="button" class="catalog-card" data-action="equip-card" data-card="${entry.id}" data-bind="catalog-${entry.id}" draggable="true">${icon(`card_${entry.id}`)}<span>${entry.labelZh}</span></button>`,
  ).join("");
}

function protocolSlots(): string {
  return Array.from({ length: PROTOCOL_SLOT_COUNT }, (_, index) => `
    <article class="protocol-slot" data-slot="${index}">
      <p class="lock" data-bind="slot-lock-${index}"></p>
      <div class="slot-controls" data-bind="slot-controls-${index}">
        <span class="lamp lamp-gray" data-bind="lamp-${index}" title="空槽位"></span>
        <span class="drag-handle" draggable="true" data-slot-drag="${index}" title="拖动排序">↕</span>
        ${icon("protocol_card")}
        <span class="idx">${String(index + 1).padStart(2, "0")}</span>
        <label class="check"><input type="checkbox" data-bind="slot-enabled-${index}" data-field="enabled" /> 启用</label>
        <button type="button" data-action="slot-move" data-index="${index}" data-dir="-1">上移</button>
        <button type="button" data-action="slot-move" data-index="${index}" data-dir="1">下移</button>
        <button type="button" data-action="slot-clear" data-index="${index}">卸下</button>
      </div>
      <div class="slot-params" data-bind="slot-params-${index}"></div>
      <p class="sentence" data-bind="slot-sentence-${index}"></p>
    </article>`).join("");
}

function requiredElement(root: ParentNode, bind: string): HTMLElement {
  const node = root.querySelector(`[data-bind="${bind}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing view node ${bind}`);
  return node;
}

function requiredButton(root: ParentNode, bind: string): HTMLButtonElement {
  const node = requiredElement(root, bind);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`Expected button ${bind}`);
  return node;
}

function requiredTextArea(root: ParentNode, bind: string): HTMLTextAreaElement {
  const node = requiredElement(root, bind);
  if (!(node instanceof HTMLTextAreaElement)) throw new Error(`Expected textarea ${bind}`);
  return node;
}

function requiredInput(root: ParentNode, bind: string): HTMLInputElement {
  const node = requiredElement(root, bind);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Expected input ${bind}`);
  return node;
}

function setText(root: ParentNode, bind: string, text: string): void {
  const node = requiredElement(root, bind);
  if (node.textContent !== text) node.textContent = text;
}
