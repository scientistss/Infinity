# 同目标历史侦察观察差（candidate，未验收）

本页说明新增的纯展示模型及其候选 UI 合同。此实现目前是未验收 candidate；单元测试、完整构建、天然付费侦察来源及原生浏览器验收必须分别记录，不能互相替代。本模型测试使用明确标注的合成边界 fixture，不声称由游戏实际付费抵达生成。

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

控制器必须捕获候选 index 当时对应的实际 message 与 snapshot 引用，不能在稍后仅按 ID 重新绑定。模型本身没有持久会话或行为权限；控制器负责在裁剪、导入、重置、保护模式、离页、文档 hidden、节点替换、新 anchor / 新选择时退役，并使旧回调无效。控制器及 UI 的实测结果由相应验收记录负责，本文件不将 API 合同写成已通过验收。

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

## 当前候选的本地检查与待验收项

tests/npc-scout-comparison-model.test.ts 覆盖数组顺序、相同封顶时间、相同原时间、同显示时间、不同出资星球、候选过滤、150 条裁剪、克隆和重复身份、旧文本/null、负差/零差/小数/次正规数、输入不修改、冻结输出、getter/原型拒绝、未来模型、非法上下界，以及无实时权限的静态导入检查。

2026-10-12，整合候选在本地 Node 24.19.0 下完成 4037 / 4037 单元测试及 TypeScript / Vite 构建；其中对照模型 35 项、控制器 68 项。独立静态审查覆盖只读边界、原始数值、getter / iterator 防御、节点退休、保护同步和原生证据链。

候选版本为 0.6.22-alpha.2，仍使用 v9 / r14；生产差异仅限四个 UI 文件，固定 e729c7f 为已发布来源。旧四个必需验收 job 与 aggregate 保留，新比较原生套接在独立 scout job 的原有验收之后。新脚本沿同一浏览器的真实付费侦察、攻击、再次侦察操作链取得两份快照，计划在 320 / 390 / 768 / 1440 四宽核验比较和退休行为。

上述 Node 24 本地结果与静态审查不替代同提交的 Node 22 CI、真实浏览器、完整四 job 和 aggregate 成功。远端完整验收及发布尚未完成；不得把来源已有成功或尚未执行的原生合同列为此候选通过。
