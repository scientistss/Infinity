# 2026-10-13 六阶段交付记录

记录截点：2026-10-13 04:30 UTC。当前隔离私人试玩游戏为
[49303d3740cf223955386ff984b335ca9b110087](https://github.com/scientistss/Infinity/commit/49303d3740cf223955386ff984b335ca9b110087)，
**0.6.29-alpha.1 / save v9 r14**。以下六阶段均完成各自完整候选 CI、精确构建产物核对和实际发布；CI 成功与部署成功分别核实。
主开发分支正常前进至 493，main 未修改。文档后继提交不是新的应用发布，也不继承游戏提交的 CI 状态。

## 已交付增量与玩家入口

| 阶段 | 精确游戏来源／版本 | 完整候选 CI | 交付范围与入口 |
| --- | --- | --- | --- |
| 历史侦察对照 | [be0e112b964179fc15b89daa4ae6f6a722b78a92](https://github.com/scientistss/Infinity/commit/be0e112b964179fc15b89daa4ae6f6a722b78a92) / 0.6.22-alpha.2 | [38291221143](https://github.com/scientistss/Infinity/actions/runs/38291221143)，4 个游戏作业及汇总成功 | 消息内选择两份保留的同坐标有效历史快照，查看资源和驻军的观测差；不读取实时钱包，不推断产量或变化原因。 |
| 编成复制到演练 | [241a51de31364e9086abcc304884bf9df7cd6912](https://github.com/scientistss/Infinity/commit/241a51de31364e9086abcc304884bf9df7cd6912) / 0.6.23-alpha.1 | [38299142438](https://github.com/scientistss/Infinity/actions/runs/38299142438)，4+汇总成功 | 历史演练中显式复制命名编成全部 13 种可飞舰船数量。缺额可见且实际演练受原库存门槛约束；复制、演练、填草稿与付费派遣各自独立。 |
| 跨星实验室阻塞定位 | [9a27ed8c198a19f6bab9578e3d8d26ee22cdfc13](https://github.com/scientistss/Infinity/commit/9a27ed8c198a19f6bab9578e3d8d26ee22cdfc13) / 0.6.24-alpha.1 | [38304895277](https://github.com/scientistss/Infinity/actions/runs/38304895277)，5+汇总成功 | 研究页展开“研究受阻”摘要，查看真实已付实验室升级／拆除的星球、目标与队列位置；没有新操作权限或虚构倒计时。 |
| 手动单位付款确认 | [6b985b88ec6b263a3eeb8f34252525383a9f110f](https://github.com/scientistss/Infinity/commit/6b985b88ec6b263a3eeb8f34252525383a9f110f) / 0.6.26-alpha.1 | [38322340471](https://github.com/scientistss/Infinity/actions/runs/38322340471)，7+汇总成功 | 舰船／防御选择数量、补到目标或最大模式后查看实际新增量、当前星球和完整三资源费用，再单独“支付并入队”。非法数量明确拒绝，消费后的报价退休。 |
| 只读回收预估 | [7ab569045996a1a6ad8ce1aee477092144dfad74](https://github.com/scientistss/Infinity/commit/7ab569045996a1a6ad8ce1aee477092144dfad74) / 0.6.27-alpha.1 | [38327276107](https://github.com/scientistss/Infinity/actions/runs/38327276107)，7+汇总成功 | 舰队回收任务内，按当前可见残骸、回收船、货物和科技查看预计拾取及剩余；不预留、不派遣，抵达时仍按实际条件结算。 |
| 同次舰队渲染索引 | [49303d3740cf223955386ff984b335ca9b110087](https://github.com/scientistss/Infinity/commit/49303d3740cf223955386ff984b335ca9b110087) / 0.6.29-alpha.1 | [38341533349](https://github.com/scientistss/Infinity/actions/runs/38341533349)，7+汇总成功 | 每次舰队渲染复用首匹配行索引，保留原查找次序、异常回退、权限、经济与存档；没有新按钮或新的自动化。 |

全部仍为 v9/r14。历史演练的三个公开种子是示例结果，不是统计胜率。
编成复制不补船、不支付、不持续同步。手动补到目标按本地已完成库存和已付剩余队列计算，其他星球及在途舰船不算本地现货；模式选择本身不付款，后台刷新不重新授权。

规则及证据分别见：[侦察对照](NPC_SCOUT_COMPARISON.md)、[编成复制](NPC_REHEARSAL_FORMATION_COPY.md)、[实验室定位](LAB_BLOCKERS.md)、[单位付款](MANUAL_UNIT_ORDERS.md)、[回收预估](RECYCLE_PREVIEW.md)、[舰队索引最终验收](FLEET_ROW_LOOKUP_ACCEPTANCE.md)。自然付费续程与合成前置、资金、容量、错误输入场景保持各自来源，不把合成验收说成真人自然成长。

## 精确产物与可恢复源码

493 的七个作业归档都与完整 Git 源树、release 及 62 个资源一致；源码为 616 个跟踪文件。完整记录见舰队索引验收文档。

- [verify 产物 11788040886](https://github.com/scientistss/Infinity/actions/runs/38341533349/artifacts/11788040886)：39,975,396 字节；ZIP SHA-256 `c57b5654b5f44ddf7027f3ee870b8bf496baaad646dd97f798b7f404a108e2e8`。
- 其中 `source.zip`：3,745,524 字节；SHA-256 `b917c2b2387c5680bba858f4f73f314dd03b1ad30f13ded3e0c7446631e4f089`。它是公开工程源码和匿名验收材料，不含玩家真实存档、node_modules 或 Git 历史。
- release.json SHA-256：`fffec2b2f02ee88e8390aed2fd76a5817e941fcb26a7b5315d7d7caee48088ad`。
- 恢复应用首选精确 493 的完整 Git checkout；上述 source.zip 可恢复跟踪源码，但完整来源合同验收还需要固定历史 Git 对象和锁文件依赖，不是离线工具链备份。文档后继不改已交付游戏来源。短期 CI artifact 可能过期，Git 提交仍是首要恢复依据。

## 推广与失败记录

候选验收和开发分支再次运行分别记录。7ab 的 [推广 38330161986](https://github.com/scientistss/Infinity/actions/runs/38330161986)在拆除原生准备处超时失败；后继 c929 的诊断重放成功，但尚未证明旧超时的根本原因，不能把原红改记为绿。493 已包含该诊断接线，其完整候选验收成功。

493 的 [推广 38345113448](https://github.com/scientistss/Infinity/actions/runs/38345113448)在本记录截点仍运行；其最终状态须单独读取，不引用候选结果替代。此前各阶段失败、部分完成及未执行边界仍保留在对应验收文档和原始运行中。后续状态消息不要求再为每个 CI 终态生成一轮文档提交。

## 性能与安全边界

- 535 原型与 7ab 在同 runner、同合法极端 100 星／1,000 舰压力输入、四个固定配对中的舰队稳态 Script 中位比约为 0.8805，Task 约为 0.9093。493 的全部 src/public 与该原型一致。该条件下有收益，不据此声称普通场景普遍提速；一个普通 Task 配对回退仍保留。
- 极端 100 星／1,000 舰仍有明显负载。正式旧 4b 累积对照中，当前极端舰队 Task 约 874 ms／墙钟秒，RAF 间隔 p95 约 50.1 ms；不是 60 fps 或所有设备流畅保证。完整旧基线比较混合了多个功能阶段，不能全部归因于这次 17 行改动。
- 独立未启用 CPU Profiler 的 7ab 手动 Save 观察为 141.6、137.5、145.1 ms，含同步 handler、渲染及观察器，非独占序列化或绘制耗时。本轮没有发布 Save 优化。
- 两项进一步 Save 内部改法在静态审查后终止：重复源扫描仍承担当同步可执行访问改变输入后的拒绝边界；祖先集合重用会改变动态集合方法的可观察行为。没有放宽检查或新增信任条件。相关新反例未完成运行验证，不能记作测试通过。

## 尚未交付与路线图边界

运输订单额外库存明细、商人额外金额保护和 NPC 自主成长候选没有随本批发布。现有普通运输、订单、商人和 NPC 固定生产／轨道战斗仍按既有合同运行；本记录不证明这些后续候选已完整验收或可恢复。

[完整路线图](ROADMAP_ACCEPTANCE.md)仍保留高层扩张与重置、通用跨星持续自动化、NPC 自主消费／成长／排名／反击、完整行星战争、防御重建和导弹攻击、月球及战略设施等缺项。长期平衡、真人长时挂机、更多设备、完整视听和全部独立原画也未完成。不同条目大小不同，不用本批阶段数或测试数量计算完成百分比。另一条 0.7.0-alpha.3／v9r6 存档路线仍未迁移；没有把丢失旧实现称作恢复。
