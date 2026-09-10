# UI Specification

## 页面目标

页面表现为桌面端 AI 工作台，而不是单一聊天页面。视觉参考包括深色开发工具风格、左侧 Workspace 导航、中央文档或代码内容、多个浮动 Chat Window，以及右侧 Assistants、Artifacts 和 Dialogs 面板。

## 页面结构

~~~text
AppShell
├── LeftSidebar
│   ├── ProductHeader
│   ├── WorkspaceTree
│   └── AccountActions
├── MainWorkspace
│   ├── SessionTabs
│   ├── ActiveSession
│   └── SessionComposer
└── RightSidebar
    ├── WorkspaceInfo
    ├── RuntimeInfo
    ├── FilesInfo
    └── ArtifactInfo
~~~

## 左侧栏

负责 Workspace 和项目导航，必须展示产品标识、Workspace 分组、项目列表、当前选中项、分组展开/折叠、新建入口以及设置/账户入口。参考宽度约为 260px。

## 中央工作区

中央区域负责展示当前 Workspace 下的 Session。Session 是中间区域的主要内容对象，而不是右侧面板中的附属列表。

必须支持：

- 当前 Workspace 的 Session 列表或标签。
- 当前活动 Session 的消息和运行状态。
- 多个 Session 之间切换。
- 新建 Session。
- 当前 Session 的消息输入。
- 当前 Session 的 Runtime 固定标识。

多个 Session 可以同时存在，但每个 Session 的对话上下文独立。

## Chat Window

如果使用浮动窗口表现，一个 Chat Window 对应一个 Session，并显示固定 Runtime 标识：Agent、OpenCode 或 Pi。第一版也可以采用中央区域的 Session 标签和单一活动会话视图，不要求默认使用多层浮动窗口。

必须包含：

- 标题栏、Runtime 名称和窗口操作。
- 消息列表。
- 流式生成状态。
- 基础运行事件状态。
- 输入区和发送按钮。
- 中断入口。

窗口支持聚焦置顶、拖动、最小化和关闭。关闭窗口不删除 Session 或 Dialog，也不提供 Runtime 切换入口。

## 右侧栏

右侧栏不是 Session 主导航，而是当前 Workspace 和当前 Session 的辅助信息展示区。

### Runtime

展示 Agent、OpenCode 和 Pi 的 Runtime 信息、连接状态和创建 Session 入口。点击 Runtime 时创建新的 Session，不修改当前 Session 的 Runtime。

### Files

展示当前 Workspace 的共享工作文件夹、目录和文件信息。Files 使用单列文件树，目录按层级缩进，点击普通文本文件时以弹窗显示内容。

当当前工作目录是 Git 仓库时，显示 Git 标识并对变更文件着色：修改为黄、新增或未跟踪为绿、删除或冲突为红、重命名为蓝。第一版不增加文件协调机制。

### Artifacts

展示当前 Workspace 关联的 Artifact，第一版支持列表、类型标识和查看入口。

### Session details

展示当前活动 Session 的 Runtime、上下文隔离状态、工作目录和运行状态。

## 视觉风格

整体采用深色开发工具风格：深色应用背景、稍亮的侧栏、接近黑色的中央内容区、浅色浮动聊天窗口、紫色或绿色强调色、低对比度分割线、圆角和柔和阴影。

## 响应式范围

第一版以桌面端为主。移动端完整交互不在当前范围内。
