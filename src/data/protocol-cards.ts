/**
 * Infinity v0.1 — Protocol card types + unlock catalog.
 * Pure data/types only (no DOM). Numbers as strings where they become Decimal.
 */

export type ResId = 'metal' | 'crystal' | 'deuterium' | 'energy' | 'warp_core';
export type ProducerId =
  | 'metal_mine'
  | 'solar_plant'
  | 'crystal_mine'
  | 'deuterium_synth'
  | 'robotics_factory';

export type Trigger =
  | { kind: 'interval'; seconds: number }
  | { kind: 'onResource'; res: ResId; gte: string };

export type Condition =
  | { kind: 'resourceGte' | 'resourceLt'; res: ResId; value: string }
  | { kind: 'energyEffLt'; value: number }
  | { kind: 'ownedLt'; producer: ProducerId; value: number }
  | { kind: 'costRatioLt'; producer: ProducerId; ratio: number };

export type Action =
  | { kind: 'buy'; producer: ProducerId; amount: 1 | 10 | 'max' }
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
  | 'auto_prestige';

export type UnlockCondition =
  | { kind: 'manualClicks'; count: number }
  | { kind: 'ownedGte'; producer: ProducerId; value: number }
  | { kind: 'firstEnergyShortage' }
  | { kind: 'firstPrestige' }
  | { kind: 'warpCoreTotal'; count: number };

export interface CardCatalogEntry {
  id: CardCatalogId;
  labelZh: string;
  order: 1 | 2 | 3 | 4 | 5 | 6;
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

/** Unlock order §5.3 — max 6 slots in v0.1. */
export const CARD_CATALOG: readonly CardCatalogEntry[] = [
  {
    id: 'auto_collect',
    labelZh: '自动采集',
    order: 1,
    unlock: { kind: 'manualClicks', count: 100 },
    template: {
      trigger: { kind: 'interval', seconds: 1 },
      conditions: [],
      action: { kind: 'collect' },
    },
    unlocks: { actions: ['collect'] },
  },
  {
    id: 'auto_build',
    labelZh: '自动建造',
    order: 2,
    unlock: { kind: 'ownedGte', producer: 'metal_mine', value: 10 },
    template: {
      trigger: { kind: 'interval', seconds: 5 },
      conditions: [],
      action: { kind: 'buy', producer: 'metal_mine', amount: 1 },
    },
    unlocks: { triggers: ['interval'], actions: ['buy'] },
  },
  {
    id: 'resource_gate',
    labelZh: '资源阈值 / 拥有数量',
    order: 3,
    unlock: { kind: 'firstEnergyShortage' },
    template: {
      trigger: { kind: 'interval', seconds: 5 },
      conditions: [
        { kind: 'energyEffLt', value: 1 },
        { kind: 'ownedLt', producer: 'solar_plant', value: 99 },
      ],
      action: { kind: 'buy', producer: 'solar_plant', amount: 1 },
    },
    unlocks: {
      conditions: ['resourceGte', 'resourceLt', 'ownedLt'],
      triggers: ['onResource'],
    },
  },
  {
    id: 'cost_ratio_guard',
    labelZh: '成本比例守卫',
    order: 4,
    unlock: { kind: 'ownedGte', producer: 'robotics_factory', value: 1 },
    template: {
      trigger: { kind: 'interval', seconds: 5 },
      conditions: [{ kind: 'costRatioLt', producer: 'crystal_mine', ratio: 0.5 }],
      action: { kind: 'buy', producer: 'crystal_mine', amount: 1 },
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
      action: { kind: 'buy', producer: 'solar_plant', amount: 1 },
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
] as const;

/** Slot rules: start 1; robotics_factory every 2 levels +1; prestige tech can +1 permanent; hard cap 6. */
export const SLOT_RULES = {
  initial: 1,
  roboticsPerLevels: 2,
  hardCap: 6,
} as const;
