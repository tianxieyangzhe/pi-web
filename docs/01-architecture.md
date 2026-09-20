# 01｜架构设计

> 状态：**目标架构。** 当前处于完整替换设计阶段，本文不描述旧代码或迁移路径。

## 1. 架构结论

系统有六个核心资源实体，以及一种 Room 内容子记录：

```text
Workspace
└─ Room *
   ├─ Session *
   │  ├─ Agent?               独立资源，可选扩展
   │  ├─ MCP *                独立资源，可选能力
   │  ├─ working Project?     当前实际工作项目
   │  └─ reference Projects * 显式参考项目
   └─ RoomContent *           目标、方向、输出与总览

Project / MCP / Agent
都是独立资源，不属于 Workspace、Room 或 Session。
```

关系的边界不可改变：

1. `Workspace` 只直接拥有 `Room`。
2. `Room` 直接拥有 `Session` 与 `RoomContent` 子记录；它不持有 Agent、MCP、Project 配置。
3. Session 是唯一运行实体，对应一次 Pi Coding Agent Runtime；它保存本次使用的 Agent、MCP、Project 和 Pi 原生 Session 恢复引用。
4. Agent 是可选的 Pi 扩展模板，不是创建 Session 的前置条件。
5. `Session.role` 是普通属性：`primary` 是默认工作线，`worker` 是辅助工作线；两者不是独立实体、表、API 或实现分支。
6. Adapter、Runtime Registry、Pi 进程句柄、MCP Client、事件订阅和执行锁都不是数据实体。
7. RoomContent 必须逐条存入 `room_contents` 表；禁止把目标、方向和输出塞进 Room `content_json`。

## 2. 术语

| 产品术语 | 代码术语 | 含义 |
| --- | --- | --- |
| 工作空间 | `Workspace` | Room 的组织与查询边界 |
| 项目 | `Project` | 独立的本地工作资源 |
| MCP | `Mcp` | 独立的外部或内置能力定义 |
| Agent | `Agent` | 独立、可复用的 Pi 扩展模板 |
| 会话 | `Room` | 多条 Session 的结构化协作容器 |
| 工作线 | `Session` | 一次实际 Pi Runtime；UI 按 `role` 显示主线或辅助线 |
| 主工作线 | `Session.role = "primary"` | 普通 Room 消息的默认路由目标 |
| 辅助工作线 | `Session.role = "worker"` | 显式创建或委派的独立 Session |

界面中的“会话”只表示 Room。Session 在界面中称“工作线”，不脱离限定词显示为“会话”。

Pi SDK 内部术语只存在于 `PiSessionRuntime` 实现内：Pi `AgentSession`、`SessionManager`、`AgentSessionRuntime`。它们不能成为平台表、DTO 或 UI 概念。

## 3. Pi 与 Agent

Pi Coding Agent Runtime 是固定的静态实现，不是数据库配置，也不是用户选择的 Runtime 资源。

```text
Session
→ PiSessionRuntime              固定代码实现
  → Pi Coding Agent SDK
    + Agent extension?          Session 可选配置
    + MCP tools*                Session 可选配置
    + Project context           Session 项目绑定
```

`Agent` 只扩展 Pi：角色说明、指令、思考强度、Tools、Extensions、Skills、Settings 和通用执行策略。没有 Agent 时，Session 直接使用 Pi 基础能力。Agent 不选择模型、Provider、API 地址或凭据。

### 3.1 固定模型配置

平台只兼容 OpenAI Chat Completions 格式。模型是进程级基础设施配置，不是领域实体、独立资源或 Agent 配置：

```text
OPENAI_BASE_URL  → OpenAI-compatible API 根路径，通常以 /v1 结尾
OPENAI_API_KEY   → Bearer key，仅服务端进程内可见
OPENAI_MODEL_ID  → 请求使用的 model ID
```

`PiSessionRuntime` 首次创建或恢复工作线时，以固定 provider ID `workspace-openai` 注册一个 `openai-completions` 模型，并在创建或恢复每个 Pi Session 时显式传入该模型。禁止读取 Pi 全局默认模型、`models.json`、登录凭据或 Agent 自定义 provider/model。

项目根目录 `.env.local` 由 `infrastructure/pi/openai-model-config.server.ts` 显式读取和校验。API key 不进入数据库、Session snapshot、nativeRef、API、浏览器、日志或错误消息；前端不提供模型路径、key 或模型 ID 的编辑入口。即使宿主进程提供同名环境变量，也不作为模型配置来源。

固定接口由服务端代码实现：

```ts
interface PiSessionRuntime {
  open(input: SessionRuntimeInput): Promise<NativeHandle>;
  restore(input: SessionRuntimeInput): Promise<NativeHandle>;
  send(input: SendMessageInput): Promise<void>;
  interrupt(handle: NativeHandle): Promise<void>;
  readMessages(input: SessionRuntimeInput): Promise<ConversationMessage[]>;
  close(handle: NativeHandle): Promise<void>;
}
```

不存在 `runtime`、`driver`、`adapter`、`binding`、`asset` 或 transcript 镜像表。

## 4. Session 配置

Session 是配置汇合点：

```text
Session
├─ agentId? / agentSnapshot?
├─ mcpIds / mcpSnapshots
├─ workingProjectId?
├─ referenceProjectIds
├─ role
├─ state
└─ nativeRef
```

### 4.1 项目绑定

每个 Session 最多一个 `workingProjectId`：Pi Runtime 的主要 `cwd`，是实际修改代码或文件的默认目标。

`referenceProjectIds` 是多个显式参考项目，可用于读取、分析、比较和跨项目协作；它们不自动成为写入目标。

因此：

```text
单项目独立工作
→ 一个 Session + 一个 workingProjectId

多项目协作
→ 一个 Room + 多个 Session
   每个执行 Session 绑定自己的 workingProjectId
   协调 Session 可没有 workingProjectId，只引用多个 Project
```

Room 的 Projects 面板只是所有 Session 项目绑定的并集投影，不拥有项目权限。

### 4.2 后附加 Agent 与 MCP

Agent/MCP 可在创建 Session 时选择，也可在 Session 已存在后附加、替换或移除。Room 页面上的操作必须明确目标 Session；Room 本身不保存此配置。

配置变更规则：

1. 当前 turn 使用开始时冻结的配置。
2. 变更在下一 turn 生效；如果没有 active turn，立即生效。
3. Pi Runtime 句柄需要重建时，由固定 `PiSessionRuntime` 在下一 turn 前重建，平台 Session 和 Pi transcript 不更换。
4. Agent/MCP/Project 不可用或校验失败时，保留旧配置，不能写入半成品配置。

## 5. Room 的结构职责

Room 即使没有目标、消息或 Session，也必须有稳定结构：

```text
Room
├─ 标题与状态
├─ 目标、方向、输出与总览
├─ 工作线结构          当前没有工作线 / 默认工作线 / 辅助工作线
├─ 项目聚合视图        来自 Session 项目绑定
├─ MCP 聚合视图        来自 Session MCP 绑定
├─ Agent 聚合视图      来自 Session Agent 绑定
└─ 活动与消息区域
```

没有目标不等于没有结构。空 Room 可以直接创建一个没有 Agent、MCP、Project 的基础 Session，也可以先选择资源再创建 Session。

Room 的目标、方向、跨 Session 输出和总览由 `RoomContent` 子记录持久化。每条内容拥有独立 ID、类型、状态、排序和来源 Session，可单独查询与更新。它不是 transcript；Session 只能提供候选和来源，写入或改变 RoomContent 必须由用户确认或编辑。

## 6. 分层与目录

```text
src/
├─ app/                 路由、页面入口、Route Handler
├─ features/            AppShell、Room、Session、Project、MCP、Agent 的页面投影
├─ application/         用例、事务、权限、并发、配置变更
├─ domain/              六个核心实体、RoomContent、状态转换、校验与错误
├─ infrastructure/
│  ├─ database/         六张核心表、room_contents 与 Repository
│  ├─ pi/               固定 PiSessionRuntime、事件翻译、nativeRef
│  ├─ mcp/              固定 MCP transport 实现
│  ├─ projects/         Path Guard、文件、Git、Diff
│  └─ security/         secret、脱敏、安全错误
└─ shared/              protocol、UI primitives、AI Elements 源码、纯工具
```

依赖方向：

```text
app → features → shared/protocol
app → application
application → domain + ports
infrastructure → ports + domain
shared → 无业务层依赖
```

只有 composition root 可以同时认识 Application 与 Infrastructure。Feature 不导入数据库、Pi SDK、Node 文件系统或 MCP transport。

## 7. 静态实现与外部规范

| 领域 | 固定实现 | 规范入口 |
| --- | --- | --- |
| Pi Runtime | `PiSessionRuntime` + 固定 OpenAI-compatible provider | [Pi SDK](https://pi.dev/docs/latest/sdk) |
| MCP Client | MCP connector/transport 实现 | [MCP TypeScript Client](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/README.md) |
| AI 交互组件 | AI Elements 源码组件 | [AI Elements](https://elements.ai-sdk.dev/) |

AI Elements 是新增前端组件的第一检索来源。存在语义匹配组件时优先采用，并通过 Feature Wrapper 接入平台 ViewModel；不能采用时必须登记原因、替代位置和复核条件。

消息 UI 只接受平台 `AgentEvent`，不使用 AI SDK 的 `useChat`、`UIMessage`、`ToolUIPart` 或 AI SDK transport。实时流和历史恢复统一使用同一 Markdown 渲染路径。

### 7.1 布局组件登记

| 需求 | AI Elements 评估 | 决策 | 位置 |
| --- | --- | --- | --- |
| Project 文件树 | 有 [File Tree](https://elements.ai-sdk.dev/components/file-tree) | 优先采用 AI Elements File Tree | `shared/ui/ai-elements/file-tree.tsx` |
| 文件内容展示 | 有 [Code Block](https://elements.ai-sdk.dev/components/code-block) | 代码文件使用 Code Block；普通文本使用同一内容列的安全文本视图 | `features/project/file-content-panel.tsx` |
| Timeline | 有 [Conversation](https://elements.ai-sdk.dev/components/conversation) | 官方源码依赖尚未进入依赖集；临时由 Room Feature 负责滚动与空状态，安装后替换为 Feature Wrapper | `features/room/room-surface.tsx` |
| 消息与 Markdown | 有 [Message](https://elements.ai-sdk.dev/components/message) | 官方 `MessageResponse` 依赖 Streamdown；当前使用本地安全结构化 Markdown renderer，不注入 HTML，依赖可用后替换 | `shared/ui/ai-elements/markdown-response.tsx` |
| Composer | 有 [Prompt Input](https://elements.ai-sdk.dev/components/prompt-input) | 官方源码依赖 AI SDK 与 shadcn 原语；当前保留相同键盘、状态和草稿语义，依赖可用后替换 | `features/room/room-surface.tsx` |
| 活动与工具 | 有 [Task](https://elements.ai-sdk.dev/components/task) 与 [Tool](https://elements.ai-sdk.dev/components/tool) | 当前直接展示平台 `ActivityEvent`，不引入 AI SDK Tool 类型；依赖可用后由 Wrapper 映射 | `features/room/room-surface.tsx` |
| MCP 审批 | 有 [Confirmation](https://elements.ai-sdk.dev/components/confirmation) | 等官方 MCP Client 与审批事件接入后采用；禁止先做无执行语义的假审批 UI | `features/room/room-surface.tsx` |
| Inspector 横向选项卡 | AI Elements 无通用 Tabs | 使用本地 WAI-ARIA Tabs 基础原语；引入 Radix 后只替换原语内部 | `shared/ui/primitives/tabs.tsx` |
| 新增、修改与确认弹窗 | AI Elements 无通用应用表单 Dialog | 使用本地语义 Dialog 基础原语；引入 Radix 后只替换原语内部 | `shared/ui/primitives/dialog.tsx` |
| 表单与工作空间选择 | AI Elements 无通用应用表单 Select | 使用统一的本地 listbox 原语，集中提供当前项、点击外部关闭、Escape 与禁用状态；引入 Radix 后只替换原语内部 | `shared/ui/primitives/select.tsx` |

Tabs、Dialog 和 Select 属于通用应用壳原语，不承载领域状态。当前依赖集中没有 Radix Tabs/Dialog/Select，先用具备 `role`、ARIA、Escape 和点击外部关闭行为的本地原语，避免业务组件自行重复实现；依赖可用后仅替换原语内部。Inspector、文件内容列、各类编辑 Dialog 必须由对应 Feature Wrapper 组装，不能把完整页面状态放进基础组件。

### 7.2 Tailwind 样式约定

Tailwind CSS 是本项目唯一的视觉样式承载方式。布局、间距、颜色、字体、边框、响应式、状态与动画均写在组件的 Tailwind utility class 中；`src/app/globals.css` 只保留 Tailwind 入口，不新增页面、Feature 或组件的手写 CSS 规则、CSS Modules、styled-components 或内联 `style` 对象。

1. 保持组件的领域语义、数据流与交互职责不变；样式迁移不得趁机把 Feature 状态下沉到通用 UI 原语。
2. 同一交互模式必须复用 shared primitive，而不是复制一套视觉实现。当前包括 Dialog、Tabs、Select；新的通用控件先评估 AI Elements，再按本节登记例外。
3. 条件样式使用 Tailwind class 组合表达；只允许通过 `cn` 合并 utility class，不创建业务 CSS 类名作为样式入口。
4. 响应式规则使用 Tailwind breakpoint utilities，保证窄屏下 Sidebar、Inspector 与 File Content 的既定信息架构不变。
5. 颜色、焦点、禁用、错误和 loading 状态必须以 utility class 同时表达视觉与可访问反馈，不能只依赖颜色。

验证方式：`rg` 不应发现业务组件中的旧视觉类名或原生 `select`；类型检查、生产构建以及桌面/窄屏界面验收均须通过。

### 7.3 可选右侧列

桌面布局最多由四列组成：Workspace Sidebar、Room Surface、File Content、Inspector。Inspector 默认隐藏，由 Room Header 按钮或左栏资源入口打开；File Content 仅在选择文件后出现，位于 Inspector 左侧，并拥有独立关闭行为。

`FileContentPanel` 只显示服务端安全文件预览结果，不直接读文件系统，不提供未经需求定义的文件编辑能力。它与 Inspector 是两个独立列，不能把文件内容重新塞进 Inspector 或弹窗。一个文件预览列可保留多个已打开文件标签；标签与当前文件仅属于页面内状态，不持久化。

## 8. 关键不变量

1. Workspace 与 Session 的 `workspaceId` 必须等于其 Room 的 `workspaceId`；Session 冗余记录此字段仅用于查询和校验。
2. Agent、MCP、Project 不属于 Workspace；Session 使用它们时必须检查独立资源状态与当前用户授权。
3. 一个 Room 最多一个 `role = primary` Session。
4. Session 可以没有 Agent、MCP、workingProject 或 referenceProject。
5. 一个 Session 同时只有一个 active turn；多个 Session 可以并行。
6. Pi transcript 属于 Pi，平台不复制完整消息表。
7. 浏览器提交的所有资源 ID、路径和权限声明都不可信，服务端重新校验。
8. 适配层只属于静态代码，不能持久化为实体或由用户动态注册。
9. 所有 Session 使用项目根目录 `.env.local` 指定的同一个 `workspace-openai` 模型；Agent、Room 与 Session 均不能覆盖模型路径、key 或模型 ID。

## 9. 架构变更

以下变化必须先更新本文并同步其余四份文档：核心实体关系、RoomContent 结构、Session 配置字段、Pi Runtime 接口、MCP 接入方式、项目绑定强度、流协议、AI Elements 采用或例外。

每项变更必须写明对应需求 ID、替换的决策、影响范围和验证方式。
