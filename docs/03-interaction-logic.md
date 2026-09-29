# 03｜交互逻辑

> 状态：**单项目 Room 目标交互，尚未按本版实现。** 跨项目路由、Router、RoomRun、Task 和 Synthesizer 的下一版流程留待单独设计；本文件只定义项目 Session 与其一对一 Room。

## 1. 总体规则

1. 每个项目 Session 固定属于一个 Project，并绑定一个项目 Room；Room 与 Session 的 Project 必须相同。
2. 项目 Room 的当前上下文只在用户确认后影响后续对话。模型、规则和模板生成的内容先进入一份待确认草稿。
3. Room 对项目 Session 的唯一模型输入作用是提供已确认的文字上下文；工具、扩展、Agent、MCP、Skill 的选择和调试由独立基础模型处理。
4. 项目消息直接写入 Pi 原生 Session transcript；项目 Room 不创建 RoomRun 或 Task，也不经过跨项目 Router。
5. Room 数据只存数据库；运行时上下文按每次提交即时组装于内存，不创建 Room 文件。
6. 同一 Session 同时最多执行一个用户请求；同一 Room 同时最多执行一个自动总结任务。

## 2. 创建 Session 与 Room

~~~text
用户选择 Project
→ 选择空 Room 或预览一个无项目 Room 模板
→ 校验 Project active、模板 projectId=null
→ 同一数据库事务创建项目 Room 与 Session，固定同一 projectId
→ Session.roomId 指向项目 Room，Room 只绑定这一条 Session
→ 打开该 Project Session 页面
~~~

复制模板使用新 Room ID 和可选 `sourceTemplateId`。模板初始上下文先进入项目 Room 的 `draftJson`；用户在页面确认后才写入 `contextJson`。模板以后修改不改变已有项目 Room。空 Room 的 `contextJson` 是 02 定义的全空结构。

项目为空的 Agent、MCP 等资源是模板，实际运行必须复制为所属 Project 的实例；复制配置、凭据处理和逐项目调试由这些资源的后续基础模型定义。Room 创建不复制或持久绑定这些资源。

## 3. 加载和页面状态

进入项目会话时并行读取 Session 安全摘要、Pi transcript 投影和绑定 Room 的当前上下文/草稿。页面显示已确认内容、待确认草稿及生成状态。Project 侧栏的历史 Session 仍按项目按需展开；选择另一 Session 时同时切换其独有 Room。

Room 正在生成草稿、草稿待确认、草稿生成失败、当前内容为空、模板待确认、Room 数据损坏应有各自的 UI 状态，错误不能伪装为空内容。生成状态可通过流式事件或轮询更新；只有数据库中的 `draftJson` 和 `contextJson` 是可恢复的 Room 内容事实。

## 4. 提交用户消息

~~~text
客户端立即显示用户消息
→ 服务端校验 Project、Session、Room 同属一个 Project 且可运行
→ 读取 Room.contextJson 并严格校验固定结构
→ 按 02 的字段顺序渲染为有长度预算的 Markdown
→ 本轮 Pi before_agent_start 在 system prompt 中加入这份上下文
→ session.prompt 接收原样用户消息
→ 流式展示真实 Pi 轮次、工具活动和回答
→ Pi 原生 transcript 持久化
~~~

`draftJson` 永不进入提示词。用户消息不拼接 Room JSON 或自动摘要文本，也不把 Room context 写入 Pi 原生用户消息。每次请求以提交时已确认的 `contextJson` 为准；执行期间的人工修改从下一次提交开始生效。Room 的 `outputs` 默认只在页面展示，不自动注入提示词。

Pi Runtime cwd 固定为 Project.rootPath，模型仍来自服务端固定配置。Room 不改变模型、Agent/MCP 快照、注册工具或工具权限。用户消息发送失败时不得让草稿生效或推进总结游标。

## 5. 自动总结与增量游标

Pi 请求完成且已稳定后，规则检查自 `lastReviewedEntryId` 之后的当前活动分支。没有实质变化时可跳过 LLM 并推进已审阅位置；有新目标、约束、事实、决策、待办或产出时，调用独立的无工具 Pi 总结 Session。总结输入是已确认 Room 上下文与新增用户/assistant 公开文本、必要的安全项目变更摘要，不含原始 thinking、secret、未脱敏工具结果或完整文件内容。

LLM 输出与 02 定义的 `RoomContext` 同结构；服务端严格校验 JSON、长度、相对路径和敏感内容后写入 `draftJson`。记录可获得的输入/输出 Token 用量及生成来源。草稿生成失败不会改变 `contextJson`，也不会阻塞主会话的最终回复；页面给出错误和重试操作。

同一 Room 有待确认草稿时，新的自动总结不得覆盖草稿或用户对草稿的编辑。后续对话继续留在 Pi transcript；用户确认或拒绝后，系统再处理尚未审阅的新轮次。当前活动分支发生切换时，先核验游标仍在该分支，再决定从何处重新总结，不能用旧分支内容覆盖当前 Room。

## 6. 人工编辑、确认和拒绝

- 用户可直接编辑 `contextJson` 的表单并保存；保存即为明确确认，下一次请求使用新内容。
- 用户可编辑 `draftJson.context` 并预览与当前内容的差异。点击“确认用于后续对话”后，在一个事务中将草稿写为当前内容、清空草稿、推进已审阅位置。
- 点击“拒绝”清空草稿并记录本次已审阅位置。用户可显式重新生成被拒范围；新生成仍需确认。
- 自动生成、模板复制、页面预览和生成完成事件均不得替代用户确认。确认进行中发生并发修改时，应重新读取并显示冲突，不静默覆盖用户编辑。
- 用户终止或结束 Session 后，Room 已确认内容和待确认草稿仍可检查；是否允许继续编辑由 Project 状态及 Room 所属关系校验，不删除历史。

## 7. Room 与资源模板边界

项目为空的 Room 是模板，不能绑定 Session，也没有当前 Project 文件和历史 Pi transcript。模板只保存可泛化的初始上下文；模板来源引用用于显示“复制自”，不构成实时共享或自动同步。

项目为空的工具、扩展、Agent、MCP、Skill 等对象以后归各自的模板类管理。Session 实际执行只使用所属 Project 的独立实例，逐实例配置和调试。Room 不存这些资源的 ID 或配置；房间上下文中的文字也不能授予工具权限。

## 8. Session 活动与历史展示

Project Session 的 Pi `turn_start/turn_end`、assistant 公开文本、工具调用与执行、上下文整理映射为带稳定 ID 的 UI 活动。每个实际模型轮次递增编号，摘要与工具活动携带相同轮次；同一活动用状态更新，所有轮次默认收起。模型可在公开 text 中输出受控高层摘要，系统不得下发原始 thinking，也不能把 Room 自动总结或 Router 文案冒充模型本轮思考。工具记录显示真实工具名、状态和安全的项目相对目标；其他参数、结果正文与异常堆栈不进入 UI。

历史投影从 Pi transcript 当前活动分支安全重建。回答以安全 Markdown 渲染；用户提交以及流式内容和活动更新时主内容区跟随滚动。Room 草稿生成是请求完成后的独立过程，状态展示在 Room 面板，不插入 assistant 最终回答。

## 9. API 边界

~~~text
GET/POST  /api/room-templates
GET/PATCH /api/room-templates/:templateId
GET/POST  /api/projects/:projectId/sessions
GET       /api/projects/:projectId/sessions/:sessionId/messages
POST      /api/projects/:projectId/sessions/:sessionId/messages
POST      /api/projects/:projectId/sessions/:sessionId/interrupt
POST      /api/projects/:projectId/sessions/:sessionId/end
GET       /api/projects/:projectId/sessions/:sessionId/room
PATCH     /api/projects/:projectId/sessions/:sessionId/room/context
PATCH     /api/projects/:projectId/sessions/:sessionId/room/draft
POST      /api/projects/:projectId/sessions/:sessionId/room/draft/confirm
POST      /api/projects/:projectId/sessions/:sessionId/room/draft/reject
POST      /api/projects/:projectId/sessions/:sessionId/room/draft/regenerate
~~~

Session 创建可接受可选 `roomTemplateId`；模板预览/复制确认必须显式。Room API 先验证 Project、Session、Room 三者一致，再处理读写。写操作使用幂等键和明确错误；对已确认 Room 的手动编辑与草稿确认均做原子更新。Route Handler 只解析请求并装配用例，不承载总结、校验或 Pi 事件翻译。

Project 文件列表、预览和 Git 变更继续通过独立 API 加载；目录浏览不依赖 Git。Path Guard 拒绝越界与危险符号链接，隐藏敏感文件，限制目录条数、预览大小和二进制内容。

## 10. 跨项目与迁移边界

本版没有跨项目 Room 提交路径。现有 `/api/rooms`、`cross-project-runs`、RoomRun/Task/Router 代码属于待重新设计的旧路径，不能复用其隐式 scope 或数据语义来实现项目 Room。

现有数据库中项目 Session 的 `roomId=null`、旧 Room/RoomContent/RoomProject/RoomRun/Task 以及无项目资源的处理必须先评估。实现者负责改表和代码；是否迁移历史记录由用户决定，确认后交付独立脚本，默认不执行；旧数据库无法安全兼容时阻止写入并提供诊断。
