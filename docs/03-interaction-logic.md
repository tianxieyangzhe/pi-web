# 03｜交互逻辑

> 状态：**目标交互逻辑。** 字段与关系以 [`02-data-model.md`](./02-data-model.md) 为准；页面结构以 [`04-ui-layout.md`](./04-ui-layout.md) 为准。

## 1. 总体规则

1. 创建 Workspace 只创建 Workspace；不创建默认 Agent、MCP、Project、Room 或 Session。
2. 创建 Room 只创建 Room；不要求目标，不创建 Session，不附加资源。
3. 创建或配置 Session 才选择 Agent、MCP、Project。
4. 普通 Room 消息只路由到 `role = primary` 的默认 Session。
5. 与 `role = worker` 的辅助 Session 交互必须显式带 `sessionId`。
6. Agent、MCP、Project 的新增、编辑、归档都是独立资源操作，不属于某个 Workspace。
7. Session 配置在 active turn 中冻结；后附加 Agent/MCP/Project 从下一 turn 生效。
8. Pi transcript 是恢复来源，数据库不是消息镜像。
9. 所有 Session 固定使用项目根目录 `.env.local` 指定的 OpenAI-compatible 模型；任何请求体、Agent 或 Session 字段都不能覆盖模型配置。

## 2. API

```text
GET    /api/workspaces
POST   /api/workspaces
GET    /api/workspaces/:workspaceId
PATCH  /api/workspaces/:workspaceId

GET    /api/projects
POST   /api/projects
PATCH  /api/projects/:projectId
DELETE /api/projects/:projectId
GET    /api/projects/:projectId/files?path=...
GET    /api/projects/:projectId/files/content?path=...
GET    /api/projects/:projectId/changes

GET    /api/mcps
POST   /api/mcps
PATCH  /api/mcps/:mcpId
DELETE /api/mcps/:mcpId
POST   /api/mcps/:mcpId/test

GET    /api/agents
POST   /api/agents
PATCH  /api/agents/:agentId
DELETE /api/agents/:agentId

GET    /api/workspaces/:workspaceId/rooms
POST   /api/workspaces/:workspaceId/rooms
GET    /api/rooms/:roomId
PATCH  /api/rooms/:roomId
DELETE /api/rooms/:roomId

GET    /api/rooms/:roomId/contents
POST   /api/rooms/:roomId/contents
PATCH  /api/rooms/:roomId/contents/:contentId
DELETE /api/rooms/:roomId/contents/:contentId

GET    /api/rooms/:roomId/sessions
POST   /api/rooms/:roomId/sessions
PATCH  /api/rooms/:roomId/sessions/:sessionId/configuration
POST   /api/rooms/:roomId/sessions/:sessionId/messages
POST   /api/rooms/:roomId/sessions/:sessionId/interrupt
POST   /api/rooms/:roomId/sessions/:sessionId/restore
POST   /api/rooms/:roomId/sessions/:sessionId/end

GET    /api/rooms/:roomId/messages
POST   /api/rooms/:roomId/messages
```

非流式成功响应为 `{ data, meta? }`；失败响应为 `ApiError`。两类消息发送 API 是例外，直接返回 NDJSON `AgentEventEnvelope`。

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    fieldErrors?: Record<string, string[]>;
  };
};
```

所有 mutation 接受 `Idempotency-Key`。列表必须稳定排序。

## 3. Workspace 与 Room

### 3.1 创建 Workspace

```text
验证名称
→ 创建 Workspace
→ 返回空的 Workspace 结构
```

Workspace 没有资源预设。它可以立刻创建 Room，也可以先创建独立 Agent、MCP、Project。

### 3.2 创建 Room

```text
POST /api/workspaces/:workspaceId/rooms
{}

验证 Workspace active
→ 创建 Room { title: "新会话", status: active }
→ 返回 Room
→ 导航到 /workspaces/:workspaceId/rooms/:roomId
```

Room 初始没有 Agent、MCP、Project、Session 和 RoomContent 行。展示层仍渲染目标、方向、输出等空结构。重复 Idempotency-Key 返回同一个 Room。

### 3.3 加载 Room

```text
读取 Room
∥ 读取 Room.sessions
∥ 读取 Room.contents
∥ 从 Session 聚合 Project / MCP / Agent 视图
→ 读取当前选中 Session 的 Pi 消息
→ 组装 RoomViewModel
```

没有 Session 时返回结构化空 Room，而不是错误或空白页面。

### 3.4 RoomContent 操作

Room 内容按记录操作，不整体覆盖：

```text
POST /api/rooms/:roomId/contents
→ 校验 Room 可编辑
→ 校验 kind、outputKind、status、title、body、position
→ 校验 sourceSessionId 属于当前 Room
→ 创建 RoomContent 行
→ 更新 Room.updatedAt

PATCH /api/rooms/:roomId/contents/:contentId
→ 校验内容属于当前 Room
→ 校验允许的状态转换
→ 若采用 overview/goal：在同一事务中 supersede 旧 active 行
→ 更新单条内容与 Room.updatedAt

DELETE /api/rooms/:roomId/contents/:contentId
→ 只允许删除未发布且无外部引用的草稿/候选
→ 已采用或已发布内容使用 superseded/retracted 保留历史
```

Session 或 Pi 可以通过 AgentEvent 提出目标、方向或输出候选，但不能自动写入 `room_contents`。用户可以接受候选、编辑内容、撤回输出或调整方向；每次只修改对应记录。

## 4. 创建 Session

Session 创建是所有资源组合的唯一入口。

```ts
type CreateSessionInput = {
  role: "primary" | "worker";
  purpose?: string | null;
  agentId?: string | null;
  mcpIds?: string[];
  workingProjectId?: string | null;
  referenceProjectIds?: string[];
  parentSessionId?: string | null;
};
```

### 4.1 默认 Session

第一条普通 Room 消息：

```text
POST /api/rooms/:roomId/messages
→ 找到 role = primary 的 Session
→ 不存在时：创建基础 Session
   role = primary
   agentId = null
   mcpIds = []
   workingProjectId = null
   referenceProjectIds = []
→ 使用该 Session 发送消息
```

并发首条消息时，partial unique index 保证最多一个 `role = primary` Session。

### 4.2 辅助 Session

```text
POST /api/rooms/:roomId/sessions
→ 校验 Room active
→ 校验 role = worker 与非空 purpose
→ 校验独立 Agent / MCP / Project 均可用
→ 校验 parentSessionId（如有）属于当前 Room
→ 创建 Session
→ 保存 Agent/MCP 快照与项目绑定
→ state = not_started
```

辅助 Session 可由用户创建，也可由默认 Session 所使用 Agent 在 `allowDelegation` 允许时委派。两者都只是创建 `role = worker` 的 Session。

## 5. Session 配置

```text
PATCH /api/rooms/:roomId/sessions/:sessionId/configuration
```

可变字段：`agentId`、`mcpIds`、`workingProjectId`、`referenceProjectIds`。

流程：

```text
验证 Session 属于 Room
→ 验证独立资源 active 且当前用户可用
→ 验证 Project 绑定规则
→ 若 Session 有 active turn：保存为下一 turn 配置
→ 否则立即保存当前配置
→ 写入 Agent/MCP 当前快照
→ configurationRevision + 1
→ 返回 Session 配置投影
```

资源变更不会中断当前 turn，不会改写已经执行的 Pi transcript。下一 turn 前 `PiSessionRuntime` 根据当前 Session 配置装配新的 Agent 扩展、MCP tools 和 Project context。

`agentId = null` 表示移除扩展并使用 Pi 基础能力。`mcpIds = []` 表示当前 Session 不使用 MCP。

## 6. 发送与 Pi Runtime

```text
发送消息到目标 Session
→ 验证 Room / Session 状态
→ 获取该 Session 执行锁
→ state = starting / running
→ 读取当前 Session 配置快照
→ 校验 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL_ID
→ 注册固定 workspace-openai / openai-completions 模型
→ PiSessionRuntime.open 或 restore
→ 装配可选 Agent extension
→ 装配 MCP tools
→ 建立 Project working/reference context
→ Pi 发送消息
→ Pi 事件翻译为 AgentEvent
→ NDJSON 输出
→ complete 或 error
→ state = idle 或 unavailable
→ 客户端使用流 envelope 的 sessionId 重新读取该 Pi transcript
→ transcript 到达后再清除流式消息投影
```

发送路由会在建立 NDJSON 响应前同步取得该 Session 的进程内执行锁。若该锁已被占用，或 Session 已处于 `starting`、`running`、`interrupting`，路由返回 HTTP 409 `SESSION_BUSY` 的 `ApiError`，不会把冲突伪装为 HTTP 200 的流内错误。锁只覆盖同一 Session；其他 Session 可以并行发送。

```ts
type AgentEventEnvelope = {
  eventId: string;
  turnId: string;
  roomId: string;
  sessionId: string;
  sequence: number;
  emittedAt: string;
  event: AgentEvent;
};
```

`AgentEvent` 只表达平台事件：文本增量、活动、标准化工具结果、审批、项目变化、Session 状态、完成或错误。工具结果必须使用平台字段 `toolName` 与 `result`；Pi 私有事件名和类型不进入浏览器。

客户端收到 `starting` 时立即投影“正在初始化工作线”，收到 `running` 但尚未收到文本或思考事件时投影“正在等待模型响应”；首个实际文本、思考或工具活动到达后移除这两个等待状态。它们只是当前请求的页面投影，不写入 Pi transcript 或数据库。

所有进入 `ActivityEvent.detail`、`tool_result.result` 和流内运行错误的信息必须先经过服务端脱敏与长度限制；API key、Bearer 凭据、authorization、token、password、secret、cookie 及敏感 URL 查询参数不得进入浏览器或日志。

流结束后的 Room/Session 状态刷新不能代替消息刷新。即使当前选中 Session ID 没有变化，客户端也必须重新读取实际响应 Session 的 Pi transcript，避免清除流式文本后出现输出消失；实时增量和恢复历史使用同一个 Markdown renderer。

AgentEvent 可以包含 `room_content_candidate`，用于提出目标、方向或输出建议；它只改变当前页面投影，除非用户确认，否则不写入 `room_contents`。

## 7. 项目绑定与多项目协作

### 7.1 单项目独立工作

```text
Room
└─ Session
   └─ workingProjectId = Project A
```

该 Session 的 Pi `cwd` 是 Project A。写入默认只允许针对 working Project，且还需通过 Project accessMode、Agent policy 与当前审批。

### 7.2 多项目协作

```text
Room
├─ Session A → working Project A
├─ Session B → working Project B
├─ Session C → working Project C
└─ Session D → reference Projects A, B, C
```

Room 展示所有 Session 的项目并集。Session D 可以协调、比较和分析多个项目；它没有 working Project 时不能自动把任一 reference Project 当作写入目标。

`referenceProjectIds` 不授予写权限。每次读写都重新校验目标 Project、Session 配置、Agent policy 和当前操作授权。

## 8. MCP 与 Agent

MCP 是当前 Session 的工具来源：

```text
Session.mcpIds
→ 固定 MCP connector 解析 config.kind
→ 连接 / listTools
→ 平台权限层
→ Pi custom tools
```

Agent 是当前 Session 的可选扩展：

```text
Session.agentId = null
→ Pi 基础能力

Session.agentId = agent_xxx
→ Pi 基础能力 + Agent extension snapshot
```

Agent 不能凭借自身配置绕过 Project、MCP 或用户权限；MCP 连接成功也不等于已被授权执行外部写操作。

模型配置不参与 Session 配置更新。`.env.local` 改变后，新的进程和之后重建的 Pi 句柄使用新模型；运行中的 turn 使用创建句柄时已冻结的模型。文件缺失、字段缺失或 URL 非 HTTP(S) 时返回 `MODEL_CONFIGURATION_ERROR`，错误只列缺失字段名，不包含 key 值。

## 9. 中断、恢复与结束

```text
interrupt
→ Session running / starting
→ state = interrupting
→ PiSessionRuntime.interrupt
→ idle 或 unavailable

restore
→ Session unavailable
→ 使用 Session 当前配置与 nativeRef
→ PiSessionRuntime.restore
→ idle 或 unavailable

end
→ 非运行 Session
→ state = ended
→ 保留 Pi transcript 与配置快照
```

恢复不会自动重放草稿、旧请求或配置变更。结束的 Session 只读；需要继续工作时创建新的 Session。

## 10. 权限

每次 Session 执行、每次工具调用和每次文件操作重新计算：

```text
Session project binding
∩ Project accessMode
∩ Agent generic policy（如有）
∩ MCP accessPolicy
∩ 当前操作授权
```

`workingProjectId` 是默认写入目标，不是永久授权。reference Project 默认仅可读。MCP `approval` 写操作暂停当前工具调用，等待用户允许一次或拒绝。

## 11. 失败恢复

| 场景 | 结果 |
| --- | --- |
| Agent 被归档 | 当前 Session 可读历史；下一 turn 要求移除或选择 active Agent |
| MCP 被停用 | 保留 Session 旧快照；下一 turn 不加载该 MCP，提示重新配置 |
| Project 路径失效 | Session 保留；working/reference 访问失败，不扩大到其他 Project |
| Pi nativeRef 丢失 | 保留 Session；历史不可恢复，不伪造新历史 |
| 浏览器断线 | Pi 可能继续运行；重新查询 Session 和 Pi transcript，不重复发送 |
| 进程重启 | active 状态转 unavailable；用户显式恢复 |

## 12. 页面布局交互

### 12.1 Inspector

```text
首次进入或切换 Room
→ inspectorVisible = false

点击 Room Header 右上角 Inspector 按钮
→ false 时显示 Inspector，并恢复本页最近 activeTab
→ true 时只隐藏 Inspector，不清除 activeTab

点击左栏 Projects / MCP / Agents
→ inspectorVisible = true
→ activeTab = 对应 Tab

点击 Inspector 横向 Tab
→ 只切换 activeTab
→ 不改变当前 Room、Session 或 Composer 目标
```

Inspector Tabs 固定为 Structure、Content、Projects、MCP、Agents、Details，并以单行横向选项卡呈现。

### 12.2 新增与修改

Workspace、Room 标题、Project、MCP、Agent、Session 配置和 RoomContent 的新增或修改都通过 Dialog 完成。打开 Dialog 不改变当前 Room、Session、Inspector Tab 或文件预览；保存成功后关闭并局部刷新，保存失败时保留输入与错误。

例外：新建 Room 是零表单命令，不打开 Dialog；文件树展开、文件选择与文件内容查看是浏览操作，不打开 Dialog。

### 12.3 文件内容列

```text
在 Projects Tab 选择 Project
→ 请求根目录的直接子项
→ Inspector 内显示该 Project 文件树

点击目录
→ 目录整行可展开或收起
→ 首次展开时请求该目录的直接子项，并合并到受控文件树

点击可预览文件
→ 请求安全文件内容
→ 若文件未打开：新增一个 File Content 标签；否则切换到已有标签
→ fileContentVisible = true
→ 在 Inspector 左侧新增 File Content 列

关闭单个文件标签
→ 仅移除该标签；存在其他标签时切换到相邻标签

关闭 File Content 列
→ 清除全部页面内文件预览标签
→ 保留 Inspector 与 Projects Tab

目录的首次加载只更新该目录的子项，根目录树和其他已展开目录保持可见；目录加载失败在当前页面显示局部错误，不清空文件树。
```

Inspector 的显隐与 File Content 的显隐相互独立。切换 Room 时关闭 File Content，避免旧 Room 的文件上下文残留。

## 13. 不做

- Room 直接绑定 Agent、MCP、Project；
- Workspace 默认 Agent/MCP；
- Agent/MCP/Project 的 Workspace 归属；
- Runtime/Adapter/Binding 数据表；
- 平台复制 Pi transcript；
- 在 active turn 中途改变正在生效的配置；
- 自动把 reference Project 作为写入目标。
- 从数据库、Agent、Session、请求参数或浏览器配置模型地址、key、provider 或 model ID。
