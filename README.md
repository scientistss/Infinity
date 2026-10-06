# Infinity · 无限

从荒芜行星开始的单机网页科幻放置游戏。升级矿场和研究、组装可视化协议卡、制造舰船，逐步建立多星球帝国。

**当前版本：v0.5.0-alpha.2 / 存档 v9 / P4 可玩核心。** 这是可玩的开发版本，不是所有规划内容已经完成。完整交付范围、规则取舍和待办见 [P4 实现说明](docs/P4_IMPLEMENTATION.md)，设计愿景见 [DESIGN](docs/DESIGN.md)，自动化见 [AUTOMATION](docs/AUTOMATION.md)。

## 运行

推荐 Node.js 22、npm 10。通过锁文件安装，不要用旧 npm 重写锁文件。

```bash
npm ci
npm run dev
```

打开 Vite 提示的地址并保留 **`/Infinity/`** 路径，通常是 `http://localhost:5173/Infinity/`。生产构建与预览：

```bash
npm run build
npm run preview
```

静态生产包需要 HTTP 服务，不能直接双击 `index.html`。GitHub Pages 地址为 https://scientistss.github.io/Infinity/ ，其实际版本以 `main` 已部署版本为准，开发分支的代码不会自动上线。

## 已能玩到的循环

经济沿用 OGame 式资源三角、能源约束、等级建筑与付费队列，经济/研究速度为 600。保留原有 16 项研究、14 类舰船、10 类防御、13 张协议卡、22 个成就、暗物质道具、曲率科技与深空星环机信标版。

P4 核心新增 **帝国、银河、舰队、消息** 四页。银河有 5×100×15 个位置、确定性 NPC 邻居；舰队速度为 120，可预览航程/货舱/燃料，派遣运输、部署、殖民或侦察任务，也可以中途召回。

**殖民玩法**：完成天体物理、准备殖民船，在银河选择空位，设置殖民任务，装载可选启动物资后出发。成功抵达消耗一艘殖民船；新星球有自己的库存、建筑、造船与产量设置，护航船返回。顶栏可以切换星球。运输只转移库存，不凭空增加累计产出。

共享研究绑定出资星球，退款和研究所不会随界面切换而串星球。所有星球与在途舰队共用事件驱动的离线结算，基本上限 2 小时，曲率科技最高 8 小时；超出上限的时间舰队也暂停。

注意：“**发射殖民舰**”是旧的曲率重置按钮，不是派遣殖民船，会清空全部殖民地、库存与在途舰队。协议卡当前只作用于选中星球。NPC 侦察只出基础报告，不战斗。

## 尚未完成

回收/深空充能、NPC 经济和贸易、军官、跨星球协议卡、星图与更高层重置、战斗均未开放。大数库存已存在，但产率、能源、舰船计数和空间规模仍有工程上限；不能把当前版本理解为真正无边界的数值系统。已接入本对话生成素材的 50 个 WebP 切片。来源是 ChatGPT 图像生成工具，不是 Google Imagen；详情见 [视觉发布说明](docs/VISUAL_RELEASE.md)。

## 存档与测试存档

**升级不再自动清空 v8 进度。** 有效 v8 单星球存档会转换为 v9，保留库存、建筑、科技、三条队列、单位、协议卡和跨轮系统。本地升级须先写入并验证原文件备份；备份失败、损坏文件、v1–v7 或未来版本会暂停自动保存，原件不变。存档页可「导出保留的原存档」。手动导入有效 v8/v9 前也备份当前进度。备份仅在本浏览器，仍建议自行导出离线备份。旧站点不接受 v9。

存档键为 `infinity.save.v1`，信封 `{ version: 9, savedAt, lastTickAt, state }`。状态使用 `planets[]`、`activePlanetId`、帝国共享 `research`、`fleets[]`、`universe` 和消息；Decimal 资源以字符串保存。导入按快照恢复，不再次结算保存时间。

生成可直接演练殖民/运输的**预置资源双星球测试存档**：

```bash
npx tsx scripts/p4-fixture.ts > p4-review-save.json
```

从新版本“存档”页导入文件内容。它会替换当前进度，应先备份；它不是自然游戏进度或默认开局。

## 验证

```bash
npm run build
npm test
npm run sim -- 60
```

P4 核心加本次视觉/迁移共 209 项单元测试通过；原贪心策略首次达到 1e6 扩张分为 23.8 分钟。更多测试范围、隔离 DOM 检查命令、验证限制及具体数值见 [P4 实现说明](docs/P4_IMPLEMENTATION.md#6-复现验证)。

`.github/workflows/verify.yml` 验证分支和 PR；`pages.yml` 在合并到 main 后构建、测试并部署。开发必须经主题分支和 PR，不直接推送 main。

## 视觉与发布验收

50 个内容哈希 WebP 约 129 KiB，涵盖场景、资源、建筑、舰船、导航及徽章。全部走 BASE_URL，每次 build 校验 SHA-256。文字、数字、按钮和表单依然是原生 HTML；同族舰种共享部分图，协议卡保留 13 个语义 SVG 徽记。不是每项一张独立高清原画。

```bash
python -m pip install -r scripts/browser-requirements.txt
npx tsx scripts/p4-fixture.ts > p4-review-save.json
npm run preview -- --host 127.0.0.1 &
python scripts/browser-smoke.py --verify-dist
# 在不接触用户真实浏览器档案的隔离上下文中测试线上站点：
python scripts/browser-smoke.py --url https://scientistss.github.io/Infinity/ --verify-dist
```

需要 Chrome/Chromium。CI 执行真实 HTTP/localStorage、全部图像哈希和存档迁移验收；Pages 发布前后各执行一次。release.json 提供实际源码 SHA 和版本。受限环境中的 browser-dom-smoke.py 只作隔离 DOM 辅助测试，不冒充原生网络验收。

## 许可证

[MIT](LICENSE)。不使用 OGame 版权美术。
