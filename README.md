# Infinity

**English.** Infinity is a sci-fi idle game about expanding from a single planet toward the multiverse. Automation is meant to be unlockable visual rule cards, not handwritten scripts. This repository is the v0.1 planet-surface scaffold: resources tick, facilities can be bought (including Buy Max), and a single square-root prestige stub can reset the surface.

从一颗行星的地表开始，向恒星系、星系、宇宙、多元宇宙扩张。当前版本是可玩的垂直切片，不是完整游戏。

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

- 三种资源：金属、晶体、重氢。地表风化每秒提供一点金属，所以一打开就能看到数字在跳。
- 五座地表设施：地表采矿机、晶壳钻探机、重氢冷凝井、磁选熔炉、前哨勘测塔。支持购买 1 台和最大购买。
- 占位声望「轨道上行」：按本轮扩张分的平方根获得遥测，重置地表，并用 `1 + √遥测` 提高产量。
- 存档写入 `localStorage`。可以导出 / 导入 JSON，顶层固定为 `{ version, savedAt, state }`。
- 离线或后台回来时会补结算，**上限 8 小时**（界面里写明了）。

界面是中文优先，设施名旁边有英文。代码和注释是英文。

## 存档示例

```json
{
  "version": 1,
  "savedAt": 1710000000000,
  "state": {
    "resources": { "metal": "10", "crystal": "0", "deuterium": "0" },
    "producers": { "miner": "1", "drill": "0", "well": "0", "smelter": "0", "survey": "0" },
    "lifetime": { "metal": "10", "crystal": "0", "deuterium": "0" },
    "telemetry": "0",
    "totalTime": "12"
  }
}
```

导入会按快照恢复状态，不会把存档里的 `savedAt` 再结算成离线收益。离线收益只在启动时根据本地存档的保存时间计算。

## 设计

完整设计、层级和自动化路线见 [docs/DESIGN.md](docs/DESIGN.md)。

## 许可证

[MIT](LICENSE)
