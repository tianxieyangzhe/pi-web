# 项目设计契约

本项目使用以下五份文档作为唯一权威设计。开始任何实现、重构、修复或评审前，必须读取与改动相关的文档；跨层改动必须读取全部五份。

1. [`docs/01-architecture.md`](docs/01-architecture.md)：技术路线、目录与文件职责、依赖方向、SDK 和第三方依赖选择。
2. [`docs/02-data-model.md`](docs/02-data-model.md)：领域实体、持久化结构、字段、关系、约束与生命周期。
3. [`docs/03-interaction-logic.md`](docs/03-interaction-logic.md)：用户操作、服务编排、API、事件流、状态机、错误和并发行为。
4. [`docs/04-ui-layout.md`](docs/04-ui-layout.md)：信息架构、页面布局、组件区域、响应式、交互反馈和 UI 状态归属。
5. [`docs/05-requirements.md`](docs/05-requirements.md)：产品范围、需求编号、验收条件、非功能要求与明确不做事项。

## 强制阅读规则

- 修改目录、模块边界、依赖、SDK、服务端/客户端边界前，读 `01-architecture.md`。
- 修改类型、数据库、Repository、领域约束、原生 Session 引用前，读 `02-data-model.md`。
- 修改 API、消息发送、流式事件、Agent 调度、审批、恢复或错误处理前，读 `03-interaction-logic.md`。
- 修改页面、组件、导航、面板、文案、空状态或响应式行为前，读 `04-ui-layout.md`。
- 任何新增或改造前端组件的需求，必须先按 `01-architecture.md` 的“AI Elements 组件治理”检索官方组件目录；存在语义匹配组件时优先采用并通过 Feature Wrapper 适配，不能跳过评估直接重复开发。
- AI Elements 没有合适组件或确实不能采用时，必须先在 `01-architecture.md` 的组件治理章节登记评估对象、例外原因和替代实现位置；官方示例的数据类型和后端接入方式不能替代本项目架构。
- 开始任何产品功能前，在 `05-requirements.md` 中找到对应需求 ID 和验收条件；不存在对应需求时，不得自行扩展产品范围。

## 事实来源与冲突处理

- `05-requirements.md` 决定“做什么”和“何时算完成”。
- `02-data-model.md` 决定“哪些是持久事实”。
- `03-interaction-logic.md` 决定“这些事实如何变化”。
- `04-ui-layout.md` 决定“用户如何看见和操作”。
- `01-architecture.md` 决定“代码放在哪里、允许依赖什么”。
- 现有代码可能实现旧模型，不能反向覆盖这五份文档。
- 五份文档发生冲突时，停止相关实现，先把冲突修正为一致设计；禁止在代码中自行折中。
- 架构、模型、交互、布局或需求发生变化时，必须在同一改动中更新对应文档。
- 不在多份文档中复制完整定义；字段以数据模型为准，流程以交互逻辑为准，其他文档只引用。

## 当前阶段规则

- 当前为完整替换阶段，不实现旧模型迁移、双写、兼容字段或旧 API 适配，除非用户明确要求。
- 产品术语“会话”对应领域对象 `Room`。
- 六个核心资源实体是 `Workspace`、`Project`、`Mcp`、`Agent`、`Room`、`Session`；另有 `RoomContent` 作为 Room 的结构内容子记录。数据库固定为六张核心表加 `room_contents`，不得使用 Room `content_json`。
- `Workspace` 只关联 `Room`；`Room` 关联 `Session` 与 `RoomContent`；`Session` 才关联可选 `Agent`、多个 `MCP`、一个 working `Project` 与多个 reference `Project`。
- `Project`、`MCP`、`Agent` 是独立资源，不属于 Workspace、Room 或 Session；Session 是这些资源唯一的运行期组合点。
- `Session` 对应 Pi Coding Agent Runtime；`primary` 和 `worker` 只是 `Session.role` 属性，不是独立实体或 API 类型。
- Agent 是可选 Pi 扩展模板。没有 Agent 的 Session 使用 Pi 基础能力；Agent/MCP/Project 可以在 Session 创建后配置，并从下一 turn 生效。
- 模型是固定服务端基础设施，不是实体或 Agent 配置。只兼容 OpenAI Chat Completions 格式，只读取项目根目录 `.env.local` 中的 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL_ID`；禁止从请求、UI、数据库、Agent、Session、宿主环境、Pi 默认模型或本机登录凭据覆盖。
- Pi 原生 Session、Pi Runtime 适配层、MCP Client、执行锁和事件订阅属于固定服务端代码或进程内状态，不进入数据库。
- 路由 `page.tsx` 和 `route.ts` 只做入口与装配，不承载完整业务实现。
- 每项需求必须实现、测试并按照 `05-requirements.md` 的验收条件验证后，才能标记完成。
