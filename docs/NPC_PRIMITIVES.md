# NPC 经济纯函数：独立准备候选

## 当前交付边界

本候选只保全固定生产模型的纯函数、领域测试、独立数值金标和后续设计。**没有把 NPC 经济接入游戏，不是 NPC 可玩版，不作为部署候选。**

应用基线为 `ac3cce98403bea1e7162bcb4092e4cfeeb448a9a`。现有应用仍使用该基线的 `0.6.17-alpha.1`、v9/r10、`infinity-original-p4` schema 和原存档键。本候选不升版本或存档修订，不引入另一条尚未完成验收的拆除实现。

领域模块位于 `experimental/npc-economy.ts`，不在应用 `src` 中；`src` 相对 ac3 基线保持不变。新增领域模块没有接入 `GameState`、tick、离线结算、SaveSession、银河、侦察抵达、消息或 UI。构建页面仍是原应用行为；不能因分支中存在领域模块，就称网站已有 NPC 产出或可侦察库存。

[NPC_ECONOMY.md](NPC_ECONOMY.md) 与 [NPC_ECONOMY_ACCEPTANCE.md](NPC_ECONOMY_ACCEPTANCE.md) 保留冻结原字节，仍是未来完整“可侦察经济基线”的规格与验收合同。文中的固定来源是规格调查的代码来源，不代表这两份当时未跟踪的新文档已存在于该提交。未来存档修订的讨论不表示本候选已采用或保留该修订号。

## 领域 API

实现：[npc-economy.ts](../experimental/npc-economy.ts)。测试：[npc-economy.test.ts](../tests/npc-economy.test.ts)。

- `NPC_ECONOMY_MODEL` 为 `fixed-production-v1`，全局年龄上限为 11,900 秒。
- 初态金属/晶体/重氢为 500/250/0；固定每秒率为 5/2.5/1；容量为 50,000/30,000/10,000。
- `createNpcEconomyState()` 创建年龄 0 的独立状态。
- `isNpcEconomyState(value)` 检查准确两个自有数据字段、已知模型和有限的 0–11,900 数值年龄。允许普通或 null 原型，拒绝访问器和多余字段；不承担整个存档的结构或位置校验。
- `advanceNpcEconomy(state, stepSeconds)` 纯函数推进并封顶。非法状态抛出 `TypeError`。零、负、非有限或运行时非数字步长不推进，保留原对象。正步长若小于当前年龄的可表示增量，也可能保持原对象。
- `npcEconomySnapshot(state)` 返回库存、容量、固定率、累计实际入库产出和各资源满仓状态。固定率不因满仓改写；`full` 标明该库存已停产。
- 数值 `-0` 合法：查询不修改输入，快照年龄使用 `+0`；无效步长保留原对象及其 `-0`。这不是存档原文字节往返承诺。

库存按各资源独立封顶，实际入库量不含初始资产或溢出。模块没有扣减、转账、随机档位、玩家收益或未来战争账本。没有运行时导入玩家经济，也不读取时钟或 RNG。

## 独立数值证据及复现

冻结金标：[npc-economy-goldens.json](../tests/fixtures/npc-economy-goldens.json)。SHA-256：

`c0f8bdb61027c0629564ad1838d0fde8693083c1228e41ea23747763f542b0bb`

[Python 生成器](../scripts/generate_npc_economy_goldens.py) 从冻结规格参数独立使用 `Fraction` 推导，并用 `Decimal` 逐四分之一秒累积交叉检查 47,601 个年龄点、142,803 次资源比较。它不读取或调用生产 TypeScript 来生成期望。

68 个固定 case 包含：8 个规格金标、9 个满仓前/等/后边界、10 个无效或零步长、8 个精确分段、6 个有符号零、27 个非法状态。期望数字是精确十进制字符串；特殊非有限运行时输入用显式 descriptor 表示，比较器先解码后验证。二进制精确输入逐值比较，不采用数值容差。

从仓库根目录运行：

```sh
python scripts/generate_npc_economy_goldens.py --source-dir docs --output npc-economy-goldens-review.json > npc-economy-oracle-report.json
cmp tests/fixtures/npc-economy-goldens.json npc-economy-goldens-review.json
node --import tsx scripts/check-npc-economy-goldens.mjs > npc-economy-primitives-report.json
npm test -- tests/npc-economy.test.ts --maxWorkers=1
```

只验证既有 fixture、不生成副本时：

```sh
python scripts/generate_npc_economy_goldens.py --source-dir docs --output tests/fixtures/npc-economy-goldens.json --check
```

生成器保留原始 CLI 默认值，因此在此仓库必须明确传 `--source-dir` 和 `--output`，不能按它原独立目录布局猜测路径。

[Node 比较器](../scripts/check-npc-economy-goldens.mjs) 默认读取仓库 fixture，也接受 `--fixture` 指定仓库内的相对路径；始终要求上述固定摘要。它保留全部 case 的结果，失败非零退出，stdout 输出完整 JSON，记录实际执行提交、工作树状态及源码/测试/fixture/适配器摘要。报告不含本机绝对目录。工作流新增重生成、逐字节 `cmp`、生产函数比对和三个 JSON 归档；既有应用门禁不删除或放宽。

## 历史试验与本候选验收分开

首次独立领域试验发生于基线 `85e199c19378dc48064a4733ddcc3c48a24afbcf` 上的未提交两个新文件，而不是本候选的 ac3 应用基线。该试验在 Linux x86_64、Node 24.19.0 下完成 48/48 定向测试、68/68 外部金标及 `tsc --noEmit`。当时没有运行全旧测试集、完整构建或浏览器验证。

原准备目录的领域源码 SHA-256 为 `b831e53b7c258f66bcc8c0a55d5a7192c0a6185c0c84fc11d6c8f20d9ae25137`；测试 SHA-256 为 `2040dae6781c112436eaa44ccbe46dd35a12026c880591f2c28baefb23bcc5b0`。这些摘要关联该历史领域证据，**不把旧实验的通过归给新候选提交**。本候选将模块移入 `experimental/`，模块仅调整 `ResourceId` 的类型导入路径，测试仅调整被测模块的导入路径；除此之外字节保持一致。迁移路径后的候选模块 SHA-256 为 `37e1e348c1c1cf4ce57f47d7b7676278638bbe9e0bdf90b35d21dd4531b94e92`，候选测试 SHA-256 为 `e4886e2dc408879cbef9e4dc402e43f48fea89c30eb465a9b8c1490209834f92`。本候选的全量测试、构建和准确 CI 结果须在实际提交上另行取得；工作流存在本身不是通过证明。

## 原生小数时间的实测范围

同一次历史领域试验还分别执行 `11,900 × Hz` 次 `1 / Hz` 秒推进。数学总时间恰为 11,900 秒；每次输入及逐次加法使用原生 binary64。下面分别列数学参考与实际存储结果，没有 epsilon、补偿或为追求零差而改源码：

| Hz | 调用次数 | 实际存储年龄（秒） | 存储年龄减数学年龄（秒） | 晶体库存减数学满仓值 | 晶体 `full` |
| ---: | ---: | ---: | ---: | ---: | --- |
| 30 | 357,000 | 11899.999999995127 | −4.8730726120993495e−9 | −1.2183591024950147e−8 | false |
| 60 | 714,000 | 11899.99999991098 | −8.901952242013067e−8 | −2.2254971554502845e−7 | false |
| 120 | 1,428,000 | 11899.999999868907 | −1.3109274732414633e−7 | −3.2773095881566405e−7 | false |
| 240 | 2,856,000 | 11900 | 0 | 0 | true |

每档金属、重氢都已满。240Hz 未封顶的原生累计数是 `11900.000000657246`，既有年龄上限将其截到 11,900；其他三档的实际存储年龄略低于上限，不能把晶体提前标为满仓。

这 5,355,000 次域调用在上述单次本机实验中总计约 1.321 秒。它不是游戏 tick、浏览器帧率、手机性能、全生命周期误差上限或所有切段整档字节等价的证明。现有 `10,000 × 0.1` 秒测试声明的局部误差界只约束该测试，不能推广为这里四档或任意运行时长的容差。

后续接入真实事件分段、飞行时间、离线和保存时，应依完整验收合同另行冻结并核对数值精度。纯函数必须继续按实际存储年龄/库存报告 `full`；不得用显示舍入或未定义 epsilon 提前补齐库存。
