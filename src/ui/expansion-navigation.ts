import { activePlanet } from "../game/empire";
import { coordinateKey, type Coordinates } from "../game/galaxy";
import type { GameState } from "../game/types";
import { expansionNavigation, type ExpansionNavigationModel } from "./expansion-navigation-model";
import "./expansion-navigation.css";

export interface ExpansionNavigationPanel {
  update(state: GameState, cursor: Coordinates): void;
  invalidate(): void;
}

/** A local inspection surface. It has no action callback, draft, or saved state. */
export function installExpansionNavigation(root: HTMLElement): ExpansionNavigationPanel {
  const tab = root.querySelector<HTMLElement>('[data-tab-panel="galaxy"]');
  if (!tab) throw Error("缺少开拓查看挂载位置");
  const panel = document.createElement("details");
  panel.id = "expansion-navigation";
  panel.className = "expansion-navigation";
  panel.dataset.expansionReady = "false";
  panel.dataset.expansionRevision = "0";
  panel.innerHTML = `
    <summary id="expansion-navigation-summary">开拓查看（只读）</summary>
    <div class="expansion-navigation-body">
      <p class="expansion-notice">跟随上方正在浏览的恒星系；报价始终从实际当前星球出发。空位不代表已满足出航条件。</p>
      <div class="expansion-controls">
        <label for="expansion-position">查看位置</label>
        <select id="expansion-position" data-expansion-control="position" aria-describedby="expansion-selection-note"></select>
      </div>
      <p id="expansion-selection-note" class="expansion-notice">这里只改变查看位置，不切换星球、不填写舰队，也不安排派遣、研究或计划。</p>
      <p id="expansion-refresh-status" class="expansion-notice" role="status">展开后读取当前状态。</p>
      <div id="expansion-snapshot" hidden>
        <div class="expansion-context">
          <p id="expansion-system"></p>
          <p id="expansion-origin"></p>
        </div>
        <div class="expansion-columns">
          <section class="expansion-card" aria-labelledby="expansion-target-title">
            <h3 id="expansion-target-title">所选位置</h3>
            <p id="expansion-selected-status"></p>
            <p id="expansion-properties"></p>
            <p id="expansion-bonuses"></p>
            <p id="expansion-distance"></p>
            <p id="expansion-target-note" class="expansion-notice"></p>
          </section>
          <section class="expansion-card" aria-labelledby="expansion-limit-title">
            <h3 id="expansion-limit-title">当前名额与限制</h3>
            <p id="expansion-colony-limit"></p>
            <p id="expansion-planet-limit"></p>
            <p id="expansion-fleet-limit"></p>
            <p id="expansion-expedition-limit"></p>
            <p id="expansion-research"></p>
            <p class="expansion-notice">只计已完成研究与本地建筑等级；队列中的目标等级尚未生效。殖民预留只计出航中的殖民舰队，返航仍占舰队槽。</p>
          </section>
        </div>
        <section aria-labelledby="expansion-scenarios-title">
          <h3 id="expansion-scenarios-title">所选位置的明确场景报价</h3>
          <p class="expansion-notice">按当前库存与真实航行规则检查，往返燃料也占用货舱；未通过时仅展示首先遇到的原因，其他限制仍可能存在。</p>
          <div id="expansion-scenarios" class="expansion-columns"></div>
        </section>
        <section id="expansion-prerequisites" aria-labelledby="expansion-prerequisites-title">
          <h3 id="expansion-prerequisites-title">科技与造船条件说明</h3>
          <p class="expansion-notice">造船前置用于解释如何获得舰船，不额外阻止派遣已有舰船；是否符合所示出航场景以真实报价为准。</p>
          <div id="expansion-prerequisite-groups"></div>
        </section>
      </div>
      <p class="expansion-notice expansion-update-note">仅在银河页、展开且页面可见时更新，通常每秒一次。查看不推进时间、不消耗资源；需要出航时请到原舰队页重新编成与核对。</p>
    </div>`;
  tab.append(panel);

  const node = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const value = panel.querySelector<T>(selector);
    if (!value) throw Error(`缺少开拓查看节点 ${selector}`);
    return value;
  };
  const put = (target: HTMLElement, text: string): void => {
    if (target.textContent !== text) target.textContent = text;
  };
  const attribute = (target: HTMLElement, name: string, value: string): void => {
    if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  };
  const position = node<HTMLSelectElement>("#expansion-position");
  const options = Array.from({ length: 16 }, (_, index) => {
    const option = document.createElement("option");
    option.value = String(index + 1);
    option.dataset.expansionPosition = option.value;
    option.textContent = `${index + 1} · 尚未查看`;
    position.append(option);
    return option;
  });
  const snapshot = node("#expansion-snapshot");
  const refreshStatus = node("#expansion-refresh-status");
  const lines = {
    system: node("#expansion-system"), origin: node("#expansion-origin"),
    selected: node("#expansion-selected-status"), properties: node("#expansion-properties"),
    bonuses: node("#expansion-bonuses"), distance: node("#expansion-distance"),
    note: node("#expansion-target-note"), colonies: node("#expansion-colony-limit"),
    planets: node("#expansion-planet-limit"), fleets: node("#expansion-fleet-limit"),
    expeditions: node("#expansion-expedition-limit"), research: node("#expansion-research"),
  };
  // Fixed nodes prevent refreshes from replacing controls or focused content.
  const scenarios = Array.from({ length: 2 }, (_, index) => {
    const card = document.createElement("article");
    card.className = "expansion-card expansion-scenario";
    card.dataset.expansionScenario = String(index);
    card.hidden = true;
    const title = document.createElement("h4");
    title.id = `expansion-scenario-${index}-title`;
    card.setAttribute("aria-labelledby", title.id);
    const paragraph = (name: string, className = ""): HTMLParagraphElement => {
      const value = document.createElement("p");
      value.setAttribute(`data-expansion-${name}`, "");
      value.className = className;
      return value;
    };
    const assumptions = paragraph("assumptions", "expansion-notice");
    const inventory = paragraph("inventory");
    const quote = paragraph("quote", "expansion-quote");
    const risk = paragraph("risk", "expansion-risk");
    card.append(title, assumptions, inventory, quote, risk);
    node("#expansion-scenarios").append(card);
    return { card, title, assumptions, inventory, quote, risk };
  });
  const prerequisiteContainer = node("#expansion-prerequisite-groups");
  const prerequisiteNodes: Array<{ group: HTMLElement; title: HTMLElement; requirements: HTMLElement; note: HTMLElement }> = [];
  const quoteMetrics = ["duration", "fuel", "capacity", "hold-seconds", "stake"] as const;
  const clearScenario = (scenario: typeof scenarios[number]): void => {
    scenario.card.hidden = true;
    delete scenario.card.dataset.expansionMission;
    delete scenario.card.dataset.expansionOk;
    for (const value of [scenario.title, scenario.assumptions, scenario.inventory, scenario.quote, scenario.risk]) put(value, "");
    scenario.quote.dataset.expansionQuote = "";
    delete scenario.quote.dataset.expansionReason;
    for (const metric of quoteMetrics) scenario.quote.removeAttribute(`data-expansion-${metric}`);
  };

  let selectedPosition = 1;
  let lastUpdated = -Infinity;
  let lastContext = "";
  let visible = false;
  let dirty = true;
  let observedOpen = false;
  let revision = 0;
  const markDirty = (): void => {
    dirty = true;
    snapshot.hidden = true;
    refreshStatus.hidden = false;
    put(refreshStatus, "正在读取当前查看位置…");
    attribute(panel, "data-expansion-ready", "false");
  };
  // These handlers retain only local presentation state, never a GameState or
  // a candidate request. The next host projection supplies the current state.
  position.addEventListener("change", () => {
    const value = Number(position.value);
    if (!Number.isInteger(value) || value < 1 || value > 16) {
      position.value = String(selectedPosition);
      return;
    }
    if (value === selectedPosition) return;
    selectedPosition = value;
    markDirty();
  });
  panel.addEventListener("toggle", () => {
    if (observedOpen === panel.open) return;
    observedOpen = panel.open;
    visible = false;
    markDirty();
  });
  document.addEventListener("visibilitychange", () => {
    visible = false;
    markDirty();
  });

  const render = (model: ExpansionNavigationModel): void => {
    for (const [index, row] of model.positions.entries()) {
      const option = options[index];
      if (!option) break;
      put(option, row.label);
      attribute(option, "data-expansion-status", row.status);
    }
    put(lines.system, model.system.label);
    put(lines.origin, model.origin.label);
    attribute(panel, "data-expansion-origin", model.origin.id);
    attribute(panel, "data-expansion-system", `${model.system.galaxy}:${model.system.system}`);
    attribute(panel, "data-expansion-selected", String(model.selected.position));
    attribute(lines.selected, "data-expansion-status", model.selected.status);
    put(lines.selected, `${model.selected.name} [${model.selected.key}] · ${model.selected.statusLabel}`);
    put(lines.properties, model.selected.properties?.label ?? "深空没有可殖民行星，不提供温度或格子。");
    if (model.selected.properties) attribute(lines.properties, "data-expansion-source", model.selected.properties.source);
    else delete lines.properties.dataset.expansionSource;
    put(lines.bonuses, model.selected.bonuses?.label ?? "深空没有行星矿产加成。");
    put(lines.distance, `距实际出发星球的航行距离：${model.selected.distance}`);
    put(lines.note, model.selected.note);
    put(lines.colonies, model.capacity.colonies.label);
    put(lines.planets, model.capacity.planets.label);
    put(lines.fleets, model.capacity.fleets.label);
    put(lines.expeditions, model.capacity.expeditions.label);
    put(lines.research, model.research.label);
    attribute(node("#expansion-scenarios"), "data-expansion-count", String(Math.min(scenarios.length, model.selected.scenarios.length)));
    for (const [index, target] of scenarios.entries()) {
      const scenario = model.selected.scenarios[index];
      if (!scenario) { clearScenario(target); continue; }
      target.card.hidden = false;
      attribute(target.card, "data-expansion-mission", scenario.mission);
      attribute(target.card, "data-expansion-ok", String(scenario.quote.ok));
      put(target.title, scenario.label);
      put(target.assumptions, scenario.assumptions);
      put(target.inventory, `实际出发星球现有该舰船 ${scenario.availableShips.toLocaleString("en-US")} 艘。`);
      put(target.quote, scenario.quote.ok ? scenario.quote.text : `当前场景不通过：${scenario.quote.reason}`);
      attribute(target.quote, "data-expansion-quote", scenario.mission);
      attribute(target.quote, "data-expansion-reason", scenario.quote.reason);
      if (scenario.quote.ok) {
        attribute(target.quote, "data-expansion-duration", String(scenario.quote.duration));
        attribute(target.quote, "data-expansion-fuel", scenario.quote.fuel);
        attribute(target.quote, "data-expansion-capacity", scenario.quote.capacity);
        attribute(target.quote, "data-expansion-hold-seconds", String(scenario.quote.holdSeconds));
        attribute(target.quote, "data-expansion-stake", String(scenario.quote.stake));
      } else {
        for (const metric of quoteMetrics) target.quote.removeAttribute(`data-expansion-${metric}`);
      }
      put(target.risk, `风险与边界：${scenario.risk}`);
    }
    for (const [index, modelGroup] of model.prerequisites.entries()) {
      let target = prerequisiteNodes[index];
      if (!target) {
        const group = document.createElement("section");
        group.className = "expansion-prerequisite-group";
        const title = document.createElement("h4"), requirements = document.createElement("p"), note = document.createElement("p");
        note.className = "expansion-notice";
        group.append(title, requirements, note);
        prerequisiteContainer.append(group);
        target = { group, title, requirements, note };
        prerequisiteNodes.push(target);
      }
      target.group.hidden = false;
      attribute(target.group, "data-expansion-prerequisite", modelGroup.id);
      put(target.title, modelGroup.label);
      put(target.requirements, modelGroup.requirements.map(requirement => requirement.label).join("；"));
      put(target.note, modelGroup.note);
    }
    for (const target of prerequisiteNodes.slice(model.prerequisites.length)) {
      target.group.hidden = true;
      delete target.group.dataset.expansionPrerequisite;
      for (const value of [target.title, target.requirements, target.note]) put(value, "");
    }
    snapshot.hidden = false;
    refreshStatus.hidden = true;
    put(refreshStatus, "");
    attribute(panel, "data-expansion-ready", "true");
    attribute(panel, "data-expansion-revision", String(++revision));
  };

  return {
    invalidate() {
      selectedPosition = 1;
      position.value = "1";
      lastUpdated = -Infinity;
      lastContext = "";
      visible = false;
      markDirty();
      put(refreshStatus, "进度已更新，展开后重新读取当前状态。");
      for (const [index, option] of options.entries()) {
        put(option, `${index + 1} · 尚未查看`);
        delete option.dataset.expansionStatus;
      }
      for (const value of Object.values(lines)) put(value, "");
      delete lines.selected.dataset.expansionStatus;
      delete lines.properties.dataset.expansionSource;
      delete panel.dataset.expansionOrigin;
      delete panel.dataset.expansionSystem;
      delete panel.dataset.expansionSelected;
      delete node("#expansion-scenarios").dataset.expansionCount;
      for (const target of scenarios) clearScenario(target);
      for (const target of prerequisiteNodes) {
        target.group.hidden = true;
        delete target.group.dataset.expansionPrerequisite;
        for (const value of [target.title, target.requirements, target.note]) put(value, "");
      }
    },
    update(state, cursor) {
      observedOpen = panel.open;
      if (tab.hidden || !panel.open || document.hidden) {
        visible = false;
        return;
      }
      const origin = activePlanet(state);
      const context = `${cursor.galaxy}:${cursor.system}|${origin.id}|${coordinateKey(origin.coordinates)}|${selectedPosition}`;
      const now = performance.now();
      if (!visible || dirty || context !== lastContext || now - lastUpdated >= 1000) {
        // Only this call sees GameState. No state, quote, or model escapes render.
        render(expansionNavigation(state, cursor, selectedPosition));
        lastUpdated = now;
        lastContext = context;
        dirty = false;
      }
      visible = true;
    },
  };
}
