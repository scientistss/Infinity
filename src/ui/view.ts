import { ACHIEVEMENTS } from "../data/achievements";
import { CURVATURE_TECH, isCurvatureId } from "../data/curvature-tech";
import { CARD_CATALOG } from "../data/protocol-cards";
import {
  PRESTIGE_SCORE_UNIT,
  PRODUCTION_IDS,
  RESOURCES,
  activeBuildings,
  buildingById,
  isBuildingId,
  isProductionId,
  type BuildingDef,
  type BuildingId,
  type ProductionBuildingId,
} from "../game/content";
import { PROTOCOL_SLOT_COUNT, type CurvatureId } from "../game/types";
import { RESEARCH, RESEARCH_GROUP_LABEL, isResearchId, type ResearchDef, type ResearchGroup, type ResearchId } from "../data/research";
import type { QueueView, TableRowView, ViewModel } from "./present";
import { INVENTORY_IDS, PACKAGE_FRACTIONS, SHOP_ITEMS, isInventoryId, isShopItemId, type InventoryItemId, type ShopItemId } from "../data/dark-matter";
import type { PackageKind, SpeedupMode, SpeedupTarget } from "../game/dark-matter";
import type { ResourceId } from "../game/types";

export type UiAction =
  | { type: "scrape" }
  | { type: "enqueue"; id: BuildingId }
  | { type: "cancelQueue"; index: number }
  | { type: "enqueueResearch"; id: ResearchId }
  | { type: "cancelResearch"; index: number }
  | { type: "dm-speedup"; target: SpeedupTarget; mode: SpeedupMode }
  | { type: "dm-shop"; id: ShopItemId; res: ResourceId }
  | { type: "dm-package"; kind: PackageKind; fraction: number }
  | { type: "dm-use"; id: InventoryItemId }
  | { type: "setProduction"; id: ProductionBuildingId; pct: number }
  | { type: "prestige" }
  | { type: "save" }
  | { type: "export" }
  | { type: "import-text"; text: string }
  | { type: "import-file"; file: File }
  | { type: "reset" }
  | { type: "dismiss-offline" }
  | { type: "dismiss-notice" }
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
    if (action === "dismiss-notice") onAction({ type: "dismiss-notice" });
    if (action === "buy-tech") {
      const id = button.dataset.id ?? "";
      if (isCurvatureId(id)) onAction({ type: "buy-tech", id });
    }
    if (action === "enqueue") {
      const id = button.dataset.id ?? "";
      if (isBuildingId(id)) onAction({ type: "enqueue", id });
    }
    if (action === "cancel-queue") {
      const index = Number(button.dataset.index);
      if (Number.isInteger(index)) onAction({ type: "cancelQueue", index });
    }
    if (action === "dm-speedup") {
      const target = button.dataset.target === "research" ? "research" : "build";
      const mode = button.dataset.mode === "finish" ? "finish" : "halve";
      onAction({ type: "dm-speedup", target, mode });
    }
    if (action === "dm-shop") {
      const id = button.dataset.id ?? "";
      const res = button.dataset.res;
      const resource: ResourceId = res === "crystal" || res === "deuterium" ? res : "metal";
      if (isShopItemId(id)) onAction({ type: "dm-shop", id, res: resource });
    }
    if (action === "dm-package") {
      const kind = button.dataset.kind;
      const fraction = Number(button.dataset.fraction);
      if ((kind === "metal" || kind === "crystal" || kind === "deuterium" || kind === "bundle") && Number.isFinite(fraction)) {
        onAction({ type: "dm-package", kind, fraction });
      }
    }
    if (action === "dm-use") {
      const id = button.dataset.id ?? "";
      if (isInventoryId(id)) onAction({ type: "dm-use", id });
    }
    if (action === "research") {
      const id = button.dataset.id ?? "";
      if (isResearchId(id)) onAction({ type: "enqueueResearch", id });
    }
    if (action === "cancel-research") {
      const index = Number(button.dataset.index);
      if (Number.isInteger(index)) onAction({ type: "cancelResearch", index });
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
    if (target instanceof HTMLSelectElement && target.dataset.prod) {
      const id = target.dataset.prod;
      const pct = Number(target.value);
      if (isProductionId(id) && Number.isInteger(pct)) onAction({ type: "setProduction", id, pct });
      return;
    }
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
      setText(root, "score", model.score);
      setText(root, "gain", model.gain);
      setText(root, "gain-detail", model.gain);
      setText(root, "energy-top", model.energy);
      requiredElement(root, "energy-chip").classList.toggle("short", model.energyShort);
      setText(root, "status", model.status);
      setText(root, "status-dm", model.status);
      setText(root, "offline-cap", model.offlineCap);
      setText(root, "ach-summary", model.achievementSummary);
      setText(root, "unspent-line", model.unspentLine);
      for (const bind of ["action-scrape", "action-scrape-ov"]) setText(root, bind, model.scrapeLabel);
      for (const bind of ["passive", "passive-ov"]) setText(root, bind, model.passive);

      for (const resource of model.resources) {
        setText(root, `amount-${resource.id}`, resource.amount);
        setText(root, `cap-${resource.id}`, resource.cap);
        setText(root, `rate-${resource.id}`, resource.rate);
        setText(root, `eta-${resource.id}`, resource.eta);
        const card = requiredElement(root, `res-${resource.id}`);
        card.classList.toggle("warn", resource.fill === "warn");
        card.classList.toggle("full", resource.fill === "full");
        requiredElement(root, `fill-${resource.id}`).style.width = `${resource.fillPct.toFixed(1)}%`;
      }

      updateQueue(root, "queue", ["", "-ov"], model.queue, "cancel-queue", "build");
      updateResearch(root, model);
      updateDarkMatter(root, model);

      for (const building of model.buildings) {
        setText(root, `level-${building.id}`, building.level);
        setText(root, `cost-${building.id}`, building.cost);
        setText(root, `time-${building.id}`, building.time);
        setText(root, `effect-${building.id}`, building.effect);
        setText(root, `payback-${building.id}`, building.payback);
        setText(root, `requires-${building.id}`, building.requires);
        setText(root, `upgrade-${building.id}`, building.button);
        setText(root, `reason-${building.id}`, building.reason);
        requiredElement(root, `bld-${building.id}`).classList.toggle("locked", building.locked);
        const button = requiredButton(root, `enqueue-${building.id}`);
        button.disabled = !building.canEnqueue;
        button.title = building.reason;
      }

      for (const setting of model.production) {
        const select = requiredElement(root, `prod-${setting.id}`);
        if (select instanceof HTMLSelectElement && select.value !== setting.value && document.activeElement !== select) {
          select.value = setting.value;
        }
        setText(root, `prod-note-${setting.id}`, setting.note);
      }

      const overview = model.overview;
      setText(root, "ov-planet", overview.planet);
      setText(root, "ov-temp", overview.temperature);
      setText(root, "ov-fields", overview.fields);
      setText(root, "ov-global", overview.global);
      setText(root, "ov-energy-summary", overview.energySummary);
      updateRows(root, "ov-prod", overview.production);
      updateRows(root, "ov-energy", overview.energy);

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
        fillList(
          requiredElement(root, "offline-gains"),
          model.offline.gains.map((gain) => `${gain.name} ${gain.amount}`),
        );
        fillList(requiredElement(root, "offline-builds"), model.offline.builds);
        fillList(requiredElement(root, "offline-research"), model.offline.research);
      }

      const banner = requiredElement(root, "banner");
      banner.hidden = model.banner === null;
      banner.textContent = model.banner ?? "";
      const notice = requiredElement(root, "notice");
      notice.hidden = model.notice === null;
      setText(root, "notice-text", model.notice ?? "");

      const prestige = requiredButton(root, "action-prestige");
      prestige.disabled = !model.canPrestige;

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
        setText(root, `slot-reason-${slot.index}`, slot.unlocked && slot.sentence ? slot.reason : "");
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

function updateDarkMatter(root: HTMLElement, model: ViewModel): void {
  const dm = model.darkMatter;
  setText(root, "dm-chip", dm.chip);
  const tab = requiredElement(root, "tab-darkmatter");
  if (tab.hidden === dm.visible) {
    tab.hidden = !dm.visible;
    if (!dm.visible && tab.classList.contains("active")) selectTab(root, DEFAULT_TAB);
  }
  requiredElement(root, "dm-chip-wrap").hidden = !dm.visible;
  setText(root, "dm-summary", dm.summary);
  for (const item of dm.shop) {
    for (const button of item.buttons) {
      const node = requiredButton(root, `dm-shop-${item.id}${button.res ? `-${button.res}` : ""}`);
      node.disabled = !button.enabled;
      node.title = button.title;
    }
  }
  for (const pack of dm.packages) {
    for (const button of pack.buttons) {
      const node = requiredButton(root, `dm-pack-${pack.kind}-${Math.round(button.fraction * 100)}`);
      if (node.textContent !== button.label) node.textContent = button.label;
      node.disabled = !button.enabled;
      node.title = button.title;
    }
  }
  for (const item of dm.inventory) {
    setText(root, `dm-inv-count-${item.id}`, item.count);
    const node = requiredButton(root, `dm-inv-${item.id}`);
    node.disabled = !item.enabled;
    node.title = item.title;
  }
  fillList(requiredElement(root, "dm-boosters"), dm.boosters);
}

function updateResearch(root: HTMLElement, model: ViewModel): void {
  const research = model.research;
  const tab = requiredElement(root, "tab-research");
  if (tab.hidden === research.visible) {
    tab.hidden = !research.visible;
    if (!research.visible && tab.classList.contains("active")) selectTab(root, DEFAULT_TAB);
  }
  requiredElement(root, "rqueue-wrap-ov").hidden = !research.visible;
  updateQueue(root, "rqueue", ["", "-ov"], research.queue, "cancel-research", "research");
  setText(root, "research-summary", research.summary);
  for (const item of research.items) {
    setText(root, `rlevel-${item.id}`, item.level);
    setText(root, `rcost-${item.id}`, item.cost);
    setText(root, `rtime-${item.id}`, item.time);
    setText(root, `reffect-${item.id}`, item.effect);
    setText(root, `rlater-${item.id}`, item.later);
    setText(root, `rbutton-${item.id}`, item.button);
    setText(root, `rreason-${item.id}`, item.reason);
    requiredElement(root, `rcard-${item.id}`).classList.toggle("locked", item.locked);
    const chain = requiredElement(root, `rchain-${item.id}`);
    if (chain.dataset.key !== item.chainKey) {
      chain.dataset.key = item.chainKey;
      chain.replaceChildren(
        ...item.chain.map((chip) => {
          const node = document.createElement("li");
          node.className = chip.met ? "chip-req met" : "chip-req";
          node.textContent = `${chip.met ? "✓" : "✗"} ${chip.label}`;
          return node;
        }),
      );
    }
    const button = requiredButton(root, `research-${item.id}`);
    button.disabled = !item.canEnqueue;
    button.title = item.reason;
  }
}

function updateQueue(
  root: ParentNode,
  prefix: string,
  suffixes: readonly string[],
  queue: QueueView,
  cancelAction: string,
  target: SpeedupTarget,
): void {
  for (const suffix of suffixes) setText(root, `${prefix}-summary${suffix}`, queue.summary);
  for (const suffix of suffixes) {
    const idle = requiredElement(root, `${prefix}-idle${suffix}`);
    idle.hidden = queue.idleHint === "";
    if (idle.textContent !== queue.idleHint) idle.textContent = queue.idleHint;
  }
  for (const list of suffixes.map((suffix) => requiredElement(root, `${prefix}-list${suffix}`))) {
    if (list.dataset.sig !== queue.signature) {
      list.dataset.sig = queue.signature;
      list.innerHTML = queue.items
        .map(
          (item) => `
          <li class="queue-item${item.active ? " active" : ""}">
            <div class="queue-text">
              <strong data-q="label"></strong>
              <span class="muted" data-q="detail"></span>
            </div>
            <div class="queue-bar"><span data-q="fill"></span></div>
            <span class="queue-dm" data-q="dm"${item.halve ? "" : " hidden"}>
              <button type="button" class="dm-btn" data-action="dm-speedup" data-target="${target}" data-mode="halve" data-q="halve"></button>
              <button type="button" class="dm-btn" data-action="dm-speedup" data-target="${target}" data-mode="finish" data-q="finish"></button>
            </span>
            <button type="button" class="danger queue-cancel" data-action="${cancelAction}" data-index="${item.index}">取消</button>
          </li>`,
        )
        .join("");
    }
    const rows = list.querySelectorAll<HTMLElement>(".queue-item");
    queue.items.forEach((item, index) => {
      const row = rows[index];
      if (!row) return;
      const label = row.querySelector<HTMLElement>('[data-q="label"]');
      const detail = row.querySelector<HTMLElement>('[data-q="detail"]');
      const fill = row.querySelector<HTMLElement>('[data-q="fill"]');
      if (label && label.textContent !== item.label) label.textContent = item.label;
      if (detail && detail.textContent !== item.detail) detail.textContent = item.detail;
      if (fill) fill.style.width = `${item.progressPct.toFixed(1)}%`;
      const dm = row.querySelector<HTMLElement>('[data-q="dm"]');
      if (dm) dm.hidden = item.halve === null;
      for (const [key, view] of [["halve", item.halve], ["finish", item.finish]] as const) {
        const btn = row.querySelector<HTMLButtonElement>(`[data-q="${key}"]`);
        if (!btn || !view) continue;
        if (btn.textContent !== view.label) btn.textContent = view.label;
        btn.disabled = !view.enabled;
        btn.title = view.title;
      }
    });
  }
}

function updateRows(root: ParentNode, prefix: string, rows: readonly TableRowView[]): void {
  for (const row of rows) {
    row.cells.forEach((cell, index) => setText(root, `${prefix}-${row.key}-${index}`, cell));
  }
}

function fillList(list: HTMLElement, items: readonly string[]): void {
  const signature = items.join("|");
  if (list.dataset.sig === signature) return;
  list.dataset.sig = signature;
  list.replaceChildren(
    ...items.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

const ICON_BASE = `${import.meta.env.BASE_URL}icons/`;
const TAB_KEY = "infinity.ui.tab";
const DEFAULT_TAB = "facilities";
const TABS = [
  { id: "overview", label: "概览", icon: "logo" },
  { id: "facilities", label: "建筑", icon: "robotics_factory" },
  { id: "research", label: "研究", icon: "tech" },
  { id: "darkmatter", label: "暗物质", icon: "dark_matter" },
  { id: "protocol", label: "协议卡", icon: "protocol_card" },
  { id: "curvature", label: "曲率", icon: "warp_core" },
  { id: "achievements", label: "成就", icon: "achievement" },
  { id: "save", label: "存档", icon: "save" },
] as const;

/** Chinese alt text for each painted icon. */
const ICON_ALT: Record<string, string> = {
  metal: "金属",
  crystal: "晶体",
  deuterium: "重氢",
  energy: "能量",
  metal_mine: "金属矿",
  crystal_mine: "晶体矿",
  deuterium_synth: "重氢合成器",
  solar_plant: "太阳能电站",
  robotics_factory: "机器人工厂",
  launch: "殖民舰",
  warp_core: "曲率核心",
  tech: "曲率科技",
  achievement: "成就勋章",
  protocol_card: "协议卡",
  save: "存档",
  logo: "Infinity 行星标志",
  dark_matter: "暗物质",
};

/**
 * Painted icon per building. P1 adds buildings without their own art yet; they reuse the closest
 * existing OGame-style WebP (no original OGame art is used).
 */
const BUILDING_ICON: Partial<Record<BuildingId, string>> = {
  metal_mine: "metal_mine",
  crystal_mine: "crystal_mine",
  deuterium_synth: "deuterium_synth",
  solar_plant: "solar_plant",
  fusion_reactor: "energy",
  metal_storage: "metal",
  crystal_storage: "crystal",
  deuterium_tank: "deuterium",
  robotics_factory: "robotics_factory",
  nanite_factory: "robotics_factory",
  shipyard: "launch",
  research_lab: "tech",
};

/** Simple self-drawn SVG icons (no painted WebP yet). */
const SVG_ICONS = new Set(["dark_matter"]);

/** Icons that also ship a 256px variant for large or high-DPI rendering. */
const HI_RES_ICONS = new Set(["metal_mine", "crystal_mine", "deuterium_synth", "solar_plant", "robotics_factory", "launch", "warp_core"]);

interface IconOptions {
  /** Defer loading until the image is near the viewport (default true; header icons pass false). */
  lazy?: boolean;
  /** Rendered CSS size in px, used for the srcset `sizes` hint on icons with a 256px variant. */
  size?: number;
  alt?: string;
}

/** Painted OGame-style icon (WebP) with a steel-grey rounded frame applied in CSS. */
function icon(name: string, extra = "", options: IconOptions = {}): string {
  const { lazy = true, size = 48, alt = ICON_ALT[name] ?? "" } = options;
  const src = `${ICON_BASE}${name}${SVG_ICONS.has(name) ? ".svg" : ".webp"}`;
  const srcset = HI_RES_ICONS.has(name) ? ` srcset="${src} 128w, ${ICON_BASE}${name}-256.webp 256w" sizes="${size}px"` : "";
  return `<img class="icon icon-${name}${extra ? ` ${extra}` : ""}" src="${src}"${srcset} alt="${alt}" width="128" height="128"${lazy ? ' loading="lazy"' : ""} decoding="async" draggable="false" />`;
}

/** Protocol card art plus the card's own single-color glyph as a small violet badge (CSS mask). */
function cardIcon(cardId: string, label: string): string {
  return `<span class="card-art">${icon("protocol_card", "", { alt: `协议卡：${label}` })}<span class="card-badge" style="--glyph:url('${ICON_BASE}card_${cardId}.svg')" aria-hidden="true"></span></span>`;
}

function readSavedTab(): string {
  try {
    return localStorage.getItem(TAB_KEY) ?? DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
}

function selectTab(root: ParentNode, id: string): void {
  const tab = TABS.some((entry) => entry.id === id) ? id : DEFAULT_TAB;
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

/** Research art reuses the existing WebP set (no original OGame art). */
const RESEARCH_ICON: Record<ResearchId, string> = {
  energy_tech: "energy",
  laser_tech: "tech",
  ion_tech: "tech",
  hyperspace_tech: "warp_core",
  plasma_tech: "tech",
  combustion_drive: "launch",
  impulse_drive: "launch",
  hyperspace_drive: "launch",
  espionage_tech: "tech",
  computer_tech: "protocol_card",
  astrophysics: "logo",
  intergalactic_research_network: "tech",
  graviton_tech: "warp_core",
  weapons_tech: "launch",
  shielding_tech: "launch",
  armour_tech: "launch",
};

function researchCard(def: ResearchDef): string {
  return `
      <article class="bld rcard" data-bind="rcard-${def.id}">
        <div class="bld-head">
          ${icon(RESEARCH_ICON[def.id], "icon-row", { size: 56, alt: def.nameZh })}
          <div class="bld-title">
            <h3>${def.nameZh} <small>${def.nameEn}</small></h3>
            <p class="bld-level">等级 <strong data-bind="rlevel-${def.id}">0</strong></p>
          </div>
        </div>
        <p class="bld-effect" data-bind="reffect-${def.id}"></p>
        <p class="bld-blurb" data-bind="rlater-${def.id}"></p>
        <ul class="req-chain" data-bind="rchain-${def.id}" aria-label="前置条件"></ul>
        <dl class="bld-facts">
          <div><dt>下一级成本</dt><dd data-bind="rcost-${def.id}"></dd></div>
          <div><dt>耗时</dt><dd data-bind="rtime-${def.id}"></dd></div>
        </dl>
        <button type="button" class="buy-btn" data-action="research" data-id="${def.id}" data-bind="research-${def.id}">
          <span class="buy-label" data-bind="rbutton-${def.id}">研究 等级 1</span>
          <span class="btn-cost" data-bind="rreason-${def.id}"></span>
        </button>
      </article>`;
}

function researchGroups(): string {
  const groups: ResearchGroup[] = ["basic", "drive", "advanced", "combat"];
  return groups
    .map(
      (group) => `
        <h3 class="group-title">${RESEARCH_GROUP_LABEL[group]}</h3>
        <div class="bld-grid">${RESEARCH.filter((def) => def.group === group).map(researchCard).join("")}</div>`,
    )
    .join("");
}

function buildingCard(def: BuildingDef): string {
  const art = BUILDING_ICON[def.id] ?? "robotics_factory";
  return `
      <article class="bld" data-bind="bld-${def.id}">
        <div class="bld-head">
          ${icon(art, "icon-row", { size: 56, alt: def.nameZh })}
          <div class="bld-title">
            <h3>${def.nameZh} <small>${def.nameEn}</small></h3>
            <p class="bld-level">等级 <strong data-bind="level-${def.id}">0</strong></p>
          </div>
        </div>
        <p class="bld-blurb">${def.blurb}</p>
        <p class="bld-effect" data-bind="effect-${def.id}"></p>
        <p class="bld-payback" data-bind="payback-${def.id}"></p>
        <p class="bld-requires" data-bind="requires-${def.id}"></p>
        <dl class="bld-facts">
          <div><dt>下一级成本</dt><dd data-bind="cost-${def.id}"></dd></div>
          <div><dt>耗时</dt><dd data-bind="time-${def.id}"></dd></div>
        </dl>
        <button type="button" class="buy-btn" data-action="enqueue" data-id="${def.id}" data-bind="enqueue-${def.id}">
          <span class="buy-label" data-bind="upgrade-${def.id}">升级到 等级 1</span>
          <span class="btn-cost" data-bind="reason-${def.id}"></span>
        </button>
      </article>`;
}

function queuePanel(suffix: string, prefix = "queue", title = "建造队列"): string {
  return `
      <div class="queue-panel">
        <div class="queue-head">
          <h3>${title}</h3>
          <span class="muted" data-bind="${prefix}-summary${suffix}">${title} 0/2</span>
        </div>
        <p class="muted queue-idle" data-bind="${prefix}-idle${suffix}"></p>
        <ol class="queue-list" data-bind="${prefix}-list${suffix}"></ol>
      </div>`;
}

function tableRows(prefix: string, keys: readonly string[], columns: number): string {
  return keys
    .map(
      (key) =>
        `<tr class="row-${key}">${Array.from({ length: columns }, (_, index) =>
          index === 0 ? `<th scope="row" data-bind="${prefix}-${key}-0"></th>` : `<td data-bind="${prefix}-${key}-${index}"></td>`,
        ).join("")}</tr>`,
    )
    .join("");
}

function shellMarkup(): string {
  // Metal, crystal and deuterium share equal status: three identical blocks in the top bar.
  const resourceCards = RESOURCES.map(
    (resource) => `
        <div class="res-card res-${resource.id}" data-bind="res-${resource.id}" title="${resource.blurb}">
          ${icon(resource.id, "icon-res", { lazy: false })}
          <span class="res-name">${resource.name} <span class="res-cap" data-bind="cap-${resource.id}">/ 10k</span></span>
          <strong class="res-amount" data-bind="amount-${resource.id}">0.00</strong>
          <span class="res-rate"><span data-bind="rate-${resource.id}">+0.00/s</span> <span class="res-eta" data-bind="eta-${resource.id}"></span></span>
          <span class="res-bar" aria-hidden="true"><span data-bind="fill-${resource.id}"></span></span>
        </div>`,
  ).join("");

  const tabs = TABS.map(
    (tab) =>
      `<button type="button" class="tab" role="tab" data-tab="${tab.id}" data-bind="tab-${tab.id}"${tab.id === "research" || tab.id === "darkmatter" ? " hidden" : ""} aria-selected="false">${icon(tab.icon, "icon-tab", { lazy: false, alt: "" })}<span>${tab.label}</span></button>`,
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

  const active = activeBuildings();
  const resourceBuildings = active.filter((def) => def.category === "resource").map(buildingCard).join("");
  const facilities = active.filter((def) => def.category === "facility").map(buildingCard).join("");
  const productionSelects = PRODUCTION_IDS.map((id) => {
    const options = Array.from({ length: 11 }, (_, index) => 100 - index * 10)
      .map((pct) => `<option value="${pct}">${pct}%</option>`)
      .join("");
    return `<label class="prod-row"><span>${buildingById(id).nameZh} <small data-bind="prod-note-${id}"></small></span><select data-prod="${id}" data-bind="prod-${id}">${options}</select></label>`;
  }).join("");

  return `
    <div class="modal" data-bind="offline-modal" hidden>
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="offline-title">
        <p class="kicker">Welcome back</p>
        <h2 id="offline-title">欢迎回来</h2>
        <p class="offline-applied">结算离线 <strong data-bind="offline-applied">0 秒</strong></p>
        <ul class="offline-gains" data-bind="offline-gains"></ul>
        <h3 class="offline-sub">离线期间完成的建造</h3>
        <ul class="offline-gains offline-builds" data-bind="offline-builds"></ul>
        <h3 class="offline-sub">离线期间完成的研究</h3>
        <ul class="offline-gains offline-builds" data-bind="offline-research"></ul>
        <p class="muted" data-bind="offline-detail"></p>
        <p class="muted" data-bind="offline-protocol"></p>
        <button type="button" data-action="dismiss-offline">知道了</button>
      </div>
    </div>
    <header class="topbar">
      <div class="topbar-main">
        <div class="brand">
          <img class="logo" src="${ICON_BASE}logo.webp" alt="${ICON_ALT.logo}" width="128" height="128" />
          <div>
            <h1>Infinity <span>无限</span></h1>
            <p class="kicker">Planet surface · v0.3</p>
          </div>
        </div>
        <div class="res-main" role="group" aria-label="主要资源">${resourceCards}</div>
        <div class="launch-box">
          <button type="button" class="btn-prestige" data-action="prestige" data-bind="action-prestige" disabled>
            ${icon("launch", "", { lazy: false, size: 34 })}
            <span class="prestige-title">发射殖民舰</span>
            <span class="prestige-gain">+<span data-bind="gain">0</span> 曲率核心</span>
          </button>
        </div>
      </div>
      <div class="res-strip">
        <div class="chip chip-energy" data-bind="energy-chip" title="能量供给 / 需求 · 效率">
          ${icon("energy", "", { lazy: false })}
          <span class="chip-name">能量</span>
          <span class="chip-rate" data-bind="energy-top"></span>
        </div>
        <div class="chip chip-warp" title="曲率核心 Warp Core">
          ${icon("warp_core", "", { lazy: false, size: 22 })}
          <span class="chip-name">曲率核心</span>
          <strong data-bind="telemetry">0</strong>
          <span class="chip-rate" data-bind="multiplier">产量 ×1.00</span>
          <span class="chip-rate" data-bind="played">累计 0 秒</span>
        </div>
        <div class="chip chip-dm" data-bind="dm-chip-wrap" title="暗物质 Dark Matter" hidden>
          ${icon("dark_matter", "", { lazy: false, size: 22 })}
          <span class="chip-name">暗物质</span>
          <strong data-bind="dm-chip">0</strong>
        </div>
      </div>
      <nav class="tabs" role="tablist" aria-label="主菜单">${tabs}</nav>
    </header>

    <main class="wrap">
      <div class="notice" data-bind="notice" role="status" hidden>
        <span data-bind="notice-text"></span>
        <button type="button" data-action="dismiss-notice">知道了</button>
      </div>
      <p class="banner" data-bind="banner" role="status" hidden></p>

      <section class="tab-panel" data-tab-panel="overview" aria-labelledby="overview-title" hidden>
        <div class="panel-head">
          <h2 id="overview-title">${icon("logo", "icon-h2", { alt: "" })} <span data-bind="ov-planet">母星</span></h2>
          <p><span data-bind="ov-temp"></span> · 格子 <strong data-bind="ov-fields">0 / 163</strong></p>
        </div>
        <p class="blurb" data-bind="ov-global"></p>
        <div class="scrape-row">
          <button type="button" class="scrape-btn" data-action="scrape" data-bind="action-scrape-ov">手动采集</button>
          <span class="muted" data-bind="passive-ov"></span>
        </div>
        ${queuePanel("-ov")}
        <div data-bind="rqueue-wrap-ov" hidden>${queuePanel("-ov", "rqueue", "研究队列")}</div>
        <div class="ov-grid">
          <div class="ov-card">
            <h3>产量（每秒）</h3>
            <table class="ov-table">
              <thead><tr><th scope="col">来源</th><th scope="col">金属</th><th scope="col">晶体</th><th scope="col">重氢</th></tr></thead>
              <tbody>${tableRows("ov-prod", ["base", "metal_mine", "crystal_mine", "deuterium_synth", "fusion", "net", "caps"], 4)}</tbody>
            </table>
          </div>
          <div class="ov-card">
            <h3>能源明细</h3>
            <p class="muted" data-bind="ov-energy-summary"></p>
            <table class="ov-table">
              <thead><tr><th scope="col">建筑</th><th scope="col">能源</th></tr></thead>
              <tbody>${tableRows("ov-energy", ["solar", "fusion", "metal_mine", "crystal_mine", "deuterium_synth"], 2)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="tab-panel" data-tab-panel="facilities" aria-labelledby="facility-title">
        <div class="panel-head">
          <h2 id="facility-title">建筑</h2>
          <p>入队时按目标等级扣费，同时只建 1 项，其余排队；取消全额退还。资源到达仓库上限后对应矿停产。</p>
        </div>
        ${queuePanel("")}
        <div class="scrape-row">
          <button type="button" class="scrape-btn" data-action="scrape" data-bind="action-scrape">手动采集</button>
          <span class="muted" data-bind="passive"></span>
        </div>
        <details class="prod-settings">
          <summary>资源设置（产量百分比）</summary>
          <p class="blurb">设为 0% 时该建筑不产出也不耗电（核聚变不烧重氢）。步长 10%。</p>
          <div class="prod-grid">${productionSelects}</div>
        </details>
        <h3 class="group-title">资源建筑</h3>
        <div class="bld-grid">${resourceBuildings}</div>
        <h3 class="group-title">设施</h3>
        <div class="bld-grid">${facilities}</div>
      </section>

      <section class="tab-panel" data-tab-panel="research" aria-labelledby="research-title" hidden>
        <div class="panel-head">
          <h2 id="research-title">${icon("tech", "icon-h2", { alt: "" })} 研究</h2>
          <p data-bind="research-summary">研究</p>
        </div>
        <p class="blurb">整个帝国同一时间只研究 1 项，研究队列长度与建造队列相同。成本 ⌊基础×2^(L−1)⌋（天体物理学 ×1.75 并取整到百位），研究时间 = (金属+晶体)/(1000·(1+研究实验室等级)) 小时 ÷ 研究速度。研究进行中不能升级研究实验室，研究实验室升级中也不能开始研究。前置只看已完成的等级。</p>
        ${queuePanel("", "rqueue", "研究队列")}
        ${researchGroups()}
      </section>

      <section class="tab-panel" data-tab-panel="darkmatter" aria-labelledby="dm-title" hidden>
        <div class="panel-head">
          <h2 id="dm-title">${icon("dark_matter", "icon-h2", { alt: "" })} 暗物质</h2>
          <p data-bind="dm-summary"></p>
        </div>
        <p class="blurb">价格沿用 OGame 原价，时间先按宇宙速度 ×600 换算回 OGame 小时。正在建造 / 研究的项目可在队列里花暗物质「减半」或「完成」（每 30 分钟 OGame 时间 750，单次上限建筑 72,000、研究 108,000）。军官、呼叫商人、星球搬迁第 4 阶段开放；更换职业第 7 阶段开放。</p>
        <h3 class="group-title">生效中的资源加成</h3>
        <ul class="dm-list" data-bind="dm-boosters"></ul>
        <h3 class="group-title">背包</h3>
        <div class="dm-grid">${inventoryCards()}</div>
        <h3 class="group-title">道具商店</h3>
        <div class="dm-grid">${shopCards()}</div>
        <h3 class="group-title">资源包（最多 1 个 OGame 日的产量，受仓库空间限制）</h3>
        <div class="dm-packs">${packageRows()}</div>
        <p class="status" data-bind="status-dm" role="status"></p>
      </section>

      <section class="tab-panel protocol-board" data-tab-panel="protocol" aria-labelledby="protocol-title" hidden>
        <div class="panel-head">
          <h2 id="protocol-title">协议卡</h2>
          <p data-bind="protocol-meta">槽位</p>
        </div>
        <p class="lede">把协议卡放进槽位。句子是「当…若…则…」。点击卡片装入第一个空槽，或拖到指定槽位。建造类动作只会把一级建筑放进队列。</p>
        <p class="rates">${icon("energy")} <span data-bind="protocol-energy"></span></p>
        <div class="catalog-row">${catalogButtons()}</div>
        <div class="protocol-slots">${protocolSlots()}</div>
      </section>

      <section class="tab-panel" data-tab-panel="curvature" aria-labelledby="prestige-title" hidden>
        <div class="prestige-panel">
          <div class="panel-head">
            <h2 id="prestige-title">${icon("launch", "icon-h2", { size: 32 })} 发射殖民舰</h2>
            <p>获得量 = ⌊√(扩张分 / ${PRESTIGE_SCORE_UNIT})⌋。扩张分 = 本轮累计 金属 + 3×晶体 + 10×重氢。重置资源、建筑、队列与产量设置（进行中的研究一并取消），保留曲率核心、曲率科技、研究等级、暗物质、成就和协议卡。每颗未花费核心使全局产量 +2%。</p>
          </div>
          <dl class="prestige-stats">
            <div>
              <dt>本轮扩张分</dt>
              <dd data-bind="score">0.00</dd>
            </div>
            <div>
              <dt>预计核心</dt>
              <dd>${icon("warp_core", "", { size: 28 })} <span data-bind="gain-detail">0</span></dd>
            </div>
          </dl>
        </div>
        <div class="panel-head">
          <h2 id="tech-title">${icon("tech", "icon-h2")} 曲率科技</h2>
          <p data-bind="unspent-line">未花费 0 / 已花费 0 · 被动 +0%</p>
        </div>
        <p class="blurb">花费曲率核心购买永久效果。买下后该核心不再提供 +2% 被动。无需确认。</p>
        <div class="tech-grid">${techCards()}</div>
      </section>

      <section class="tab-panel" data-tab-panel="achievements" aria-labelledby="ach-title" hidden>
        <div class="panel-head">
          <h2 id="ach-title">成就</h2>
          <p data-bind="ach-summary">已解锁 0 / 13 · 全局产出 +0%</p>
        </div>
        <p class="blurb">每个已解锁成就 +1% 全局产出，互相加算，再与曲率核心相乘。发射殖民舰不会清空成就。</p>
        <ul class="ach-list">${achievements}</ul>
      </section>

      <section class="tab-panel" data-tab-panel="save" aria-labelledby="save-title" hidden>
        <div class="panel-head">
          <h2 id="save-title">${icon("save", "icon-h2")} 存档</h2>
          <p>自动写入 localStorage。导出的 JSON 形如 { version: 7, savedAt, lastTickAt, state }。测试期只接受 v7：其他版本的文件会被拒绝，当前进度不受影响。离线进度最多结算 <strong data-bind="offline-cap">2 小时</strong>。</p>
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

function inventoryCards(): string {
  return INVENTORY_IDS.map(
    (id) => `
      <article class="dm-card">
        <h4>${{ kraken_box: "克拉肯", newtron_box: "纽特隆", booster_box: "资源 +10%", supply_pack: "资源补给包" }[id]} <strong data-bind="dm-inv-count-${id}">×0</strong></h4>
        <p class="muted">${{ kraken_box: "正在建造的建筑剩余时间 −30%", newtron_box: "正在进行的研究剩余时间 −30%", booster_box: "三种矿产量 +10%，1 小时游戏时间", supply_pack: "三种资源各 1 个 OGame 日的产量（同资源包）" }[id]}</p>
        <button type="button" data-action="dm-use" data-id="${id}" data-bind="dm-inv-${id}">使用</button>
      </article>`,
  ).join("");
}

function shopCards(): string {
  return SHOP_ITEMS.map((def) => {
    const buttons =
      def.kind === "booster"
        ? (["metal", "crystal", "deuterium"] as const)
            .map(
              (res) =>
                `<button type="button" data-action="dm-shop" data-id="${def.id}" data-res="${res}" data-bind="dm-shop-${def.id}-${res}">${{ metal: "金属", crystal: "晶体", deuterium: "重氢" }[res]}</button>`,
            )
            .join("")
        : `<button type="button" data-action="dm-shop" data-id="${def.id}" data-bind="dm-shop-${def.id}">购买并使用</button>`;
    const detail =
      def.kind === "booster"
        ? `矿产量 +${def.pct}%，OGame ${def.ogameDays} 天`
        : `${def.kind === "kraken" ? "建造" : "研究"}缩短 OGame ${def.ogameHours} 小时`;
    return `
      <article class="dm-card">
        <h4>${def.nameZh} <small>${def.dm.toLocaleString("zh-CN")} 暗物质</small></h4>
        <p class="muted">${detail}</p>
        <div class="dm-buttons">${buttons}</div>
      </article>`;
  }).join("");
}

function packageRows(): string {
  const kinds = [
    ["metal", "金属包"],
    ["crystal", "晶体包"],
    ["deuterium", "重氢包"],
    ["bundle", "三资源套餐"],
  ] as const;
  return kinds
    .map(
      ([kind, label]) => `
      <div class="dm-pack-row">
        <span>${label}</span>
        ${PACKAGE_FRACTIONS.map(
          (fraction) =>
            `<button type="button" data-action="dm-package" data-kind="${kind}" data-fraction="${fraction}" data-bind="dm-pack-${kind}-${Math.round(fraction * 100)}">${Math.round(fraction * 100)}%</button>`,
        ).join("")}
      </div>`,
    )
    .join("");
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
          ${icon("warp_core", "", { size: 22 })}
          <button type="button" class="buy-btn" data-action="buy-tech" data-id="${node.id}" data-bind="tech-buy-${node.id}">花费 ${node.cost}</button>
        </div>
      </article>`;
  }).join("");
}

function catalogButtons(): string {
  return CARD_CATALOG.map(
    (entry) =>
      `<button type="button" class="catalog-card" data-action="equip-card" data-card="${entry.id}" data-bind="catalog-${entry.id}" draggable="true">${cardIcon(entry.id, entry.labelZh)}<span>${entry.labelZh}</span></button>`,
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
      <p class="slot-reason" data-bind="slot-reason-${index}"></p>
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
