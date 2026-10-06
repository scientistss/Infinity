import { UNIT_ART } from "./art";
/**
 * DOM for the shipyard and defense tabs (P3). Static markup is built once; {@link updateShipyardCards} only
 * touches text, classes and button states.
 */
import { DEFENSES, SHIPS, rapidFireOf, unitById, type UnitDef } from "../data/units";
import type { ShipyardView, UnitCardView } from "./shipyard-present";

type IconFn = (name: string, extra?: string, options?: { size?: number; alt?: string; lazy?: boolean }) => string;

function rapidFireLine(def: UnitDef): string {
  const { against, from } = rapidFireOf(def.id);
  const fmt = (list: Array<[string, number]>) =>
    list.length === 0 ? "无" : list.map(([id, rf]) => `${unitById(id as UnitDef["id"]).nameZh} ${rf}`).join("、");
  return `<details class="unit-rf"><summary>快速射击</summary><p><strong>克制</strong>：${fmt(against)}</p><p><strong>被克制</strong>：${fmt(from)}</p><p class="muted">P5 战斗用：对表中目标开火后有 (RF−1)/RF 的概率再开一炮。</p></details>`;
}

function unitIcon(def: UnitDef): string {
  return UNIT_ART[def.id];
}

function unitCard(def: UnitDef, icon: IconFn): string {
  const id = def.id;
  return `
      <article class="bld unit-card" data-bind="ucard-${id}">
        <div class="bld-head">
          ${icon(unitIcon(def), "icon-row", { size: 56, alt: def.nameZh })}
          <div class="bld-title">
            <h3>${def.nameZh} <small>${def.nameEn}</small></h3>
            <p class="bld-level">拥有 <strong data-bind="uowned-${id}">0</strong> <span class="muted" data-bind="uqueued-${id}"></span></p>
          </div>
        </div>
        <p class="bld-blurb">${def.blurb}</p>
        <p class="bld-effect" data-bind="ustats-${id}"></p>
        <p class="bld-payback" data-bind="umob-${id}"></p>
        <ul class="req-chain" data-bind="uchain-${id}" aria-label="前置条件"></ul>
        <dl class="bld-facts">
          <div><dt>单价</dt><dd data-bind="ucost-${id}"></dd></div>
          <div><dt>耗时</dt><dd data-bind="utime-${id}"></dd></div>
        </dl>
        ${rapidFireLine(def)}
        <div class="unit-order">
          <input type="number" min="1" step="1" value="1" inputmode="numeric" aria-label="${def.nameZh}数量" data-bind="uqty-${id}" />
          <button type="button" class="unit-btn" data-action="build-units" data-mode="count" data-id="${id}" data-bind="ubuild-${id}" title="按输入的数量下单">建造</button>
          <button type="button" class="unit-btn" data-action="build-units" data-mode="max" data-id="${id}" data-bind="umax-${id}" title="按现有资源能造的最大数量下单">最大</button>
          <button type="button" class="unit-btn" data-action="build-units" data-mode="fill" data-id="${id}" data-bind="ufill-${id}" title="补到输入的数量（已有 + 排队中计入）">补到</button>
        </div>
        <p class="btn-cost unit-reason" data-bind="ureason-${id}"></p>
      </article>`;
}

function queuePanel(suffix: string): string {
  return `
      <div class="queue-panel">
        <div class="queue-head">
          <h3>造船队列</h3>
          <span class="muted" data-bind="squeue-summary${suffix}">造船队列 0/10</span>
        </div>
        <p class="muted queue-idle" data-bind="squeue-idle${suffix}"></p>
        <ol class="queue-list" data-bind="squeue-list${suffix}"></ol>
      </div>`;
}

export function shipyardPanelsHtml(icon: IconFn): string {
  return `
      <section class="tab-panel" data-tab-panel="shipyard" aria-labelledby="shipyard-title" hidden>
        <div class="panel-head">
          <h2 id="shipyard-title">${icon("shipyard", "icon-h2", { alt: "" })} 造船厂</h2>
          <p data-bind="shipyard-summary"></p>
        </div>
        <p class="blurb">每艘耗时 = (金属 + 晶体) / (2500 × (1 + 造船厂) × 2^纳米) 小时 ÷ 宇宙速度。按批次下单、下单时扣全款，逐艘完成；舰船与防御共用一条造船队列。造船厂或纳米机器人工厂升级期间造船暂停。攻击、护盾、结构已计入武器、护盾、装甲技术（战斗第 5 阶段开放），速度已计入引擎（飞行第 4 阶段开放）。</p>
        ${queuePanel("")}
        <div class="bld-grid">${SHIPS.map((def) => unitCard(def, icon)).join("")}</div>
        <p class="status" data-bind="status-shipyard" role="status"></p>
      </section>

      <section class="tab-panel" data-tab-panel="defense" aria-labelledby="defense-title" hidden>
        <div class="panel-head">
          <h2 id="defense-title">${icon("defense", "icon-h2", { alt: "" })} 防御</h2>
          <p data-bind="defense-silo"></p>
        </div>
        <p class="blurb">防御和舰船共用造船队列与造船时间公式。护盾罩每种限 1 个；导弹放在导弹井里（每级 10 格，反弹道导弹 1 格、星际导弹 2 格）。第 1–4 阶段没有敌人，防御在第 5 阶段开始派上用场。</p>
        ${queuePanel("-def")}
        <div class="bld-grid">${DEFENSES.map((def) => unitCard(def, icon)).join("")}</div>
        <p class="status" data-bind="status-defense" role="status"></p>
      </section>`;
}

function bound(root: ParentNode, bind: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-bind="${bind}"]`);
}

function put(root: ParentNode, bind: string, text: string): void {
  const node = bound(root, bind);
  if (node && node.textContent !== text) node.textContent = text;
}

function updateCard(root: ParentNode, card: UnitCardView): void {
  const id = card.id;
  put(root, `uowned-${id}`, card.owned);
  put(root, `uqueued-${id}`, card.queued);
  put(root, `ustats-${id}`, card.stats);
  put(root, `umob-${id}`, card.mobility);
  put(root, `ucost-${id}`, card.cost);
  put(root, `utime-${id}`, card.time);
  put(root, `ureason-${id}`, card.reason);
  put(root, `umax-${id}`, card.maxLabel);
  bound(root, `ucard-${id}`)?.classList.toggle("locked", card.locked);
  const chain = bound(root, `uchain-${id}`);
  if (chain && chain.dataset.key !== card.chainKey) {
    chain.dataset.key = card.chainKey;
    chain.replaceChildren(
      ...card.chain.map((chip) => {
        const node = document.createElement("li");
        node.className = chip.met ? "chip-req met" : "chip-req";
        node.textContent = `${chip.met ? "✓" : "✗"} ${chip.label}`;
        return node;
      }),
    );
  }
  for (const mode of ["ubuild", "umax", "ufill"]) {
    const button = bound(root, `${mode}-${id}`);
    if (!(button instanceof HTMLButtonElement)) continue;
    const disabled = card.locked || (mode === "umax" ? card.max < 1 : !card.canBuild);
    button.disabled = disabled;
    if (mode !== "ufill") button.title = card.reason;
  }
}

export function updateShipyardCards(root: ParentNode, view: ShipyardView): void {
  put(root, "shipyard-summary", view.summary);
  put(root, "defense-silo", view.silo);
  for (const card of view.ships) updateCard(root, card);
  for (const card of view.defenses) updateCard(root, card);
}

/** Quantity typed into a card's input (at least 1). */
export function unitQuantity(root: ParentNode, id: string): number {
  const input = bound(root, `uqty-${id}`);
  const value = input instanceof HTMLInputElement ? Math.floor(Number(input.value)) : 1;
  return Number.isFinite(value) && value >= 1 ? value : 1;
}
