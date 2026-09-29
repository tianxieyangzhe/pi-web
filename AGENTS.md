# 项目设计契约

本项目使用以下五份文档作为唯一权威设计。开始任何实现、重构、修复或评审前，必须读取与改动相关的文档；跨层改动必须读取全部五份。

1. [`docs/01-architecture.md`](docs/01-architecture.md)：单项目 Room 技术路线、目录与职责、Pi 编排和依赖方向。
2. [`docs/02-data-model.md`](docs/02-data-model.md)：Room 单表、Session 一对一、模板与项目归属、JSON 约束和迁移边界。
3. [`docs/03-interaction-logic.md`](docs/03-interaction-logic.md)：项目 Session 执行、Room 上下文、自动草稿、人工确认、API 与恢复。
4. [`docs/04-ui-layout.md`](docs/04-ui-layout.md)：项目会话、Room 面板、模板选择、文件与检查布局。
5. [`docs/05-requirements.md`](docs/05-requirements.md)：产品范围、需求编号、验收条件、非功能要求与明确不做事项。

## 强制阅读规则

- 修改目录、模块边界、依赖、SDK、服务端/客户端边界前，读 `01-architecture.md`。
- 修改类型、数据库、Repository、Room 上下文装配或 Pi Session 引用前，读 `02-data-model.md`。
- 修改 API、Session 调度、Room 草稿/确认、流式事件、恢复或错误处理前，读 `03-interaction-logic.md`。
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
- 当前权威目标仅覆盖单项目 Room；现有跨项目 Room、Router、RoomRun、Task 等代码和表是待重新设计的旧模型，不能推导本版 Room 的字段或流程，也不得自动删除历史记录。
- 顶层资源是 Project。每个项目 Session 固定绑定一个 Project 和一个独有项目 Room；项目 Room 只能服务该 Session。Session 用户消息直接进入 Pi 原生 transcript。
- Room 相关持久数据只用 `rooms` 一张表。Room 的 `projectId=null` 表示模板；项目 Room 的 `projectId` 必填，模板复制创建独立项目副本。`Session.roomId` 对项目 Session 必填且唯一，不建 Room 内容子表或多对多关系表。
- Room 的 `contextJson` 是用户已确认的当前结构，`draftJson` 是至多一份自动形成、待用户确认的草稿；只有明确确认后的当前内容才影响下一轮 Pi 系统提示词。Room 不存内容版本。
- Room 只保存 `02-data-model.md` 定义的摘要、目标、约束、事实、决策、下一步和产出摘要，不保存工具、扩展、Agent、MCP、Skill 的 ID、配置、快照或启用选择。
- 项目为空的运行资源只作为模板；复制后成为属于一个 Project 的独立实例，逐项目配置与调试。资源基础模型详细字段另行设计，不通过 Room JSON 或关系表临时实现。
- Pi Agent 是唯一 Runtime；固定服务端模型只兼容 OpenAI Chat Completions，只读取项目根目录 `.env.local` 的 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL_ID`，Room/Session/Agent/UI 均不覆盖。
- Room 数据只存数据库；已确认上下文按每次调用在内存中渲染为 Markdown。Pi 原生 transcript、Runtime 句柄、原始 thinking、未脱敏工具结果、执行锁、订阅和 Client 不进入 Room。
- 同一 Session 同时最多一个运行中的用户请求；Room 自动草稿生成独立于主会话，失败不阻断回复，有待确认草稿时不得自动覆盖。
- `page.tsx` 和 `route.ts` 只做入口与装配，不承载完整业务实现。
- 每项需求必须实现、测试并按 `05-requirements.md` 验收后，才能标记完成。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
