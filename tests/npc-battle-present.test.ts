import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import type { Fleet } from "../src/game/fleet";
import type { NpcBattleReceipt } from "../src/game/npc-attack-state";
import { createInitialState, createPlanet } from "../src/game/state";
import { npcBattleDetails, npcBattleReportsView, npcBattleRounds } from "../src/ui/npc-battle-present";

// Presentation fixtures and expected labels are literal, never produced by the
// battle kernel, summary helpers or current NPC projections under test.
function receipt(patch: Partial<NpcBattleReceipt> = {}): NpcBattleReceipt {
  return {
    fleetId: 8, originId: "homeworld", target: { galaxy: 1, system: 56, position: 6 },
    at: "25892.3997786282", seed: 12345, cargoFactor: 1,
    attackerTech: { weapons: 1, shields: 2, armour: 3 },
    battle: {
      mode: "squadron-v1", winner: "attacker",
      attackerBefore: { small_cargo: 2, light_fighter: 20 },
      defenderBefore: { light_fighter: 4 },
      attackerAfter: { small_cargo: 2, light_fighter: 20 }, defenderAfter: {},
      rounds: [{ round: 1, attacker: 22, defender: 0, attackDamage: 1234.56789012345, defendDamage: 197.93162235990167 }],
    },
    stockBefore: [530, 264, 46], loot: [265, 132, 23], delivery: "delivered", ...patch,
  };
}
function world(reports: readonly NpcBattleReceipt[] = [receipt()]) {
  const state = createInitialState(42, 777);
  const home = createPlanet("homeworld", { galaxy: 2, system: 34, position: 5 });
  home.name = "雪港";
  const other = createPlanet("other-colony", { galaxy: 3, system: 4, position: 5 });
  other.name = "当前星球";
  state.planets = [home, other]; state.activePlanetId = other.id;
  state.npcBattles = { ...state.npcBattles, reports };
  state.totalTime = big("1e1000");
  return state;
}
function fleet(report: NpcBattleReceipt, patch: Partial<Fleet> = {}): Fleet {
  return {
    id: report.fleetId, orderTransport: null, originId: report.originId, target: { ...report.target }, mission: "attack",
    ships: { ...report.battle.attackerAfter }, cargo: { metal: big(report.loot[0]), crystal: big(report.loot[1]), deuterium: big(report.loot[2]) },
    duration: 60, remaining: 30, elapsed: 30, returning: true,
    npcAttack: { seed: report.seed, cargoFactor: report.cargoFactor, phase: { kind: "returning", reason: "battle", dockBlocked: false } },
    ...patch,
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function unread(value: object, key: string) {
  Object.defineProperty(value, key, { get() { throw Error(`unexpected ${key} read`); } });
}

describe("compact NPC battle report fields", () => {
  it("shows an independent exact winning summary with no casualties and readable game time", () => {
    const report = receipt(), row = npcBattleReportsView(world([report]))[0];
    expect(row).toEqual({
      id: 8, outcome: "胜", delivery: "已入港", report,
      route: "雪港 [2:34:5] → [1:56:6]", lossText: "我方永久损失：0 艘",
      lootText: "实际装载：金属 265 · 晶体 132 · 重氢 23", timeText: "游戏时间 7 小时 11 分", roundText: "1 回合",
      summary: "#8 · 胜 · 1 回合 · 已入港 · 雪港 [2:34:5] → [1:56:6] · 我方永久损失：0 艘 · 实际装载：金属 265 · 晶体 132 · 重氢 23 · 游戏时间 7 小时 11 分",
    });
    expect(row.report).toBe(report);
    expect(row.summary).not.toContain("homeworld");
    expect(row.summary).not.toContain("25892.3997786282");
  });

  it("shows a six-round draw and sums permanent own casualties across ship types", () => {
    const report = receipt({ fleetId: 7, loot: [0, 0, 0], battle: {
      mode: "squadron-v1", winner: "draw",
      attackerBefore: { light_fighter: 8, small_cargo: 2 }, defenderBefore: { light_fighter: 8, heavy_fighter: 1 },
      attackerAfter: { light_fighter: 3, small_cargo: 1 }, defenderAfter: { light_fighter: 5, heavy_fighter: 1 },
      rounds: [
        { round: 1, attacker: 10, defender: 9, attackDamage: 460.1195584231988, defendDamage: 567.1502256081798 },
        { round: 2, attacker: 9, defender: 8, attackDamage: 482.79241457283496, defendDamage: 592.53105551882 },
        { round: 3, attacker: 8, defender: 7, attackDamage: 370.2452607806772, defendDamage: 528.8849544385448 },
        { round: 4, attacker: 7, defender: 7, attackDamage: 325.5341492133215, defendDamage: 491.97548677772284 },
        { round: 5, attacker: 5, defender: 6, attackDamage: 306.9051498832181, defendDamage: 482.6072435832911 },
        { round: 6, attacker: 4, defender: 6, attackDamage: 214.2215604136465, defendDamage: 455.4049782186317 },
      ],
    } });
    const row = npcBattleReportsView(world([report]))[0];
    expect(row.outcome).toBe("平");
    expect(row.roundText).toBe("6 回合");
    expect(row.lossText).toBe("我方永久损失：6 艘");
    expect(row.lootText).toBe("实际装载：金属 0 · 晶体 0 · 重氢 0");
  });

  it("distinguishes defeat and total own loss from the battle outcome of mutual destruction", () => {
    const report = receipt({ delivery: "destroyed", loot: [0, 0, 0], battle: {
      mode: "squadron-v1", winner: "defender", attackerBefore: { light_fighter: 1 }, defenderBefore: { light_fighter: 4 },
      attackerAfter: {}, defenderAfter: { light_fighter: 4 },
      rounds: [{ round: 1, attacker: 0, defender: 4, attackDamage: 51.011037519201636, defendDamage: 197.93162235990167 }],
    } });
    const row = npcBattleReportsView(world([report]))[0];
    expect(row.outcome).toBe("败"); expect(row.delivery).toBe("全损");
    expect(row.lossText).toBe("我方永久损失：1 艘");
    expect(row.lootText).toBe("实际装载：金属 0 · 晶体 0 · 重氢 0");
    const mutual = receipt({ ...report, battle: { ...report.battle, winner: "draw", defenderAfter: {},
      rounds: [{ round: 1, attacker: 0, defender: 0, attackDamage: 2000, defendDamage: 2000 }] } });
    expect(npcBattleReportsView(world([mutual]))[0].outcome).toBe("平");
  });

  it("labels zero-round empty garrisons as collection rather than a fought victory", () => {
    const report = receipt({ fleetId: 10, battle: { ...receipt().battle, defenderBefore: {}, defenderAfter: {}, rounds: [] } });
    const row = npcBattleReportsView(world([report]))[0];
    expect(row.outcome).toBe("无驻军收集"); expect(row.roundText).toBe("0 回合");
    expect(row.lossText).toBe("我方永久损失：0 艘");
    expect(row.lootText).toBe("实际装载：金属 265 · 晶体 132 · 重氢 23");
    expect(npcBattleRounds(report)).toEqual([]);
  });

  it("counts all thirteen flying ship types exactly even at the legal per-type ceiling", () => {
    const before = {
      small_cargo: 1000000000000, large_cargo: 1000000000000, light_fighter: 1000000000000,
      heavy_fighter: 1000000000000, cruiser: 1000000000000, battleship: 1000000000000,
      battlecruiser: 1000000000000, bomber: 1000000000000, destroyer: 1000000000000,
      deathstar: 1000000000000, recycler: 1000000000000, espionage_probe: 1000000000000, colony_ship: 1000000000000,
    };
    const report = freeze(receipt({ delivery: "destroyed", loot: [0, 0, 0], battle: {
      mode: "squadron-v1", winner: "defender", attackerBefore: before, attackerAfter: {},
      defenderBefore: { light_fighter: 1 }, defenderAfter: { light_fighter: 1 },
      rounds: [{ round: 1, attacker: 0, defender: 1, attackDamage: 0, defendDamage: 1e16 }],
    } }));
    const raw = JSON.stringify(report), row = npcBattleReportsView(world([report]))[0];
    expect(row.lossText).toBe("我方永久损失：13000000000000 艘");
    expect(row.lossText).not.toContain("运输舰");
    expect(npcBattleDetails(report).attacker).toContain("永久损失：小型运输舰 1000000000000 · 大型运输舰 1000000000000");
    expect(npcBattleDetails(report).attacker).toContain("殖民船 1000000000000；幸存：无");
    expect(JSON.stringify(report)).toBe(raw);

    const intact = freeze(receipt({ battle: { ...receipt().battle, attackerBefore: before, attackerAfter: before,
      defenderBefore: {}, defenderAfter: {}, rounds: [] } }));
    expect(npcBattleReportsView(world([intact]))[0].lossText).toBe("我方永久损失：0 艘");
  });

  it.each([
    ["0", "游戏时间 0 秒"],
    ["61.999", "游戏时间 1 分 1 秒"],
    ["90061.999", "游戏时间 1 天 1 小时"],
    ["1e1000", "游戏时间 1.00e1000 秒"],
  ])("formats legal game time %s without changing its exact receipt value", (at, expected) => {
    const report = freeze(receipt({ at })), row = npcBattleReportsView(world([report]))[0];
    expect(row.timeText).toBe(expected); expect(report.at).toBe(at);
    expect(npcBattleDetails(report).source).toBe(`出发星球 homeworld → [1:56:6] · 实际游戏时间 ${at} 秒`);
  });
});

describe("current origin identity and receipt-only combat facts", () => {
  it("uses the current matching origin name, never the active planet or a historical name claim", () => {
    const state = world(), first = npcBattleReportsView(state)[0];
    state.planets[0].name = "<雪港 & 新名>";
    const renamed = npcBattleReportsView(state)[0];
    expect(renamed.route).toBe("<雪港 & 新名> [2:34:5] → [1:56:6]");
    expect(first.route).toBe("雪港 [2:34:5] → [1:56:6]");
    state.activePlanetId = "homeworld";
    expect(npcBattleReportsView(state)[0]).toEqual(renamed);
    expect(renamed.report).toBe(first.report);
    expect(npcBattleDetails(renamed.report).source).toBe("出发星球 homeworld → [1:56:6] · 实际游戏时间 25892.3997786282 秒");
  });

  it.each(["homeworld", "colony-5-9-2"])("explicitly marks unavailable origin %s without parsing its ID or falling back", originId => {
    const report = receipt({ originId }), state = world([report]);
    state.planets = [state.planets[1]];
    const row = npcBattleReportsView(state)[0];
    expect(row.route).toBe("原出发星球已不可用 → [1:56:6]");
    expect(row.summary).not.toContain(originId);
    expect(row.summary).not.toContain("当前星球");
    expect(npcBattleDetails(report).source).toBe(`出发星球 ${originId} → [1:56:6] · 实际游戏时间 25892.3997786282 秒`);
  });

  it("does not read live NPC stock, garrison, research, current cargo or ships to present history", () => {
    const report = receipt({ delivery: "returning" }), state = world([report]), live = fleet(report);
    state.fleets = [live];
    for (const key of ["npcEconomy", "research", "universe", "activePlanetId"]) unread(state, key);
    for (const planet of state.planets) for (const key of ["resources", "units"]) unread(planet, key);
    for (const key of ["cargo", "ships", "target", "originId"]) unread(live, key);
    const row = npcBattleReportsView(state)[0];
    expect(row.route).toBe("雪港 [2:34:5] → [1:56:6]");
    expect(row.lossText).toBe("我方永久损失：0 艘");
    expect(row.lootText).toBe("实际装载：金属 265 · 晶体 132 · 重氢 23");
    expect(row.delivery).toBe("战后返航");
  });

  it("does not eagerly read exact-detail fields or round damage for collapsed summaries", () => {
    const report = receipt();
    for (const key of ["attackerTech", "stockBefore", "cargoFactor"]) unread(report, key);
    for (const round of report.battle.rounds) for (const key of ["attackDamage", "defendDamage"]) unread(round, key);
    expect(npcBattleReportsView(world([report]))[0].roundText).toBe("1 回合");
  });

  it("leaves recursively frozen raw state untouched and preserves all exact detail and round numbers", () => {
    const state = freeze(world()), report = state.npcBattles.reports[0], before = JSON.stringify(state);
    npcBattleReportsView(state);
    expect(npcBattleDetails(report)).toEqual({
      source: "出发星球 homeworld → [1:56:6] · 实际游戏时间 25892.3997786282 秒",
      attacker: "我方出征：小型运输舰 2 · 轻型战斗机 20；永久损失：无；幸存：小型运输舰 2 · 轻型战斗机 20",
      defender: "NPC 当时驻军：轻型战斗机 4；永久损失：轻型战斗机 4；幸存：无",
      loot: "实际装载：金属 265 · 晶体 132 · 重氢 23。返抵原出发星球后一次结算；不足 1 的部分保留为该星球待结算权益，不计入普通可花库存。此处仍记录本场完整整数战利品，历史战报不可再次领取。",
      tech: "本场我方武器 1 / 护盾 2 / 装甲 3；NPC 科技均为 0。出航货舱倍率 ×1。",
    });
    expect(npcBattleRounds(report)).toEqual([{ round: "1", attacker: "22", defender: "0", attackDamage: "1234.56789012345", defendDamage: "197.93162235990167" }]);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("compact report delivery and bounded indexes", () => {
  it.each([
    ["delivered", "已入港"], ["destroyed", "全损"], ["forfeited", "已丢弃"],
  ] as const)("keeps terminal delivery %s authoritative without reading live fleets", (delivery, expected) => {
    const state = world([receipt({ delivery })]); unread(state, "fleets");
    expect(npcBattleReportsView(state)[0].delivery).toBe(expected);
  });

  it.each([false, true])("uses only the matching battle-return phase; blocked=%s", dockBlocked => {
    const report = receipt({ delivery: "returning" }), state = world([report]);
    state.fleets = [fleet(report, { npcAttack: { seed: report.seed, cargoFactor: 1,
      phase: { kind: "returning", reason: "battle", dockBlocked } } })];
    expect(npcBattleReportsView(state)[0].delivery).toBe(dockBlocked ? "入港受阻" : "战后返航");
  });

  it.each(["missing", "different-id", "transport", "missing-contract", "outbound", "recall", "target-invalid"])("does not guess delivery from %s live data", kind => {
    const report = receipt({ delivery: "returning" }), state = world([report]), live = fleet(report);
    if (kind === "different-id") live.id++;
    if (kind === "transport") live.mission = "transport";
    if (kind === "missing-contract") delete live.npcAttack;
    if (kind === "outbound") live.npcAttack = { ...live.npcAttack!, phase: { kind: "outbound" } };
    if (kind === "recall" || kind === "target-invalid") live.npcAttack = { ...live.npcAttack!, phase: { kind: "returning", reason: kind, dockBlocked: false } };
    state.fleets = kind === "missing" ? [] : [live];
    const row = npcBattleReportsView(state)[0];
    expect(row.delivery).toBe("交付状态不可确认");
    expect(row.lootText).toBe("实际装载：金属 265 · 晶体 132 · 重氢 23");
  });

  it("returns an empty report list before reading either planets or fleets", () => {
    const state = world([]); unread(state, "planets"); unread(state, "fleets");
    expect(npcBattleReportsView(state)).toEqual([]);
  });

  it("indexes planets once for all 60 terminal plus 64 pinned reports and preserves newest-first order", () => {
    const reports = freeze(Array.from({ length: 124 }, (_, index) => receipt({ fleetId: index + 1, delivery: index < 60 ? "delivered" : "returning" })));
    const state = world(reports), planets = state.planets, fleets = reports.slice(60).map(report => fleet(report));
    let planetReads = 0, fleetReads = 0;
    const idReads = [0, 0];
    planets.forEach((planet, index) => {
      const id = planet.id;
      Object.defineProperty(planet, "id", { get() { idReads[index]++; return id; } });
    });
    Object.defineProperty(state, "planets", { get() { planetReads++; return planets; } });
    Object.defineProperty(state, "fleets", { get() { fleetReads++; return fleets; } });
    const rows = npcBattleReportsView(state);
    expect(rows.map(row => row.id)).toEqual(Array.from({ length: 124 }, (_, index) => 124 - index));
    expect(rows.slice(0, 64).every(row => row.delivery === "战后返航")).toBe(true);
    expect(rows.slice(64).every(row => row.delivery === "已入港")).toBe(true);
    expect(rows.every(row => row.route === "雪港 [2:34:5] → [1:56:6]")).toBe(true);
    expect(planetReads).toBe(1); expect(fleetReads).toBe(1); expect(idReads).toEqual([1, 1]);
    expect(reports[0].fleetId).toBe(1); expect(reports[123].fleetId).toBe(124);
  });
});
