# Infinity

**English.** Infinity is a sci-fi idle game about expanding from a barren planet toward the multiverse. Automation is visual protocol cards, not scripts. This repository is the planet-surface scaffold: mines tick, you can buy them, and launching a colony ship banks curvature cores.

从一颗荒芜行星的地表开始。当前是可玩切片，不是完整游戏。设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 在线

https://scientistss.github.io/Infinity/

推送到 `main` 后，GitHub Actions 执行 `npm ci` 和 `npm run build`，并把 `dist/` 发布到 GitHub Pages。

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

## v0.1 里能玩什么

- 金属、晶体、重氢，加上不累积的能源（供给/需求）。先点「手动采矿」，买下金属矿后资源会自己增长。
- 五座生产者：金属矿、太阳能电站、晶体矿、重氢合成器、机器人工厂。购买 ×1 / ×10 / 最大。开局赠送 1 座太阳能电站。
- 「发射殖民舰」：`floor(sqrt(产出分 / 1e6))` 个曲率核心。未花费核心每个 +2% 产出。曲率科技用核心换永久效果。
- 协议卡会执行：触发 + 条件 + 动作。在线大约每 1 秒求值一次，离线补算每 60 秒一次。规则见 [docs/AUTOMATION.md](docs/AUTOMATION.md)。
- 10 个成就，每个 +1% 全局产出。离开后再打开会弹出离线结算。
- 存档写入 `localStorage`。导出 JSON 为 `{ version, savedAt, lastTickAt, state }`（当前版本 5，更早的版本会迁入）。离线上限 **2 小时**，曲率科技最高 **8 小时**。

界面是中文优先，设施名旁边有英文。代码和注释是英文。

## 存档示例

```json
{
  "version": 5,
  "savedAt": 1710000000000,
  "state": {
    "resources": { "metal": "10", "crystal": "0", "deuterium": "0" },
    "producers": { "metal_mine": "1", "solar_plant": "1", "crystal_mine": "0", "deuterium_synth": "0", "robotics_factory": "0" },
    "lifetime": { "metal": "10", "crystal": "0", "deuterium": "0" },
    "warpCores": "0",
    "totalTime": "12",
    "manualClicks": 0,
    "seenEnergyShortage": false,
    "hasPrestiged": false,
    "unlockedCards": [],
    "protocols": { "accumulator": 0, "slots": [] }
  }
}
```

导入会按快照恢复状态，不会把存档里的 `savedAt` 再结算成离线收益。离线收益只在启动时根据本地存档的保存时间计算。

## 设计

完整设计、层级和自动化路线见 [docs/DESIGN.md](docs/DESIGN.md)。

## 许可证

[MIT](LICENSE)
