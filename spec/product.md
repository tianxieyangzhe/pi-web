# Product Specification

## 产品概述

AI Workspace 是一个面向 Agent Harness 的统一工作台。用户可以在 Workspace 中选择和运行不同的 Agent Runtime，并在统一界面中查看对应 Session 的消息、运行状态和执行结果。

第一版支持三个 Runtime：

- Agent
- OpenCode
- Pi

产品重点是让多个 Runtime Session 在同一个 Workspace 中并存，不实现多个 Agent 之间的自动协作。

## 核心概念

### Workspace

Workspace 是用户的工作上下文和文件夹归属单位。一个 Workspace 可以拥有多个 Session。同一个 Workspace 下的 Session 使用同一个工作文件夹，并拥有该文件夹的读写权限。

产品界面中 Workspace 显示为“项目”。默认项目绑定服务端运行目录下的 `data/` 文件夹；用户可以创建其他项目并选择宿主机上的绝对目录。一个目录只能绑定一个项目。

### Assistant

Assistant 是 Runtime 的产品入口。第一版 Assistant 与 Runtime 一一对应：Agent、OpenCode、Pi。Assistant 用于创建 Session，不是 Session 本身。

### Session

Session 是用户在某个 Workspace 中与一个 Runtime 建立的独立运行会话。

- 同一个 Runtime 可以拥有多个 Session。
- 每个 Session 只能绑定一个 Runtime。
- Session 创建后不能切换 Runtime。
- Session 的对话上下文、运行状态和窗口状态相互独立。
- 同一 Workspace 下的 Session 可以使用同一个工作文件夹。
- Session 主要归属于 Workspace，并在中央工作区中展示。

### Dialog

Dialog 是 Session 中的对话和运行记录，包括用户消息、Runtime 输出以及相关事件。

### Chat Window

Chat Window 是 Session 在工作台中的可视化表现。第一版可以使用中央 Session 标签和活动会话视图，不强制使用浮动窗口。

### Artifact

Artifact 是 Runtime 运行过程中产生的可查看结果，例如文档、代码、报告或文件变更记录。第一版以展示和关联为主，不实现完整编辑器。

## 产品目标

- 在一个 Workspace 中统一管理 Agent、OpenCode 和 Pi。
- 支持同一个 Runtime 创建多个独立 Session。
- 支持一个 Workspace 下的多个 Session 并存，并在中央区域切换。
- 展示不同 Runtime 的文本输出和运行状态。
- 让每个 Session 使用 Workspace 的共享工作文件夹。
- 为后续接入真实 Harness Adapter 保留扩展空间。

## 第一版范围

### 包含

- Workspace 导航。
- Agent、OpenCode、Pi Runtime 入口。
- 创建多个 Session。
- Session 与 Runtime 的固定绑定。
- Workspace 下的多个 Session。
- 消息输入和发送。
- 流式输出状态展示。
- 基础运行状态、错误和中断状态。
- Workspace 工作文件夹绑定。
- Session 对共享工作文件夹的读写权限。
- Dialog 历史展示。
- 基础 Artifact 展示。

### 不包含

- Session 之间的消息传递、上下文共享或任务转交。
- Runtime 之间的协作、Agent 委派或多 Agent 编排。
- Session 中途切换 Runtime。
- 自定义 Assistant 或第三方 Harness 插件。
- 用户登录、多用户协作和企业权限。
- 文件锁、并发写入检测、冲突合并和版本协调。
- 完整 Artifact 编辑器。

## 成功标准

用户能够在同一个 Workspace 中查看三个 Runtime，创建多个独立 Session，打开对应 Chat Window，发送消息，查看各自的运行状态，并通过不同 Session 读写同一个 Workspace 工作文件夹。
