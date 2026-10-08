# 项目设计契约

本项目使用以下五份文档作为唯一权威设计。开始任何实现、重构、修复或评审前，必须读取与改动相关的文档；跨层改动必须读取全部五份。

1. [`docs/01-architecture.md`](docs/01-architecture.md)：单项目 SessionMemory 技术路线、目录与职责、Pi 编排和依赖方向。
2. [`docs/02-data-model.md`](docs/02-data-model.md)：SessionMemory 单表、Session 一对一、模板与项目归属、JSON 约束和迁移边界。
4. [`docs/04-ui-layout.md`](docs/04-ui-layout.md)：项目会话、SessionMemory 面板、模板选择、文件与检查布局。
5. [`docs/05-requirements.md`](docs/05-requirements.md)：产品范围、需求编号、验收条件、非功能要求与明确不做事项。

## 强制阅读规则

- 任何代码改动都必须先更新对应权威设计文档，再修改代码；包括实现、修复、重构、页面样式和交互调整。不得代码先行后补文档。

- 修改目录、模块边界、依赖、SDK、服务端/客户端边界前，读 `01-architecture.md`。
- 修改类型、数据库、Repository、SessionMemory 上下文装配或 Pi Session 引用前，读 `02-data-model.md`。
- 修改页面、组件、导航、面板、文案、空状态或响应式行为前，读 `04-ui-layout.md`。
- 新增或改造前端组件前，必须按 `01-architecture.md` 的“AI Elements 组件治理”检索官方组件；有语义匹配组件时优先通过 Feature Wrapper 接入。
- AI Elements 没有合适组件或不能采用时，先在 `01-architecture.md` 登记评估对象、例外原因、替代位置和复核条件。
- 开始任何产品功能前，在 `05-requirements.md` 中找到对应需求 ID 和验收条件；不存在时不得自行扩展范围。

## 事实来源与冲突处理

- `05-requirements.md` 决定“做什么”和“何时算完成”。
- `02-data-model.md` 决定“哪些是持久事实”。
- `03-interaction-logic.md` 决定“这些事实如何变化”。
- `04-ui-layout.md` 决定“用户如何看见和操作”。
- `01-architecture.md` 决定“代码放在哪里、允许依赖什么”。
- 现有代码实现的是旧模型，不能反向覆盖五份文档。
- 五份文档冲突时停止实现，先修正文档；禁止在代码中自行折中。
- 架构、模型、交互、布局或需求变化时，必须在同一改动中更新对应文档。
- 不在多份文档复制完整定义；字段以数据模型为准，流程以交互逻辑为准，其他文档只引用。

## 当前阶段规则

- 从 2026-09-28 起，所有数据库改动必须兼顾已有历史数据；禁止为了适配新 Schema 自动清库、删除旧表或静默丢弃记录。
- 数据迁移是否需要、是否执行由用户决定。先说明旧数据影响和迁移选项；用户确认需要后，提供可审查的迁移脚本，默认不运行脚本、不直接改写用户数据库。
- 数据库表结构、约束、索引、Repository 与应用代码由助手按批准后的目标模型直接实现；数据迁移脚本与应用启动/schema 初始化分离，不以启动时隐式迁移替代用户决定。
- 未获用户确认前，不执行会改写历史记录的迁移；若旧数据库无法安全兼容新 Schema，应明确阻止该数据库继续写入并报告所需步骤，不得用重建数据库绕过。
- 顶层资源是 Project。每个项目 Session 固定绑定一个 Project 和一个独有项目 SessionMemory；项目 SessionMemory 只能服务该 Session。Session 用户消息直接进入 Pi 原生 transcript。
- SessionMemory 相关持久数据只用 `session_memories` 一张表。SessionMemory 的 `projectId=null` 表示模板；项目 SessionMemory 的 `projectId` 必填，模板复制创建独立项目副本。`Session.sessionMemoryId` 对项目 Session 必填且唯一，不建 SessionMemory 内容子表或多对多关系表。
- SessionMemory 只保存 `02-data-model.md` 定义的摘要、目标、约束、事实、决策、下一步和产出摘要，不保存工具、扩展、Agent、MCP、Skill 的 ID、配置、快照或启用选择。
- 项目为空的运行资源只作为模板；复制后成为属于一个 Project 的独立实例，逐项目配置与调试。资源基础模型详细字段另行设计，不通过 SessionMemory JSON 或关系表临时实现。
- Pi Agent 是唯一 Runtime；固定服务端模型只兼容 OpenAI Chat Completions，只读取项目根目录 `.env.local` 的 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL_ID`，SessionMemory/Session/Agent/UI 均不覆盖。
- SessionMemory 数据只存数据库；当前阶段仅固定模式总结展示，不进入主 Pi 提示词或消息。Pi 原生 transcript、Runtime 句柄、原始 thinking、未脱敏工具结果、执行锁、订阅和 Client 不进入 SessionMemory。
- `page.tsx` 和 `route.ts` 只做入口与装配，不承载完整业务实现。
- 每项需求必须实现、测试并按 `05-requirements.md` 验收后，才能标记完成。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

- 跨项目会话当前仅保留页面入口及待设计空状态，不实现执行 API、编排或持久模型，等待用户另行定义。

- SessionMemory 相关持久内容只使用 session_memories 单表，Session.sessionMemoryId 必填、唯一且不可变；sessions.session_memory_id 与记忆所属 Project 通过组合外键保持一致。

- 自动和手动总结均通过 LLM 校验后直接更新 SessionMemory.contextJson，无确认流程；历史 draftJson 仅保留，不阻塞、不自动采用、不静默删除。

- SessionMemory 为固定七部分指导线，目前只独立总结、展示及人工校正；校正只供后续独立总结，不自动干预主 LLM 思考或执行，Pi 原生上下文继续管理主会话。
