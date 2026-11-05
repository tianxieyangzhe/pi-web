# 01｜架构：模型与 Pi 的归属

本文范围：应用架构、独立项目执行与通用组件治理。Bot 的全部专属设计、模型、API、交互与需求统一见 [06｜Bot](06-bot.md)，本文不定义或复写其规则。

本文只定义代码位置、依赖方向，以及模型与 Pi 的归属。字段以 `02` 为准，API 以 `03` 为准，完成条件以 `05` 为准。页面投影不是本文职责。

## 当前规则

Pi SDK 依赖基线为 `@earendil-works/pi-coding-agent@1.5.0`（依赖范围 `^1.5.0`，实际版本由 lockfile 固定）；不自动迁移 Pi 文件。

## 1. 独立项目执行

每个项目 Session 对应独立 Pi Session，cwd 为所属 Project.rootPath，按精确 nativeRef 恢复并复用句柄；消息与完整 Session Tree 归 Pi，SessionMemory 只总结展示。页面生命周期和 API 见 `03`。

## 2. 资源归属
SessionMemory 在 Project 与 Workspace 归属均为空时属于模板，工作区专属归属见 `06`；MCP 及其他项目资源无 Project 时属于模板，复制后固定 Project。Agent 是独立的可复用 Markdown 定义；Project/Session 的运行关系在各自配置流程中保存，不把材料来源误作 Agent owner。统一目录只管理定义，不建立执行授权。

SessionMemory 不保存工具、扩展、Agent、MCP、Skill 的 ID、配置、启用列表、凭据或快照。Agent 模型以 `02`“独立项目 Agent Markdown”为准，其他资源模型另行设计，不能暂存于 SessionMemory JSON 或建立 SessionMemory 资源关联表。SessionMemory 的 JSON 只保存 `02` 定义的当前记忆和只读历史草稿。

## 3. Pi 主线与记忆展示线
~~~text
用户消息 → 项目 Session 用例验证归属 → Pi 原生 prompt(原样文本)
                                        → Pi 原生历史、窗口及回复
完整公开回答稳定 → 独立无工具 LLM 总结 → 校验 → 当前记忆及游标 → 页面展示
用户修改记忆部分 → 条件保存 → 校正展示及后续独立总结
~~~

独立项目 Session 的项目读写工具由应用执行策略和项目路径保护装配，与可选 Agent 指导及其能力开关独立。

Pi AgentSession/SessionManager 是唯一执行 Runtime 和原生上下文权威。每个业务会话的 Pi Session Tree 及全部分支由所属 Pi 管理；中间会话栏只是该树的对话流投影，不新建持久对话副本。读取和流更新契约以 `03` 为准。本阶段 SessionMemory 是固定结构的指导线，仅用于独立总结、页面展示和人工校正，不注入 system prompt，不拼入用户消息，不写成 Pi custom message，不修改原生历史、压缩或工具配置。主请求验证同项目、一对一归属即可，无需将记忆正文读取为模型输入。

项目 Runtime 的 AgentSession 初始化共用 `infrastructure/pi/create-session.server.ts`，在 SDK 初始化期间避免重复追加相同原生配置；比较及失败规则见 `03` 的 PSES-009，不改 Pi SDK 或已有 transcript。

自动总结与立即总结共用固定服务端模型及指导模式；总结失败不影响主回复。Project.cwd 固定为 rootPath，固定 OpenAI Chat Completions 配置仍仅从应用根目录 .env.local 的三个 OPENAI 字段读取，页面和记忆不覆盖。

## 4. 固定指导模式与独立更新
领域字段含义以 `02`“SessionMemory 当前上下文”为准，处理顺序以 `03`“自动总结与增量游标”为准。固定总结指令及包含指令的输入预算检查定义在 Pi 适配层专用模块 `session-memory-summary-prompt.ts`，面板或模板不修改该模式。模式按工作概况、目标、约束、事实、决策、下一步、产出七个问题提炼当前对话；不生成新的执行命令、权限或主会话思考内容。

每次完整公开回答后立即独立增量更新，单记忆至多一个 LLM 任务，结果校验后直接写数据库并刷新展示。生成期间人工校正使旧基线失效，旧输出丢弃，最新校正只传给独立总结器；主 Pi 会话的提示词与消息不受记忆变化影响。历史 draftJson 原样保留且不进入运行。

## 5. 分层与文件职责
~~~text
src/app/                     Next 页面与 Route Handler 入口
src/application/ports/       数据库与 Pi Runtime 能力边界
src/domain/                  SessionMemory 固定 JSON 结构、关系和状态校验
src/infrastructure/database/ SQLite Schema、Repository、历史库诊断
src/infrastructure/pi/       Pi Session、逐轮 system prompt、无工具总结
src/infrastructure/projects/ 项目文件和路径安全
src/bootstrap/               Application/Infrastructure 装配
web/workspace/workspace.tsx  页面壳与区域装配
web/workspace/use-workspace-state.ts 跨区域选择状态
web/workspace/sidebar/       左侧项目导航、弹窗、表单与导航状态
web/workspace/conversation/  中间画布、输入与消息 UI
  project-session/           项目会话及流式状态
web/workspace/files/         文件浏览和预览
web/workspace/inspector/     右侧面板、诊断与资源表单
web/api/                     同源 REST/NDJSON Client
web/domain/                  浏览器端 DTO 与事件类型
web/styles/                  全局视觉样式
~~~

`web/workspace/` 按页面可见区域组织，区域内再按功能分子目录；看左侧功能先进入 `sidebar/`，看中间对话进入 `conversation/`，看文件与右侧检查分别进入 `files/` 和 `inspector/`。区域专用组件、表单与 Hook 同目录。`workspace.tsx` 维护区域装配，`use-workspace-state.ts` 维护跨区域选择；通用 API Client、DTO 和全局视觉样式保留在公共层。

项目导航使用单一 WorkspaceSelection，展开和刷新不抢占当前选择。

依赖方向为 `app → application → domain + ports`、`infrastructure → ports + domain` 和 `app → web/workspace → web/api + web/domain`。只有 composition root 同时认识应用服务与基础设施。`page.tsx` 和 `route.ts` 只做入口与装配，不承载完整业务实现；页面不直接访问 Pi、SQLite 或 Node 文件系统。

Next.js 同时提供页面和同源 API；不增加独立 Vite 服务或第二个浏览器端口。文件树、预览与 Git 变化仍由独立项目 API 读取；目录列表不依赖 Git 状态。

## 6. AI Elements 组件治理
新增或改造前端组件前，先检索官方 AI Elements 组件。语义匹配时优先经 Feature Wrapper 映射领域 DTO；组件库不能决定 SessionMemory 的字段或协议。当前选型：

| 场景 | 组件语义 | 现有例外或替代 |
| --- | --- | --- |
| Session 消息与 Markdown 回复 | Conversation / Message / Response | 现有 `web/workspace/conversation/ai-elements/response.tsx` 提供安全 Markdown 子集；官方依赖可用后复核替换 |
| 项目会话等待响应 | Loader / Spinner | 已检索官方 [Loader](https://elements.ai-sdk.dev/components/loader)，当前指向 shadcn Spinner，匹配加载语义；项目尚未引入 shadcn 组件体系，复用现有 lucide `LoaderCircle` 和 `.spin`，在项目会话 Feature Wrapper 中配合可访问状态文本；统一基础组件体系引入时复核。 |
| Pi Session Tree entry（含工具） | Conversation / Message / Tool | 会话栏按 `03` 投影整棵树；工具内容及其他节点不得过滤，现有 `conversation.tsx` 可使用原生 disclosure 展开完整内容，官方组件能够承载节点和分支关系时复核 |
| 原生上下文用量 | Context | 已检索官方 Context（https://ai-sdk.dev/elements/components/context）；依赖 AI SDK/shadcn HoverCard 与进度组件，项目尚未引入配套系统且需表达未知容量与最后可信值。当前以 `web/workspace/inspector/native-context-section.tsx` Feature Wrapper 和原生 progress 显示；配套依赖与未知值映射可用时复核替换 |
| 记忆局部修改 | 富文本表单弹窗 | 官方 AI Elements Context/Confirmation 无局部富文本表单语义；采用 `web/workspace/inspector/memory-field-dialog.tsx` Feature Wrapper 与原生 dialog，将安全格式转换为 Markdown。官方支持字段富文本编辑时复核 |
| Project 导航折叠 | 通用导航触发器 | 官方 AI Elements 无匹配通用 App Shell Sidebar Trigger；沿用原生按钮与现有图标，导航重做时复核 |
| 项目文件树与预览 | File Tree / Code Block | 只读且受 Project Path Guard 约束；Git 只是可选状态 |
| 会话与输入错误气泡 | 通用错误通知 | 已检索官方 [AI Elements 组件目录](https://elements.ai-sdk.dev/components)，Confirmation 表达审批，未发现通用 Toast。使用 `web/workspace/conversation/error-toast.tsx` 共享 Feature Wrapper，以 React portal、原生 alert 和关闭/重试按钮显示现有错误；引入统一通知基础组件时复核。 |
| 本轮参考文件 | [Prompt Input Attachments](https://elements.ai-sdk.dev/components/prompt-input) / [File Tree](https://elements.ai-sdk.dev/components/file-tree) | 官方附件组件面向浏览器上传、File Tree 只提供树投影，均未覆盖本项目的草稿门禁及服务端项目范围；沿用 Composer Feature Wrapper、原生多文件输入和模态目录浏览。统一基础组件支持这些门禁时复核。 |
| 项目对话输入与发送快捷键 | Prompt Input | 已检索官方 [Prompt Input](https://elements.ai-sdk.dev/components/prompt-input)：提供文本输入和 Enter 发送/Shift+Enter 换行，语义符合原有键位习惯；组件还引入项目未使用的 AI SDK/shadcn 输入依赖，且不能直接承载现有会话草稿与运行门禁。保留 `web/workspace/conversation/prompt-input.tsx` Feature Wrapper；PSES-010 的光标内联附件由 `inline-composer-editor.tsx` 使用原生 contentEditable/Selection/Range 承载，官方 Prompt Input Attachments 未提供本项目所需的混合光标文档与项目文件引用，故不引入依赖。DOM 仅承载浏览器草稿，不构成持久消息。Enter 发送、Shift+Enter 换行，并同时检查 composition 状态、`nativeEvent.isComposing` 与旧浏览器 `keyCode=229`，防止候选确认误发。浏览器输入法覆盖或统一基础输入组件接入时复核 |
| 项目或 SessionMemory 模板选择 | 资源选择弹窗 | 选择并复制 Project/模板不等于模型操作审批；沿用 Feature 层弹窗，官方组件有匹配语义时复核 |
| 记忆 / 文件 / 检查切换 | 通用面板导航 | 已检索官方 AI Elements 目录，Context 为模型用量展示、Confirmation 为审批，均不匹配面板导航；采用 `web/workspace/workspace.tsx` 中原生可访问独立按钮和 `web/workspace/inspector/context-panel.tsx` 内容装配。官方提供通用面板切换组件时复核 |
| 项目导航与检查区域容器 | 通用应用布局 | AI Elements 不提供应用列容器语义；沿用 `web/workspace/sidebar/project-navigation.tsx` 和 `web/workspace/inspector/context-panel.tsx`。引入统一 App Shell 组件时复核 |


AI Elements 不承担 API、NDJSON 解析、持久状态或权限校验。Tailwind CSS 与现有项目样式系统承载视觉样式。

## 7. 安全与关键不变量
1. 项目 Session、SessionMemory 和执行资源必须属于同一 Project；模板 SessionMemory 与资源模板不可直接执行。
2. 项目 Session 的 `sessionMemoryId` 唯一且不可变；一个SessionMemory 只服务一个 Session。
3. SessionMemory 当前内容及历史草稿均不进入主 Pi 系统提示词或消息；contextJson 仅供指导线总结、校正和展示。
4. SessionMemory 的 `outputs` 用于展示，SessionMemory 不选择或授权工具、Agent、MCP、Skill 和扩展。
5. 用户消息属于 Pi 原生 transcript；SessionMemory 不保存完整 transcript 或原始思维链。
6. SessionMemory 数据只存数据库，上下文组装只在内存中存在；不创建 `.data/memories` 或本地 SessionMemory 文件。
8. 数据库固定为 `.data/ai-workspace-v5.sqlite`。保留项目、Agent、Session 和 SessionMemory；历史结构变更须遵守显式迁移决定，不重建数据库文件。

## 9. SessionMemory 实现职责与调用边界
以下是目标职责拆分，不代表这些模块已经实现；对应 SMEM-001～010、PSES-003、NFR-002～004。

| 层 | 目标职责 |
| --- | --- |
| domain | SessionMemoryContext/SessionMemoryDraft 严格校验、规范化、基线 Hash、容量和相对路径语法规则；实际文件安全通过项目端口校验，不依赖 Pi 或 SQLite |
| ports | 原子 SessionMemory Repository、当前活动分支的安全投影、无工具总结器、可恢复的请求完成边界、Clock 和后台调度接口 |
| database | 整行条件更新和短事务、JSON 映射、引用约束、历史库只读诊断；字段以 `02` 为准 |
| pi | 主 Session 使用原生上下文；独立临时总结 Session，不绑定业务 Session，不写入主 transcript |
| bootstrap | 装配固定模型、进程内 Session/SessionMemory 锁和总结调度器；禁止 Route 创建各自独立锁 |
| web | SessionMemory Feature Wrapper、编辑状态和差异展示；通过 SessionMemory API 读取状态，不把自动总结塞入主对话事件 |

主会话结束钩子先完成主回复，再通知 SessionMemory 调度器立即处理尚未同步的完整回答；后台异常在辅助线收敛。调度器仅为每个 SessionMemory 保留一个运行任务和一个“需再检查”信号，不建立任务持久表，不在进程退出后假装任务仍运行。总结适配器必须显式关闭工具、MCP、扩展、Skill 和输出 thinking；其原生会话不持久化，不沿用用户 Session 的执行能力。

本版运行环境是单个长驻 Node 服务进程、单个 SQLite 数据库；主请求锁与总结锁在该进程共享。纯请求结束即冻结的部署和多副本部署无法保证后台完成与执行互斥，不得宣称支持；若要支持，必须先独立设计调度和部署边界。数据库条件写入仍是所有最终写入的校验屏障。


Pi 原生上下文压缩算法和原生历史恢复能力保留，但自动压缩关闭；只由用户在检查面板点击“压缩原生上下文”触发。创建与恢复主 Pi Session 时都显式设置手动压缩策略，禁止通过溢出恢复、重试、后台调度或扩展绕过该策略。SessionMemory 自动总结和“立即总结”不能触发原生压缩；临时总结 Session 同样不使用隐式自动压缩，超预算按总结错误处理。

应用层提供原生上下文用量读取和手动压缩用例；Pi 端口提供用量快照、原生手动压缩、状态与历史恢复投影。检查面板通过同源 API 展示安全 DTO，不读取原生文件或完整提示词。手动压缩与用户请求共用 Session 执行互斥，SessionMemory 的短来源读取等操作经过同一协调器；具体流程以 `03`“原生上下文检查和用户手动压缩”为准，指标定义以 `02`“原生上下文使用情况”为准。

当前模板创建/编辑入口先随新建项目会话弹窗提供，模板 API 已独立；独立模板库与完整分支范围恢复界面仍待复验，不以此宣称全部 UI 已验收。

会话导航的展示清理由 Workspace 统一处理，右侧面板仅在打开时装配，避免隐藏状态下回退到检查或资源展示。

已有 SessionMemory 数据保留。应用启动不自动改写数据库，也不恢复旧实体或旧协议。

## 10. Pi 主导上下文管理（2026-10-08）
Pi AgentSession/SessionManager 是执行上下文的权威：管理当前有效消息窗口、原生历史和压缩边界。应用只调用 Pi 的原生读取/压缩/取消/恢复能力并提供 Session Tree 的对话流投影，不维护第二套模型窗口，不用数据库摘要拼装假 transcript，不以 SessionMemory 总结代替 Pi compaction。

SessionMemory 是应用层可编辑的指导线，目前只用于独立 LLM 总结和展示，主 Pi 请求不读取记忆正文作为上下文。其总结游标用于应用记忆增量处理，不是 Pi 压缩游标。原生上下文压缩仍由用户手动触发、自动关闭，不因采用 Pi 为主而恢复自动压缩。

端口分离：`application/ports/pi-context.ts` 定义原生上下文检查、手动压缩和取消；`session-memory-runtime.ts` 只定义安全历史来源与独立记忆总结。两者由同一 Pi Runtime 适配，共享 Session 执行互斥，功能不嵌套。

检查面板优先展示“Pi 上下文”，集中显示当前用量、模型容量、采样口径、执行状态及手动压缩/取消/刷新操作。恢复继续调用现有 Session 恢复用例。实际调用必须使用当前 Pi SDK 提供的 `getContextUsage/compact/abortCompaction`；无法测量则显示未知。消息/工具正文、完整 system prompt、私密思维链和原生文件路径不通过检查 API 暴露。分支管理与修改原生消息不在本次范围；后续先定义需求再实现。


## 11. 与对话并行的记忆纠错线（2026-10-08）
SessionMemory 是与 Pi 对话同时存在的工作理解与人工纠错线，持续维护当前目标、约束、事实和决定，用于向用户展示历史关联和工作方向。每次成功完成的公开回答稳定后立即触发独立 LLM 增量更新，取消累计五次触发和 30 秒冷却；单记忆仍至多一个任务，调用耗时和输入输出预算保持约束。主回复不等待总结，新回答在已有任务后继续处理；原生 transcript 始终保留完整历史。

实时指持续跟随已完成对话并立即展示可用记忆，不把流式半句当作持久事实。生成未结束时只显示已经写入的记忆及同步状态，不冒充最新。人工修正立即写入当前记忆，后续独立总结读取；旧生成因条件凭据过期而丢弃，再以最新修正和新增来源更新。模型总结必须以当前记忆中的明确纠正为准，不因历史错误重复出现而恢复被纠正的事实。Pi 原生窗口管理和手动压缩策略保持独立。

2026-10-08 当前阶段边界：指导模式固定，记忆内容只总结展示。任何后续将指导线作用于主 LLM 的方案必须先定义需求与交互，本次不提供隐式注入或自动干预。

## 12. 共享状态读取与活动总览
当前 Session 的记忆只由 `conversation/project-session/use-session-memory.ts` 读取，主会话侧栏与记忆面板共享其结果。状态变化仍由主请求完成钩子独立驱动，不依赖轮询产生总结。轮询节奏和可见性以 `03` 为准。对话按 `03` 投影所属 Pi Session Tree 的全部节点和分支；SessionMemory 的活动分支安全来源仍与会话树展示独立。
