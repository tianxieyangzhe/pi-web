# 02｜数据模型

> 状态：**目标数据模型。** 六张核心实体表加一张 `room_contents` 子记录表；不建立 Runtime、Binding、Asset 或平台消息表。

## 1. 核心实体与 RoomContent

```text
workspace
project
mcp
agent
room
session
room_contents  # Room 的结构内容子记录
```

关系：

```text
Workspace 1 ─── * Room
                    ├── * Session
                    │      ├── 0..1 Agent
                    │      ├── 0..* MCP
                    │      ├── 0..1 working Project
                    │      └── 0..* reference Project
                    └── * RoomContent
```

Project、MCP、Agent 都是独立资源，不带 `workspaceId`、`roomId` 或 `sessionId`。Session 是它们唯一的运行期组合点。

## 2. 基础类型

```ts
type EntityId = string;
type ISODateTime = string;
type JsonObject = Record<string, unknown>;

type ResourceStatus = "active" | "disabled" | "archived";
type RoomStatus = "active" | "paused" | "closed" | "archived";
type SessionRole = "primary" | "worker";
type SessionState =
  | "not_started"
  | "starting"
  | "idle"
  | "running"
  | "interrupting"
  | "ended"
  | "unavailable";

type RoomContent = {
  id: EntityId;
  roomId: EntityId;
  kind: "overview" | "goal" | "direction" | "output";
  outputKind: "note" | "decision" | "plan" | "delivery" | "summary" | null;
  title: string;
  body: string;
  status:
    | "candidate"
    | "active"
    | "adopted"
    | "dismissed"
    | "draft"
    | "published"
    | "superseded"
    | "retracted";
  sourceSessionId: EntityId | null;
  position: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

type RoomContentCandidate =
  | { type: "goal"; text: string; sourceSessionId: EntityId }
  | { type: "direction"; title: string; body: string; sourceSessionId: EntityId }
  | { type: "output"; outputKind: NonNullable<RoomContent["outputKind"]>; title: string; body: string; sourceSessionId: EntityId };
```

ID 前缀：`workspace_`、`project_`、`mcp_`、`agent_`、`room_`、`session_`、`room_content_`。前缀只用于诊断，不能承载授权含义。

## 3. Workspace

```ts
type Workspace = {
  id: EntityId;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

Workspace 只组织 Room。它不拥有、不默认选择、不复制 Project、MCP 或 Agent。

约束：

1. archived Workspace 不能创建 Room 或 Session。
2. 删除 Workspace 只删除其 Room 和 Session 记录；不删除任何独立 Project、MCP、Agent 或 Pi 原生文件。
3. 当前 Workspace、当前 Room、Inspector Tab 等不进入 Workspace 表。

## 4. Project

```ts
type Project = {
  id: EntityId;
  name: string;
  description: string | null;
  kind: "code" | "knowledge" | "general";
  rootPath: string;
  accessMode: "read" | "write";
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

Project 是独立本地资源。相同 Project 可以被不同 Workspace 的不同 Session 使用。

约束：

1. `rootPath` 是可读的规范化绝对目录。
2. 一个规范化真实路径只能对应一个 Project。
3. 所有文件访问必须经过 realpath 和 Project root 边界检查。
4. archived 或 disabled Project 不能被新配置附加到 Session。
5. 已被 active Session 用作 `workingProjectId` 的 Project 不可删除；只能停用或等 Session 结束。

## 5. MCP

```ts
type McpConfig =
  | { kind: "built_in"; implementation: "workspace" }
  | { kind: "stdio"; command: string; args: string[]; envSecretRefs: Record<string, string> }
  | { kind: "streamable_http"; url: string; authSecretRef: string | null };

type Mcp = {
  id: EntityId;
  name: string;
  description: string | null;
  config: McpConfig;
  accessPolicy: "read_only" | "approval" | "allow";
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

MCP 是独立能力定义。它不属于 Workspace；Session 使用它时保存 ID 与当前配置快照。

约束：

1. `config` 只能保存 secret 引用，不能保存凭据明文。
2. disabled 或 archived MCP 不能被新附加到 Session。
3. 被 active turn 使用的 MCP 不可在该 turn 中移除；变更从下一 turn 生效。
4. MCP 连接健康、工具列表、Client 句柄不是持久字段。

## 6. Agent

```ts
type AgentPolicy = {
  allowProjectWrite: boolean;
  allowExternalWrite: boolean;
  allowDelegation: boolean;
  maxParallelSessions: number;
};

type PiAgentExtension = {
  instruction: string | null;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  tools: string[] | null;
  excludeTools: string[];
  extensionSources: string[];
  skillPaths: string[];
  settings: JsonObject;
};

type Agent = {
  id: EntityId;
  name: string;
  description: string | null;
  extension: PiAgentExtension;
  policy: AgentPolicy;
  revision: number;
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

Agent 是独立的 Pi 扩展模板。它不是 Runtime，不属于 Workspace，也不是创建 Session 的必要条件。

约束：

1. Agent 不保存 Project ID、MCP ID、Workspace ID、Room ID 或 Session ID。
2. Agent 只能表达通用扩展与通用执行策略；具体资源选择始终位于 Session。
3. 修改 Agent 使 `revision + 1`，只影响之后附加或重新配置的 Session。
4. 已有 Session 使用自身快照，不会被 Agent 后续编辑静默改写。
5. archived Agent 不能被新附加；被历史 Session 引用时可归档，不物理删除。
6. Agent 不保存 model provider、base URL、API key 或 model ID；模型信息只来自项目根目录 `.env.local`。

## 7. Room

```ts
type Room = {
  id: EntityId;
  workspaceId: EntityId;
  title: string;
  status: RoomStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

Room 关联 Workspace、Session 与 RoomContent。它不保存 Agent、MCP、Project、默认资源、运行时或完整 transcript。

RoomContent 按行保存：没有 `kind = goal` 的 active 记录就表示尚无目标；没有 direction/output 行就表示尚无方向或输出。空 Room 不需要创建占位行。

Room 生命周期转换为：`active → paused/closed/archived`、`paused → active/closed/archived`、`closed → active/archived`、`archived → active`；相同状态更新是幂等操作，其他转换拒绝。

Room 输出不能复制完整消息、工具结果或 Pi transcript。`sourceSessionId` 只记录来源 Session，不将来源内容复制为第二份历史。

约束：

1. 一个 Room 可以有多个并行 Session。
2. 一个 Room 最多一个 `role = primary` Session。
3. archived Room 不允许创建 Session 或发送消息。
4. Room 的 Projects、MCP、Agents 都是 Session 配置的聚合投影，不持久化到 Room。
5. RoomContent 的变更不得修改任何 Session 配置、Pi transcript 或资源权限。
6. RoomContent 中非空的 `sourceSessionId` 必须属于当前 Room；手工创建的目标、方向和输出允许来源为空。
7. 一个 Room 最多一个 `kind = overview AND status = active` 记录和一个 `kind = goal AND status = active` 记录。
8. `kind = output` 时 `outputKind` 必须非空；其他 kind 的 `outputKind` 必须为空。
9. `position` 是同一 Room、同一 kind 内的稳定显示顺序。
10. status 必须符合 kind：overview 使用 active/superseded，goal 使用 active/superseded/retracted，direction 使用 candidate/adopted/dismissed，output 使用 draft/published/superseded/retracted。

## 8. Session

```ts
type Session = {
  id: EntityId;
  workspaceId: EntityId;
  roomId: EntityId;
  role: SessionRole;
  purpose: string | null;
  parentSessionId: EntityId | null;

  agentId: EntityId | null;
  agentSnapshot: Agent | null;
  mcpIds: EntityId[];
  mcpSnapshots: Mcp[];
  workingProjectId: EntityId | null;
  referenceProjectIds: EntityId[];
  configurationRevision: number;

  state: SessionState;
  nativeRef: JsonObject | null;
  nativeMetadata: JsonObject;
  createdAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
  endedAt: ISODateTime | null;
};
```

Session 是 Pi Coding Agent Runtime 的平台记录。它可以：

- 没有 Agent，直接使用 Pi 基础能力；
- 没有 MCP；
- 没有 Project；
- 有一个工作项目和多个参考项目；
- 在创建后附加、替换或移除 Agent/MCP；
- 与同一 Room 的其他 Session 并行运行。

`role` 仅是属性：

```text
primary → 默认消息路由，UI 显示主工作线
worker  → 显式选择或委派，UI 显示辅助工作线
```

### 8.1 配置变更

Session 配置更新包含 Agent、MCP 与项目绑定：

1. active turn 的配置冻结不变。
2. 新配置写入 Session 并使 `configurationRevision + 1`。
3. 下一 turn 前固定 Pi runtime 根据当前 Session 快照重新装配。
4. Pi transcript 和平台 Session ID 保持不变。
5. 任何资源校验失败都回滚整个配置变更。

### 8.2 不变量

1. `Session.workspaceId = Room.workspaceId`。
2. `role = primary` 时 `parentSessionId = null`。
3. `role = primary` 的 Session 只能由 Room 的普通消息懒创建。
4. `role = worker` 必须有非空 `purpose`。
5. `workingProjectId` 不能同时出现在 `referenceProjectIds`。
6. working/reference Project、Agent、MCP 必须处于 active 状态才能被新配置使用。
7. `agentSnapshot = null` 当且仅当 `agentId = null`。
8. `mcpIds` 与 `mcpSnapshots` 必须一一对应，去重且顺序稳定。
9. 同一 Session 同时只有一个 active turn。

### 8.3 状态转换

```text
not_started → starting → running → idle
idle → running
idle / unavailable → starting
running → interrupting → idle
starting / running / interrupting → unavailable
not_started / idle / unavailable → ended
```

`starting` 只表示 Pi Runtime 创建或恢复过程。进程重启时 `starting`、`running`、`interrupting` 统一转为 `unavailable`。

## 9. SQLite Schema

固定为六张核心表和一张 Room 内容表：

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('code','knowledge','general')),
  root_path TEXT NOT NULL UNIQUE,
  access_mode TEXT NOT NULL CHECK (access_mode IN ('read','write')),
  status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mcps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  config_json TEXT NOT NULL,
  access_policy TEXT NOT NULL CHECK (access_policy IN ('read_only','approval','allow')),
  status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  extension_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','closed','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, workspace_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary','worker')),
  purpose TEXT,
  parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_snapshot_json TEXT,
  mcp_ids_json TEXT NOT NULL DEFAULT '[]',
  mcp_snapshots_json TEXT NOT NULL DEFAULT '[]',
  working_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  reference_project_ids_json TEXT NOT NULL DEFAULT '[]',
  configuration_revision INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK (state IN ('not_started','starting','idle','running','interrupting','ended','unavailable')),
  native_ref_json TEXT,
  native_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  last_activity_at TEXT,
  ended_at TEXT,
  CHECK ((role = 'primary' AND parent_session_id IS NULL) OR (role = 'worker' AND length(trim(purpose)) > 0)),
  CHECK ((agent_id IS NULL AND agent_snapshot_json IS NULL) OR (agent_id IS NOT NULL AND agent_snapshot_json IS NOT NULL)),
  UNIQUE (id, room_id),
  FOREIGN KEY (room_id, workspace_id) REFERENCES rooms(id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX sessions_one_primary_per_room
  ON sessions(room_id)
  WHERE role = 'primary';

CREATE TABLE room_contents (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('overview','goal','direction','output')),
  output_kind TEXT CHECK (output_kind IS NULL OR output_kind IN ('note','decision','plan','delivery','summary')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate','active','adopted','dismissed','draft','published','superseded','retracted')),
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'output' AND output_kind IS NOT NULL)
    OR (kind <> 'output' AND output_kind IS NULL)
  ),
  CHECK (
    (kind = 'overview' AND status IN ('active','superseded'))
    OR (kind = 'goal' AND status IN ('active','superseded','retracted'))
    OR (kind = 'direction' AND status IN ('candidate','adopted','dismissed'))
    OR (kind = 'output' AND status IN ('draft','published','superseded','retracted'))
  )
);

CREATE UNIQUE INDEX room_contents_one_active_overview
  ON room_contents(room_id)
  WHERE kind = 'overview' AND status = 'active';

CREATE UNIQUE INDEX room_contents_one_active_goal
  ON room_contents(room_id)
  WHERE kind = 'goal' AND status = 'active';

CREATE INDEX room_contents_room_kind_position
  ON room_contents(room_id, kind, position, updated_at);
```

实现 Schema 还必须为所有 JSON 列增加 `json_valid` 与对象/数组类型检查，并用 insert/update trigger 保证非空 `room_contents.source_session_id` 属于同一 Room。`mcp_ids_json`、`mcp_snapshots_json`、`reference_project_ids_json` 仍用于 Session 的多值配置。Room 结构内容禁止使用 JSON，必须逐条写入 `room_contents`。资源 ID 在每次配置变更和每次执行前重新校验。

## 10. 非持久化状态

- Pi 原生 transcript：Pi SessionManager；
- Pi Runtime 句柄、订阅、AbortController、执行锁：进程内；
- MCP Client/transport：进程内；
- Room 项目、MCP、Agent 聚合视图：由 Session 实时计算；
- RoomContent 列表与分组视图：由 `room_contents` 行查询并组装；
- 当前 Room、当前辅助 Session、输入草稿：URL 或浏览器存储；
- Inspector 是否显示、当前横向 Tab：页面内 UI 状态；首次进入 Room 时 Inspector 默认隐藏；
- 当前预览 Project/文件相对路径、File Content 列是否显示：页面内 UI 状态；切换 Room 时清除；
- AgentEvent 与流式文本：请求投影。
- OpenAI-compatible base URL、API key、model ID：项目根目录 `.env.local`；不属于任何表或 JSON snapshot。

这些布局状态不进入 Workspace、Room、Session 或任何数据库表。

## 11. 明确不建模

```text
runtime
adapter
driver
agent_binding
room_agent
room_mcp
session_project
session_mcp
room_asset
message
transcript
model
```

这些不是实体表。固定实现属于代码；多值资源关系在 Session JSON 配置中表达；消息与 transcript 属于 Pi。
