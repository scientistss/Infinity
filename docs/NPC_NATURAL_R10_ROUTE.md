# NPC 旧版自然侦察路线：独立 test-only 候选

## 状态与精确来源

已执行证据来自精确 ac3/r10 的原领域API：无改动原件，真实研究、造探针、两次身份侦察、返航、严格保存读回及全资源来源核算。该已跑路线累计66游戏秒，1644项检查通过。它没有NPC经济，不能称NPC库存玩法、native浏览器、CI或发布验收。

本提交的 `scripts/npc-natural-r10-route.mjs` 是独立 Node 验收 runner。最初 portable `.mts` 实际通过1769项领域检查，但因项目浏览器 TypeScript 配置没有 Node 类型且不允许扩展名导入而构建失败。随后固定 ES2022/ESNext 转为普通 `.mjs`，保留运行时断言；不修改生产、依赖或 TypeScript 门禁。旧 portable 原文另存为 `docs/evidence/npc-r10-route/portable-original-script.mts.txt`，下列历史证据不因此改写。此前报告不能绑定到此新脚本，更不能冒充当前候选CI。适配只改变路径与源码绑定门禁、增强“仅键序变化”的字节证明；不改支付、时长、燃料、产出期望或数值容差。

- 历史领域源码：ac3cce98403bea1e7162bcb4092e4cfeeb448a9a。
- 固定生产src树：8df1d4635cfb04c3bb35666ea7b1380fccb1d47f。
- 原件：tests/fixtures/demolition-origin-r10-save.json，35551字节，SHA-256 d456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a。
- 准备时只读检查的NPC候选：1b648fca6f5124ff13acf2f41664dc5d16831428，其src树与ac3相同。
- 实际已跑脚本原文：docs/evidence/npc-r10-route/executed-ac3-script.mts.txt；hash 8f79af61fe987d632dc23b158527fa44523b9981ac601b703abd35657737d3af。
- 已跑匿名报告：docs/evidence/npc-r10-route/observed-ac3-report.json；hash bfeccc61f6827627d243920564846db58c64d799fa9e0b1a0afce09e0795a129。

## Portable执行合同

从仓库根执行：

```sh
timeout --signal=TERM --kill-after=5s 300s node --import tsx \
  scripts/npc-natural-r10-route.mjs --output /tmp/npc-natural-r10-report.json
```

允许实际HEAD是NPC的test/docs候选，而不是强制HEAD=ac3。必须同时验证：HEAD:src树等于固定ac3树；src无tracked改动、无untracked或ignored附加文件；逐个运行src文件的原始字节与git show ac3:path完全一致；依赖声明与ac3相同，package-lock原字节相同。报告记录actualGitHead、domainSourceSha、源码文件hash、脚本hash和实际工作树状态。脏的test/docs工作树不会被伪称干净；更改任何生产src会拒绝。

输入固定为已有r10原件，不提供钱包、科技、船或时间覆盖参数。输出默认仓库根npc-natural-r10-report.json，也可显式--output；输出必须是不存在的新文件，拒绝源码目录，且使用排他创建防止覆盖原件、源码或既有报告。只写匿名报告，不保存完整存档payload。计划上限为300主机秒、120模拟秒、130次tick、10个付款动作；外层timeout独立兜底。运行前后原件hash不变，实际采用的时间只能由原tick推进。

## 已跑的自然闭环

- 原始科技燃烧2，先用真实orderUnits证实不能造探针且拒绝无副作用。
- 母星真实研究燃烧2→3，job202，1600金属+2400重氢，1秒后完成。
- 真实造1探针，job203，1000晶体，由造船tick完成。
- 固定种子20261010，目标[1:56:6]，独立32位散列核定晨星共同体56-6。
- 真实舰队4在总游戏25812出发、25813抵达、25814返航；单程1秒，每次真实预付4重氢，空货物，货舱7。
- 正常等60秒，舰队5在25874出发，25874.5保存/严格读回，25875抵达，25876返航。与不中断控制路径完整状态一致。
- 两条scout报告是现有静态identity文案，id为scout-4/scout-5，时间25813/25875。第一份text/at不变，最终仍仅1探针、无在途舰队、nextFleetId6。
- 总真实支出1600M、1000C、2408D；每tick两颗星球全部钱包及lifetime均按独立冻结公式核算，cap截断不算产出，最终守恒。没有调用同一个quote/economy生成自己的期望。
- 不领取星环；原有计划/授权、随机域、旧消息、建筑/比例/地形账、暗物质/核心/道具保持原规则。容差固定1e-7+abs(expected)*2e-14。

## 原红保留与仅键序差异

首轮在probe-paid-unfinished的“首轮导出字节全等”断言停止，102项通过，已研究完成并付探针费，尚未造完/侦察；不能将其抹掉。

- 原红报告：docs/evidence/npc-r10-route/attempt1-failed-report.json，hash ac2b765b065790f3df2b2b7c63dd3d1262111691d09a56b87e1ba5d7dcf93ef0。
- 原红脚本：docs/evidence/npc-r10-route/attempt1-script.mts.txt，hash 24bc2343be6d36b522a74623ecdca9cf2c687277b7b57b5b502c70945a23ca99。
- 原红现场没有捕获该节点两hash；下面是获准从原件完整重跑、同源同前缀得到的复现证据，不回填冒充现场捕获。原红报告的originalBytesUnchanged=false是旧脚本把该标记与整体成功挂钩的粗糙结果，不是观察到输入被改；独立事后hash及完整重跑均确认原件未变。本portable版将此标记改为运行后实际重新读取输入hash，读不到则null，不再从整体通过与否推断。

源码路径：shipyard.ts:303–306创建以jobId/taskId开头的order；save.ts:430 spread序列化保持该键序；save.ts:483–494 reader重建以unit/count开头。完整最小差异只有 $.state.planets[0].shipyardQueue[0] 对象键序：

```text
jobId, taskId, unit, count, orderedCount, paidPerUnit, progress, source
→ unit, count, orderedCount, paidPerUnit, progress, source, jobId, taskId
```

前后均29143字节。复现首次导出hash 7adf47d4adbae6f543ce7040b1a7c450b6df9d4bf3522c674c1a6e2c9b442f54，规范导出hash 85c67ad550bc77486eea71173d2d73ffcb6ab98e74ba924da626976666caaee4。完整封套值/字段/数组严格相等，无经济数值变化；二轮规范读回字节稳定。原文件永远按原字节保存。

已跑报告也逐项记录舰队elapsed/returning和新增消息at/text同类键序变化。本portable版增加更强的断言：仅将规范值对象恢复为首次键序后，JSON.stringify输出必须精确还原首次导出字节。它同时保留全封套值严格深等、第二次完整状态深等和二轮导出字节稳定，不能只报语义比较就忽略未知文本变化。

## 证据与发布边界

匿名报告含工程资源/时间/舰队数据，不含账号、凭据、完整存档或星环待开奖payload。完整文件摘要见docs/evidence/npc-r10-route/manifest.json。旧已跑报告始终绑定其实际已执行脚本；portable版需要另行在实际候选SHA执行并保存新报告后才可声称通过。不要为了适配修改经济、当前生产或原件；失败立即保留并报出。
