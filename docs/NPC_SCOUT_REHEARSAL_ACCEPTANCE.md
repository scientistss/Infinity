# 历史侦察演练 r14 验收与发布记录

证据截点：**2026-10-12**。已发布游戏来源为
[e729c7ff3c4ef519bfd14da9dc132ba7d971de48](https://github.com/scientistss/Infinity/commit/e729c7ff3c4ef519bfd14da9dc132ba7d971de48)，
版本 **0.6.22-alpha.1 / v9/r14**。
[完整 CI 38205500857](https://github.com/scientistss/Infinity/actions/runs/38205500857)
的四个必需游戏任务及汇总门禁于 **05:20:29 UTC** 全部成功。精确产物另经
536 个源文件、62 个应用资源及 release 元数据核对，发布负责人确认 **05:23 UTC**
发布回执为 `succeeded`。开发分支通过正常比较后更新至同一 e729 SHA；未强推，
旧站及玩家存档未操作。

CI 成功与发布是两份证据；本文不声称所有站点或 GitHub Pages 同版。访问某一部署时仍应核对其
`release.json`。本文是这份不可变游戏产物的文档记录，不改变应用、存档合同或资源，也不把
e729 的绿色转移给后续文档提交。**r15 仅为本地待验准备，未发布。**

## 已交付的玩家闭环

1. 按真实前置研究和造船：间谍卫星要求船厂 3、燃烧引擎 3、间谍技术 2；间谍研究还需满足研究所前置。
2. 普通付费侦察实际抵达 NPC 后，才在消息中生成一次精确的结构化历史快照。派遣、查看、导出或导入均不补造快照。
3. 在消息页打开该份「历史侦察演练」，选择当前所选星球实际停泊舰船，显式运行三个公开种子示例。
4. 示例使用该次抵达时的库存、驻军与观察时间，以及点击运行时己方已完成的科技和货舱倍率。
   三个固定种子 `[608135816, 2242054355, 320440878]` 属于 `npc-rehearsal-public-v1`；
   **不是统计胜率、所有可能结果或损失／战利品保证**，不窥探真实战斗种子，也不观察当前敌方钱包。
5. 显式「填入攻击草稿（空载）」只替换当前草稿的任务、目标、13 类舰船数量、速度及零货物。
   仍须通过最新普通报价，包括武器技术 1、各舰种前置、当前库存、燃料和航班容量。
   排队中的武器研究不算已完成；条件不足仍可查看历史示例，但不能填入不合法草稿。
6. 舰队页单独「付费出征」才实际付款并派遣。演练和填入不产生舰队、不领奖、不扣减 NPC 库存。
   真实战斗永久战损、返航一次结算、再次付费侦察均沿用既有规则。

真实战斗在派遣时固定货舱倍率，在抵达时读取己方战斗科技，且 NPC 状态可能已经变化。
示例不是实时敌情或未来收益承诺。旧报告没有精确快照，继续保留原文并提示新的付费侦察；
不解析舍入文本、不按当前钱包补齐、不伪造历史值。完整规则见 [侦察演练合同](NPC_SCOUT_REHEARSAL.md)。

## 存档、权限与保留边界

- 存储键、schema 和 version 9 保持；当前修订为 r14。同谱系 r2–r13 必须先通过对应完整旧 reader
  与已有逐代迁移；最后的 r13→r14 消息增量仅追加 `npcScoutSnapshot: null`，不重建钱包。
  既有迁移语义、权益、时钟、付款、舰队和原文字段保留。
- 当前 r14 要求每条消息有显式快照槽；缺失、错位、无效模型、非法身份或交叉引用均拒绝。
  旧格式里出现保留字段／模型不能用改修订号伪装迁移。原始备份、写后读回、跨标签保护仍由 SaveSession 管理。
- 最多 150 条普通消息，正常 FIFO 淘汰连同其快照；没有第二份隐藏档案或新的永久 NPC 目标。
  报告被淘汰后，未完成侦察仍可正常返航，已打开的演练和草稿权限立即退役。
- 曲率保留历史消息，但旧世界的运行／填入引用失效。切星、替换存档、关闭、取消、隐藏、控件移除及存档保护
  都不能复活旧权限；重新打开后仍须按当前所选星球明确审阅。导入不合并两份世界。
- 保留 r13 的 512 个永久目标、64 个未完攻击及 60 份终端战报上限，必要活战报另行固定保留。
  不增加 NPC 自主支出、建筑成长、反击、排名奖励或完整行星战争。

## 精确门禁与产物

四个任务均独立 checkout、构建并绑定同一 e729 来源。两个旧门禁任务各保留 45 分钟上限，
轨道和侦察任务各保留 25 分钟上限；划分没有删掉旧断言、缩短观察窗口或放宽失败结果。
具体拆分见 [并行原生门禁](PARALLEL_NATIVE_GATES.md)。

| e729 的必需任务 | 该运行的结果 |
| --- | --- |
| [verify](https://github.com/scientistss/Infinity/actions/runs/38205500857/job/114667971933) | success；3,934 / 3,934 单元，107 文件；SaveSession 6,408；渲染 1,944；核心旧原生门禁完成 |
| [verify-continuation](https://github.com/scientistss/Infinity/actions/runs/38205500857/job/114667971843) | success；独立重复构建／单元／准备；23 套接续报告共 7,816 项检查，完整性能 12 样本／6 对配对 |
| [npc-orbital](https://github.com/scientistss/Infinity/actions/runs/38205500857/job/114667971762) | success；6,593 项轨道与战报原生检查；独立真实付费和重载来源 |
| [scout-rehearsal](https://github.com/scientistss/Infinity/actions/runs/38205500857/job/114667971905) | success；344 项付费领域接续检查；4,806 项侦察演练原生检查 |
| [required-gates](https://github.com/scientistss/Infinity/actions/runs/38205500857/job/114674141427) | success；四项均成功，源码／资源／运行时同源，完整 orbital 与 scout fixture 身份通过 |

这些是不同层次报告的计数；重复单元与嵌套检查不相加成独立场景数，也不据此计算功能完成百分比。
四份发布候选产物的所有 **536 个跟踪源文件／模式和 62 个应用资源**同源；源码归档、release 元数据
与实际 Node 22 补丁版本共同进入一致性校验。

| Actions 产物 | ZIP SHA-256 |
| --- | --- |
| [original-deep / 11727597443](https://github.com/scientistss/Infinity/actions/runs/38205500857/artifacts/11727597443) | `882c5c5560832117ee22952724b87d7701d375ad0afa8abe6e595f7effb847eb` |
| [original-deep-continuation / 11727373805](https://github.com/scientistss/Infinity/actions/runs/38205500857/artifacts/11727373805) | `63ba7f590ea6001e0afe59f929241a9883464f81f13cf5643be620965c13a4ec` |
| [npc-orbital / 11727451911](https://github.com/scientistss/Infinity/actions/runs/38205500857/artifacts/11727451911) | `8009f0d637d8f0dbee6c3fbd23ad88b162b076ed7df47146ad24e9c3ef39618b` |
| [scout-rehearsal / 11727760251](https://github.com/scientistss/Infinity/actions/runs/38205500857/artifacts/11727760251) | `21f0a538e5a48e4d4333b37284ca2b5c743fb84aac4b8bf6dea29a9b33224e96` |

Aggregate 实际输出的 SHA-256：

- 四任务 source/assets/runtime：`34d547180eb1e330a7492f5299874bbe011d3fc01b4cc4f913ff160a28b723ad`
- 两个旧门禁与独立轨道任务的完整 orbital fixture：`4300f1823bd790e1ebcd2ce8a7287ffb567ef0038c4f5921f2b4e8bf1032cb75`
- 独立 scout 完整 fixture：`e14c42401ae4098f39ab3688b31034a3b39e521ae2ce0466db4755eb5909787f`

Actions 产物有保留期限；身份哈希和运行链接用于定位当时的精确证据，不承诺产物链接永久可下载。

## 自然路线与原生证据的区别

领域接续从真实付费 31 秒的 r13 源导出继续，再推进九个采用的游戏秒：间谍卫星 #11 付费出发，
在 0.5 秒中途重载，实际抵达后生成一次快照并返航；六架战斗机独立付费执行攻击 #12，真实战斗、
返港后再派侦察 #13。344 项领域检查将经济／动作／tick 状态与归档 7554 引擎比较，
新快照由独立预期推导；额外分支通过真实付款完成轻型战斗机与武器 2 研究。
这属于加速引擎和受控时间证据，不是九秒真人游玩或长期平衡测试。

独立原生任务验证真实 HTTP、native localStorage、Run／Fill／Send 分离、取消后重开、
权限退役、当前库存／科技改变、历史内容及完整草稿原子性、备份／导出／恢复与四宽可操作性。
320、390、768、1440px 是浏览器视口证据，不等于四类实体设备、用户 Windows 电脑或 Safari 验收。
自然主线、合成安全／上限夹具以及不修改时钟的演练性能探针分别记录，不能互相冒充。

## 性能与覆盖限制

[成功接续任务](https://github.com/scientistss/Infinity/actions/runs/38205500857/job/114667971843)
完成 12 个有效原生性能样本，组成 6 对 before/after。
对照是固定 [4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b](https://github.com/scientistss/Infinity/commit/4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b)
到 e729 的跨多阶段比较，不是只改变侦察演练的隔离实验。

- 当前普通负载的 Task 中位约 **28–38ms/s**；样本中未观察到稳态 **≥50ms** 长任务，
  普通导航 EventTiming P95 为 **40ms**。
- 极端组合舰队页的 Task 中位为 **622.78→684.76ms/s**；导航 P95 为 **160ms**，未改善；
  启动约 **292→427ms**。
- 极端规模仍有明显卡顿。报告完整和有效不表示达到绝对速度目标，不能宣称整体提速、
  r14 独立加速、稳定 60fps、所有设备流畅或无限期存档增长可接受。
- 消息保留与多份存储副本增加负载。规格中的字节预算是特定组件／场景估算，
  不是全产品最大值或各浏览器存储配额承诺；不得为满足假定配额删除备份或缩短旧文本。

## 后继推广失败与历史证据

同一 e729 的后继开发分支
[推广 CI 38207609186](https://github.com/scientistss/Infinity/actions/runs/38207609186)
不是另一份成功验收：`verify`、`npc-orbital`、`scout-rehearsal` 成功，但
[`verify-continuation`](https://github.com/scientistss/Infinity/actions/runs/38207609186/job/114674470844)
与 `required-gates` 均失败。

05:44:53 UTC，开拓查看原生检查停在 **510 / 511**，失败点为
`actual rules: globalFull: every status equals actual owned/NPC/outbound/deep rules`。
该次失败报告观测到 `nativeCurrentRaw: null` 与新游戏状态；源码／夹具与成功运行一致。
根据同步启动分支可推断首次读取可能为 `null`，但没有直接记录那次初读，不能把源码推断写成原始观测。
**原因未知，不能直接称为 race，也不能把失败追认为通过。** 诊断修改须经真实 native 执行验证。
该步骤之后的检查和性能在这轮没有运行，不能继承先前绿色或把缺失报告视为成功。
失败产物 [11728606375](https://github.com/scientistss/Infinity/actions/runs/38207609186/artifacts/11728606375)
为 51,075,778 字节，ZIP SHA-256 为
`82c8188bc2d0a1d3a4b47a9ec2271209274e4bb8d8c3329520d2465d5f17087a`。

之前的 d3798afa 三任务
[CI 38201857023](https://github.com/scientistss/Infinity/actions/runs/38201857023)
在旧 `verify` 的 45 分钟边界取消，性能只完成五个样本及下一样本的一部分；
它保持 cancelled，不因后续拆分并成功而变绿。[r13 旧返港失败](NPC_ORBITAL_STATUS.md#historical-failure-retained-dock-timing-corrected)
及 [r13 精确验收](NPC_ORBITAL_ACCEPTANCE.md)也保留各自历史范围。

### 历史本地准备记录

早期 `[deep-source]` 检查点只保存工程工作，没有启动正式原生门禁。
本地 Node v24.19.0 曾通过 3,934 项单元与完整构建，146 项 UI／controller 测试包含在总数内，
不能再次累加；CI 的 Node 22 结果另见上表。大 JavaScript chunk 警告仍在。

历史池包含 56 份真实 r2–r13 原源码行、原始哈希、归档 reader 与完整旧规范化投影，
不含玩家存档；改标签攻击另列为负例。前期准备两批严格检查 635 个存档封套；
NPC 旧路线 2,507 项，两种轨道重载路线各 954 项。三个来源交接曾因工作树脏而拒绝，
提交后才在干净来源通过；四份新夹具与三份路线报告中的 493 个封套通过实际 reader／serializer 回环。

早期侦察路线把一秒抵达误标为中途状态；该诊断保留，后继改为真实 0.5 秒出航中检查点，
门禁拒绝旧错误结构，不删字段使比较通过。327 项早期路线与 344 项后继路线不混称。
当时审查修复未付款提示被常规状态覆盖、控件隐藏后旧审阅残留、重复过期运行残留观察器；
最终 native 证据属于 e729 上表，不属于这些本地检查点。

本地集成候选 `cd324b381e3bc8e5b07a629d6f8379fbeb3bd547` 保留 r13 正常合入的显示／原生边界，
12 条封存生产路径与 `ee41d7d` 相同；两次本地干净构建的 533 个源码文件／模式、62 个资源及
完整 canonical orbital fixture 一致。这是历史本地可复现结果，不能替代最终 e729 的
536 文件、Node 22 原生门禁或发布核验。后续工作按新的准确提交验收，不循环重写这些历史结果。
