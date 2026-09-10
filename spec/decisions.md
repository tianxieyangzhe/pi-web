# Decision Log

## D-001：第一版支持三个 Runtime

状态：已确定

第一版只支持 Agent、OpenCode 和 Pi。

## D-002：Assistant 代表 Runtime

状态：已确定

Assistant 是 Runtime 的产品入口，不是单纯的模型、人格或 system prompt 配置。

## D-003：同一个 Runtime 可以拥有多个 Session

状态：已确定

同一个 Runtime 可以创建多个独立 Session。每个 Session 拥有独立的对话上下文和运行状态。

## D-004：一个 Session 只能绑定一个 Runtime

状态：已确定

Session 创建时确定 Runtime，Session 生命周期内不能切换 Runtime。

## D-005：更换 Runtime 必须创建新的 Session

状态：已确定

用户从 OpenCode 切换到 Pi 时，不修改当前 OpenCode Session，而是创建或打开 Pi Session。

## D-006：第一版不做 Runtime 协作

状态：已确定

第一版不支持 Session 之间的消息、上下文、事件或任务交互，也不支持 Agent 委派和 Runtime 编排。

## D-007：同一 Workspace 共享工作文件夹

状态：已确定

同一个 Workspace 下的多个 Session 使用同一个工作文件夹，并拥有该文件夹的读写权限。

## D-008：第一版不处理共享文件夹风险

状态：已确定

第一版不实现文件锁、并发写入检测、冲突提示、自动合并或版本协调。Session 直接使用共享文件夹进行读写。

## D-009：Chat Window 对应一个 Session

状态：已确定

Chat Window 展示一个 Session，并显示其固定 Runtime 标识。关闭窗口不删除 Session 或 Dialog。

## D-010：AI SDK 作为统一 AI 能力层

状态：初步确定

AI SDK UI 用于聊天和流式 UI；AI SDK Core 或 Harness Adapter 用于 Runtime 接入。具体 Adapter API 和运行环境在技术实现阶段继续确认。

## D-011：第一版以桌面端为主

状态：初步确定

第一版优先实现桌面端工作台体验，移动端完整适配不在当前范围内。

## D-012：真实 Runtime 运行环境待确认

状态：待决策

OpenCode 和 Pi 的实际进程、工作目录和部署环境需要根据 Harness Adapter 的要求验证，不能在未验证前默认依赖普通 Serverless Runtime。

## D-013：第一版技术路线

状态：已确定

第一版采用 Next.js Web UI、Node.js Runtime Host 和 AI SDK Harness Adapter 的分层架构。页面不直接连接 Runtime，所有 Runtime 调用经过 Session Manager 和 Runtime Registry。

## D-014：Runtime Adapter 注册

状态：已确定

Agent、OpenCode 和 Pi 分别通过独立 Adapter 注册。页面和业务层只依赖 RuntimeType 与统一 Session 接口，不依赖具体 Harness 包。

## D-015：Workspace 工作目录共享

状态：已确定

创建 Session 时将所属 Workspace 的同一个 workingDirectory 传给 Runtime Adapter。第一版所有 Session 都拥有该目录的读写权限。

## D-016：第一版不实现文件协调

状态：已确定

不实现文件锁、写入队列、冲突检测、Worktree、自动合并和版本协调。

## D-017：第一版不实现 Runtime 协作

状态：已确定

不实现跨 Session Event Bus、Handoff、Agent Orchestrator、任务转交或多 Runtime 自动调度。

## D-018：使用 Next.js 动态路由目录

状态：已确定

Session 级别的 API 使用 Next.js App Router 动态目录 `[sessionId]`，例如 `app/api/sessions/[sessionId]/messages/route.ts`。方括号只存在于代码目录中，实际 URL 使用具体 Session ID。

## D-019：保留 lib 作为业务代码聚合目录

状态：已确定

第一版保留 `lib/` 作为非页面业务代码的聚合目录，并通过 `runtimes`、`sessions`、`workspace`、`files`、`ai` 和 `storage` 等明确的二级目录划分职责。服务端专用模块使用 `.server.ts` 后缀，避免将服务端 Runtime 代码误用于浏览器。

## D-020：默认项目使用 data 目录，项目目录全局唯一

默认项目的 workingDirectory 固定为服务端项目根目录下的 `data/`。新项目允许用户选择其他宿主机绝对目录。SQLite 为 `workspaces.working_directory` 设置唯一索引；同一目录不能被两个项目绑定，避免同一目录被不同项目的 Session 以不同项目身份同时访问。
