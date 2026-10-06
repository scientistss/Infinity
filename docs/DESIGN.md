# Infinity — 游戏设计大纲 v0.2

**English.** Infinity is a web idle game about expanding from one barren planet toward the multiverse. Automation is visual protocol cards, not scripts. The name means unbounded expansion, not an Antimatter Dimensions infinity layer. This file is the design source of truth. The repository today is the planet-surface slice described at the end: OGame-style buildings by level with a build queue, storage caps and planet fields (port phase 1), plus a running protocol-card engine.

> 类型：网页放置/增量 · Vite + TypeScript + break_infinity.js（大数走 `src/game/decimal.ts`）
> 核心卖点：**可视化协议卡** × **OGame 式星际扩张**

## 1. 愿景

你是一颗荒芜行星上的殖民指挥官。一开始只能亲手点击开采矿石，随后用协议卡把重复劳动交给机器人：自动建矿、自动调度能源、自动发射殖民舰。行星 → 星系 → 银河 → 宇宙 → 多元宇宙，每扩张一层，规模放大一个量级，角色也从操作员变成设计自动化的人。

与 Antimatter Dimensions 的差别：

- 不做「维度 N 生产维度 N-1」。建筑靠**资源三角 + 能源约束**联系，不靠层层相乘。
- 不设 1.79e308 的 Infinity 墙。重置由玩家选择（发射殖民舰），没有强制硬顶。
- 自动化是自己拼规则，不是买一个 Autobuyer 就结束。
- 每一层都有新的空间单位（星球 / 星系），不只是新的乘数。

## 2. 范围

| 范围 | v0.1 目标 | 后续（只预留） |
| --- | --- | --- |
| 层级 | 行星地表 | 星系 / 银河 / 宇宙 / 多元宇宙 |
| 建筑 | OGame 地表建筑，P1 开放 12 座（§3） | 研究、造船、舰队按 OGame 移植阶段 P2–P6 推进 |
| 重置 | 1 层：发射殖民舰（Sqrt） | 每层一种新重置 |
| 自动化 | 8 种协议卡，最多 6 槽 | 流程块连线、变量、子程序 |
| 系统 | 离线（有上限）、成就约 15 个、存档导入导出 | 挑战、事件、统计面板 |
| 不做 | 战斗、舰队、多人、商城、云存档 | — |

节奏目标：首次重置约 20–30 分钟（宇宙速度 S = 600 时，贪心玩家约 27 分钟达到 1e6 扩张分，见 `npm run sim`）；第 5 次重置时自动化基本接管地表。

## 3. 行星地表

### 资源

| id | 中文 | 说明 |
| --- | --- | --- |
| `metal` | 金属 | 基础资源；星球基础产出 30/小时 |
| `crystal` | 晶体 | 高级建筑；星球基础产出 15/小时 |
| `deuterium` | 重氢 | 机器人工厂、核聚变燃料、殖民舰 |
| `energy` | 能源 | **不累积**。效率 `eff = min(1, 供给/需求)`，不足时所有矿按比例降产。顶栏显示 `供给 / 需求 · 效率%` |
| `warp_core` | 曲率核心 | 重置货币，跨轮保留 |

三种资源各有仓库上限 `5000 × ⌊2.5 × e^(20L/33)⌋`（L0 = 10k）。到达上限后对应的矿停产，基础产出也停；取消队列的退款可以超过上限。

### 建筑（OGame 移植 P1）

所有数值按 OGame 社区公式，时间按宇宙速度 **S = 600** 压缩（`perSecond = perHour × S / 3600`）。建筑按**等级**显示和升级，没有 ×10 / 最大。

- 成本：`⌊base × factor^(L−1)⌋`（L 为目标等级）。
- 产量（每小时，再乘能源效率与全局倍率）：金属 `30·L·1.1^L`，晶体 `20·L·1.1^L`，重氢 `10·L·1.1^L·(1.44 − 0.004·T)`（母星 T = 40°C）。
- 耗电：金属矿、晶体矿 `10·L·1.1^L`，重氢合成器 `20·L·1.1^L`。供电：太阳能 `20·L·1.1^L`，核聚变 `30·L·1.05^L`（耗重氢 `10·L·1.1^L`/小时，重氢见底时降额）。
- 建造时间（小时）：`(金属 + 晶体) / (2500 × max(4 − L/2, 1) × (1 + 机器人) × 2^纳米)`，再除以 S，最短 1 秒。纳米工厂不享受低等级加速。
- 每颗星球 163 格，每级占 1 格。每个产出建筑可在“资源设置”里设 0–100%（步长 10%）。

| id | 中文 | 1 级成本 | factor | 前置 | 开放 |
| --- | --- | --- | --- | --- | --- |
| `metal_mine` | 金属矿 | 60 金属 + 15 晶体 | 1.5 | — | P1 |
| `crystal_mine` | 晶体矿 | 48 金属 + 24 晶体 | 1.6 | — | P1 |
| `deuterium_synth` | 重氢合成器 | 225 金属 + 75 晶体 | 1.5 | — | P1 |
| `solar_plant` | 太阳能电站 | 75 金属 + 30 晶体 | 1.5 | — | P1 |
| `fusion_reactor` | 核聚变反应堆 | 900 金属 + 360 晶体 + 180 重氢 | 1.8 | 重氢合成器 5（能源技术 3 待 P2） | P1 |
| `metal_storage` | 金属仓库 | 1000 金属 | 2 | — | P1 |
| `crystal_storage` | 晶体仓库 | 1000 金属 + 500 晶体 | 2 | — | P1 |
| `deuterium_tank` | 重氢罐 | 1000 金属 + 1000 晶体 | 2 | — | P1 |
| `robotics_factory` | 机器人工厂 | 400 金属 + 120 晶体 + 200 重氢 | 2 | — | P1 |
| `nanite_factory` | 纳米机器人工厂 | 1e6 金属 + 5e5 晶体 + 1e5 重氢 | 2 | 机器人工厂 10（计算机技术 10 待 P2） | P1 |
| `shipyard` | 造船厂 | 400 金属 + 200 晶体 + 100 重氢 | 2 | 机器人工厂 2 | P1（P3 生效） |
| `research_lab` | 研究实验室 | 200 金属 + 400 晶体 + 200 重氢 | 2 | — | P1（P2 生效） |

导弹井、联盟仓库、地形改造器、太空船坞、月球建筑已在数据表中，按阶段 P3–P6 开放，界面上暂不显示。

### 建造队列

每颗星球同时只建 1 项，队列长度 2（1 在建 + 1 等待）。**入队时扣费**，按目标等级定价；取消全额退还，后面同一建筑的订单目标等级 −1 并退差价。时长在开工时按当时的机器人 / 纳米等级计算。前置按已建成等级检查。

开局 500 金属 / 500 晶体，不送电站；手动采集 = `max(10, 当前每秒金属产量)`（曲率 ×10）。全局倍率 = `(1 + 0.02 × 未花费曲率核心) × (1 + 1% × 成就数) × 产线翻倍`。

## 4. 扩张层级

| 层级 | 空间单位 | 解锁 | 本层重置 | 新自动化 |
| --- | --- | --- | --- | --- |
| **行星**（v0.2） | 1 颗星球的地表 | OGame 建筑、仓库、建造队列、能源 | **发射殖民舰** → 曲率核心 | 协议卡 |
| 星系 | 多颗行星 | 星球特性、星际运输 | **恒星跃迁** → 星图 | 跨星球规则 |
| 银河 | 多个星系 | 航线、研究树 | **银河奇点** → 奇点碎片 | 流程块连线 |
| 宇宙 | 多个银河 | 物理常数 | **大坍缩** → 常数 | 变量、规则模板 |
| 多元宇宙 | 平行宇宙 | 同时跑多个宇宙 | **分支**：复制/合并 | 蓝图跨宇宙复用 |

每上一层，上一层的手动操作都应该能被自动化覆盖。

银河层货币原名“暗物质”，已改名**奇点碎片**；“暗物质”留给 OGame 移植后的原用途。

## 5. 协议卡

比喻是指挥中心的协议板。玩家从卡库拖入卡槽，用下拉框填参数，不写代码、不输入表达式。

每张卡读成一句中文：「**当** 建造队列有空位 **若** 金属矿建造时间 < 120 秒 **则** 入队 金属矿 +1 级」。状态灯：绿=已执行，灰=条件不满足，红=资源不足。可单独开关。从上到下是优先级，可拖动排序。

```ts
type Trigger =
  | { kind: "interval"; seconds: number }
  | { kind: "onResource"; res: ResId; gte: string }
  | { kind: "queueIdle" }                       // 建造队列有空位
  | { kind: "storageFull"; res: StoredResId };  // 某资源到达仓库上限
type Condition =
  | { kind: "resourceGte" | "resourceLt"; res: ResId; value: string }
  | { kind: "energyEffLt"; value: number }
  | { kind: "levelLt"; building: BuildingId; value: number }
  | { kind: "costRatioLt"; building: BuildingId; ratio: number }   // 下一级成本 / 库存
  | { kind: "storageGte"; res: StoredResId; ratio: number }        // 库存 / 上限
  | { kind: "queueLenLt"; value: number }
  | { kind: "buildTimeLt"; building: BuildingId; seconds: number };
type Action =
  | { kind: "enqueue"; building: BuildingId; levels: 1 }   // 入队一级，入队时扣费
  | { kind: "setProduction"; building: ProductionBuildingId; pct: number }
  | { kind: "collect" }
  | { kind: "prestige"; minGain: number };
```

引擎在线每 1 秒、离线每 60 秒按卡槽顺序评估；建造完成和资源满仓时也会立刻评估一次事件卡（`queueIdle` / `storageFull`）。每张卡每次最多执行 1 次。数值存字符串，加载时转 `Decimal`。

| 顺序 | 卡片 | 解锁 |
| --- | --- | --- |
| 1 | 自动采集 `collect` | 手动采集 100 次 |
| 2 | 自动建造（间隔 + `enqueue`） | 金属矿 10 级 |
| 3 | 资源阈值 / 建筑等级 | 首次能源不足 |
| 4 | 成本比例 `costRatioLt` | 机器人工厂 1 级 |
| 5 | 能源效率 | 首次重置后 |
| 6 | 自动重置 `prestige` | 累计 10 曲率核心 |
| 7 | 队列调度（`queueIdle` + `enqueue`） | 首次队列跑空，且机器人工厂 ≥ 1 |
| 8 | 产线调节（`storageFull` + `setProduction`） | 首次有资源到达上限 |

卡槽：初始 1，机器人工厂每 2 级 +1，曲率科技可永久 +1，上限 6。另有 3 个推荐卡组模板。

## 6. 发射殖民舰

- 产出分 `score = 金属累计 + 3×晶体累计 + 10×重氢累计`（本轮）。
- `gain = floor(sqrt(score / 1e6))`。分数不到 1e6 时按钮不可用。
- 按钮显示「可得 X 核心，下一个还需 Y」。
- 清空：金属、晶体、重氢、全部建筑、建造队列、产量百分比；返还开局 500 金属 / 500 晶体（+ 曲率“开局储备”）。
- 保留：曲率核心、曲率科技、成就、协议卡配置。
- 未花费核心：每个 +2% 全局产出（加算）。曲率科技 8 个节点已实装（开局储备、产线翻倍：矿产量与电站供电 ×2、建筑成本因子 −0.01（最低 1.01）、离线上限 +2 小时、永久卡槽 +1、手动采集 ×10、协议预热、航迹加权）。花费后的核心不再提供被动加成。

## 7. 系统目标

- 离线：与在线同一个分段积分 `tick`（在建项目完成、协议评估、满仓 / 见底都会切段），基础上限 **2 小时**，科技可到 8 小时。离线时协议卡每 60 秒评估。回归时汇总资源与“离线期间完成的建造”。
- 成就 13 个已实装，每个 +1% 全局产出（设计目标约 15 个）。
- 存档：localStorage；导出为带 `version` 的 JSON。导入失败不得覆盖当前局。大数用十进制字符串，建筑等级为整数。测试期不写迁移：版本号变化时旧存档重置并提示一次。
- 目标目录：`src/core/`、`src/automation/`、`src/prestige/`、`src/save/`、`src/ui/`、`src/data/`。当前代码仍在 `src/game/` 与 `src/ui/`。

## 8. UX

要让玩家看见下一步、看见每张卡为什么执行或没执行、看见每秒产量和重置预览。不要让玩家写代码或表达式。不要把自动化做成一个没有参数的开关。不要套娃相乘。不要藏公式。小于 1e6 用千分位，更大用科学计数。

## 9. 开放问题

能源是比例降效还是硬性停工；+2% 未花费核心会不会让人永远不花；6 个卡槽是否太紧；离线协议卡是完整执行还是简化；星系层的多星球是独立地表还是共享资源池；要不要挑战模式；美术是纯界面还是加星球示意图；副标题要不要写成 Infinity: Expanse 以和 AD 区分。

## 10. 当前脚手架

仓库里已经跑起来的是地表循环（OGame 移植 P1）：

- 建筑按等级升级，成本 / 产量 / 耗电 / 建造时间用 OGame 社区公式（`src/data/buildings.ts`、`src/game/formulas.ts`），宇宙速度 S = 600
- 建造队列（1 在建 + 1 等待，入队扣费、取消全退，`src/game/queue.ts`）、仓库上限、163 格、产量百分比、太阳能 + 核聚变能源
- 分段积分 `tick(state, dt, mode)`：在线逐帧与离线一次性结算结果一致（`src/game/logic.ts`、`src/game/economy.ts`）
- 手动采集、开局 500/500，发射殖民舰与曲率核心的 Sqrt 公式，以及 +2% 未花费核心
- 协议卡引擎：8 张目录卡，在线约每 1 秒、离线每 60 秒评估，队列空闲 / 满仓事件即时触发。目录在 `src/data/protocol-cards.ts`，求值在 `src/automation/`。说明见 [AUTOMATION.md](AUTOMATION.md)
- 13 个成就，每个 +1% 全局产出，发射后保留。回归时弹出离线结算（基础上限 2 小时，预留到 8 小时），列出离线期间完成的建造
- localStorage 与 `{ version, savedAt, lastTickAt, state }` JSON 导入导出。存档版本 6；更早的本地存档会重置并提示一次，旧版本文件拒绝导入
- 曲率科技树：8 个节点，花费未使用的曲率核心。效果跨发射保留
- Vitest 单元测试（`npm test`）：公式、队列、tick 等价性、离线、存档；节奏抽查脚本 `npm run sim`

未做：研究（P2）、造船与防御（P3）、银河与舰队（P4+）、拆除、队列长度升级、推荐卡组、目录重构、星系及以上。
