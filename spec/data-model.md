# Data Model Specification

## 基础类型

~~~ts
type RuntimeType = "agent" | "opencode" | "pi"

type SessionStatus =
  | "created"
  | "starting"
  | "ready"
  | "running"
  | "completed"
  | "interrupted"
  | "failed"
~~~

## Workspace

~~~ts
type Workspace = {
  id: string
  name: string
  workingDirectory: string
  sessionIds: string[]
  dialogIds: string[]
  artifactIds: string[]
  createdAt: string
  updatedAt: string
}
~~~

一个 Workspace 绑定一个共享工作文件夹。第一版同一 Workspace 下的所有 Session 使用该目录并拥有读写权限。

默认 Workspace 的 `workingDirectory` 是服务端进程项目根目录下的 `data/`。用户创建其他 Workspace 时必须提供宿主机绝对路径；`workingDirectory` 在 Workspace 表中全局唯一，不能被多个 Workspace 复用。

## Assistant

~~~ts
type Assistant = {
  id: RuntimeType
  name: string
  runtimeType: RuntimeType
  description?: string
  icon?: string
  status: "available" | "unavailable" | "starting"
}
~~~

第一版 Assistant 与 Runtime 一一对应。

## Session

~~~ts
type Session = {
  id: string
  workspaceId: string
  runtimeType: RuntimeType
  workingDirectory: string
  dialogId: string
  status: SessionStatus
  executionIds: string[]
  createdAt: string
  updatedAt: string
}
~~~

约束：

- runtimeType 在创建时确定且不可变。
- 同一个 Runtime 可以拥有多个 Session。
- workingDirectory 默认来自所属 Workspace。
- Session 不保存其他 Session 的上下文。

## Dialog 与 Execution

~~~ts
type Dialog = {
  id: string
  workspaceId: string
  sessionId: string
  runtimeType: RuntimeType
  title: string
  events: DialogEvent[]
  createdAt: string
  updatedAt: string
}

type Execution = {
  id: string
  sessionId: string
  status: "queued" | "running" | "completed" | "interrupted" | "failed"
  input: string
  eventIds: string[]
  changedFiles: string[]
  startedAt?: string
  completedAt?: string
}
~~~

## DialogEvent

~~~ts
type DialogEvent = {
  id: string
  executionId?: string
  type:
    | "user-message"
    | "assistant-message"
    | "reasoning"
    | "tool-call"
    | "tool-result"
    | "file-change"
    | "status"
    | "error"
  payload: unknown
  createdAt: string
}
~~~

事件必须归属于一个 Session 或其 Execution，不允许跨 Session 归属。

## ChatWindow 与 Artifact

~~~ts
type ChatWindow = {
  id: string
  sessionId: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
}

type Artifact = {
  id: string
  workspaceId: string
  sessionId: string
  name: string
  type: "document" | "code" | "report" | "file-change"
  path?: string
  preview?: string
  createdAt: string
  updatedAt: string
}
~~~

第一版不建模 Handoff、ContextSnapshot、SessionLink、CollaborationTask、WorkspaceLock、FileConflict 或 MergeRequest。
