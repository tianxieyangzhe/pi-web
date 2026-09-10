# Interaction Specification

## Session 创建

用户从 Agent、OpenCode 或 Pi Assistant 入口创建 Session。创建后，Session 绑定对应 Runtime、当前 Workspace 和 Workspace 工作文件夹，并打开对应 Chat Window。

## Runtime 绑定

- 一个 Session 只能绑定一个 Runtime。
- Session 创建后不能修改 Runtime。
- Chat Window 中不能切换 Runtime。
- 用户想使用另一个 Runtime 时，必须创建或打开另一个 Session。

## 多 Session

同一个 Runtime 可以拥有多个 Session。每个 Session 的消息列表、对话上下文、运行状态、Execution 记录和 Chat Window 状态独立。

## 文件夹访问

同一个 Workspace 下的 Session 使用同一个工作文件夹，并具有读写权限。Session 可以读取、创建、修改和删除该文件夹中的文件。一个 Session 写入的文件，其他 Session 后续可以读取。

第一版不提供文件锁、写入排队、冲突提示或自动合并。

## Chat Window

- 打开已有 Dialog 时创建或恢复对应 Chat Window。
- 点击窗口后，该窗口成为活动窗口并置于其他窗口之上。
- 拖动标题栏时更新窗口位置。
- 最小化只隐藏窗口内容，不删除 Session 或 Dialog。
- 关闭只移除 Chat Window，Session 和 Dialog 仍然保留。

## 消息发送

~~~text
输入消息 → 提交 → 追加用户消息 → Runtime 执行
→ 显示流式输出或运行事件 → 完成、失败或中断
~~~

空消息不提交。中断后保留已经收到的输出，失败后允许重试。

## Session 交互边界

第一版不支持 Session 之间的消息传递、上下文共享、事件订阅、任务转交、Runtime 调用、Agent 委派或自动编排。共享工作文件夹造成的文件可见性属于文件系统行为，不属于 Session 协作功能。

