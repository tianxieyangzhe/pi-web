# Acceptance Specification

## Assistant

~~~text
Given 用户进入 Workspace
Then 页面展示 Agent、OpenCode 和 Pi 三个 Assistant
~~~

~~~text
Given 用户选择一个 Assistant
Then 系统创建或打开该 Assistant 对应 Runtime 的 Session
~~~

## Session

~~~text
Given 用户选择 OpenCode 创建 Session
Then Session.runtimeType 等于 opencode
And Session.runtimeType 在后续生命周期中保持不变
~~~

~~~text
Given OpenCode 已经拥有一个 Session
When 用户再次选择 OpenCode
Then 系统允许创建另一个独立的 OpenCode Session
~~~

~~~text
Given 当前打开的是 OpenCode Session
When 用户选择 Pi
Then 当前 OpenCode Session 不切换 Runtime
And 系统创建或打开 Pi Session
~~~

## 上下文隔离

~~~text
Given Agent Session A 已经产生对话
When 用户打开 OpenCode Session B
Then Session B 不自动显示 Session A 的对话上下文
~~~

同一 Runtime 下的多个 Session 的消息、运行状态和 Dialog 记录不得混淆。

## 文件夹共享

~~~text
Given Session A 和 Session B 属于同一个 Workspace
Then 两个 Session 使用同一个 workingDirectory
And 两个 Session 都具有读写权限
~~~

~~~text
Given Session A 修改共享工作文件夹中的文件
When Session B 随后读取该文件
Then Session B 可以读取当前文件内容
~~~

第一版不验收文件锁、并发写入检测、冲突合并或版本协调。文件操作由对应 Runtime 直接执行。

## Chat Window

~~~text
Given 一个 Session 已创建
Then 可以打开与该 Session 对应的 Chat Window
~~~

~~~text
Given 多个 Chat Window 已打开
When 用户点击其中一个窗口
Then 该窗口位于其他窗口之上
~~~

~~~text
Given Chat Window 已关闭
Then 对应 Session 和 Dialog 仍然存在
~~~

## 运行状态

用户发送非空消息后，当前 Session 进入运行状态，并可以显示流式输出。用户中断后保留已收到的输出；Runtime 失败后显示错误并允许重试。

## API 与服务层

- [ ] `GET /api/workspaces` 返回 Workspace 列表。
- [ ] `GET /api/runtimes` 返回 Agent、OpenCode、Pi 三个 Runtime。
- [ ] 创建 Session 时必须提交合法的 `workspaceId` 和 `runtime`。
- [ ] 消息请求只能写入目标 Session，不能写入同一 Workspace 的其他 Session。
- [ ] 消息请求经 Runtime Registry 路由到该 Session 创建时绑定的 Adapter。
- [ ] 当前 Adapter 尚未连接真实 Harness 时，返回明确的本地开发响应。

## 文件树

- [ ] 右侧以单列树展示当前项目工作目录中的文件和目录。
- [ ] 点击普通文本文件后，以弹窗显示其内容。
- [ ] 非 Git 目录显示 Local 状态；Git 项目显示 Git 状态。
- [ ] Git 变更文件以不同颜色显示修改、新增/未跟踪、删除/冲突、重命名状态。
- [ ] 文件读取不得访问当前 Workspace 工作目录之外的路径。
- [ ] 二进制文件、超过 512 KB 的文件和目录不可作为文本预览打开。

## 明确不验收

- Session 之间自动发送消息。
- Session 之间自动共享上下文。
- Agent、OpenCode、Pi 之间自动协作。
- Agent 委派、任务编排或 Runtime 切换。
- 文件锁、冲突检测和自动合并。
- Runtime Adapter 不应被页面组件直接调用。
- 浏览器不应直接访问工作文件夹或启动 Runtime。
