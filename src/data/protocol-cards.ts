/**
 * Protocol card types + unlock catalog (design doc §5.8, §13).
 * Pure data/types only (no DOM). Numbers as strings where they become Decimal.
 */
import type { BuildingId, ProductionBuildingId } from './buildings';
import type { ResearchId } from './research';
import type { BetSymbol } from './arcade';
import type { UnitId } from './units';

export type ResId = 'metal' | 'crystal' | 'deuterium' | 'energy' | 'warp_core';
/** Resources with a storage cap. */
export type StoredResId = 'metal' | 'crystal' | 'deuterium';

export type Trigger =
  | { kind: 'interval'; seconds: number }
  | { kind: 'onResource'; res: ResId; gte: string }
  /** Fires when the build queue has a free slot (checked on every pass and right after a build completes). */
  | { kind: 'queueIdle' }
  /** Fires when the resource sits at its storage cap (and right when it reaches it). */
  | { kind: 'storageFull'; res: StoredResId }
  /** Fires when the research queue has a free slot (checked on every pass and right after a research completes). */
  | { kind: 'researchIdle' }
  /** Fires when the ring machine has a stored run (checked on every pass and right when a beacon run arrives). */
  | { kind: 'runsReady' }
  /** Fires when the shipyard queue is empty (checked on every pass and right when the last batch finishes). P3. */
  | { kind: 'shipyardIdle' };

/** Groups for "cheapest first". */
export type CheapestGroup = 'mines' | 'storage' | 'research';

export type Condition =
  | { kind: 'resourceGte' | 'resourceLt'; res: ResId; value: string }
  | { kind: 'energyEffLt'; value: number }
  | { kind: 'levelLt'; building: BuildingId; value: number }
  | { kind: 'costRatioLt'; building: BuildingId; ratio: number }
  | { kind: 'storageGte'; res: StoredResId; ratio: number }
  | { kind: 'queueLenLt'; value: number }
  | { kind: 'buildTimeLt'; building: BuildingId; seconds: number }
  | { kind: 'researchLevelLt'; tech: ResearchId; value: number }
  | { kind: 'researchTimeLt'; tech: ResearchId; seconds: number }
  | { kind: 'runsGte'; value: number }
  | { kind: 'pityGte'; pity: 'empty' | 'jackpot'; value: number }
  /** Owned + queued units of one kind below N (P3). */
  | { kind: 'unitCountLt'; unit: UnitId; value: number }
  /** Energy demand − supply ≥ N, counting solar satellites already queued as supply (P3). */
  | { kind: 'energyDeficitGte'; value: number };

/**
 * How many units a buildUnits action orders: a fixed count, as many as the stock pays for, enough solar
 * satellites to close the energy deficit, or up to N owned + queued.
 */
export type BuildUnitsCount = number | 'max' | 'deficit' | { fillTo: number };

export type Action =
  | { kind: 'enqueue'; building: BuildingId; levels: 1 }
  | { kind: 'setProduction'; building: ProductionBuildingId; pct: number }
  | { kind: 'collect' }
  | { kind: 'prestige'; minGain: number }
  | { kind: 'enqueueResearch'; tech: ResearchId }
  | { kind: 'enqueueCheapest'; group: CheapestGroup }
  /** Reveal stored ring machine runs with the standing bets. */
  | { kind: 'runLights'; count: 1 | 'all' }
  /** Change a standing bet. */
  | { kind: 'setBet'; symbol: BetSymbol; units: number }
  /** Order a shipyard batch (P3). */
  | { kind: 'buildUnits'; unit: UnitId; count: BuildUnitsCount };

export interface ProtocolCard {
  id: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  action: Action;
}

export type CardCatalogId =
  | 'auto_collect'
  | 'auto_build'
  | 'resource_gate'
  | 'cost_ratio_guard'
  | 'energy_eff_gate'
  | 'auto_prestige'
  | 'queue_scheduler'
  | 'production_tuner'
  | 'research_scheduler'
  | 'cheapest_first'
  | 'auto_runner'
  | 'satellite_power'
  | 'defense_keeper';

export type UnlockCondition =
  | { kind: 'manualClicks'; count: number }
  | { kind: 'levelGte'; building: BuildingId; value: number }
  | { kind: 'firstEnergyShortage' }
  | { kind: 'firstPrestige' }
  | { kind: 'warpCoreTotal'; count: number }
  | { kind: 'firstQueueIdle'; roboticsLevel: number }
  | { kind: 'firstStorageFull' }
  | { kind: 'researchGte'; tech: ResearchId; value: number }
  | { kind: 'arcadeManualRuns'; count: number }
  | { kind: 'unitGte'; unit: UnitId; value: number }
  | { kind: 'firstDefense' };

export interface CardCatalogEntry {
  id: CardCatalogId;
  labelZh: string;
  order: number;
  unlock: UnlockCondition;
  /** Default template the player gets when unlocked (editable). */
  template: Omit<ProtocolCard, 'id' | 'enabled'>;
  /** Which Trigger/Condition/Action kinds this unlock introduces. */
  unlocks: {
    triggers?: Trigger['kind'][];
    conditions?: Condition['kind'][];
    actions?: Action['kind'][];
  };
}

/** Unlock order. From P2 the rack holds up to 12 slots (robotics and computer technology each give +1 per 2 levels). */
export const CARD_CATALOG: readonly CardCatalogEntry[] = [
  {
    id: 'auto_collect',
    labelZh: '自动采集',
    order: 1,
    unlock: { kind: 'manualClicks', count: 100 },
    template: {
      trigger: { kind: 'interval', seconds: 10 },
      conditions: [],
      action: { kind: 'collect' },
    },
    unlocks: { actions: ['collect'] },
  },
  {
    id: 'auto_build',
    labelZh: '自动建造',
    order: 2,
    unlock: { kind: 'levelGte', building: 'metal_mine', value: 10 },
    template: {
      trigger: { kind: 'interval', seconds: 5 },
      conditions: [],
      action: { kind: 'enqueue', building: 'metal_mine', levels: 1 },
    },
    unlocks: { triggers: ['interval'], actions: ['enqueue'] },
  },
  {
    id: 'resource_gate',
    labelZh: '资源阈值 / 建筑等级',
    order: 3,
    unlock: { kind: 'firstEnergyShortage' },
    template: {
      trigger: { kind: 'interval', seconds: 5 },
      conditions: [
        { kind: 'energyEffLt', value: 1 },
        { kind: 'levelLt', building: 'solar_plant', value: 99 },
      ],
      action: { kind: 'enqueue', building: 'solar_plant', levels: 1 },
    },
    unlocks: {
      conditions: ['resourceGte', 'resourceLt', 'levelLt'],
      triggers: ['onResource'],
    },
  },
  {
    id: 'cost_ratio_guard',
    labelZh: '成本比例守卫',
    order: 4,
    unlock: { kind: 'levelGte', building: 'robotics_factory', value: 1 },
    template: {
      trigger: { kind: 'interval', seconds: 5 },
      conditions: [{ kind: 'costRatioLt', building: 'crystal_mine', ratio: 0.5 }],
      action: { kind: 'enqueue', building: 'crystal_mine', levels: 1 },
    },
    unlocks: { conditions: ['costRatioLt'] },
  },
  {
    id: 'energy_eff_gate',
    labelZh: '能源效率调度',
    order: 5,
    unlock: { kind: 'firstPrestige' },
    template: {
      trigger: { kind: 'interval', seconds: 5 },
      conditions: [{ kind: 'energyEffLt', value: 0.9 }],
      action: { kind: 'enqueue', building: 'solar_plant', levels: 1 },
    },
    unlocks: { conditions: ['energyEffLt'] },
  },
  {
    id: 'auto_prestige',
    labelZh: '自动重置',
    order: 6,
    unlock: { kind: 'warpCoreTotal', count: 10 },
    template: {
      trigger: { kind: 'interval', seconds: 10 },
      conditions: [],
      action: { kind: 'prestige', minGain: 2 },
    },
    unlocks: { actions: ['prestige'] },
  },
  {
    id: 'queue_scheduler',
    labelZh: '队列调度',
    order: 7,
    unlock: { kind: 'firstQueueIdle', roboticsLevel: 1 },
    template: {
      trigger: { kind: 'queueIdle' },
      conditions: [{ kind: 'buildTimeLt', building: 'metal_mine', seconds: 120 }],
      action: { kind: 'enqueue', building: 'metal_mine', levels: 1 },
    },
    unlocks: { triggers: ['queueIdle'], conditions: ['queueLenLt', 'buildTimeLt'], actions: ['enqueue'] },
  },
  {
    id: 'production_tuner',
    labelZh: '产线调节',
    order: 8,
    unlock: { kind: 'firstStorageFull' },
    template: {
      trigger: { kind: 'storageFull', res: 'metal' },
      conditions: [],
      action: { kind: 'setProduction', building: 'metal_mine', pct: 0 },
    },
    unlocks: { triggers: ['storageFull'], conditions: ['storageGte'], actions: ['setProduction'] },
  },
  {
    id: 'research_scheduler',
    labelZh: '研究调度',
    order: 9,
    unlock: { kind: 'levelGte', building: 'research_lab', value: 1 },
    template: {
      trigger: { kind: 'researchIdle' },
      conditions: [{ kind: 'researchLevelLt', tech: 'computer_tech', value: 10 }],
      action: { kind: 'enqueueResearch', tech: 'computer_tech' },
    },
    unlocks: {
      triggers: ['researchIdle'],
      conditions: ['researchLevelLt', 'researchTimeLt'],
      actions: ['enqueueResearch'],
    },
  },
  {
    id: 'cheapest_first',
    labelZh: '最便宜优先',
    order: 10,
    unlock: { kind: 'researchGte', tech: 'computer_tech', value: 2 },
    template: {
      trigger: { kind: 'queueIdle' },
      conditions: [],
      action: { kind: 'enqueueCheapest', group: 'mines' },
    },
    unlocks: { actions: ['enqueueCheapest'] },
  },
  {
    id: 'auto_runner',
    labelZh: '自动跑灯',
    order: 11,
    unlock: { kind: 'arcadeManualRuns', count: 10 },
    template: {
      trigger: { kind: 'runsReady' },
      conditions: [{ kind: 'runsGte', value: 1 }],
      action: { kind: 'runLights', count: 1 },
    },
    unlocks: {
      triggers: ['runsReady'],
      conditions: ['runsGte', 'pityGte'],
      actions: ['runLights'],
    },
  },
  {
    id: 'satellite_power',
    labelZh: '卫星供电',
    order: 12,
    unlock: { kind: 'unitGte', unit: 'solar_satellite', value: 1 },
    template: {
      trigger: { kind: 'shipyardIdle' },
      conditions: [{ kind: 'energyDeficitGte', value: 1 }],
      action: { kind: 'buildUnits', unit: 'solar_satellite', count: 'deficit' },
    },
    unlocks: {
      triggers: ['shipyardIdle'],
      conditions: ['energyDeficitGte', 'unitCountLt'],
      actions: ['buildUnits'],
    },
  },
  {
    id: 'defense_keeper',
    labelZh: '防御维护',
    order: 13,
    unlock: { kind: 'firstDefense' },
    template: {
      trigger: { kind: 'shipyardIdle' },
      conditions: [{ kind: 'unitCountLt', unit: 'rocket_launcher', value: 50 }],
      action: { kind: 'buildUnits', unit: 'rocket_launcher', count: { fillTo: 50 } },
    },
    unlocks: {
      triggers: ['shipyardIdle'],
      conditions: ['unitCountLt'],
      actions: ['buildUnits'],
    },
  },
] as const;

/**
 * Slot rules (design doc §8.6): start 1; robotics factory every 2 levels +1; computer technology every
 * 2 levels +1; curvature tech can +1 permanent; hard cap 12 from P2.
 */
export const SLOT_RULES = {
  initial: 1,
  roboticsPerLevels: 2,
  computerPerLevels: 2,
  hardCap: 12,
} as const;
