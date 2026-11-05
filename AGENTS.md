# 项目设计契约

功能只有两个要点：模型和 API。六份设计文档按范围分别作为唯一权威；页面只投影 API，不单独定义功能。

## 1. 权威文档

开始实现、重构、修复或评审前，先读与本次模型和 API 相关的文档。独立项目和通用模型与 API 同时变化时读取 `01`、`02`、`03`、`05`；只有可见投影变化时才读 `04`。涉及 Bot 的架构、模型、API、交互和验收时必须先读 `06`，通用能力再引用 `01`～`05`。

| 文档 | 唯一职责 |
| --- | --- |
| [`docs/05-requirements.md`](docs/05-requirements.md) | 做什么、不做什么、何时算完成 |
| [`docs/02-data-model.md`](docs/02-data-model.md) | 持久模型、字段、表、约束和迁移映射 |
| [`docs/03-interaction-logic.md`](docs/03-interaction-logic.md) | 状态如何变化，以及 API 的入参、返回、事务和错误 |
| [`docs/01-architecture.md`](docs/01-architecture.md) | 代码位置、依赖方向、模型与 Pi 的归属 |
| [`docs/04-ui-layout.md`](docs/04-ui-layout.md) | 页面如何投影 API，不定义新事实或新接口 |
| [`docs/06-bot.md`](docs/06-bot.md) | Bot 专属架构、模型、API、交互、需求、迁移映射与未验证项；不保留旧设计副本 |

独立项目和通用字段与表只在 `02` 定义，状态变化和 API 只在 `03` 定义，Pi 归属只在 `01` 定义；Bot 专属事实统一在 `06` 定义。页面只引用所属范围的 API。禁止在多份文档复制完整字段、SQL 或流程。

## 2. 功能边界

1. 模型：持久对象、SQL 表、关系、状态事实，以及对象与 Pi Session 的归属。
2. API：入参、返回值、许可、事务、错误，以及它读写哪些模型、调用哪些 Pi 能力。

页面布局、文案、样式和交互不是第三个功能要点。页面只展示 API 返回的模型和派生状态，只通过已定义 API 发出用户意图。

没有新的模型事实或 API 契约，就不是新功能。修复必须落回两个要点之一，不能只改页面表现来掩盖模型或 API 错误。

## 3. 改动顺序

先改对应文档，再改代码。纯解释也不从页面倒推事实。

```text
需求 ID → 模型（对象、表、状态、Pi 归属） → API（入参、返回、事务、Pi 能力） → 页面只投影 API
```

### 3.1 模型

- 在 `02` 定位独立项目或通用持久对象 Session、Agent、Project；Bot 专属对象与关系在 `06` 定位。
- 写清职责、身份、归属、生命周期、不可变字段和关系。运行句柄、锁、订阅、流式文本、草稿和 UI 阶段不是持久模型。
- 派生状态必须标明来源和计算规则，不能新增含糊状态字段代替事实。
- 在 `03`（Bot 专属流程为 `06`）按时间写清触发者、读取记录、事务写入、成功、失败和 unknown 分别留下什么。
- 事务写明表、关键列、外键、唯一约束、触发器、幂等键和禁止写入的列。不能只写 Repository 方法名。
- 在 `01` 写明每个对象对应哪个 Pi Session，或明确它不拥有 transcript。Bot 专属 Pi 归属在 `06` 定义。
- 列出实际使用的 Pi 能力：prompt、steer、custom message、custom entry、transcript 读取、abort、compaction、工具和原生证据。同时写明 cwd、nativeRef、session 文件和恢复身份。没有 Pi 交互时明确写“不调用 Pi”。
- 中间布局的会话栏是所属 Pi Session Tree 的对话流投影，展示整棵树的所有分支，而不是另一份对话数据；投影时不因内容为内部节点、thinking 或敏感工具结果而过滤或脱敏。

### 3.2 API

- 在 `03`（Bot 专属 API 为 `06`）写明方法、路径、调用方、前置许可、入参、返回 DTO、错误码、幂等键和副作用。
- 入参只携带定位和用户意图。归属、角色、权限和当前状态由服务端从数据库读取。
- 返回值不单独暴露原生绝对路径、密钥或句柄；不得因包含内部节点、thinking 或敏感工具结果而过滤或脱敏 transcript 和工具结果。
- 写清读写模型和事务边界，以及调用的 Pi 能力。失败时写明哪些记录保持不变，哪些进入 failed 或 unknown，以及可执行的恢复动作。
- `page.tsx` 和 `route.ts` 只做入口与装配。业务规则放在 application，SQL 放在 infrastructure/database，Pi SDK 调用放在 infrastructure/pi。

### 3.3 页面投影

- 只有模型或 API 需要新的可见结果时，才更新 `04`；Bot 专属投影更新 `06`。
- 可见区域只能显示 API 返回的模型、派生状态或所属 Pi transcript。不同会话、业务元数据和恢复操作不能混成第二份对话。
- 用户动作只能调用已定义 API。等待、成功和失败反馈来自该 API 的返回、错误码和许可，不在页面推导新业务状态。
- 缺少显示所需数据时，先修正模型或 API，不为页面新增字段、状态副本或专用接口。
- 新增可见组件前，先按 `01` 的“AI Elements 组件治理”检索官方组件。没有可复用组件时，先登记评估对象、例外原因、替代位置和复核条件。

### 3.4 闸门

- 文档冲突时停止实现，先修正文档。不能在代码中折中。
- 现有代码、旧接口和页面文案不能反向覆盖文档。
- 每项需求在 `05`（Bot 专属需求为 `06`）有需求 ID、验收条件和状态。不存在时先补需求，不自行扩展范围。
- 完成后只核对两点：模型事实是否完整，API 是否按契约读写该模型并使用规定的 Pi 能力。页面只核对是否忠实投影 API。
- 需求按 `05` 或所属的 `06` 验收后才能标记完成。测试只证明已记录的验收条件，不替代文档。

## 4. 测试

默认不运行全量测试。`npm test`、`node --test tests/*.test.cjs` 和其他运行全部测试文件的命令不是常规验收命令。

1. 函数级测试：领域规则、状态推导、边界判断、协议解析、DTO 或 Repository 条件。使用临时内存库或假依赖，不启动服务，不调用真实模型。
2. API 测试：Route Handler 或 application service 的入参、许可、事务、返回 DTO、错误码和副作用。只覆盖本次 API，使用临时数据库和受控 Runtime。
3. 页面渲染、生产构建、全套回归、真实模型或浏览器验收，只有用户明确要求，或函数级和 API 测试无法证明目标行为时才做。

- 运行前说明测试文件、覆盖的函数或 API，以及不扩大范围的原因。
- 一个改动涉及多个独立目标时，只并行运行对应测试文件，不因此升级为全量测试。
- 类型检查只在类型边界变化时运行，不替代目标测试，也不附带全量测试。
- 测试只用临时库、内存库或副本。不得为测试启动、停止或改写用户服务和用户数据库。
- 现有测试不能覆盖时，先补充最小测试，再运行该测试。
- 新的完成记录写明实际测试文件和目标。

## 5. 持久化与迁移

- 数据库改动必须兼顾已有历史数据。禁止为适配新 Schema 自动清库或静默丢弃记录。
- 是否迁移、何时执行由用户决定。先说明旧数据影响和迁移选项；用户确认后提供可审查脚本。默认不运行脚本，不直接改写用户数据库。
- 表结构、约束、索引、Repository 和应用代码按批准后的目标模型实现。迁移脚本与应用启动和 schema 初始化分离，不以启动时隐式迁移替代用户决定。
- 未获用户确认前，不执行会改写历史记录的迁移。旧库无法安全兼容时，阻止继续写入并报告所需步骤，不得重建数据库绕过。
- 允许新增、合并、拆分、重命名或退役表。变更前必须在 `02`“表数量与模型可读性”（Bot 专属模型在 `06`）说明独立持久事实、现有问题、方案取舍、数量变化、关系总览和历史映射。
- 不得把每个流程、状态、组件或潜在功能都拆成表，不提前建设通用任务平台。合并也不得用任意 JSON 隐藏归属、唯一性和必须查询的关系。
- 表数量没有固定目标。现有表是实现和迁移基线，不是必须保留的数量。表结构设计调整不等于历史库迁移授权。
- 已完成的迁移授权只覆盖当时目标。后续任何迁移都须单独授权。执行前核对服务和数据库无其他打开连接，不操作用户服务启停。

## 6. 运行边界

- SessionMemory 功能整体退役：删除模型、模板、后台总结、API、DTO、会话绑定及页面依赖，不建立替代摘要；持久会话名称保留已有 purpose；侧栏标题只读所属Pi最新用户输入，时间使用持久lastOpenedAt，契约见02/03/04及06的SLIST-002。历史库退役与授权边界见 `02`、`06`，不自动改写或删除旧数据。
- 会话辅助入口统一为“文件”和“会话检查”两个独立非模态浮窗（不阻止继续对话，左侧任意单击关闭）；会话检查只含树标题预览和 Session 设置，投影见 `04`。

- Pi Agent 是唯一 Runtime。模型配置与默认设置遵循 `01`“应用级 Pi 配置来源”：以 npm 启动目录为本地配置根，models.json 和 settings.json 各自整份优先于全局文件；模型参数完整交给 Pi 解析，支持会话级模型切换，容量以当前模型的 contextWindow 为准。Agent 不覆盖配置。
- Agent 就是角色。页面称“Agent”，内部分别称 Agent 和 agents，不另建 Role。正式定义是应用管理的版本化 Markdown；数据库只保留目录索引、状态、摘要及 Project 和会话关系，不保存新版本正文。
- 独立项目 Agent 没有 Project owner。参考项目和文件仅用于本次生成或修订，不形成永久绑定或目录授权。
- 用户上传的 Markdown，包括 OpenCode、Claude 和普通 Markdown，都交给独立无工具 LLM 转换为规范 Agent.md。knowledge-v2 的 OpenCode 定义只是参考样本，不自动加载、执行或授予旧工具和目录权限。
- 独立项目 Agent 能力开关由用户明确选择，默认关闭。LLM 不授予能力。用户不手工编辑 Agent.md；创建和修改通过独立对话接收自然语言意见，右侧只读展示版本化 Markdown。
- 无 Project 的其他项目执行资源只作为模板，复制成 Project 独立实例后使用。其他资源模型另行设计，不借会话任意 JSON 临时实现。

## 7. 当前设计入口

- 独立项目与通用能力按 `01`～`05` 各自职责维护。
- Bot 全部专属设计只维护于 [docs/06-bot.md](docs/06-bot.md)。该文档只保留当前目标，不保留旧设计与归档副本；被取代的规则以单行清单说明去向，追溯旧结论以 git 历史为准。
- 设计拆分和目标调整不代表运行时已经实现，也不授权历史数据迁移。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
