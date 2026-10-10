import { afterEach, describe, expect, it, vi } from "vitest";
import * as automation from "../src/automation/engine";
import { emptyCatchup } from "../src/core/offline";
import { ACHIEVEMENTS } from "../src/data/achievements";
import * as curvature from "../src/data/curvature-tech";
import { RESEARCH } from "../src/data/research";
import { DEFENSES, SHIPS } from "../src/data/units";
import { grantRun, revealRun } from "../src/game/arcade";
import { activeBuildings } from "../src/game/content";
import * as darkMatter from "../src/game/dark-matter";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { createPlanet } from "../src/game/planet";
import * as buildingQueue from "../src/game/queue";
import * as research from "../src/game/research";
import { deserializeState, serializeState } from "../src/game/save";
import * as shipyard from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import * as arcadePresenter from "../src/ui/arcade-present";
import { present, presentVisible, resolveVisibleTab, type PresentInput, type ViewModel } from "../src/ui/present";
import { shipyardView } from "../src/ui/shipyard-present";

afterEach(() => vi.restoreAllMocks());

const TABS = [
  "overview", "facilities", "research", "shipyard", "defense", "darkmatter",
  "arcade", "protocol", "curvature", "achievements", "save",
  "galaxy", "fleet", "messages", "deep", "orders", "expansion",
] as const;
const INPUT: PresentInput = { status: "当前状态", banner: "存档保护提示", notice: "离线通知", catchup: null };

function apply(result: { state: GameState; ok: boolean; reason: string }): GameState {
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

/** Configured progression; every queued paid identity and ring result comes from its real API. */
function populated(): GameState {
  let state = createInitialState(42, 4242);
  const home = activePlanet(state);
  home.resources = { metal: big(1e8), crystal: big(1e8), deuterium: big(1e8) };
  Object.assign(home.buildings, {
    metal_mine: 5, crystal_mine: 4, deuterium_synth: 3, solar_plant: 10,
    robotics_factory: 4, shipyard: 8, research_lab: 8, missile_silo: 2,
  });
  Object.assign(home.units, { small_cargo: 7, solar_satellite: 9, rocket_launcher: 2 });
  Object.assign(state.research.levels, {
    energy_tech: 6, computer_tech: 6, combustion_drive: 6, impulse_drive: 6,
    hyperspace_drive: 3, laser_tech: 8, ion_tech: 5, plasma_tech: 5, astrophysics: 2,
  });
  const remote = createPlanet("remote", { galaxy: 2, system: 4, position: 8 });
  remote.name = "第二星球";
  remote.resources = { metal: big(2e6), crystal: big(3e6), deuterium: big(4e6) };
  state.planets.push(remote);
  state.warpCores = big(20);
  state.hasPrestiged = true;
  state.darkMatter = big(1234);
  state.stats.darkMatterEarned = 2000;
  state.manualClicks = 100;
  state.stats.scrapes = 100;
  state.items.kraken_box = 2;
  state.boosters = [{ res: "metal", pct: 10, until: 1000 }];
  state = automation.equipCard(automation.refreshUnlocks(state), 0, "auto_collect").state;
  state = grantRun(state, "bonus").state;
  state = apply(revealRun(state, "manual"));
  state = grantRun(state, "bonus").state;
  state = apply(buildingQueue.enqueue(state, "metal_mine", "manual"));
  state = apply(buildingQueue.enqueue(state, "crystal_mine", "manual"));
  state = apply(research.enqueueResearch(state, "computer_tech", "manual"));
  state = apply(shipyard.orderUnits(state, "light_fighter", 3, "manual"));
  state = apply(shipyard.orderUnits(state, "rocket_launcher", 4, "manual"));
  const checked = deserializeState(serializeState(state));
  expect(serializeState(deserializeState(serializeState(checked)))).toEqual(serializeState(checked));
  return checked;
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

/** Compare every shared field, not just selected headline values. */
function expectedProjection(full: ViewModel, tab: string): ViewModel {
  const model = structuredClone(full);
  if (tab !== "facilities") { model.buildings = []; model.production = []; }
  if (tab !== "overview") { model.overview.production = []; model.overview.energy = []; }
  if (tab !== "research") model.research.items = [];
  if (tab !== "shipyard") model.shipyard.ships = [];
  if (tab !== "defense") model.shipyard.defenses = [];
  if (tab !== "darkmatter") {
    model.darkMatter.shop = [];
    model.darkMatter.packages = [];
    model.darkMatter.inventory = [];
    model.darkMatter.boosters = [];
  }
  if (tab !== "arcade") {
    model.arcade = {
      visible: full.arcade.visible, runsCount: 0, runs: "", beacon: "", pity: "", jackpot: "",
      betLine: "", bets: [], topUpLabel: "", topUpEnabled: false, topUpTitle: "", canRun: false,
      prize: "", tiles: [], odds: [], luckyRows: [], history: [], historySignature: "", stats: [],
      statsLine: "", last: [], autoHint: "",
    };
  }
  if (tab !== "protocol") { model.catalog = []; model.slots = []; }
  if (tab !== "achievements") model.achievements = [];
  if (tab !== "curvature") model.techs = [];
  return model;
}

describe("visible original-page projection", () => {
  it.each(TABS)("matches the full reference for all shared and visible fields on %s", tab => {
    const state = populated();
    const input: PresentInput = {
      ...INPUT,
      catchup: {
        ...emptyCatchup(state), appliedSeconds: 90, rawSeconds: 90,
        gains: { metal: big(100), crystal: big(200), deuterium: big(300) },
        completedBuilds: [{ building: "metal_mine", level: 5, planetId: state.activePlanetId }],
        completedResearch: [{ tech: "energy_tech", level: 6 }],
        completedUnits: [{ unit: "small_cargo", count: 2, planetId: "remote" }],
        arcadeRuns: state.arcade.history,
      },
    };
    const before = JSON.stringify(serializeState(state));
    const inputBefore = JSON.stringify(input);
    freeze(state);
    freeze(input);
    const full = present(state, input);
    expect(resolveVisibleTab(state, tab)).toBe(tab);
    expect(presentVisible(state, input, tab)).toEqual(expectedProjection(full, tab));
    expect(JSON.stringify(serializeState(state))).toBe(before);
    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(present(state, input)).toEqual(full);
  });

  it.each(["research", "shipyard", "defense", "darkmatter", "arcade"])("projects facilities before a locked %s fallback", tab => {
    const state = createInitialState(13, 31);
    freeze(state);
    expect(resolveVisibleTab(state, tab)).toBe("facilities");
    const model = presentVisible(state, INPUT, tab);
    expect(model).toEqual(expectedProjection(present(state, INPUT), "facilities"));
    expect(model.buildings.length).toBeGreaterThan(0);
    expect(model.production.length).toBeGreaterThan(0);
  });

  it("resolves again on world switches and on same-ID replacements", () => {
    const state = populated();
    expect(resolveVisibleTab(state, "shipyard")).toBe("shipyard");
    const remote = selectPlanet(state, "remote");
    expect(resolveVisibleTab(remote, "shipyard")).toBe("facilities");
    expect(presentVisible(remote, INPUT, "shipyard")).toEqual(expectedProjection(present(remote, INPUT), "facilities"));
    const replacement = createInitialState(42, 4242);
    expect(replacement.activePlanetId).toBe(state.activePlanetId);
    expect(presentVisible(replacement, INPUT, "arcade")).toEqual(expectedProjection(present(replacement, INPUT), "facilities"));
  });

  it("preserves existing visibility from research, paid queues, earned DM and stored runs", () => {
    let state = createInitialState(4, 8);
    state.research.levels.energy_tech = 1;
    state.stats.darkMatterEarned = 1;
    state = grantRun(state, "bonus").state;
    expect(resolveVisibleTab(state, "research")).toBe("research");
    expect(resolveVisibleTab(state, "darkmatter")).toBe("darkmatter");
    expect(resolveVisibleTab(state, "arcade")).toBe("arcade");
    const queued = populated();
    activePlanet(queued).buildings.shipyard = 0;
    activePlanet(queued).buildings.research_lab = 0;
    queued.research.levels = research.emptyResearchLevels();
    expect(resolveVisibleTab(queued, "shipyard")).toBe("shipyard");
    expect(resolveVisibleTab(queued, "defense")).toBe("defense");
    expect(resolveVisibleTab(queued, "research")).toBe("research");
  });

  it("keeps current paid queue identities, progress, speedups and chrome on hidden pages", () => {
    const state = populated();
    const before = presentVisible(state, INPUT, "save");
    const beforeJson = JSON.stringify(before);
    const next = tick(state, 0.25);
    const input = { ...INPUT, status: "新的状态", banner: null, notice: null };
    const full = present(next, input);
    const hidden = presentVisible(next, input, "messages");
    expect(hidden).toEqual(expectedProjection(full, "messages"));
    expect(hidden.queue.items[0]!.progressPct).toBeGreaterThan(before.queue.items[0]!.progressPct);
    expect(hidden.research.queue.items[0]!.progressPct).toBeGreaterThan(before.research.queue.items[0]!.progressPct);
    expect(hidden.shipyard.queue.items[0]!.progressPct).toBeGreaterThan(before.shipyard.queue.items[0]!.progressPct);
    for (const queue of [hidden.queue, hidden.research.queue, hidden.shipyard.queue]) {
      expect(queue.items.length).toBeGreaterThan(0);
      expect(queue.items[0]!.halve).not.toBeNull();
      expect(queue.items[0]!.finish).not.toBeNull();
      for (const item of queue.items) {
        expect(item.jobId).toBeGreaterThan(0);
        expect(item.key).toBe(`${item.planetId}:${item.jobId}`);
      }
    }
    expect(JSON.stringify(before)).toBe(beforeJson);
  });

  it("builds fresh bodies when revisiting a tab and leaves the full presenter complete", () => {
    const state = populated();
    const first = presentVisible(state, INPUT, "shipyard");
    presentVisible(state, INPUT, "save");
    const next = tick(state, 0.25);
    const revisited = presentVisible(next, INPUT, "shipyard");
    expect(revisited.shipyard.ships).toEqual(present(next, INPUT).shipyard.ships);
    expect(revisited.shipyard.ships).not.toBe(first.shipyard.ships);
    const full = present(next, INPUT);
    expect(full.buildings).toHaveLength(activeBuildings().length);
    expect(full.research.items).toHaveLength(RESEARCH.length);
    expect(full.shipyard.ships).toHaveLength(SHIPS.length);
    expect(full.shipyard.defenses).toHaveLength(DEFENSES.length);
    expect(full.achievements).toHaveLength(ACHIEVEMENTS.length);
    expect(full.techs).toHaveLength(curvature.CURVATURE_TECH.length);
    expect(full.arcade.tiles.length).toBeGreaterThan(0);
    expect(full.darkMatter.packages.length).toBeGreaterThan(0);
    expect(full.slots.length).toBeGreaterThan(0);
  });

  it("retains shipyardView's complete default and shares its paid queue in every body mode", () => {
    const state = populated();
    const full = shipyardView(state);
    expect(shipyardView(state, "both")).toEqual(full);
    expect(shipyardView(state, "ships")).toEqual({ ...full, defenses: [] });
    expect(shipyardView(state, "defenses")).toEqual({ ...full, ships: [] });
    expect(shipyardView(state, "none")).toEqual({ ...full, ships: [], defenses: [] });
  });

  it.each(TABS)("does not call hidden heavy builders on %s", tab => {
    const state = populated();
    const building = vi.spyOn(buildingQueue, "canEnqueue");
    const researchCard = vi.spyOn(research, "canEnqueueResearch");
    const unitCard = vi.spyOn(shipyard, "canBuildUnits");
    const unitMaximum = vi.spyOn(shipyard, "maxBuildable");
    const packages = vi.spyOn(darkMatter, "packageQuote");
    const shop = vi.spyOn(darkMatter, "shopItemReason");
    const arcade = vi.spyOn(arcadePresenter, "arcadeView");
    const catalog = vi.spyOn(automation, "unlockProgress");
    const slots = vi.spyOn(automation, "slotFields");
    const techs = vi.spyOn(curvature, "curvatureById");
    const achievements = ACHIEVEMENTS.map(def => vi.spyOn(def, "progress"));
    presentVisible(state, INPUT, tab);
    expect(building).toHaveBeenCalledTimes(tab === "facilities" ? activeBuildings().length : 0);
    expect(researchCard).toHaveBeenCalledTimes(tab === "research" ? RESEARCH.length : 0);
    expect(unitCard).toHaveBeenCalledTimes(tab === "shipyard" ? SHIPS.length : tab === "defense" ? DEFENSES.length : 0);
    if (tab !== "shipyard" && tab !== "defense") expect(unitMaximum).not.toHaveBeenCalled();
    for (const call of unitCard.mock.calls) {
      expect((tab === "shipyard" ? SHIPS : DEFENSES).some(def => def.id === call[1])).toBe(true);
    }
    expect(packages.mock.calls.length > 0).toBe(tab === "darkmatter");
    expect(shop.mock.calls.length > 0).toBe(tab === "darkmatter");
    expect(arcade).toHaveBeenCalledTimes(tab === "arcade" ? 1 : 0);
    expect(catalog.mock.calls.length > 0).toBe(tab === "protocol");
    expect(slots.mock.calls.length > 0).toBe(tab === "protocol");
    expect(techs).toHaveBeenCalledTimes(tab === "curvature" ? curvature.CURVATURE_TECH.length : 0);
    for (const progress of achievements) expect(progress).toHaveBeenCalledTimes(tab === "achievements" ? 1 : 0);
  });
});
