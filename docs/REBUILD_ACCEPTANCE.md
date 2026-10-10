# Infinity 分阶段重建验收报告

日期：2026-10-10

**阶段 0–6 的本次重建范围已完成，代码检查点的完整 CI 已通过。后续开发仍有下述明确缺口，测试数量不代表所有未来功能已经完成。**

- 开发分支：[codex/infinity-rebuild-20261010](https://github.com/scientistss/Infinity/tree/codex/infinity-rebuild-20261010)
- 起点：[ebbabd7854a5bb77fc154a63202c1a1b705d3c39](https://github.com/scientistss/Infinity/commit/ebbabd7854a5bb77fc154a63202c1a1b705d3c39)。这是基于已保存 Git 源码的增量重建。
- 完整验收代码：[8c19d044fb3c38c601223cd55272c6570c08525d](https://github.com/scientistss/Infinity/commit/8c19d044fb3c38c601223cd55272c6570c08525d)；[CI 38068643853](https://github.com/scientistss/Infinity/actions/runs/38068643853) 于 2026-10-10 成功，job 114261340395。
- 1311 项单元测试、16 套共 5075 项正确性浏览器检查、216 项原生性能校验通过；12 次原生旧／新运行全部合格。领域／迁移／旧读取器拒绝门禁、原 UI／素材检查、60 分钟加速模拟及监督器自测也通过。
- 本文记录该代码检查点。后续文档提交须运行自己的完整 CI，不能把此代码提交的成功直接当作文档新 SHA 的成功；从文件提交历史及 Actions 可定位其独立结果。
- 游戏版本 0.6.8-alpha.1，存档 v9/r8。main 核为 ebbabd7854a5bb77fc154a63202c1a1b705d3c39；开发分支未合并 main。
- 本报告不含站点部署或访问权限验收；那是单独发布步骤。新增回归输入均为匿名合成状态。

## 已实现范围与逐阶段证据

以下数字属于各阶段所列提交；当前代码检查点的完整结果另见页首。浏览器检查包含受控时钟场景，真实时间实验另行说明。

- **阶段 0 基线。** 保留原导航、卡片、资源栏、配色和美术；原 view.ts、style.css 与 public 资源未改动。359 项单元、260 项浏览器检查通过。[96f5a49](https://github.com/scientistss/Infinity/commit/96f5a49bcf8547ca2ce51645c27e383484fcbf10) · [CI](https://github.com/scientistss/Infinity/actions/runs/38037250631)
- **阶段 1 存档安全。** SaveSession 统一生产入口；导入和重置先验证、备份、写入并读回，成功后采用新进度。失败保护、跨标签冲突与过期文件读取覆盖。403 项单元、506 项浏览器检查通过。[ebf75a7](https://github.com/scientistss/Infinity/commit/ebf75a755aa87f0b452bf427eb6cda833e26990d) · [CI](https://github.com/scientistss/Infinity/actions/runs/38037809604)
- **阶段 2 有限星环。** 保留天体物理学 1 级解锁、手动开奖 10 次解锁自动卡；星环自动卡装配默认关闭。明确授权现有票据、来源与支出上限后运行，用完停止。535 项单元、679 项浏览器检查通过。[55f7aa9](https://github.com/scientistss/Infinity/commit/55f7aa9e483c69901a560dd51d1b9c1ce1ad1514) · [CI](https://github.com/scientistss/Infinity/actions/runs/38039770101)
- **阶段 3A 有限本地订单。** 建筑与科研固定目标等级，造船固定新增数量；固定付款星球、独立预算、稳定工作编号，取消只处理实际拥有的付费工作。671 项单元、928 项浏览器检查通过。[b58c881](https://github.com/scientistss/Infinity/commit/b58c8816ad1d7e7e5e0b3d839f1668e18de22de4) · [CI](https://github.com/scientistss/Infinity/actions/runs/38041611643)
- **阶段 3B 单源真实运输。** 运输默认关闭；显式固定供货星球、舰船、速度、航次数和货物上限。真实出航、交付后付款、真实返港；燃料不退，同一工作不会重复取货。824 项单元、1212 项浏览器检查通过。[bc6f5a4](https://github.com/scientistss/Infinity/commit/bc6f5a475336dca1bb02d4f1061ee01ba9c5d9c4) · [CI](https://github.com/scientistss/Infinity/actions/runs/38044299547)
- **阶段 4A 研究意图模板。** 模板只保存名称与目标；逐项核对付款星球和预算后创建有限研究订单，不复制旧执行状态或运输许可。982 项单元、1532 项浏览器检查通过。[090d312](https://github.com/scientistss/Infinity/commit/090d3124f799f4dadb890922268c2cc1d32e9ad8) · [CI](https://github.com/scientistss/Infinity/actions/runs/38046306885)
- **阶段 4B 编成与一次补船。** 可编辑命名多舰种设计；明确填入派遣数量不会出航。补船按固定星球现货和已付款队列计算一次缺额，数量与预算不会随战损扩大；保留任务仍引用的设计不能删除。1131 项单元、1905 项浏览器检查通过。[6016391](https://github.com/scientistss/Infinity/commit/6016391ed947e72b6e53d5307091c152c0c69079) · [CI](https://github.com/scientistss/Infinity/actions/runs/38049543532)
- **阶段 5A 曲率预览。** 收益、损失与实际转换共用规则；手动发射先保存读回再采用新世界。1156 项单元、2152 项浏览器检查通过。[10512bf](https://github.com/scientistss/Infinity/commit/10512bfc955300da379ffacce683de8050503dbf) · [CI](https://github.com/scientistss/Infinity/actions/runs/38051375925)
- **阶段 5B 只读开拓查看。** 检视当前星系位置和深空，复用真实航程报价；查看不改付款星球、不填派遣、不创建工作。1206 项单元、2926 项浏览器检查通过。[6f8682b](https://github.com/scientistss/Infinity/commit/6f8682b727bf30a2833bbe6569ea15ee936b10b0) · [CI](https://github.com/scientistss/Infinity/actions/runs/38053037247)
- **阶段 6A 后台时间。** 保存时刻与已结算水位分离；后台保存不会吃掉尚未模拟的时间，恢复或重载不重复领取。1249 项单元、3455 项浏览器检查通过，包含 469 项受控时间检查与 60 项独立原生隐藏标签检查。[4a4a4d6](https://github.com/scientistss/Infinity/commit/4a4a4d68d0a0cf467f10a734a690606487acd327) · [CI](https://github.com/scientistss/Infinity/actions/runs/38056760380)
- **阶段 6B 表现调度。** 仅计算可见重型面板，普通更新采用 100 毫秒节奏，保留原模拟步、队列与协议时钟及星环逐帧动画；旧队首按钮不能操作新工作。完整验收已通过，见 [8c19d04](https://github.com/scientistss/Infinity/commit/8c19d044fb3c38c601223cd55272c6570c08525d) 的 [CI](https://github.com/scientistss/Infinity/actions/runs/38068643853)。

## 存档兼容范围与重要限制

当前格式为 v9/r8。已支持的旧档来自本仓库已核验 Git 源码谱系中的 v9/r2–r7；迁移输入由真实旧版本代码生成，并比较完整旧状态与真实付款、在途运输和模板数据。

**同样的 schema 名称、版本号和修订号不足以证明兼容。** 已识别的另一条 0.7.0-alpha.3 路线也标记 v9/r6，却含 ringProgression、ringAutomation、logistics、missionPlans、sector，且没有本分支的 orders 结构。已对该路线实际旧版本程序生成的初始档实测：当前读取器严格拒绝；SaveSession 进入保护态，没有写入或删除，原件导出与输入逐字节相同。此结果证明该样本被安全保护，尚未实现迁移，不能据此宣称完整旧进度可继续运行。

- 不支持或损坏的旧档不会静默重开或覆盖；可读但升级失败的旧进度保持冻结，并保留原字节导出。
- 备份槽有界且不自动覆盖既有原件。读回失败时，候选可能已在磁盘上，界面不会宣称磁盘已回滚。
- 跨标签检查在观察到变化时停止写入；localStorage 不提供跨进程原子锁，也不合并分歧进度。
- 故障矩阵包括明确注入的备份失败、当前写入失败和读回失败，不能将它们写成自然发生的浏览器配额故障。
- 本分支的有限星环、单源有限订单、意图模板、一次补船和只读导航各有独立授权边界；它们不代表另一条路线的 ringProgression、持续 logistics、missionPlans 或完整 sector 系统已恢复。

## 有代表性的端到端验证

- **跨星球经济：** 预置单母星后，通过真实界面派舰建立殖民地、返航和重载；另分别完成建筑、科研、造船的单源补给订单，核对供货扣款、实际卸货、当地付款及舰船返港。后者明确控制模拟时间。
- **换世界与旧操作：** 导入、重置及手动／协议／离线曲率均覆盖同编号旧按钮、旧草稿、延迟输入和重复提交失效；取消或失败保留当前合法状态。
- **导入与恢复：** 实际旧源码迁移、字节精确备份、当前版本重载、真实双标签冲突、延迟文件读取和新旧操作竞争均有专门套件。
- **真实后台：** 独立有头 Chrome 实际隐藏约 33 秒，核对两次原生自动保存、隐藏直接重载、恢复后补时和后续重载不重复结算。
- **成长模拟：** 60 分钟是固定种子的加速单世界引擎策略模拟，直接调用建造、研究、造船与开奖，并输出里程碑。尚无从新游戏连续成长到扩张、换世界再导入的完整自然时间浏览器流程；该模拟也不能证明长期平衡。

对应实现与脚本见 [验收记录](REBUILD_CHECKPOINTS.md)、[存档契约](SAVE_SESSION.md) 和仓库 scripts 目录。

## 原生性能与容量实测

[本次完整 CI](https://github.com/scientistss/Infinity/actions/runs/38068643853) 完成 12 次原生旧／新运行与 216 项量测校验：中等及组合极限档各三组交错配对，Linux Chrome 154.0.8037.97 使用真实时钟、计时器、存储及可信输入。脚本总用时约 345 秒，真实清理后没有本次已观察到的存活子进程。

- 中等合成档概览、计划、舰队页的脚本 CPU 中位分别约为 836→25、804→27、792→29 ms/s；总任务 CPU 约 902→43、828→36、854→47 ms/s。
- 组合极限档对应脚本 CPU 约为 987→828、986→807、879→860 ms/s；舰队页总任务 CPU 仍约 1000→1000 ms/s，接近单核满载，不能宣称极限流畅或达到 60fps。
- 极限档含 100 星球、1000 舰队、100 计划、256 条运输回执、1202 项已付工作、32 个模板和 32 个编成；初始资源、科技和舰船是明确预置的合成条件。
- 约 1.91 MB 的完整存档通过真实异步文件入口导入；首次终态的原生当前文本与本次文件选择时的原件备份逐字节核对通过。只读取证观察器在 CPU 窗口之后安装，避免后续正常自动保存与导入事务混淆；不替换 API 或冻结游戏。
- 约 190 万字符的文本框编辑路径仍未完成验证。文件入口成功不代表该路径已通过，也不保证所有浏览器配额或其他备份占用条件。
- 上述不能外推为用户 Windows 电脑、实际手机、Safari 或所有合法最大组合的性能保证。

此前失败及修正均保留于 [阶段记录](REBUILD_CHECKPOINTS.md)，没有将失败运行追认为成功：包括真正的保护态控件显示回归、订单异步导入焦点风险，以及隐藏面板准备、可信指针命中和跨保存时刻取证问题。当前全部原始正确性断言与新增回归均实际运行通过。

## 精确产物与范围边界

- [CI 产物](https://github.com/scientistss/Infinity/actions/runs/38068643853/artifacts/11675834922)：24499931 字节，SHA-256 `ccd5ec5dbd0ffeeabae7a90014f7552dd599727afc0fd5a971a63c49a9795e31`。
- 产物中 `release.json` 的 sourceSha 为上述代码 SHA，62 个静态文件哈希全部核验；release 文件 SHA-256 `8cbd86a4717046ea916460f051392a13cade7abd01aef32629ba167dec63344c`。
- `source.zip` 逐文件与该 Git 提交一致，SHA-256 `164cb45fe762c10687fe8637c7b8d5311db9067a84a242d0721373fa1f6a3427`。Git tree 为 `683e7bcc8496b07607e7fadd0c4dd9d4fce1b36c`。
- Actions 产物按工作流保留 7 天，本次列出的到期日为 2026-10-17；源码、固定输入生成方式与验收命令长期保留于 Git，不能把限期下载链接称为永久备份。

仍未恢复完整 NPC 星区、持续供给或另一条路线的任务系统；未实现多来源无限物流、持续库存补船或无限星环执行。长期平衡、数小时原生后台、操作系统睡眠及完整自然成长体验也尚未验收。

## 复核入口

源码长期保留于开发分支和逐阶段提交；详细命令、报告与合成输入归档规则见 [CI 工作流](https://github.com/scientistss/Infinity/blob/8c19d044fb3c38c601223cd55272c6570c08525d/.github/workflows/p4-original-verify.yml)。

基础本地检查为 npm ci、npm test -- --maxWorkers=1、npm run build、npm run sim -- 60。完整浏览器验收还需要工作流固定的历史源码、真实 HTTP 服务与 Chromium 环境；仅完成这四条命令不能算完整通过。
