# 天体物理学解锁说明：最小显示修正

## 范围与真实规则

本阶段只修正研究卡片的失效显示后缀，不增加玩法。当前已交付的精确游戏来源为
[6f73735534ffc1b0e47a01935d8c6e3ff786c989](https://github.com/scientistss/Infinity/commit/6f73735534ffc1b0e47a01935d8c6e3ff786c989)，
**0.6.30-alpha.1 / v9 r14**。其自己的[完整候选 CI 38358775560](https://github.com/scientistss/Infinity/actions/runs/38358775560)
于 2026-10-13 07:21:33 UTC 成功；精确 release 与 62 个资源核对后，07:28 UTC
已交付隔离私人试玩，原生发布终态 succeeded。前一已发布版本为
[49303d3740cf223955386ff984b335ca9b110087](https://github.com/scientistss/Infinity/commit/49303d3740cf223955386ff984b335ca9b110087)
（0.6.29-alpha.1 / v9 r14），也是本次显示对照的固定旧源。后续文档提交不改变
已发布应用来源，也不继承游戏提交的 CI 状态。

唯一应用源码改动是 `src/ui/present.ts` 的 `researchEffect`：删除天体物理学未到
1 级时附加的 `（第 2 阶段后续版本开放）`，同时删除因此不再使用的 `levels` 局部变量。

- 现有定义 `src/data/research.ts` 的效果仍是 `1 级解锁深空星环机（信标版）`。
- `src/game/arcade.ts` 的真实开放条件仍是已完成的天体物理学等级 ≥ 1。
- `src/ui/present.ts` 的研究页开放条件仍包含已完成研究实验室 ≥ 1。
- 研究费用、实验室 3 / 间谍技术 4 / 脉冲引擎 3 前置、付费队列、完成计时、存档、
  游戏数据及其他 `later` 文本全部不改。排队但未完成的天体物理学 1 级仍不开放星环机。

修正后的应用文件 SHA-256：
`9f40aa07c776b40cd2b3be866a9dcc11a72ffdbca55d86d96029251d1f0de6f3`。
相对 493 的全部 `src` / `public` 差异只有上述两行删除；版本与验收接线另行记录，
没有经济、规则或存档改动。独立来源封存、原生浏览器、完整 CI 和实际发布证据见下文。

## 定向单元检查

`tests/research-unlock-copy.test.ts` 共 9 项：

1. 真实初始工厂输出不开放研究和星环页面。
2. 实验室 1 / 天体物理学 0 显示现有效果，保留价格、时间和全部前置。
3. 已完成天体物理学 1 仍按现有规则开放星环机。
4. 真实 `enqueueResearch` 付费但未完成时仍关闭；真实 `tick` 完成后才开放。
5. 其他全部研究卡片在受影响的天体物理学等级边界两侧相同；全部 `later` 文本及
   能源、计算机、等离子的特殊效果文本不变。
6. 0 级、1 级和已付未完三种情况各自进行递归冻结、重复全量与可见页投影、完整内存
   JSON 与完整序列化字节检查，并确认三个持久种子不变、没有调用 `Math.random`。
7. 使用工厂支持的两个种子参数得到相同初始字节，资源仍为 500 / 500 / 0，全部建筑
   和研究仍为 0，没有调用新熵。

这些研究边界单元样本明确是合成状态，不能冒充自然成长来源。跨版本的所有卡片和
完整状态对照由相同原始来源的两个真实读者及原生浏览器检查另行提供。

2026-10-13 局部实跑：9/9 通过，`tsc --noEmit` 通过。首轮 2 项断言使用了错误的
数字显示格式（`4000` 与 `0`，实际既有格式为 `4.00e3` 与 `0.00`）；保留失败日志，
仅更正测试期望后重跑通过，没有为测试修改游戏格式或规则。

## 独立自然来源：第一座实验室

`scripts/research-unlock-copy-fixture.mjs` 独立使用当前真实 API，不读取或复制旧自然
报告或旧自然生成器；本阶段的来源与结果独立封存，不借用其他未交付候选的材料。

```sh
node --import tsx scripts/research-unlock-copy-fixture.mjs generate --out research-unlock-copy-fixture
node --import tsx scripts/research-unlock-copy-fixture.mjs read \
  --source-root /path/to/actual-candidate \
  --input research-unlock-copy-fixture/raw-first-lab.json \
  --out research-unlock-copy-candidate-reader.json
node --import tsx scripts/research-unlock-copy-fixture.mjs read \
  --source-root /path/to/actual-released-493 \
  --input research-unlock-copy-fixture/raw-first-lab.json \
  --out research-unlock-copy-before-reader.json
```

`generate` 从一次真正的 `createInitialState(20261013, 49303029)` 开始。第二参数是
已有 API 提供的星环随机种子参数，第一参数固定世界；不改经济状态来固定随机数。
每次生成记录真实初始原始字节和 SHA-256，两个实际版本消费同一份字节，不能各自重建
一份“看起来相同”的来源。使用新的输出目录；原始文件和读者报告默认拒绝覆盖。

实际路线：

- 引擎时间 0：由 500 金属 / 500 晶体支付太阳能电站 1，费用 75 / 30 / 0。
- 引擎时间 0：继续支付重氢合成器 1，费用 225 / 75 / 0，剩 200 / 395 / 0。
- 用真实 `tick(..., "live")` 完成两个已付建筑，每次最多推进 1 秒。
- 无手动采集、无额外建筑、无资源修改，继续每秒正常产出直到能支付实验室。
- 本次引擎时间 87：库存 639.25 / 614.625 / 201.46133333331798，实际支付实验室 1
  的 200 / 400 / 200。
- 引擎时间 88：实验室 1 完成；天体物理学仍为 0，研究页开放，星环机仍关闭。

共 3 次实际付款、88 次真实引擎 tick、91 条行动记录。真实引擎自然授予
`first_deuterium` 和 `first_lab` 两个成就及合计 1000 暗物质；既没有注入奖励，也没有
屏蔽奖励或其生产影响。全程没有研究等级/资源/建筑直接赋值，没有手动采集、道具、
暗物质加速、协议、计划或浏览器时钟加速。三个初始持久种子保持不变。

生成器有限边界为 300 引擎秒和 320 条行动；遇到资源以外的前置阻塞或未取得真实进展
会失败并保留初始字节及已走的路径，不更改经济以“修通”样本。

这是加速自然域引擎推进，不是 88 秒真人或浏览器实时试玩。两个导出保持明确相同的
真实源墙钟水位，推进的游戏时间记录在 `totalTime`，不伪造经过的墙钟时间。浏览器
检查仅通过真实 UI 导入并继续这个已赚取检查点；如果固定浏览器时钟进行精确对照，
必须在浏览器报告中单独披露这一限制，不能宣称自然墙钟旅程。

## 文件与来源合同

生成输出：

- `raw-initial.json`：真实工厂的完整 `exportSave` 字节。
- `raw-first-lab.json`：仅经过上述真实付款和 tick 后的完整 `exportSave` 字节。
- `receipt.json`：`infinity-research-unlock-natural-v1`，含 `status`、`passed`、
  `completed`、`sourceSha`、完整 `source`、`initialFactory`、时间/行动上限、全部行动、
  付款 job、前后资源/队列/研究/建筑/种子/成就/统计/经济快照、完整序列化状态哈希、
  实际完成事件、两个原始文件路径和哈希。失败时保留 `status: failed` 和错误。
- `expected-view.json`：`infinity-research-unlock-expected-v1`，由候选真实读者读取
  同一原始文件后生成，含文件版本、水位、来源、原始字节/完整状态哈希、完整视图、
  研究面板、天体物理学卡片、两个真实开放判定与投影无修改断言。

`read` 报告为 `infinity-research-unlock-reader-v1`，从 `--source-root` 动态加载该
实际版本的 `importSave`、`deserializeState`、`presentVisible` 和真实规则，完整
验证并读入所给原始文件，返回完整状态哈希与实际视图。它不替换旧版代码、不裁剪状态，
也不为旧版注入候选显示结果。

每份 `source` 记录实际 Git HEAD、与 HEAD 不同的受跟踪应用文件名、全部受跟踪
`src` 文件及 `package.json` / `package-lock.json` 的实际 SHA-256 清单和清单哈希，
并单独绑定生成器字节。`sourceSha` 是实际 HEAD；本地未提交检查必须同时查看
`changedSourceFiles` 和实际文件哈希，不能把 HEAD 当作已包含工作树改动。

历史局部试跑的固定证据（不同于下列最终 CI；新一次生成会拥有新的墙钟时间和原始字节哈希）：

- 原始初始字节：`e9059e8ebaab86ed56e0be0109859a2450421f0ee4ab0e50e3e2e33299bd5bee`
- 原始第一实验室：`2772ec7ba0e8bcc45c9c8e7865300a4c4a986788e8b482e586b2fae731266872`
- 行动回执：`d094d4dffea8200ddba1b7b2d96dcee326c0975badcfe91d819b93375186ca67`

该次历史局部试跑的候选真实读者读取成功且完整投影无状态改动；当时未运行完整测试、
构建、旧版读者、原生浏览器或发布。以下为后来针对精确 6f 独立完成的验收，不能
将它追记为早先局部检查已经完成的工作。

## 精确完整验收与原始产物

[完整候选运行 38358775560](https://github.com/scientistss/Infinity/actions/runs/38358775560)
绑定精确 6f：`verify`、`verify-continuation`、`npc-orbital`、`scout-rehearsal`、
`lab-blockers`、`manual-unit-payments`、`manual-unit-authority` 七个必需作业和
`required-gates` 汇总均为 success。4632 项单元全部通过，没有失败、待运行或跳过的
单元项；37 份既有原生报告共 50,820 项检查通过。本次新增的 439 项原生检查另行
通过，合计 51,259 项报告检查；这些是各自范围内的检查数，不是玩法完成度。

同次运行的八份原始归档均已核对：七份游戏归档中的 626 个跟踪文件字节／模式与
精确 Git 树一致，62 个生产资源及 release 一致；第八份汇总归档的实际分组清单与
原始报告重新计算的结果一致，不把汇总小包称为另一份完整源码包。

- [原始 verify 产物 11794392841](https://github.com/scientistss/Infinity/actions/runs/38358775560/artifacts/11794392841)：45,368,726 字节；ZIP SHA-256 `a1770d20332f8d606adfd0dabecce7d50ef0a362bf49979a1e01351ff7cabb12`。
- 其中 `source.zip`：3,825,230 字节；SHA-256 `ce8e6f36878c98e4f8b380a73c0a97ce03b4a6796f99deb58a08752959078fcc`，包含 626 个跟踪文件。
- `release.json` SHA-256：`96416bd85b3735f6f1746dccb288befc4a93ed090b9e6f019ff4f6360c847834`。
- 本次原生显示报告 `research-unlock-copy-browser-evidence/report.json` SHA-256：`a0e103b50488d5e0957cc1d30a2a2c829952db8217a4a533b387d134d56919c1`。
- 同次生成的第一实验室原始文件 SHA-256：`803443baeb695c9ea1d212bcdab26d5a355caf8671454fa62f10ea9312d4f31c`；行动回执 SHA-256：`aad12b277076be893ed447e8c07feb7d826e530082a9bc404193f470e813b8cc`。它们属于这一次 CI，不能替换上节历史试跑的原始字节。

恢复应用首选完整的精确 6f Git checkout。原始产物中的 `source.zip` 可恢复公开
跟踪源码和匿名验收材料，但不含 Git 历史、node_modules 或完整离线工具链；完整
来源合同重跑仍需要锁文件依赖和固定历史 Git 对象。Actions 产物可能到期，固定
Git 提交是首要恢复依据。源码归档已按 `TZ=UTC git archive` 逐字节核对；其他时区可能改变 ZIP 头时间而不改变成员源码，核验应固定 UTC。文档后继不改上述已发布产物身份。

## 原生旧新显示与保存对照

精确旧 493 和新 6f 分别在 320 / 390 / 768 / 1440 CSS px 运行，共八个阶段。
两端真实读者与浏览器消费同一份独立赚取的第一实验室原始文件；不向旧版本注入
新版结果，不从合成高等级状态冒充第一实验室自然来源。

- 每阶段通过真实 UI 导入，并执行两次实际可信 Save 点击；保存前后完整状态不变，原生 localStorage 写入与读回均核对。
- 对照真实完整读者状态、全部研究卡片、研究面板 DOM／文字／控件；只允许天体物理学唯一效果节点删除旧后缀，价格、前置、等级、禁用状态及其他卡片保持一致。
- 两端各 62 个 HTTP 资源及八个阶段实际执行的 V8 资源绑定精确构建；不能用无关服务器返回值或仅存在于磁盘的脚本替代执行证据。
- 八张原始分辨率截图逐张独立检查：四宽完整卡片、效果、前置、费用及禁用按钮可见，没有裁切或遮挡。原有布局及灰色禁用样式保留；该像素检查独立于几何断言。
- 原生报告 439 项全部通过，worker 正常退出，监督报告没有残留所属进程。

自然来源是初始 500 / 500 / 0、三次真实建筑付款、88 个模拟秒／91 条行动，
不是 88 秒真实浏览器游玩。浏览器从这个已赚取检查点导入，`Date` 与
`performance` 值固定在来源水位，用于精确旧新状态和 DOM 对照；原生 RAF 调度、
定时器、Storage、文件读取、确认和点击保留。四宽是桌面浏览器的 CSS 视口，
不等于四种实体设备、Safari 或用户电脑验收，也不证明真人长期成长与平衡。

## 保留失败与开发分支推广

以下完整运行仍按原结果记录，成功的后继不把原红改为绿：

1. [80c0598](https://github.com/scientistss/Infinity/commit/80c0598c6f20469de4fe60bbf804896681c54bbd)／[38351203274](https://github.com/scientistss/Infinity/actions/runs/38351203274)：旧性能基准的精确源码哈希合同失败，不能只引用其中已通过的工作。
2. [e0cba6a](https://github.com/scientistss/Infinity/commit/e0cba6aa671a07355b0776ac3127e6e6ecf2b141)／[38352545361](https://github.com/scientistss/Infinity/actions/runs/38352545361)：旧显示合同测试失败；接续原生启动另在 10 秒内未观察到可见 RAF 回调（计数 0）。该启动失败的根本原因仍未知，后续通过不构成旧失败的原因证明。
3. [209ab4f](https://github.com/scientistss/Infinity/commit/209ab4f4a3ce239f8fd6b18f0053e250ffa3505a)／[38355475913](https://github.com/scientistss/Infinity/actions/runs/38355475913)：六个必需游戏作业成功，但 verify 的精确检查器哈希合同失败，整轮仍失败。
4. 精确 6f 将历史显示合同与已封存来源的映射明确绑定，全部必需测试重新完整运行后通过；没有跳过原失败、放宽游戏规则或以旧版本绿色替代。

前一 493 的[推广 CI 38345113448](https://github.com/scientistss/Infinity/actions/runs/38345113448)
后来已成功。2026-10-13 07:26 UTC，dev 通过正常比较更新从 493 前进至精确 6f，
随后读回一致；main 未修改。6f 的[推广 CI 38362680488](https://github.com/scientistss/Infinity/actions/runs/38362680488)
在本次 07:28 UTC 交付截点仍运行，终态待单独核对；本次发布依据是已独立成功的
候选 38358775560 与精确实际发布回执，不能把候选绿色当作推广已成功。

## 性能与覆盖边界

同次[接续产物 11795132108](https://github.com/scientistss/Infinity/actions/runs/38358775560/artifacts/11795132108)
保留完整性能原始数据。固定旧 4b 到精确 6f 是跨多个功能阶段的累计比较：12 次
运行、6 对配对、36 个固定窗口、313 项检查，监督耗时约 185.4 秒。原始 CPU
计数增量、窗口时间、配对和汇总字段均独立重算通过；这不证明文案修正带来性能收益。

- 普通三个页面的 Task 中位约 52–67 ms／墙钟秒，固定样本内没有稳态 ≥50 ms 长任务。
- 合法极端 100 星／1,000 舰的舰队页 Task 中位约 783 ms／墙钟秒，RAF 间隔 p95 为 50 ms；新版三个固定舰队窗口合计 16 次长任务，仍有明显卡顿。
- RAF 间隔不等于实际绘制帧率；不宣称 60 fps、普遍提速、后台节流改善或 Save 优化。跨阶段对照不能用于分离这次两行显示删除的因果效果。
- 493 的同 runner 直接舰队索引对照及普通配对回退仍按[原舰队索引验收](FLEET_ROW_LOOKUP_ACCEPTANCE.md)保留。两项 Save 内部实验仍只是静态审查后未采用；新反例未运行，不记作测试通过。

## 只读发现：其他历史阶段文字，尚未确认

本阶段仅查找相关显示文字，不批量修订。`src/ui` 和研究/星环数据中，没有发现第二处
相同的“第 2 阶段后续版本开放”显示分支。`src/data/research.ts` 仍有以下历史说明，
各自须核实真实实现和未完成边界，不能根据本次星环修正直接断定整条说明都已过期：

- 离子技术：拆除费用 −4%/级（拆除随第 4 阶段）。
- 超空间技术：货舱 +5%/级（第 4 阶段舰队）。
- 燃烧引擎、超空间引擎：飞行时间（第 4 阶段）。
- 脉冲引擎：舰船速度、飞行第 4 阶段，以及导弹射程第 5 阶段。
- 间谍技术：侦察详细度、看清来袭舰队（第 4–5 阶段）。
- 计算机技术：舰队槽 +1/级（第 4 阶段）。
- 天体物理学的独立 `later`：殖民地数、远征槽（第 4 阶段）。
- 武器、护盾、装甲技术：战斗第 5 阶段。

这些条目本次全部保持原样，没有改变实际规则或扩大验收结论。
