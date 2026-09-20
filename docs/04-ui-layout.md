# 04｜UI 布局

> 状态：**目标 UI 信息架构。** Room 是结构化协作容器，Session 是可并行的工作线。页面不得把 Project、MCP、Agent 误展示为 Workspace 或 Room 的直属资源。

## 1. 产品术语

| 内部对象 | 用户界面名称 | 不使用 |
| --- | --- | --- |
| Workspace | 工作空间 | 项目 |
| Room | 会话 | 对话、聊天室、Session |
| Session.role = primary | 主工作线 | 主会话 |
| Session.role = worker | 辅助工作线 | 子会话、子 Agent |
| Agent | Agent | Runtime |
| Mcp | MCP | Workspace MCP |
| Project | 项目 | Workspace 目录 |

## 2. 路由

~~~
/
  → 最近 Workspace 或欢迎页

/workspaces/:workspaceId
  → Workspace 首页

/workspaces/:workspaceId/rooms/:roomId
  → Room；默认显示 role = primary 的工作线

/workspaces/:workspaceId/rooms/:roomId?session=:sessionId
  → Room；显示指定的 role = worker 辅助工作线
~~~

session query 只决定当前工作线视图和 Composer 目标，不改变默认消息路由。

## 3. 桌面结构

~~~
默认：
┌───────────────────┬───────────────────────────────────────────────┐
│ Workspace Sidebar │ Room Surface                                  │
│ 240–340px         │ min 640px / flex                              │
└───────────────────┴───────────────────────────────────────────────┘

打开 Inspector：
┌───────────────────┬─────────────────────────────┬─────────────────┐
│ Workspace Sidebar │ Room Surface                │ Inspector       │
│                   │                             │ 320–440px       │
└───────────────────┴─────────────────────────────┴─────────────────┘

选择文件：
┌───────────────────┬───────────────────┬──────────────┬────────────┐
│ Workspace Sidebar │ Room Surface      │ File         │ Inspector  │
│                   │                   │ Content      │ File Tree  │
└───────────────────┴───────────────────┴──────────────┴────────────┘
~~~

基础布局只有 Workspace Sidebar 与 Room Surface。Inspector 默认不显示，File Content 也不显示。两个右侧列均按需出现且独立关闭。

页面本身不滚动；Session Timeline、Inspector Body 与 File Content 分别独立滚动。显示或隐藏右侧列不能销毁 Room、Session、草稿或流式状态。

## 4. 左栏

~~~
WorkspaceSidebar
├─ WorkspaceSwitcher
├─ NewRoomButton
├─ RoomNavigation
├─ ResourceCatalogNavigation
│  ├─ Projects
│  ├─ MCP
│  └─ Agents
└─ Settings
~~~

- Workspace 列表只展示 Workspace 与 Room 数量，不假装拥有 Agent、MCP、Project。
- 新会话立即创建空 Room，不弹出资源选择表单。
- Room 行展示标题、Room 生命周期状态、最近活动时间和当前 running Session 提示。
- 点击 Room 进入对应 Room，并以 Inspector 隐藏、File Content 关闭的状态开始。
- 点击 Projects、MCP、Agents 会显示 Inspector，并激活对应横向 Tab。
- Projects、MCP、Agents 是独立资源目录，可以从任何 Workspace 页面进入。显示被哪些 Room/Session 使用只是查询投影。

## 5. Room Surface

~~~
RoomSurface
├─ RoomHeader
├─ SessionRail
├─ SessionContent
└─ SessionComposer
~~~

Room 是结构容器，不是单一聊天流。它始终展示 Header、工作线区域、资源聚合入口和内容区域。

### 5.1 空 Room

没有目标、消息或 Session 时，中央仍展示：

~~~
Room Header
├─ 目标、方向与输出：尚未形成
├─ 工作线：尚未开始
├─ 项目：尚无 Session 绑定
├─ MCP：尚无 Session 绑定
├─ Agent：使用 Pi 基础能力，尚未附加 Agent
└─ 内容区域：可直接发送第一条消息，或创建辅助工作线
~~~

直接发送第一条消息时，系统创建 role = primary 的基础 Session。用户也可以新建辅助工作线，并预先选择 Agent、MCP、工作项目和参考项目。

### 5.2 RoomHeader

显示 Room 标题与生命周期状态、当前工作线 Agent 或 Pi 基础能力、当前工作线状态、Inspector 开关和 Room 操作。

Room Header 右上角提供一个小型图标按钮：Inspector 隐藏时使用 `PanelRightOpen`，显示时使用 `PanelRightClose`。按钮有“显示检查栏/隐藏检查栏”Tooltip、可访问名称和 `aria-pressed`，不使用大块文字按钮。

Header 下方固定展示 RoomContent 摘要：

- goal 为空时显示“尚未形成目标”；非空时显示当前目标；
- directions 显示候选和已采纳方向数量，可展开查看与编辑；
- outputs 显示已发布输出数量和最近更新项；
- overview 为空时不伪造总结。

Agent 提出的目标、方向或输出以候选状态出现，用户选择“采用”“编辑”或“忽略”后才创建或更新对应 RoomContent 记录。

Room 状态与 Session 状态必须分开显示。Session unavailable 不能显示为 Room 已关闭。

## 6. Session Rail

~~~
[主工作线 · Pi 基础能力]
[实现接口 · Builder]
[审查依赖 · Reviewer]
[+ 新建辅助工作线]
~~~

- 第一项始终是 role = primary 的 Session；不存在时显示主工作线，尚未开始。
- 后续项是 role = worker 的辅助 Session，按创建时间排序。
- 标签显示 purpose、Agent 或 Pi 基础能力、运行状态与工作项目。
- 选择辅助 Session 只改变 session query、当前 Timeline 和 Composer 目标。
- 结束辅助 Session 不影响默认 Session。
- 颜色、排序和默认发送行为都来自 Session.role，不是另一套对象类型。

## 7. Session 内容与 Composer

### 7.1 Timeline

~~~
Turn
├─ UserMessage
├─ AgentActivityGroup
│  ├─ ThinkingActivity
│  ├─ ToolActivity
│  └─ ContextActivity
├─ ApprovalCard
├─ AssistantMessage
└─ ProjectChangesCard
~~~

所有消息、活动和变更都属于当前 Session。Room 不把多个 Session transcript 混成一条时间线。

| 本地展示 | AI Elements 基线 |
| --- | --- |
| Timeline | [Conversation](https://elements.ai-sdk.dev/components/conversation) |
| 消息 | [Message](https://elements.ai-sdk.dev/components/message) |
| 活动步骤 | [Task](https://elements.ai-sdk.dev/components/task) |
| 活动摘要 | [Reasoning](https://elements.ai-sdk.dev/components/reasoning) |
| 工具调用 | [Tool](https://elements.ai-sdk.dev/components/tool) |
| 审批 | [Confirmation](https://elements.ai-sdk.dev/components/confirmation) |
| 代码 | [Code Block](https://elements.ai-sdk.dev/components/code-block) |

这些组件只展示 Session ViewModel 与 AgentEvent，不使用 AI SDK useChat 或 SDK 消息类型。

实时增量与历史消息必须走同一富文本路径。Streamdown 依赖不可用时，本地 renderer 至少支持标题、段落、强调、列表、引用、表格、链接、行内代码和 fenced code；原始 HTML 按文本显示，禁止 `dangerouslySetInnerHTML`。

消息提交后，Timeline 在等待期间显示低干扰的状态活动：初始化阶段显示“正在初始化工作线”，Runtime 已就绪但模型尚未返回首 token 时显示“正在等待模型响应”。首个思考、工具或文本事件到达后自动移除等待活动，不把初始化误显示成模型思考。

### 7.2 Composer

使用 [Prompt Input](https://elements.ai-sdk.dev/components/prompt-input) 作为基线。

- 默认工作线显示发送给主 Agent或发送给 Pi。
- 辅助工作线显示发送给辅助工作线：purpose · Agent。
- 当前 Session running/starting 时，发送按钮变为停止按钮。
- 每个 Room/Session 草稿独立保存到浏览器存储。
- Enter 发送，Shift+Enter 换行，中文输入法 composition 中 Enter 不发送。
- Composer 和 Agent 配置不提供模型 Provider、API 路径、API key 或模型 ID 控件；这些是服务端环境配置。

### 7.3 配置工作线

每条 Session 的更多菜单提供：

~~~
Agent：无 Agent / 选择独立 Agent
MCP：多选独立 MCP
工作项目：无 / 一个 Project
参考项目：多选独立 Project
~~~

参考项目和 MCP 的多选项使用紧凑的整行 checkbox 选项：复选框与名称保持相邻对齐，整行可点击；禁用的工作项目选项保留在列表中但明确呈现不可选状态。

配置工作线使用 Dialog。当前 turn 运行时，配置项显示下一轮生效。不在 Room 级保存这些选择。

## 8. 右侧 Inspector

~~~
Inspector
├─ InspectorHeader
├─ HorizontalTabs
│  ├─ Structure
│  ├─ Content
│  ├─ Projects
│  ├─ MCP
│  ├─ Agents
│  └─ Details
└─ InspectorBody
~~~

Inspector 默认隐藏。显示后，六类内容位于顶部同一行横向选项卡中，顺序固定为“结构、内容、项目、MCP、Agent、详情”。Tab 不换行；宽度不足时 TabList 可横向滚动，但 Inspector Body 不发生横向溢出。

点击 Tab 只改变 Inspector Body，不改变当前 Room、Session、Timeline 或 Composer。通过 Header 按钮隐藏 Inspector 时保留 active Tab；再次显示恢复该 Tab。

### 8.1 Structure

展示 Room 的结构投影：Session 数量、默认 Session、辅助 Session、running 状态和未开始状态。

### 8.2 Content

展示 Room 的跨 Session 内容：目标、方向、输出与总览。每一项对应独立 RoomContent 记录，局部保存不能覆盖其他内容。

- 目标可为空，不显示必填错误；
- 方向按 candidate、adopted、dismissed 分组；
- 输出按 draft、published、superseded、retracted 分组；
- 每项显示来源工作线，但不显示原始 transcript；
- 新增和修改 RoomContent 使用 Dialog；编辑内容不改变任何 Session 的 Agent/MCP/Project 配置。

### 8.3 Projects

按 Project 聚合 Session 绑定：

~~~
Project A
├─ Session A：工作项目
└─ Session C：参考项目

Project B
└─ Session B：工作项目
~~~

选择某个 Session 后，突出该 Session 的工作项目和参考项目。选择 Project 后，文件树直接显示在 Projects Tab 的 Inspector Body 内。

文件树使用 [File Tree](https://elements.ai-sdk.dev/components/file-tree) 的受控模式；目录行任意位置点击都展开/收起，首次展开时按目录加载直接子项，文件点击打开或激活 File Content 标签。路径加载、权限、Git 状态和预览来自 Project Feature。

### 8.4 MCP 与 Agents

分别聚合当前 Room 各 Session 使用的 MCP 与 Agent：

- 显示哪些 Session 正在或将要使用它。
- 显示当前 Session 的绑定状态。
- 从独立资源目录打开详情或编辑。
- 不将其标记为 Room 或 Workspace 所有。

Project、MCP、Agent 的新增与修改都使用 Dialog。列表、选择和文件树浏览留在 Inspector；不得把编辑表单直接展开在 Inspector Body 中。

### 8.5 Details

展示当前 Session 的安全投影：role、state、purpose、configurationRevision、Agent 名称或无 Agent、MCP 数量、working/reference Project 摘要、可恢复性诊断。

不展示 nativeRef、Agent/MCP snapshot 原文、secret 或 Pi 原生文件路径。

## 9. File Content 列

File Content 是 Inspector 左侧的独立列，不属于 Inspector Tab，也不是 Dialog 或 Drawer。

~~~
FileContentPanel
├─ FileHeader
│  ├─ Project 名称
│  ├─ 相对路径
│  └─ CloseButton
├─ FileTabs
├─ FileMetadata
└─ FileBody
~~~

- 点击可预览文件后显示；同一时刻只展示一个活跃文件，但可保留多个文件标签。
- 再次点击已打开文件时只激活对应标签，不重复请求或新增标签。
- 每个标签可单独关闭；关闭最后一个标签时关闭 File Content 列。
- Header 固定，内容区域独立滚动。
- 路径只显示 Project 内相对路径，不显示绝对 rootPath。
- 代码使用 [Code Block](https://elements.ai-sdk.dev/components/code-block)；普通文本使用安全等宽文本视图。
- 二进制、敏感、超限或不可访问文件显示明确原因，不尝试渲染乱码。
- 关闭单个标签后保留其他标签、Inspector、Projects Tab、当前 Project 与文件树展开状态；关闭整个 File Content 列时清除全部标签。
- File Content 当前只读；文件编辑能力需要独立需求，不能顺手加入。

Inspector 可以隐藏而 File Content 保持显示，两列拥有独立显隐状态。切换 Room 时两者都恢复默认：Inspector 隐藏、File Content 关闭。

## 10. 新增、修改与弹窗

除文件树浏览、文件选择、Tab 切换和零表单新建 Room 外，所有新增与修改操作都使用 Dialog：

- Workspace 新增与修改；
- Project、MCP、Agent 新增与修改；
- Session 新增与配置；
- Room 标题与 RoomContent 新增、修改；
- 删除操作的危险确认。

Dialog 保存失败时保留输入和字段错误；保存成功后关闭并局部刷新原列表。Dialog 关闭后焦点返回触发按钮，不允许 Dialog 嵌套 Dialog。

## 11. 多项目体验

单项目独立工作时，Session Rail 可只显示主工作线，Inspector Projects 只显示一个工作项目。

多项目协作时，Room 作为统一结构，Session Rail 按项目或 purpose 并行展开；Inspector 以 Project 被哪些 Session 使用展示，而不是项目属于 Room。

协调 Session 没有工作项目时，在 Header 与 Inspector 明确显示协调工作线；它的多个参考项目不显示为可写目标。

## 12. 空、加载、错误

| 场景 | 表现 | 主操作 |
| --- | --- | --- |
| 没有 Workspace | 欢迎结构 | 新建工作空间 |
| Workspace 没有 Room | Room 列表空状态 | 新会话 |
| Room 没有 Session | 完整 Room 骨架 | 发送第一条消息或新建辅助工作线 |
| Room 没有目标/方向/输出 | 显示尚未形成内容结构 | 直接交流或编辑内容 |
| Session 没有 Agent | 显示 Pi 基础能力 | 配置工作线 |
| Session 没有 MCP | 显示未附加 MCP | 配置工作线 |
| Session 没有 Project | 显示未绑定项目 | 配置工作线 |
| Session unavailable | 保留历史与草稿 | 恢复工作线 |
| 消息被并发冲突拒绝 | 移除仅在页面内的乐观消息，保留实际 transcript 并显示局部错误 | 等待当前 turn 完成或停止 |

错误不伪装为空状态。局部资源错误不让 AppShell 或其他 Session 消失。

## 13. 响应式与无障碍

- 宽桌面 `≥1600px`：可同时显示 Sidebar、Room、Inspector、File Content 四列。
- `1200–1599px`：File Content 打开时可以自动隐藏 Inspector；用户仍可用 Header 按钮以覆盖层查看 Inspector。
- `<1200px`：Inspector 与 File Content 使用互斥的右侧覆盖层，但文件内容在信息架构中仍是独立面板，不回到编辑 Dialog。
- 小屏始终优先保留 Session Timeline 与 Composer。
- 图标按钮有可访问名称与 Tooltip。
- 工作线 rail、Tabs、Dialog 使用正确键盘语义。
- streaming 开始时使用一次 `role=status` 的低干扰提示（“Pi 正在生成回复”），不把每个 token 放入 live region。
- 状态不只依赖颜色；prefers-reduced-motion 关闭非必要动画。

## 14. UI 不做

- 将 Agent、MCP、Project 作为 Workspace 或 Room 的直属资源展示。
- 将所有 Session 混成同一条消息时间线。
- 创建 Room 时要求目标或资源选择。
- 将辅助 Session 作为另一种实体或顶层会话。
- 默认常驻显示 Inspector。
- 把 Inspector 类别改成纵向导航。
- 在 Inspector Body 中直接展开新增或编辑表单。
- 使用 Dialog 或 Inspector Body 展示文件正文。
- 展示 Runtime Registry、Pi nativeRef、原生 JSONL。
- 用单一巨型 Client Component 承载整个页面。
