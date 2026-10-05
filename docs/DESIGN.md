# Infinity — 游戏设计大纲 v0.1

**English.** Infinity is a web idle game about expanding from one barren planet toward the multiverse. Automation is visual protocol cards, not scripts. The name means unbounded expansion, not an Antimatter Dimensions infinity layer. This file is the design source of truth. The repository today is the planet-surface slice described at the end, including a running protocol-card engine.

> 类型：网页放置/增量 · Vite + TypeScript + break_infinity.js（大数走 `src/game/decimal.ts`）
> 核心卖点：**可视化协议卡** × **OGame 式星际扩张**

## 1. 愿景

你是一颗荒芜行星上的殖民指挥官。一开始只能亲手点击开采矿石，随后用协议卡把重复劳动交给机器人：自动建矿、自动调度能源、自动发射殖民舰。行星 → 星系 → 银河 → 宇宙 → 多元宇宙，每扩张一层，规模放大一个量级，角色也从操作员变成设计自动化的人。

与 Antimatter Dimensions 的差别：

- 不做「维度 N 生产维度 N-1」。生产者靠**资源三角 + 能源约束**联系，不靠层层相乘。
- 不设 1.79e308 的 Infinity 墙。重置由玩家选择（发射殖民舰），没有强制硬顶。
- 自动化是自己拼规则，不是买一个 Autobuyer 就结束。
- 每一层都有新的空间单位（星球 / 星系），不只是新的乘数。

## 2. 范围

| 范围 | v0.1 目标 | 后续（只预留） |
| --- | --- | --- |
| 层级 | 行星地表 | 星系 / 银河 / 宇宙 / 多元宇宙 |
| 生产者 | 5 个（§3） | 每层再加 3–5 个 |
| 重置 | 1 层：发射殖民舰（Sqrt） | 每层一种新重置 |
| 自动化 | 6 种协议卡，最多 6 槽 | 流程块连线、变量、子程序 |
| 系统 | 离线（有上限）、成就约 15 个、存档导入导出 | 挑战、事件、统计面板 |
| 不做 | 战斗、舰队、多人、商城、云存档 | — |

节奏目标：首次重置约 20–30 分钟；第 5 次重置时自动化基本接管地表。

## 3. 行星地表

### 资源

| id | 中文 | 说明 |
| --- | --- | --- |
| `metal` | 金属 | 基础资源 |
| `crystal` | 晶体 | 高级建筑与协议卡 |
| `deuterium` | 重氢 | 殖民舰与机器人 |
| `energy` | 能源 | **不累积**。效率 `eff = min(1, 供给/需求)`，不足时按比例降低所有矿的产量。界面显示红色警告和缺多少能源 |
| `warp_core` | 曲率核心 | 重置货币，跨轮保留 |

### 生产者

`cost(n) = base × growth^n`（n 为已拥有数量）。`rate = n × baseRate × 全局倍率 × 能源效率`。购买 ×1 / ×10 / 最大。

| id | 中文 | 基础成本 | growth | 效果 | 解锁 |
| --- | --- | --- | --- | --- | --- |
| `metal_mine` | 金属矿 | 10 金属 | 1.15 | +1 金属/秒，耗 1 能源 | 开局 |
| `solar_plant` | 太阳能电站 | 30 金属 + 10 晶体 | 1.17 | +5 能源 | 拥有 3 座金属矿 |
| `crystal_mine` | 晶体矿 | 60 金属 | 1.18 | +0.4 晶体/秒，耗 2 能源 | 本轮累计 100 金属 |
| `deuterium_synth` | 重氢合成器 | 300 金属 + 100 晶体 | 1.22 | +0.1 重氢/秒，耗 3 能源 | 本轮累计 500 晶体 |
| `robotics_factory` | 机器人工厂 | 1000 晶体 + 200 重氢 | 2.0 | 全部产出 ×1.25（乘算）；每 2 级 +1 协议卡槽 | 本轮累计 50 重氢 |

开局赠送 1 座 `solar_plant`，避免没有电就死锁。保留「手动采矿」按钮（每次 +1 金属）。全局倍率 = `(1 + 0.02 × 未花费曲率核心) × (1.25 ^ 机器人工厂)`。能源只削减矿的资源产量，不削减电站本身。

## 4. 扩张层级

| 层级 | 空间单位 | 解锁 | 本层重置 | 新自动化 |
| --- | --- | --- | --- | --- |
| **行星**（v0.1） | 1 颗星球的地表 | 5 个生产者、能源 | **发射殖民舰** → 曲率核心 | 协议卡 |
| 星系 | 多颗行星 | 星球特性、星际运输 | **恒星跃迁** → 星图 | 跨星球规则 |
| 银河 | 多个星系 | 航线、研究树 | **银河奇点** → 暗物质 | 流程块连线 |
| 宇宙 | 多个银河 | 物理常数 | **大坍缩** → 常数 | 变量、规则模板 |
| 多元宇宙 | 平行宇宙 | 同时跑多个宇宙 | **分支**：复制/合并 | 蓝图跨宇宙复用 |

每上一层，上一层的手动操作都应该能被自动化覆盖。

## 5. 协议卡

比喻是指挥中心的协议板。玩家从卡库拖入卡槽，用下拉框填参数，不写代码、不输入表达式。

每张卡读成一句中文：「**当** 每 5 秒 **若** 能源 < 100% **则** 建造 太阳能电站 ×1」。状态灯：绿=已执行，灰=条件不满足，红=资源不足。可单独开关。从上到下是优先级，可拖动排序。

```ts
type Trigger = { kind: "interval"; seconds: number } | { kind: "onResource"; res: ResId; gte: string };
type Condition =
  | { kind: "resourceGte" | "resourceLt"; res: ResId; value: string }
  | { kind: "energyEffLt"; value: number }
  | { kind: "ownedLt"; producer: ProducerId; value: number }
  | { kind: "costRatioLt"; producer: ProducerId; ratio: number };
type Action =
  | { kind: "buy"; producer: ProducerId; amount: 1 | 10 | "max" }
  | { kind: "collect" }
  | { kind: "prestige"; minGain: number };
interface ProtocolCard {
  id: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  action: Action;
}
```

引擎每 1 秒按卡槽顺序评估，每张卡每次最多执行 1 次。数值存字符串，加载时转 `Decimal`。

| 顺序 | 卡片 | 解锁 |
| --- | --- | --- |
| 1 | 自动采集 `collect` | 手动点击 100 次 |
| 2 | 自动建造（间隔 + buy） | 拥有 10 座金属矿 |
| 3 | 资源阈值 / 拥有数量 | 首次能源不足 |
| 4 | 成本比例 `costRatioLt` | 拥有 1 座机器人工厂 |
| 5 | 能源效率 | 首次重置后 |
| 6 | 自动重置 `prestige` | 累计 10 曲率核心 |

卡槽：初始 1，机器人工厂每 2 级 +1，曲率科技可永久 +1，上限 6。另有 3 个推荐卡组模板。

## 6. 发射殖民舰

- 产出分 `score = 金属累计 + 3×晶体累计 + 10×重氢累计`（本轮）。
- `gain = floor(sqrt(score / 1e6))`。分数不到 1e6 时按钮不可用。
- 按钮显示「可得 X 核心，下一个还需 Y」。
- 清空：金属、晶体、重氢、全部生产者。
- 保留：曲率核心、曲率科技、成就、协议卡配置。每轮开始重新获得 1 座太阳能电站，避免死锁。
- 未花费核心：每个 +2% 全局产出（加算）。曲率科技约 8 个节点（开局资源、基础产出 ×2、growth −0.01、离线上限 +2 小时、永久卡槽 +1、手动采集 ×10 等），花费核心，本脚手架未实装。

## 7. 系统目标

- 离线：批量计算，基础上限 **2 小时**，科技可到 8 小时。离线时协议卡按每 60 秒简化执行。回归时汇总。
- 成就约 15 个，每个 +1% 全局产出。未实装。
- 存档：localStorage；导出目标是带 `version` 的 JSON（设计上可再包一层 base64）。导入失败不得覆盖当前局。大数用十进制字符串。
- 目标目录：`src/core/`、`src/automation/`、`src/prestige/`、`src/save/`、`src/ui/`、`src/data/`。当前代码仍在 `src/game/` 与 `src/ui/`。

## 8. UX

要让玩家看见下一步、看见每张卡为什么执行或没执行、看见每秒产量和重置预览。不要让玩家写代码或表达式。不要把自动化做成一个没有参数的开关。不要套娃相乘。不要藏公式。小于 1e6 用千分位，更大用科学计数。

## 9. 开放问题

能源是比例降效还是硬性停工；+2% 未花费核心会不会让人永远不花；6 个卡槽是否太紧；离线协议卡是完整执行还是简化；星系层的多星球是独立地表还是共享资源池；要不要挑战模式；美术是纯界面还是加星球示意图；副标题要不要写成 Infinity: Expanse 以和 AD 区分。

## 10. 当前脚手架

仓库里已经跑起来的只有地表循环：

- `tick(state, dt)`、三种累积资源、能源供给/需求、上表五座生产者、×1 / ×10 / 最大
- 手动采矿、开局 1 座太阳能电站、解锁条件
- 发射殖民舰与曲率核心的 Sqrt 公式，以及 +2% 未花费核心
- 协议卡引擎执行已装配的卡。在线大约每 1 秒，离线每 60 秒。目录在 `src/data/protocol-cards.ts`，求值在 `src/automation/`。说明见 [AUTOMATION.md](AUTOMATION.md)
- localStorage 与 `{ version, savedAt, state }` JSON 导入导出；离线上限 2 小时。存档版本 3，版本 1 和 2 会迁入

未做：曲率科技、成就、推荐卡组、base64、目录重构、星系及以上。
