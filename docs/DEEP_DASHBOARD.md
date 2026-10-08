# 深空操作面板 R2

## 范围与基线

在原版 69eca71 路线的星环机 R1 发布提交 69eb287 上继续。新增在途充能信息、报告筛选、折叠规则与战斗回合；不重做原版导航、配色或建筑页。存档 v9/r3、游戏版本 0.6.0-alpha.1 不变；release.json 增加 deepUiVersion=deep-r2。

## 实际操作

深空页直接显示充能舰队的前往、驻留、返航阶段，剩余时间、当前阶段进度、出发港、舰数、舰载资源和驻留段数。进度分母使用当前阶段已过与剩余时间，兼容乱流／顺流改变返航时长。未结算时不查看未来结果，召回仍调用原舰队规则；返航中禁用重复召回。

报告可筛选全部、遭遇战、商人、舰队全损和待返航入库。任务结束但未入港的旧报告不误算为返航中。报告沿用星环机的15类图标，展开报告后仍需主动展开逐回合数据；可以保留已打开的回合视图。过滤和查看不扣资源、不发奖励、不改变随机状态。

四组长说明折叠：充能与回放、报价交易、残骸回收、战斗模型。关键风险仍常驻：黑洞保护不免除海盗或异星战损。商人摘要区分本港可成交与等待返航的联络，不把异地、过期、未来生效或额度耗尽的报价称为可交易。

## 线上验收故障修复

R1 的 Pages 构建、部署、62个实际文件哈希校验成功，但旧 browser-deep.py 公网验收失败：离线结算弹窗拦截银河按钮。不能把此前 R1 的 verify-live 说成通过。

正常场景的浏览器测试现在在页面实际初始化时设置测试存档时间，避免下载等待被误计为离线；导航前使用真实“关闭离线汇总”按钮，断言弹窗已关闭，不使用 force-click、移除弹窗、关闭保存或跳过测试。

新增 browser-deep-dashboard.py 故意使用61秒前的测试存档，确认真实离线弹窗出现、正常关闭后导航可用；再检查在途舰队、筛选、真实召回、存档和响应式布局。失败保留截图与JSON报告。

## 验证

本地构建通过；359项单元测试（原342 + 新17）通过。原版46项UI与素材哈希、15项独立图标哈希不变。新增代码不修改 src/game、src/core、src/automation 或 src/prestige，既有经济、概率、战斗和迁移规则保持原样。

本地导航受环境限制时使用 --inline。其内存存储／受控时钟检查与真实HTTP、原生localStorage、公网部署分别报告；不混称线上通过。完整CI与上线验收以对应提交的Actions产物为准。

截图使用实际引擎制造的测试场景，预置资源并在测试生成器内选种子；不是正常开局或玩家存档。深空战斗仍为六回合编队近似，不是完整OGame逐舰模拟。

## 复现

```sh
npm ci
npm run build
npm test
mkdir -p deep-fixtures
for s in pirate alien merchant blackhole-protected blackhole-risk; do
  node --import tsx scripts/deep-fixture.ts "$s" > "deep-fixtures/$s.json"
done
node --import tsx scripts/deep-dashboard-fixture.mjs > deep-dashboard-review.json
# 另一个终端运行 npm run preview -- --host 127.0.0.1 --port 4173
python scripts/browser-deep-dashboard.py
```

## 未包含

跨星球自动化、NPC完整经济与排名、军官、星球搬迁、建筑拆除、地形改造、高层重置和独立Imagen原画仍未加入。本次只在已有真实玩法上改善操作及验证，不宣称终版完成。
