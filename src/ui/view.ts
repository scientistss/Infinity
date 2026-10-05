import { isProducerId, OFFLINE_CAP_LABEL, PRESTIGE_SCORE_UNIT, PRODUCERS, RESOURCES } from "../game/content";
import type { ProducerId } from "../game/types";
import type { ViewModel } from "./present";

export type UiAction =
  | { type: "scrape" }
  | { type: "buy"; id: ProducerId; mode: "one" | "max" }
  | { type: "prestige" }
  | { type: "save" }
  | { type: "export" }
  | { type: "import-text"; text: string }
  | { type: "import-file"; file: File }
  | { type: "reset" };

export interface GameView {
  update(model: ViewModel): void;
  setTransferText(text: string): void;
}

export function mountView(root: HTMLElement, onAction: (action: UiAction) => void): GameView {
  root.innerHTML = shellMarkup();

  const transfer = requiredTextArea(root, "transfer");
  const fileInput = requiredInput(root, "import-file");

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    const action = button.dataset.action;
    if (action === "scrape") onAction({ type: "scrape" });
    if (action === "prestige") onAction({ type: "prestige" });
    if (action === "save") onAction({ type: "save" });
    if (action === "export") onAction({ type: "export" });
    if (action === "import-text") onAction({ type: "import-text", text: transfer.value });
    if (action === "reset") onAction({ type: "reset" });
    if (action === "buy") {
      const id = button.dataset.id ?? "";
      const mode = button.dataset.mode === "max" ? "max" : "one";
      if (isProducerId(id)) onAction({ type: "buy", id, mode });
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) onAction({ type: "import-file", file });
  });

  return {
    update(model) {
      setText(root, "telemetry", model.telemetry);
      setText(root, "multiplier", `产量 ${model.multiplier}`);
      setText(root, "played", `累计 ${model.played}`);
      setText(root, "passive", model.passive);
      setText(root, "score", model.score);
      setText(root, "gain", model.gain);
      setText(root, "status", model.status);
      setText(root, "offline-cap", model.offlineCap);

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
    },
    setTransferText(text) {
      transfer.value = text;
    },
  };
}

function shellMarkup(): string {
  const resources = RESOURCES.map(
    (resource) => `
      <article class="resource resource-${resource.id}">
        <header>
          <h2>${resource.name}</h2>
          <span>${resource.nameEn}</span>
        </header>
        <p class="amount" data-bind="amount-${resource.id}">0.00</p>
        <p class="rate" data-bind="rate-${resource.id}">+0.00/s</p>
        <p class="blurb">${resource.blurb}</p>
      </article>`,
  ).join("");

  const producers = PRODUCERS.map((producer, index) => {
    const idx = String(index + 1).padStart(2, "0");
    return `
      <article class="facility">
        <div class="facility-head">
          <div>
            <h3><span class="idx">${idx}</span> ${producer.name} <small>${producer.nameEn}</small></h3>
            <p>${producer.description}</p>
          </div>
          <div class="owned">
            <span>拥有</span>
            <strong data-bind="owned-${producer.id}">0</strong>
          </div>
        </div>
        <p class="rates" data-bind="rates-${producer.id}"></p>
        <div class="facility-buy">
          <p class="cost" data-bind="cost-${producer.id}"></p>
          <div class="actions">
            <button type="button" data-action="buy" data-mode="one" data-id="${producer.id}" data-bind="buy-one-${producer.id}">购买 1</button>
            <button type="button" data-action="buy" data-mode="max" data-id="${producer.id}" data-bind="buy-max-${producer.id}">最大购买</button>
          </div>
        </div>
      </article>`;
  }).join("");

  return `
    <div class="sky" aria-hidden="true"></div>
    <svg class="horizon" viewBox="0 0 960 88" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 58 C 140 18 250 22 380 46 C 520 72 640 20 780 40 C 860 50 920 48 960 42 V 88 H 0 Z" fill="#2c241c"/>
      <path d="M0 68 C 180 46 320 70 520 58 C 700 48 820 66 960 60 V 88 H 0 Z" fill="#1a1612"/>
      <circle cx="742" cy="26" r="16" fill="#f0c27a"/>
      <circle cx="742" cy="26" r="22" fill="rgba(240,194,122,0.18)"/>
    </svg>
    <main class="wrap">
      <header class="mast">
        <div>
          <p class="kicker">Planet surface · v0.1</p>
          <h1>Infinity <span>无限</span></h1>
          <p class="lede">行星地表的第一座前哨。资源会自己增长，设施可以买到最大数量。</p>
        </div>
        <aside class="mast-stat">
          <span>遥测 Telemetry</span>
          <strong data-bind="telemetry">0</strong>
          <span data-bind="multiplier">产量 ×1.00</span>
          <span data-bind="played">累计 0 秒</span>
        </aside>
      </header>

      <p class="banner" data-bind="banner" role="status" hidden></p>

      <section class="panel" aria-labelledby="stock-title">
        <div class="panel-head">
          <h2 id="stock-title">库存</h2>
          <p data-bind="passive">风化拾取</p>
          <button type="button" data-action="scrape">徒手刮取 +1</button>
        </div>
        <div class="resources">${resources}</div>
      </section>

      <section class="panel" aria-labelledby="facility-title">
        <div class="panel-head">
          <h2 id="facility-title">地表设施</h2>
          <p>价格按几何级数上涨。最大购买会在付得起的范围内一次买满。</p>
        </div>
        <div class="facilities">${producers}</div>
      </section>

      <section class="panel prestige" aria-labelledby="prestige-title">
        <div class="panel-head">
          <h2 id="prestige-title">轨道上行</h2>
          <p>占位声望层。获得量 = ⌊√(扩张分 / ${PRESTIGE_SCORE_UNIT})⌋。上行清空地表库存、设施和本轮累计，只保留遥测。产量倍率 = 1 + √遥测。</p>
        </div>
        <dl class="prestige-stats">
          <div>
            <dt>本轮扩张分</dt>
            <dd data-bind="score">0.00</dd>
          </div>
          <div>
            <dt>预计遥测</dt>
            <dd data-bind="gain">0</dd>
          </div>
        </dl>
        <button type="button" data-action="prestige" data-bind="action-prestige" disabled>执行轨道上行</button>
      </section>

      <section class="panel" aria-labelledby="save-title">
        <div class="panel-head">
          <h2 id="save-title">存档</h2>
          <p>自动写入 localStorage。导出的 JSON 形如 { version, savedAt, state }。离线进度最多结算 <strong data-bind="offline-cap">${OFFLINE_CAP_LABEL}</strong>。</p>
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
