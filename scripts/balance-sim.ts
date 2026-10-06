/**
 * Pacing check (design doc §3.4 / appendix B) driven by the real game code: formulas.ts, queue.ts and tick().
 * A greedy player keeps the 2-slot build queue full: power first, crystal ≤ metal−2, deuterium ≤ crystal−3,
 * robotics ≈ metal/3, storage when the next build would exceed 90% of a cap. No curvature, no manual clicks.
 * P2: a research lab once metal mine 10 stands (lab ≈ metal/4 while no research runs), and a 2-slot research
 * queue that always picks the cheapest useful research whose price is ≤ 25% of current stock.
 *
 * Dark matter: at each snapshot it prices finishing the running build / research on the dark-matter clock
 * (1 OGame hour = 1 game minute) next to the old S = 600 conversion, and what a 9,000 DM wallet buys.
 *
 * Usage: npm run sim [-- minutes]   (runs through tsx; no browser needed)
 */
import { buildingById, type BuildingId } from "../src/data/buildings";
import { economy } from "../src/game/economy";
import { expansionScore, tick } from "../src/game/logic";
import { canEnqueue, costFor, enqueue, nextTargetLevel } from "../src/game/queue";
import { canEnqueueResearch, enqueueResearch } from "../src/game/research";
import type { ResearchId } from "../src/data/research";
import { metalEquivalent } from "../src/automation/engine";
import { createArcade, revealAll } from "../src/game/arcade";
import { createInitialState } from "../src/game/state";
import { dailyProduction, packageQuote, speedupQuote } from "../src/game/dark-matter";
import { DM_PRICES } from "../src/data/dark-matter";
import { ECONOMY_SPEED } from "../src/game/formulas";
import type { GameState } from "../src/game/types";

declare const process: { argv: string[] };
const horizonMinutes = Number(process.argv[2] ?? 150);

function want(state: GameState): BuildingId {
  const p = state.planet;
  const lv = (id: BuildingId) => nextTargetLevel(p, id) - 1; // count queued levels as built
  const eco = economy(state);
  let pick: BuildingId;
  if (eco.demand > eco.supply && lv("metal_mine") > 0 && lv("solar_plant") <= p.buildings.solar_plant) pick = "solar_plant";
  else if (lv("crystal_mine") < lv("metal_mine") - 2) pick = "crystal_mine";
  else if (lv("metal_mine") >= 4 && lv("deuterium_synth") < Math.max(1, lv("crystal_mine") - 3)) pick = "deuterium_synth";
  else if (lv("deuterium_synth") >= 1 && lv("robotics_factory") < Math.min(10, Math.floor(lv("metal_mine") / 3))) pick = "robotics_factory";
  else if (lv("metal_mine") >= 10 && state.research.queue.length === 0 && lv("research_lab") < Math.min(10, Math.floor(lv("metal_mine") / 4))) pick = "research_lab";
  else if (lv("metal_mine") >= 10 && lv("research_lab") < 1) pick = "research_lab";
  else if (state.research.levels.energy_tech >= 3 && lv("deuterium_synth") >= 5 && lv("fusion_reactor") < Math.floor(lv("deuterium_synth") / 2) - 2) pick = "fusion_reactor";
  else pick = "metal_mine";
  const cost = costFor(state, pick, nextTargetLevel(p, pick));
  const storages: Array<[BuildingId, "metal" | "crystal" | "deuterium"]> = [
    ["metal_storage", "metal"],
    ["crystal_storage", "crystal"],
    ["deuterium_tank", "deuterium"],
  ];
  for (const [store, res] of storages) {
    if (cost[res].toNumber() > 0.9 * eco.caps[res]) return store;
  }
  return pick;
}

/** Research the player cares about early, with level caps. */
const RESEARCH_PLAN: Array<[ResearchId, number]> = [
  ["energy_tech", 8],
  ["computer_tech", 20],
  ["laser_tech", 10],
  ["espionage_tech", 4],
  ["impulse_drive", 3],
  ["combustion_drive", 2],
  ["astrophysics", 3],
  ["ion_tech", 5],
  ["plasma_tech", 10],
];

function pickResearch(state: GameState): ResearchId | null {
  let best: ResearchId | null = null;
  let bestValue = Number.POSITIVE_INFINITY;
  const stock = state.resources.metal.add(state.resources.crystal.mul(2)).add(state.resources.deuterium.mul(3)).toNumber();
  for (const [id, cap] of RESEARCH_PLAN) {
    const check = canEnqueueResearch(state, id);
    if (!check.ok || check.targetLevel > cap) continue;
    const value = metalEquivalent(check.cost).toNumber();
    if (value > 0.25 * stock) continue;
    if (value < bestValue) {
      best = id;
      bestValue = value;
    }
  }
  return best;
}

const marks: Record<string, number> = {};
const snapshots: string[] = [];
const dmLines: string[] = [];
const WALLET = 9000;

/** The pre-rebalance price: real seconds × S / 3600 OGame hours, 750 per started half hour, capped. */
function oldFinishPrice(seconds: number, research: boolean): number {
  const p = DM_PRICES.speedup;
  const raw = p.dmPerHalfHour * Math.ceil(((seconds * ECONOMY_SPEED) / 3600) * 2 - 1e-9);
  return Math.min(research ? p.maxResearch : p.maxBuilding, Math.max(p.min, raw));
}

/** Every order's build time as it starts, to price "finish" across the run. */
const started: Array<{ research: boolean; minutes: number; seconds: number }> = [];
const seenOrders = new Set<string>();
function recordStarts(s: GameState, minutes: number): void {
  const build = s.planet.buildQueue[0];
  if (build && build.totalSeconds > 0 && !seenOrders.has(`b${build.building}${build.targetLevel}`)) {
    seenOrders.add(`b${build.building}${build.targetLevel}`);
    started.push({ research: false, minutes, seconds: build.totalSeconds });
  }
  const research = s.research.queue[0];
  if (research && research.totalSeconds > 0 && !seenOrders.has(`r${research.tech}${research.targetLevel}`)) {
    seenOrders.add(`r${research.tech}${research.targetLevel}`);
    started.push({ research: true, minutes, seconds: research.totalSeconds });
  }
}

function finishReport(): string[] {
  const lines: string[] = [];
  const windows: Array<[number, number]> = [[0, 30], [30, 60], [60, 120], [120, horizonMinutes]];
  for (const [from, to] of windows) {
    for (const research of [false, true]) {
      const times = started.filter((o) => o.research === research && o.minutes >= from && o.minutes < to).map((o) => o.seconds).sort((x, y) => x - y);
      if (times.length === 0) continue;
      const median = times[Math.floor(times.length / 2)]!;
      const max = times[times.length - 1]!;
      const target = research ? "research" : "build";
      const price = (t: number) => speedupQuote(t, target, "finish").dm;
      const wallet = times.reduce((acc, t) => (acc.left >= price(t) ? { left: acc.left - price(t), n: acc.n + 1 } : acc), { left: WALLET, n: 0 });
      lines.push(
        `${from}–${to} 分钟 ${research ? "研究" : "建造"} ${times.length} 项：中位 ${median.toFixed(0)}s 完成 ${price(median).toLocaleString("en-US")}（旧 ${oldFinishPrice(median, research).toLocaleString("en-US")}），最长 ${max.toFixed(0)}s 完成 ${price(max).toLocaleString("en-US")}（旧 ${oldFinishPrice(max, research).toLocaleString("en-US")}）；${WALLET.toLocaleString("en-US")} 暗物质可完成中位项 ${Math.floor(WALLET / price(median))} 次，按顺序完成本段前 ${wallet.n} 项`,
      );
    }
  }
  return lines;
}

function dmReport(minutes: number, s: GameState): string {
  const pack = packageQuote({ ...s, darkMatter: s.darkMatter.add(1e9) }, "metal", 0.1);
  const eco = economy(s);
  const boosterGain = eco.gross.metal * 0.1 * DM_PRICES.secondsPerOgameHour * 24 * 7;
  return `t=${minutes}min 资源包 10% 金属 ${pack.amounts.metal.toNumber().toExponential(2)} / ${pack.dm.toLocaleString("en-US")} 暗物质（日产 ${dailyProduction(s, "metal").toExponential(2)}，受仓库限制） · 加成·铜 金属 ≈ +${boosterGain.toExponential(2)} / 2,500 暗物质`;
}
let state = createInitialState();
state = { ...state, arcade: createArcade(20261006) };
let arcadeRuns = 0;
let arcadeDm = 0;
const fmtLv = (s: GameState) => {
  const b = s.planet.buildings;
  const r = s.research.levels;
  return `金${b.metal_mine} 晶${b.crystal_mine} 氘${b.deuterium_synth} 电${b.solar_plant} 聚${b.fusion_reactor} 机${b.robotics_factory} 研${b.research_lab} 仓${b.metal_storage}/${b.crystal_storage}/${b.deuterium_tank} 能${r.energy_tech} 计${r.computer_tech} 天${r.astrophysics}`;
};

for (let second = 1; second <= horizonMinutes * 60; second += 1) {
  for (let tries = 0; tries < 2 && state.planet.buildQueue.length < 2; tries += 1) {
    const id = want(state);
    if (!canEnqueue(state, id).ok) break;
    state = enqueue(state, id, "protocol").state;
  }
  for (let tries = 0; tries < 2 && state.research.queue.length < 2; tries += 1) {
    const id = pickResearch(state);
    if (!id) break;
    state = enqueueResearch(state, id, "protocol").state;
  }
  state = tick(state, 1);
  recordStarts(state, second / 60);
  // Ring machine: reveal every stored run right away, no bets (fixed seed, so the run is reproducible).
  if (state.arcade.runs.length > 0) {
    const before = state.darkMatter.toNumber();
    const all = revealAll(state, "manual");
    state = all.state;
    arcadeRuns += all.results.length;
    arcadeDm += state.darkMatter.toNumber() - before;
  }
  const score = expansionScore(state).toNumber();
  const minutes = second / 60;
  const mark = (key: string, hit: boolean) => {
    if (hit && marks[key] === undefined) marks[key] = minutes;
  };
  mark("首个暗物质（成就）", state.stats.darkMatterEarned > 0);
  mark("暗物质 ≥ 5,000", state.stats.darkMatterEarned >= 5000);
  mark("首次星环机开奖", state.arcade.stats.runs >= 1);
  mark("星环机首个暗物质", state.arcade.stats.darkMatter > 0);
  mark("金属矿 10 级", state.planet.buildings.metal_mine >= 10);
  mark("首次仓库满", state.stats.seenStorageFull);
  mark("机器人工厂 1 级", state.planet.buildings.robotics_factory >= 1);
  mark("首个仓库", Math.max(state.planet.buildings.metal_storage, state.planet.buildings.crystal_storage) >= 1);
  mark("首次能源不足", state.stats.seenEnergyShort);
  mark("研究实验室 1 级", state.planet.buildings.research_lab >= 1);
  mark("首项研究完成", state.stats.researchCompleted >= 1);
  mark("计算机技术 1 级", state.research.levels.computer_tech >= 1);
  mark("计算机技术 4 级（+2 槽）", state.research.levels.computer_tech >= 4);
  mark("能源技术 3 级", state.research.levels.energy_tech >= 3);
  mark("核聚变 1 级", state.planet.buildings.fusion_reactor >= 1);
  mark("天体物理学 1 级", state.research.levels.astrophysics >= 1);
  mark("重置分 1e6（1 核心）", score >= 1e6);
  mark("重置分 4e6（2 核心）", score >= 4e6);
  mark("重置分 1e7", score >= 1e7);
  if ([10, 30, 60, 120, 150].includes(minutes)) {
    const eco = economy(state);
    snapshots.push(
      `t=${minutes}min ${fmtLv(state)} score=${score.toExponential(2)} rate/s=${eco.net.metal.toFixed(1)}/${eco.net.crystal.toFixed(1)}/${eco.net.deuterium.toFixed(1)} 能源 ${eco.supply.toFixed(0)}/${eco.demand.toFixed(0)}`,
    );
    dmLines.push(dmReport(minutes, state));
  }
}

console.log(
  `S=600, greedy 2-slot queues, ${horizonMinutes} min, builds ${state.stats.buildsCompleted}, research ${state.stats.researchCompleted}`,
);
for (const [key, minutes] of Object.entries(marks)) console.log(`  ${key}: ${minutes.toFixed(1)} 分钟`);
for (const line of snapshots) console.log(`  ${line}`);
console.log("  暗物质「完成」价格（暗物质时钟：1 OGame 小时 = 1 分钟；旧 = 按 S = 600 换算）:");
for (const line of finishReport()) console.log(`    ${line}`);
console.log("  资源包 / 资源加成:");
for (const line of dmLines) console.log(`    ${line}`);
console.log(`  星环机：开奖 ${arcadeRuns} 次，暗物质 +${arcadeDm.toLocaleString("en-US")}（含 JACKPOT），累计暗物质 ${state.stats.darkMatterEarned.toLocaleString("en-US")}`);
const next = buildingById("metal_mine");
console.log(`  下一级金属矿 ${nextTargetLevel(state.planet, next.id)}`);
