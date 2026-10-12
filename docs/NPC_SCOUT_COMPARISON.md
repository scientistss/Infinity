# 同目标历史侦察观察差

已交付版本 **0.6.22-alpha.2 / v9/r14**，精确来源为 [be0e112](https://github.com/scientistss/Infinity/commit/be0e112b964179fc15b89daa4ae6f6a722b78a92)。同目标两份保留报告的只读观察差已通过完整 CI 并发布；后续 0.6.24-alpha.1 继续包含本能力。纯模型的合成边界 fixture 与实际付费侦察取得的原生快照分别验收，不互相替代。

玩家入口：消息页 → 打开一份含精确快照的侦察报告 → 明确选择另一份同目标报告 → 查看“观察差”和两份原始详情。查看不付款、不刷新情报，也不创建攻击。

## 交互与来源边界

- 用户点击当前保留的一份完整有效 V1 历史报告作为 anchor，并显式选择另一份同坐标的当前保留 V1 报告。
- 两份报告可以来自不同出资星球；保留并展示各自 originId，不限定当前活动星球。
- before / after 仅由传入 messages 数组的原始索引决定。目前数组旧→新，展示列表即使反向排列，也不能替换此顺序。
- 不按消息 at 排序：at 会在 1e12 封顶。也不按 observedAt 或 fleetId 排序：原始时间可能相同，且不能以时间重建观察事件的次序。
- anchor 和另一条报告必须是该数组中实际对象，不能传同 ID 的旧对象或克隆。数组最多 150 条，必须是无额外字段、无访问器的稠密普通数组。
- 严格检查完整消息四字段、快照 V1、消息 ID 与舰队 ID 关联、at 与原 observedAt 关联。不同消息对象、ID、fleetId、快照及快照子对象不能重复使用；未知模型、畸形、非标准原型和 getter 一律拒绝，不尝试降级解释。
- 旧文字、null 快照只作为普通消息保留，不能从文案解析库存或身份。任一畸形保留消息使对照保守地不可用。
- 不访问 GameState、实时 NPC、种子、经济系统、计时器、RNG、报价、派遣命令或写权限，也不引入存档 schema。

## 冻结 API

文件：src/ui/npc-scout-comparison-model.ts。

- isNpcScoutComparisonMessage(message: unknown): boolean 只检查一条完整 V1 消息，供入口是否可展示使用；它不证明当前成员资格。
- isNpcScoutComparisonHistory(messages: unknown): boolean 验证保留消息图，区分非法图和合法但不足两份报告。
- listNpcScoutComparisonCandidates(messages: unknown, anchor: unknown) 返回冻结候选元数据数组，每条含 messageId、fleetId、原 observedAt、当前数组 index。顺序保持旧→新，不自动选择最新一条。非法输入返回冻结空数组。
- buildNpcScoutComparison(messages: unknown, anchor: unknown, other: unknown) 返回深冻结、无输入引用的展示模型，或 null。不得把 null 解释为空差值成功。
- 模型 target 是原坐标；before / after 各含 messageId、fleetId、originId、原 observedAt、完整 Number 库存、驻军及 defenderTech；delta 含三个十进制字符串库存差和两个有界整数驻军差。
- NPC_SCOUT_COMPARISON_UNAVAILABLE 是可见失效提示；warning / precision 始终随模型返回。

控制器必须捕获候选 index 当时对应的实际 message 与 snapshot 引用，不能在稍后仅按 ID 重新绑定。模型本身没有持久会话或行为权限；控制器负责在裁剪、导入、重置、保护模式、离页、文档 hidden、节点替换、新 anchor / 新选择时退役，并使旧回调无效。控制器及 UI 的实测结果见本页末尾；API 合同本身不代替执行证据。

## 库存差的数值含义

原始两份库存完整保留为 Number，不经过 toFixed、epsilon 修正、整数化或重新推算。经济 -0 也原样保留；输出差值零统一为字符串 0。

每个有效原 Number 的 Number.toString() 是展示差运算的权威输入。仅对这些已验证且有界的十进制字符串使用 BigInt 定标相减，返回无指数、无小数尾零、无 -0 的规范字符串。例如 0.3 与 0.1 的观察差为 0.2；如果原值本来是 0.30000000000000004，则保留该原始精度，不伪装为 0.3。

此处并不宣称能恢复 IEEE-754 数字生成前丢失的精度，也不宣称得到原始二进制浮点数的无限精确有理差。固定可见说明为：

“原始库存为 Number；观察差按各原值 Number.toString() 的完整十进制表示计算，不代表更高精度。”

三项库存上限依 V1 为 50000 / 30000 / 10000。最小正 Number 为 5e-324；定标最多 324 小数位、329 位整数。无通用任意精度经济框架，不重新计算产量、计时、当前仓库、可掠夺值或战利品。

## 展示合同

短摘要名称为“观察差”，允许正、负和零值；它只是后观察减前观察。两份完整原始值放入可折叠详情，包括目标、两消息 ID / fleetId / originId、各自完整 observedAt、原始库存、驻军及科技。原始值应用字符串表示，不以三位小数覆盖完整值。

始终显著展示这句中文警示：

“只是两次观察差，不代表净产量、战利品或当前库存”

无符合条件的第二份报告、成员已被裁剪、同 ID 对象更换、旧选择失效或输入非法时，需要可见原因；不自动找替代报告，不把旧文字升级为结构化情报。

## 精确验收与覆盖边界

tests/npc-scout-comparison-model.test.ts 覆盖数组顺序、相同封顶时间、相同原时间、同显示时间、不同出资星球、候选过滤、150 条裁剪、克隆和重复身份、旧文本/null、负差/零差/小数/次正规数、输入不修改、冻结输出、getter/原型拒绝、未来模型、非法上下界，以及无实时权限的静态导入检查。

2026-10-12，be0e112 的[完整 CI 38291221143](https://github.com/scientistss/Infinity/actions/runs/38291221143)中，`verify`、`verify-continuation`、`npc-orbital`、`scout-rehearsal` 与 aggregate 全部成功；其独立[推广 CI 38295920178](https://github.com/scientistss/Infinity/actions/runs/38295920178)也已成功。0.6.22-alpha.2 已交付，生产改动限于 UI，存档仍为 v9/r14。

原生检查沿同一次真实付费侦察、攻击、再次侦察操作链取得两份快照，核对只读全状态、原生存储、选择失效与 320 / 390 / 768 / 1440 四宽交互。经济操作使用真实游戏接口；验收时钟受控，不能称真人连续试玩或四种实体设备实测。合成极值、旧节点和故障输入仍单独标注。

后继 [9a27ed8 / 完整 CI 38304895277](https://github.com/scientistss/Infinity/actions/runs/38304895277)重新执行本套件，通过 2655 项检查；265 个实际引用文件及 595 次引用均已核对。数字只描述这一报告的范围，不是全部玩法或任意输入已完备的证明。五个必需作业、汇总、发布及性能边界见 [阶段 22A–24 记录](REBUILD_CHECKPOINTS.md#阶段-22a-到-24)。
