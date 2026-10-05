import { isProducerId, OFFLINE_CAP_LABEL, PROTOCOL_CARDS, PRODUCERS, RESOURCES } from "../game/content";
import type { ProducerId } from "../game/types";
import type { ViewModel } from "./present";

export type UiAction =
  | { type: "scrape" }
  | { type: "buy"; id: ProducerId; mode: "one" | "ten" | "max" }
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
      const mode = button.dataset.mode === "max" ? "max" : button.dataset.mode === "ten" ? "ten" : "one";
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
      setText(root, "warp-cores", model.warpCores);
      setText(root, "multiplier", `产量 ${model.multiplier}`);
      setText(root, "played", `累计 ${model.played}`);
      setText(root, "energy", model.energy);
      setText(root, "slots", model.slots);
      setText(root, "score", model.score);
      setText(root, "preview", model.preview);
      setText(root, "status", model.status);
      setText(root, "offline-cap", model.offlineCap);

      requiredElement(root, "energy").classList.toggle("energy-short", model.energyShort);

      const banner = requiredElement(root, "banner");
      banner.hidden = model.banner === null;
      banner.textContent = model.banner ?? "";

      for (const resource of model.resources) {
        setText(root, `amount-${resource.id}`, resource.amount);
        setText(root, `rate-${resource.id}`, resource.rate);
      }

      requiredButton(root, "action-prestige").disabled = !model.canPrestige;

      for (const producer of model.producers) {
        setText(root, `owned-${producer.id}`, producer.owned);
        setText(root, `effect-${producer.id}`, producer.effect);
        setText(root, `cost-${producer.id}`, producer.cost);
        requiredElement(root, `facility-${producer.id}`).classList.toggle("locked", !producer.unlocked);
        requiredButton(root, `buy-one-${producer.id}`).disabled = !producer.canBuyOne;
        requiredButton(root, `buy-ten-${producer.id}`).disabled = !producer.canBuyTen;
        const max = requiredButton(root, `buy-max-${producer.id}`);
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
      <article class="facility" data-bind="facility-${producer.id}">
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
        <p class="rates" data-bind="effect-${producer.id}"></p>
        <div class="facility-buy">
          <p class="cost" data-bind="cost-${producer.id}"></p>
          <div class="actions">
            <button type="button" data-action="buy" data-mode="one" data-id="${producer.id}" data-bind="buy-one-${producer.id}">×1</button>
            <button type="button" data-action="buy" data-mode="ten" data-id="${producer.id}" data-bind="buy-ten-${producer.id}">×10</button>
            <button type="button" data-action="buy" data-mode="max" data-id="${producer.id}" data-bind="buy-max-${producer.id}">最大</button>
          </div>
        </div>
      </article>`;
  }).join("");

  const cards = PROTOCOL_CARDS.map(
    (card) => `<li><strong>${card.name}</strong> · 未实装 · ${card.unlock}</li>`,
  ).join("");

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
          <p class="lede">殖民一颗荒芜行星。先手动采矿，再用矿井和电站把产出转起来。</p>
        </div>
        <aside class="mast-stat">
          <span>曲率核心 Warp Core</span>
          <strong data-bind="warp-cores">0</strong>
          <span data-bind="multiplier">产量 ×1.00</span>
          <span data-bind="played">累计 0 秒</span>
        </aside>
      </header>

      <p class="banner" data-bind="banner" role="status" hidden></p>

      <section class="panel" aria-labelledby="stock-title">
        <div class="panel-head">
          <h2 id="stock-title">库存</h2>
          <p data-bind="energy">能源</p>
          <button type="button" data-action="scrape">手动采矿 +1</button>
        </div>
        <div class="resources">${resources}</div>
      </section>

      <section class="panel" aria-labelledby="facility-title">
        <div class="panel-head">
          <h2 id="facility-title">地表生产者</h2>
          <p>成本 = 基础 × 成长^已拥有。能源不足时，矿的效率按供给/需求下降。</p>
        </div>
        <div class="facilities">${producers}</div>
      </section>

      <section class="panel" aria-labelledby="protocol-title">
        <div class="panel-head">
          <h2 id="protocol-title">协议板</h2>
          <p data-bind="slots">卡槽 1 / 6</p>
        </div>
        <p class="blurb">可视化协议卡，不写代码。一句可读的规则，例如：当 每 5 秒 若 能源 &lt; 100% 则 建造 太阳能电站 ×1。本脚手架只展示卡槽和卡种，不执行规则。</p>
        <ul class="protocol-list">${cards}</ul>
      </section>

      <section class="panel prestige" aria-labelledby="prestige-title">
        <div class="panel-head">
          <h2 id="prestige-title">发射殖民舰</h2>
          <p>产出分 = 金属累计 + 3×晶体累计 + 10×重氢累计。核心 = ⌊√(产出分 / 1e6)⌋。未花费核心每个 +2% 全局产出。发射清空资源和生产者，保留曲率核心，并重新获得 1 座太阳能电站。</p>
        </div>
        <dl class="prestige-stats">
          <div>
            <dt>本轮产出分</dt>
            <dd data-bind="score">0.00</dd>
          </div>
          <div>
            <dt>预览</dt>
            <dd data-bind="preview">可得 0 核心</dd>
          </div>
        </dl>
        <button type="button" data-action="prestige" data-bind="action-prestige" disabled>发射殖民舰</button>
      </section>

      <section class="panel" aria-labelledby="save-title">
        <div class="panel-head">
          <h2 id="save-title">存档</h2>
          <p>自动写入 localStorage。导出 JSON 为 { version, savedAt, state }。离线进度最多结算 <strong data-bind="offline-cap">${OFFLINE_CAP_LABEL}</strong>。</p>
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
        <textarea id="transfer" data-bind="transfer" spellcheck="false" placeholder="在此粘贴存档 JSON"></textarea>
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
