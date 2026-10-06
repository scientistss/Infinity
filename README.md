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
| `test` | 运行 Vitest 单元测试（公式、队列、研究、tick、存档） |
| `sim` | 节奏抽查：用真实规则模拟贪心玩家，打印关键时间点 |

## v0.3 里能玩什么

玩法按 OGame 移植阶段 1（P1）加阶段 2（P2）的研究部分：

- 金属、晶体、重氢，加上不累积的能源（供给 / 需求 · 效率）。开局 500 金属 / 500 晶体，星球每小时基础产出 30 金属 / 15 晶体。
- 建筑按等级升级，成本、产量、耗电和建造时间都用 OGame 社区公式，时间按宇宙速度 ×600 压缩。P1 开放：金属矿、晶体矿、重氢合成器、太阳能电站、核聚变反应堆、三种仓库、机器人工厂、纳米机器人工厂、造船厂、研究实验室。
- 研究：研究实验室建成后出现「研究」页。16 项 OGame 研究，成本 / 前置 / 时间按 OGame 公式（研究速度 ×600），整个帝国同时研究 1 项、再排 1 项。能源技术提高核聚变供电并是核聚变的前置，计算机技术每 2 级 +1 协议卡槽（上限 12）并是纳米工厂的前置，等离子技术提高矿产量。研究等级在发射殖民舰后保留。
- 建造队列：同时建 1 项，再排 1 项。入队时扣费，取消全额退还。机器人工厂和纳米工厂缩短建造时间。
- 仓库上限：资源满了对应的矿停产，顶栏显示容量条和“约 X 后满”。星球 163 格，每级占 1 格。
- “资源设置”里可以把每个矿和电站设为 0–100%。“概览”页列出产量和能源明细。
- 「发射殖民舰」：`floor(sqrt(扩张分 / 1e6))` 个曲率核心，重置建筑和队列。未花费核心每个 +2% 产出。曲率科技用核心换永久效果。
- 协议卡：触发 + 条件 + 动作，10 张目录卡（新增“研究调度”“最便宜优先”）。建造动作只把一级建筑放进队列。规则见 [docs/AUTOMATION.md](docs/AUTOMATION.md)。
- 18 个成就，每个 +1% 全局产出。离开后再打开会弹出离线结算，列出离线期间完成的建造和研究。
- 存档写入 `localStorage`。导出 JSON 为 `{ version, savedAt, lastTickAt, state }`，当前版本 **7**。测试期不迁移：本地旧存档会重置并提示一次，旧版本文件拒绝导入且不覆盖当前进度。离线上限 **2 小时**，曲率科技最高 **8 小时**。

界面是中文优先，建筑名旁边有英文。代码和注释是英文。

## 存档示例

```json
{
  "version": 7,
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
      ]
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
