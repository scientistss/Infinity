> **原版 P4 银河与舰队 v1**：已接通银河、运输、部署、殖民与基础侦察。独立开发存档为 v9 / r2；此前 r1 原件会被保护而不会自动迁移。深空充能、回收、商人和战斗尚未开放。详见 `docs/P4_SPACE.md`。

> **原版续作 P4-1**：本分支是从原始 `69eca71` 继续的 P4-1 多星球基础；保留原版 UI，尚未实现派舰殖民或深空充能。使用独立开发存档键，不覆盖现有线上存档。实现与测试见 [P4-1 说明](docs/P4_ORIGINAL_01.md)。

# Infinity

**English.** Infinity is a sci-fi idle game about expanding from a barren planet toward the multiverse. Automation is visual protocol cards, not scripts. This repository is the planet-surface slice: OGame-style buildings upgraded by level through a build queue, storage caps, energy, and a colony-ship launch that banks curvature cores.

从一颗荒芜行星的地表开始。当前是可玩切片，不是完整游戏。设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 在线

https://scientistss.github.io/Infinity/

推送到 `main` 后，GitHub Actions 执行 `npm ci`、`npm run build` 和 `npm test`，并把 `dist/` 发布到 GitHub Pages。

## 运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

浏览器打开终端里提示的本地地址。生产构建：

```bash
npm run build
npm run preview
```

| 脚本 | 作用 |
| --- | --- |
| `dev` | 启动 Vite 开发服务器 |
| `build` | 类型检查并打包到 `dist/` |
| `preview` | 预览生产构建 |
| `test` | 运行 Vitest 单元测试（公式、队列、研究、造船、tick、存档） |
| `sim` | 节奏抽查：用真实规则模拟贪心玩家，打印关键时间点 |

## v0.4 里能玩什么

玩法按 OGame 移植阶段 1（P1）、阶段 2（P2，研究、暗物质、深空星环机信标版）和阶段 3（P3，造船厂与防御）：

- 金属、晶体、重氢，加上不累积的能源（供给 / 需求 · 效率）。开局 500 金属 / 500 晶体，星球每小时基础产出 30 金属 / 15 晶体。
- 建筑按等级升级，成本、产量、耗电和建造时间都用 OGame 社区公式，时间按宇宙速度 ×600 压缩。P1 开放：金属矿、晶体矿、重氢合成器、太阳能电站、核聚变反应堆、三种仓库、机器人工厂、纳米机器人工厂、造船厂、研究实验室；P3 加导弹井。
- 研究：研究实验室建成后出现「研究」页。16 项 OGame 研究，成本 / 前置 / 时间按 OGame 公式（研究速度 ×600），整个帝国同时研究 1 项、再排 1 项。能源技术提高核聚变供电并是核聚变的前置，计算机技术每 2 级 +1 协议卡槽（上限 12）并是纳米工厂的前置，等离子技术提高矿产量。研究等级在发射殖民舰后保留。
- 暗物质：每解锁 1 个成就 +500 暗物质，拿到第一笔后出现「暗物质」页和顶栏计数。用途按 OGame 价格公式，时间走「暗物质时钟」（1 个 OGame 小时 = 1 分钟游戏时间）：在建项目和在研项目「减半」/「完成」（每开始 30 秒 750，单次上限 72,000 / 108,000）；道具商店（克拉肯 / 纽特隆 / 底特律加速，与按钮同价、可顺延；金属 / 晶体 / 重氢加成 +10/20/30%，持续 168 分钟）；资源包（1 个 OGame 日 = 24 分钟的产量 36,000，可按 10/25/50/100% 购买，受仓库剩余容量限制）。所有价格都在 `src/data/balance.json`。
- 深空星环机（信标版）：天体物理学 1 级后出现「星环机」页，并送 1 次至少大档的奖励开奖。7×7 街机面板一圈 24 个图块，一盏灯跑约 3 秒停在预先掷好的结果上（可跳过动画、可全部开奖）。每 30 分钟游戏时间攒 1 次信标开奖（离线也攒，最多存 3 次），也可以花重氢加注（价格每 24 小时内翻倍）。图块：金属陨石 / 晶簇 / 重氢云（奖池 × 档位，最多帝国 10 分钟产量）、漂流舰（P3，价值为资源奖品的一半，只出已解锁及高一档的舰船）、暗物质 300–700、补给箱（道具进背包）、空域、引力乱流 / 曲速顺流（改变信标冷却）、LUCKY 送灯、JACKPOT。金属 / 晶体 / 重氢 / 漂流舰都能押注，按 `0.9 / 概率` 赔付（期望 90%），押注常驻。空灯保底 5、大奖保底 50，赔率表和命中统计常驻显示。手动开奖 10 次后解锁协议卡「自动跑灯」。
- 造船厂与防御（P3）：造船厂 1 级后出现「造船厂」「防御」页。14 种舰船、10 种防御，成本 / 属性 / 引擎 / 前置 / 快速射击按 OGame。每个单位耗时 `(金属 + 晶体) / (2500 × (1 + 造船厂) × 2^纳米)` 小时 ÷ 600，按批次下单（输入数量 / 最大 / 补到 N），下单扣全款、取消退还没造完的部分，队列最多 10 批；造船厂或纳米工厂升级时暂停。太阳能卫星每颗供电 `⌊(T_max + 140) / 6⌋`（母星 30）。护盾罩各限 1 个，导弹井每级 10 格。暗物质「减半 / 完成」和底特律道具（750 / 4,500 / 9,000 暗物质，造船缩短 30 秒 / 3 分 / 6 分，可顺延）也能用在造船上；星环机的补给箱也会掉底特律（当前批次 −30%）。航行（P4）和战斗（P5）还没有，卡片先显示含科技加成的属性和航速。
- 建造队列：同时建 1 项，再排 1 项。入队时扣费，取消全额退还。机器人工厂和纳米工厂缩短建造时间。
- 仓库上限：资源满了对应的矿停产，顶栏显示容量条和“约 X 后满”。星球 163 格，每级占 1 格。
- “资源设置”里可以把每个矿和电站设为 0–100%。“概览”页列出产量和能源明细。
- 「发射殖民舰」：`floor(sqrt(扩张分 / 1e6))` 个曲率核心，重置建筑和队列。未花费核心每个 +2% 产出。曲率科技用核心换永久效果。
- 协议卡：触发 + 条件 + 动作，13 张目录卡（P2 新增“研究调度”“最便宜优先”“自动跑灯”，P3 新增“卫星供电”“防御维护”）。建造动作只把一级建筑放进队列。规则见 [docs/AUTOMATION.md](docs/AUTOMATION.md)。
- 22 个成就，每个 +1% 全局产出。离开后再打开会弹出离线结算，列出离线期间完成的建造、研究和舰船 / 防御。
- 存档写入 `localStorage`。导出 JSON 为 `{ version, savedAt, lastTickAt, state }`，当前版本 **8**。测试期不迁移：本地旧存档会重置并提示一次，旧版本文件拒绝导入且不覆盖当前进度。离线上限 **2 小时**，曲率科技最高 **8 小时**。

界面是中文优先，建筑名旁边有英文。代码和注释是英文。

## 存档示例

```json
{
  "version": 8,
  "savedAt": 1760000000000,
  "lastTickAt": 1760000000000,
  "state": {
    "resources": { "metal": "500", "crystal": "500", "deuterium": "0" },
    "planet": {
      "name": "母星",
      "tempMax": 40,
      "fieldsMax": 163,
      "buildings": { "metal_mine": 0, "crystal_mine": 0, "solar_plant": 0, "robotics_factory": 0, "…": 0 },
      "productionPct": { "metal_mine": 100, "crystal_mine": 100, "deuterium_synth": 100, "solar_plant": 100, "fusion_reactor": 100 },
      "buildQueue": [
        {
          "building": "metal_mine",
          "targetLevel": 1,
          "paid": { "metal": "60", "crystal": "15", "deuterium": "0" },
          "totalSeconds": 1,
          "remainingSeconds": 0.4,
          "source": "manual"
        }
      ],
      "units": { "light_fighter": 0, "solar_satellite": 0, "…": 0 },
      "shipyardQueue": [{ "unit": "solar_satellite", "count": 10, "progress": 0.25, "source": "manual" }]
    },
    "research": { "levels": { "energy_tech": 0, "computer_tech": 0, "…": 0 }, "queue": [] },
    "darkMatter": "0",
    "lifetime": { "metal": "0", "crystal": "0", "deuterium": "0" },
    "warpCores": "0",
    "totalTime": "0",
    "unlockedCards": [],
    "protocols": { "accumulator": 0, "slots": [] }
  }
}
```

（节选；完整存档还包含曲率科技、成就和统计字段。`buildings` 列出全部 19 座建筑的等级。）

导入会按快照恢复状态，不会把存档里的 `savedAt` 再结算成离线收益。离线收益只在启动时根据本地存档的保存时间计算。

## 设计

完整设计、层级和自动化路线见 [docs/DESIGN.md](docs/DESIGN.md)。

## 许可证

[MIT](LICENSE)
