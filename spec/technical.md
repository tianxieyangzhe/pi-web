# Technical Specification

## 1. 技术路线

第一版采用“Next.js Web UI + Node.js Runtime Host + AI SDK Harness Adapter”的架构。

~~~text
Browser
  ↓ HTTP / SSE 或 AI SDK UI Message Stream
Next.js Application
  ├── 页面和 Chat UI
  ├── Session API
  └── Runtime Host 调用层
        ↓
Node.js Runtime Host
  ├── Agent Session
  ├── OpenCode Session
  └── Pi Session
        ↓
共享 Workspace workingDirectory
~~~

页面、Session 管理和 Runtime 执行必须分层。浏览器不直接启动 Runtime，也不直接访问文件系统。

## 2. AI SDK 选型

第一版使用 AI SDK 的 Harness 体系：

- AI SDK UI：聊天界面、消息状态和流式 UI。
- AI SDK Harness：统一的 HarnessAgent / Harness Session 抽象。
- Agent Harness：第一版的内置 Agent Runtime。
- @ai-sdk/harness-opencode：OpenCode Runtime Adapter。
- @ai-sdk/harness-pi：Pi Runtime Adapter。

AI SDK Core 作为通用 AI 能力和类型基础，不把 OpenCode、Pi 强行抽象成普通 streamText Provider。

AI SDK 的 Harness 架构中，HarnessAgent 负责会话和 Sandbox 生命周期，具体 Adapter 负责连接底层 Agent Runtime，并将原生输出转换为统一 Harness 流。这个边界必须保持在代码架构中。[AI SDK Harness Adapter 架构](https://github.com/vercel/ai/blob/main/architecture/harness-abstraction.md)

## 3. 代码架构

~~~text
app/
├── layout.tsx
├── page.tsx
└── api/
    ├── sessions/
    │   ├── route.ts
    │   └── [sessionId]/
    │       ├── route.ts
    │       ├── messages/route.ts
    │       └── interrupt/route.ts
    └── workspaces/
        └── [workspaceId]/route.ts

components/
├── shell/
├── assistants/
├── sessions/
├── dialogs/
├── artifacts/
└── chat/
    ├── chat-window.tsx
    ├── message-list.tsx
    ├── runtime-status.tsx
    └── chat-input.tsx

lib/
├── runtimes/
│   ├── runtime-types.ts
│   ├── runtime-adapter.ts
│   ├── runtime-registry.ts
│   ├── agent-adapter.server.ts
│   ├── opencode-adapter.server.ts
│   ├── pi-adapter.server.ts
│   ├── runtime-events.ts
│   └── runtime-message-adapter.server.ts
├── sessions/
│   ├── session-manager.server.ts
│   ├── session-store.server.ts
│   └── session-events.server.ts
├── workspace/
│   └── workspace-manager.server.ts
├── files/
│   ├── working-directory.server.ts
│   ├── file-access.server.ts
│   └── file-change-events.server.ts
├── ai/
│   └── message-adapter.server.ts
└── storage/
    ├── dialog-store.server.ts
    └── artifact-store.server.ts

stores/
├── workspace-store.ts
├── session-store.ts
└── window-store.ts
~~~

## 4. Runtime Registry

所有 Runtime 必须通过注册表管理，禁止在页面组件中直接判断 Runtime 类型。

~~~ts
type RuntimeType = "agent" | "opencode" | "pi"

type RuntimeDefinition = {
  type: RuntimeType
  name: string
  createSession: (input: CreateRuntimeSessionInput) => Promise<RuntimeSession>
}
~~~

注册表负责根据 RuntimeType 查找 Adapter、创建 Session、路由消息、订阅事件、中断和关闭 Runtime Session。

## 5. Runtime Adapter

~~~ts
interface RuntimeAdapter {
  start(session: Session): Promise<void>
  sendMessage(sessionId: string, message: string): Promise<void>
  subscribe(sessionId: string): AsyncIterable<RuntimeEvent>
  interrupt(sessionId: string): Promise<void>
  close(sessionId: string): Promise<void>
}
~~~

Adapter 负责处理各 Runtime 的启动方式、消息格式、事件格式、工具调用格式和中断方式。页面和业务层不得直接依赖具体 Runtime 包。

## 6. Session Manager

Session Manager 是应用层唯一的 Session 入口。

必须保证：

- 每个 Session 创建时绑定一个 Runtime。
- Runtime 绑定在 Session 生命周期内不可变。
- 同一个 Runtime 可以创建多个 Session。
- 不同 Session 的消息和事件不混淆。
- Session 使用所属 Workspace 的 workingDirectory。
- 不实现跨 Session 消息、上下文共享或任务转交。

## 7. Workspace 文件夹

一个 Workspace 绑定一个 workingDirectory。同一 Workspace 下的所有 Session 默认使用该目录，并拥有读写权限。

默认 Workspace 使用 `path.resolve(process.cwd(), "data")`。该路径指向 Next.js/Node.js 服务进程所在宿主机的项目目录，不是浏览器文件系统路径。创建其他 Workspace 时，服务端只接受绝对路径，并创建目录（如尚不存在）；SQLite 对 `workspaces.working_directory` 建立唯一索引，保证同一目录只能绑定一个 Workspace。

第一版直接执行文件操作，不实现文件锁、写入排队、并发检测、冲突合并、Worktree 隔离或版本协调。

### 文件树与 Git 状态

右侧 Files 面板通过服务端 API 读取当前 Workspace 的 `workingDirectory`。文件路径必须由服务端解析，并确认仍位于该工作目录内；禁止 `..` 跳出目录或通过符号链接读取目录外的内容。

如果目录是 Git 仓库，服务端使用只读的 `git status --porcelain=v1 -z --untracked-files=all` 叠加文件状态。浏览器不执行 Git 命令。文件内容只读取普通 UTF-8 文本文件，单文件预览上限为 512 KB；二进制文件和超限文件返回明确错误。

- `GET /api/workspaces/:workspaceId/files`：返回文件树、Git 仓库标识和文件状态。
- `GET /api/workspaces/:workspaceId/files/content?path=:relativePath`：读取当前项目内指定文件的预览内容。

## 8. API 请求链路

~~~text
POST /api/sessions/:sessionId/messages
  ↓
Session Manager
  ↓
Runtime Registry
  ↓
对应 Harness Adapter
  ↓
统一 Runtime Event / UI Message Stream
  ↓
Chat Window
~~~

## 9. `lib` 目录约定

第一版保留 `lib/` 作为非页面业务代码的聚合目录。`lib` 不是无边界的杂物目录，必须按职责使用固定的二级目录：

~~~text
lib/runtimes/  Agent Runtime 和 Harness Adapter
lib/sessions/  Session 生命周期和事件
lib/workspace/ Workspace 管理
lib/files/     共享工作文件夹访问
lib/ai/        AI SDK 消息转换
lib/storage/   数据保存和读取
~~~

服务端专用模块使用 `.server.ts` 后缀。页面组件不得直接导入 Runtime Adapter、文件系统访问模块或服务端 Store。

## 10. Next.js 动态路由约定

第一版使用 Next.js App Router 的文件系统动态路由。目录名中的方括号是 Next.js 的动态路由标记，不会出现在实际 URL 中。

~~~text
代码目录：app/api/sessions/[sessionId]/messages/route.ts
API 模板：POST /api/sessions/:sessionId/messages
真实请求：POST /api/sessions/sess_01/messages
~~~

Session 级别的 Route Handler 统一放在 `[sessionId]` 动态目录下：

~~~text
app/api/sessions/
├── route.ts
└── [sessionId]/
    ├── route.ts
    ├── messages/route.ts
    └── interrupt/route.ts
~~~

不使用固定的 `sessionId` 目录，因为固定目录会匹配字面量路径，而不是动态 Session ID。

## 11. 前后端边界

浏览器负责展示 Session、发送消息、接收流式事件、控制窗口和请求中断。

服务端负责连接 Runtime、访问工作文件夹、转换事件、维护 Session 生命周期和保存 Dialog 状态。

OpenCode 与 Pi 的具体进程和部署方式待验证，不能在未验证前默认依赖普通 Serverless Runtime。

## 12. 第一版不实现

- Agent Orchestrator。
- Cross-session Event Bus。
- Handoff Manager。
- Collaboration Manager。
- 多 Runtime 自动调度。
- Session 中途切换 Runtime。
- 文件锁与冲突处理。

## 13. 当前实现状态

第一阶段已经完成以下可运行链路：

- `GET /api/workspaces` 返回 Workspace 列表。
- `GET /api/workspaces/:workspaceId` 返回 Workspace 和其 Session 列表。
- `GET /api/runtimes` 返回 Runtime Registry 中的三个 Runtime。
- `GET /api/sessions?workspaceId=:workspaceId` 按 Workspace 查询 Session。
- `POST /api/sessions` 创建 Session，并在创建时固定 Runtime。
- `GET /api/sessions/:sessionId` 查询单个 Session。
- `POST /api/sessions/:sessionId/messages` 经过 Runtime Registry 发送消息并写回统一消息模型。
- `POST /api/sessions/:sessionId/interrupt` 保留中断入口。

当前三个 Adapter 使用 `LocalRuntimeAdapter` 作为开发期实现。它的作用是先验证 Session 生命周期、Runtime 路由和消息回写边界；真实 Agent、OpenCode、Pi 的 Harness 进程协议确认后，只替换对应 Adapter，不改变页面和 Session API。

服务端当前使用进程内 Store，适合本地原型和接口联调。接入持久化数据库后，替换 `lib/sessions/session-store.server.ts` 即可，API 契约保持不变。
