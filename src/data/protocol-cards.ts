/**
 * Protocol card types + unlock catalog (design doc §5.8, §13).
 * Pure data/types only (no DOM). Numbers as strings where they become Decimal.
 */
import type { BuildingId, ProductionBuildingId } from './buildings';

export type ResId = 'metal' | 'crystal' | 'deuterium' | 'energy' | 'warp_core';
/** Resources with a storage cap. */
export type StoredResId = 'metal' | 'crystal' | 'deuterium';

export type Trigger =
  | { kind: 'interval'; seconds: number }
  | { kind: 'onResource'; res: ResId; gte: string }
  /** Fires when the build queue has a free slot (checked on every pass and right after a build completes). */
  | { kind: 'queueIdle' }
  /** Fires when the resource sits at its storage cap (and right when it reaches it). */
  | { kind: 'storageFull'; res: StoredResId };

export type Condition =
  | { kind: 'resourceGte' | 'resourceLt'; res: ResId; value: string }
  | { kind: 'energyEffLt'; value: number }
  | { kind: 'levelLt'; building: BuildingId; value: number }
  | { kind: 'costRatioLt'; building: BuildingId; ratio: number }
  | { kind: 'storageGte'; res: StoredResId; ratio: number }
  | { kind: 'queueLenLt'; value: number }
  | { kind: 'buildTimeLt'; building: BuildingId; seconds: number };

export type Action =
  | { kind: 'enqueue'; building: BuildingId; levels: 1 }
  | { kind: 'setProduction'; building: ProductionBuildingId; pct: number }
  | { kind: 'collect' }
  | { kind: 'prestige'; minGain: number };

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
  | 'production_tuner';

export type UnlockCondition =
  | { kind: 'manualClicks'; count: number }
  | { kind: 'levelGte'; building: BuildingId; value: number }
  | { kind: 'firstEnergyShortage' }
  | { kind: 'firstPrestige' }
  | { kind: 'warpCoreTotal'; count: number }
  | { kind: 'firstQueueIdle'; roboticsLevel: number }
  | { kind: 'firstStorageFull' };

export interface CardCatalogEntry {
  id: CardCatalogId;
  labelZh: string;
  order: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
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

/** Unlock order. Slots stay capped at 6 in P1; 8 catalog cards compete for them. */
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
] as const;

/** Slot rules: start 1; robotics_factory every 2 levels +1; curvature tech can +1 permanent; hard cap 6. */
export const SLOT_RULES = {
  initial: 1,
  roboticsPerLevels: 2,
  hardCap: 6,
} as const;
