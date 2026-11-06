# 01｜架构：模型与 Pi 的归属

FILE-003：会话文件只读用例位于application/session-file-service，基础设施复用会话附件目录与有界文件读取，bootstrap注入SQL Session查询；不通过项目文件API绕过归属、不改变Pi/文件归属。


FILE-002：Excel/PPT结构提取复用infrastructure/references/file-preview中的受限ZIP/XML数据解析；PDF使用浏览器原生查看器与现有下载端口，不引入Office服务/第三方上传或新依赖；复用已有FilePreviewPane和原生iframe，不新增可见组件。


ROUTE-CLEAN-001：删除退役记忆/模板固定404路由、旧记忆改名脚本、未接入生产调用链的NDJSON适配、轮询器、旧会话组件及其专用测试；移除源码树内空目录。当前原生Pi/SSE、租约、恢复、Agent采用、导出和已完成迁移脚本保留；不操作数据库、备份、原生历史或构建/发布产物。

本文范围：应用架构、独立项目执行与通用组件治理。Workspace 的专属设计、模型、API、交互与需求统一见 [06｜Workspace](06-workspace.md)，本文不定义或复写其规则。

本文只定义代码位置、依赖方向，以及模型与 Pi 的归属。字段以 `02` 为准，API 以 `03` 为准，完成条件以 `05` 为准。页面投影不是本文职责。

## 1. 会话与 Pi 归属

每个独立项目 Session 对应独立 Pi AgentSession/SessionManager，cwd 为所属 Project.rootPath，按精确 nativeRef 恢复并复用句柄；Workspace 的专属 cwd 和归属见 06。用户消息、完整 Session Tree、全部分支、活动指针、模型变化与压缩结果只归 Pi，不维护第二份持久对话或应用摘要上下文。

PSES-024：项目文件位置由infrastructure/projects按所属项目根解析，application只接收内部定位描述并装配参考文本，不读取正文；上传/粘贴图片继续解析内容快照；非图片按PSES-025存储并提供位置。两者均经所属Pi sendCustomMessage记录，再prompt原样用户意图；模型通过已有read读取必要片段、bash/rg搜索，cwd/nativeRef/session文件/恢复身份与工具权限不变，不注册新工具。PSES-025附件存储位于infrastructure/references，ZIP/XML提取使用fflate和现有linkedom；文件归属/生命周期见02，API及失败边界见03。Pi适配在prompt前按原生sessionId物化文件，独立项目和Workspace均使用Pi原生read读取附件位置；附件存储校验不构成原生工具的文件系统沙箱。

会话主线为“验证归属及运行许可 → Pi prompt 原样用户文本 → 原生历史与回复”。不运行回答后的应用级自动总结，不创建记忆对象或模板，不以摘要改写提示词。Pi 原生手动上下文压缩继续保留，它与被删除的应用记忆能力是不同的操作。

项目 Runtime 的 AgentSession 初始化共用 infrastructure/pi/create-session.server.ts，在 SDK 初始化期间避免重复追加相同原生配置；比较及失败规则见 03 的 PSES-009，不改 Pi SDK 或已有 transcript。PSES-028：独立项目直接装配Pi原生read/bash/edit/write，与Workspace一致，不注册project_*或额外Bot协作工具；cwd为所属Project.rootPath，原生工具按宿主进程权限执行，cwd不是路径沙箱。Agent仅附加指导，不决定工具许可。内部read请求在prompt前仅激活read，排除可写命令工具；终结后恢复原工具集。project_*包装与Bot功能全部删除，不保留旧Runtime或协作装配，目标模型及历史数据边界见02 BOT-REMOVE-001，专属入口退役见06 BOT-REMOVE-001。历史工具节点原样保留，当前系统说明以实际Pi工具为准。

## 2. 资源归属

Agent 是独立可复用的版本化 Markdown 定义，无 Project owner；会话显式保存精确版本引用，参考项目和文件不形成永久绑定或授权。MCP 及其他执行资源没有 Project 时只作为模板，复制到 Project 后成为独立实例。统一目录只管理定义，不建立执行授权。资源模型分别设计，不借其他对象的任意 JSON 暂存。

## 3. 应用级 Pi 配置来源

配置根目录是 npm 启动该应用时的工作目录，启动时捕获为不可变的 applicationConfigRoot。它与业务 Project.rootPath、Workspace 默认目录、Pi Session cwd 及工具中的 cd 无关；所有会话共享同一来源策略，不逐项目查找。部署适配必须保留 npm 启动目录语义，不把打包输出目录当作配置根。

| 文件 | 本地来源 | 本地文件不存在时的全局来源 |
| --- | --- | --- |
| models.json | `<applicationConfigRoot>/models.json` | `~/.pi/agent/models.json` |
| settings.json | `<applicationConfigRoot>/settings.json` | `~/.pi/agent/settings.json` |

两个文件分别选择来源。只在本地文件不存在（ENOENT）时读取对应全局文件；本地存在则整份使用，不读取、不合并全局对应文件。空文件、JSON 损坏、权限错误、字段无效均报告配置错误，不以回退掩盖。两级均缺失时按 Pi 原生无自定义文件的行为解析；需要默认模型的新会话/无原生选择的操作，缺少可确定的默认模型或认证时明确报错，不任取首项；已有原生选择按该型号校验，不因缺少未使用的默认项而替换或阻断。

模型通过当前依赖版本的 Pi ModelRuntime/ModelRegistry 原生解析和认证机制装配，完整支持 Pi 支持的模型、供应商及嵌套参数，不建立缩水白名单或丢弃未知字段后假装兼容；Pi 不支持的字段按其校验规则报错。包括 api、baseUrl、认证与环境变量引用、headers、兼容参数、reasoning、input、cost、contextWindow、maxTokens 等，新增 Pi 参数随依赖的原生契约适配。协议不限于单一供应商或 Chat Completions。凭据、配置全文、请求头和原生路径只在服务端使用。

settings.json采用defaultProvider、defaultModel及enabledModels，不从另一份文件补值。enabledModels按Pi原生模型scope模式匹配（支持provider/id、通配与thinking后缀），用于模型列表及执行选择的过滤；省略或空数组不限制，非空但无匹配时无可用模型，字段类型错误报告配置错误。当前Session模型不存在、被过滤或认证不可用时，打开/恢复及下一次空闲操作自动采用配置默认模型；默认模型同样必须通过过滤及认证，默认也不可用才提示MODEL_UNAVAILABLE。不任意挑选其他模型，不重发失败请求。自动压缩必须开启并采用Pi默认参数，工具边界仍由应用契约决定。应用不再从环境文件中的固定模型三元组生成模型或提供备用模型；Pi 配置内显式声明的环境变量引用正常生效。

新会话及无原生模型选择的会话采用有效默认模型；已有会话优先恢复 Pi 当前分支保存的 provider/model，已保存型号不可用时按MCFG-002自动回退默认模型，默认也不可用才报告模型不可用。用户切换只调用本会话的 Pi setModel，并保存原生 model_change，不写默认配置或 SQL 模型副本。会话思考等级通过Pi getSupportedThinkingLevels/getAvailableThinkingLevels及setThinkingLevel读取和修改，持久事实仅为原生thinking_level_change，不写SQL或默认配置；接口见03 PSES-019。手动压缩使用当前会话模型；Agent 编辑器使用默认模型，保持独立无工具边界。

显式 contextWindow 和 maxTokens 必须进入实际 Runtime，分别用于上下文容量和最大输出限制，禁止应用硬编码容量或输出上限覆盖配置。缺省使用 Pi 解析结果；容量不能确认时指标为未知。配置读取发生在应用初始化、模型列表请求及后续操作的配置校验边界；运行中的模型/工具循环固定本次快照，变更在下一次空闲操作时生效，不在流中热替换。重新解析失败必须报告，不能用旧缓存伪装成功。应用不提供配置文件写入或隐式修改能力。

## 4. 分层与文件职责
~~~text
src/app/                     Next 页面与 Route Handler 入口
src/application/ports/       数据库与 Pi Runtime 能力边界
src/domain/                  Session、资源关系和运行状态校验
src/infrastructure/database/ SQLite Schema、Repository、历史库诊断
src/infrastructure/pi/       Pi Session、模型配置、逐轮 system prompt 与原生上下文
src/infrastructure/projects/ 项目文件和路径安全
src/bootstrap/               Application/Infrastructure 装配
web/workspace/workspace.tsx  页面壳与区域装配
web/workspace/use-workspace-state.ts 跨区域选择状态
web/workspace/sidebar/       左侧项目导航、弹窗、表单与导航状态
web/workspace/conversation/  中间画布、输入与消息 UI
  project-session/           项目会话及流式状态
web/workspace/files/         文件浏览和预览
web/workspace/inspector/     会话检查弹窗、树导航与 Session 设置
web/api/                     同源 REST/SSE Client
web/domain/                  浏览器端 DTO 与事件类型
web/styles/                  全局视觉样式
~~~

`web/workspace/` 按页面可见区域组织，区域内再按功能分子目录；看左侧功能先进入 `sidebar/`，看中间对话进入 `conversation/`，看文件与会话检查分别进入 `files/` 和 `inspector/`。区域专用组件、表单与 Hook 同目录。`workspace.tsx` 维护区域装配，`use-workspace-state.ts` 维护跨区域选择；通用 API Client、DTO 和全局视觉样式保留在公共层。

项目导航使用单一 WorkspaceSelection，展开和刷新不抢占当前选择。

依赖方向为 `app → application → domain + ports`、`infrastructure → ports + domain` 和 `app → web/workspace → web/api + web/domain`。只有 composition root 同时认识应用服务与基础设施。`page.tsx` 和 `route.ts` 只做入口与装配，不承载完整业务实现；页面不直接访问 Pi、SQLite 或 Node 文件系统。

Next.js 同时提供页面和同源 API；不增加独立 Vite 服务或第二个浏览器端口。文件树、预览与 Git 变化仍由独立项目 API 读取；目录列表不依赖 Git 状态。

FILE-001：文件读取/下载用例在application/project-file-service，bootstrap/project-files装配基础设施，route仅映射请求/响应；Workspace按原application端口校验归属。DOCX结构提取在infrastructure/references/file-preview，响应DTO在domain/file-preview。不新增UI组件，复用以下已登记的FilePreviewPane与文件浮窗，以原生标题/表格/代码和按钮投影API，无新增依赖。

## 5. AI Elements 组件治理

| 场景 | 组件语义 | 现有例外或替代 |
| --- | --- | --- |
| Session 消息与 Markdown 回复 | Conversation / Message / Response | 现有 `web/workspace/conversation/ai-elements/response.tsx` 提供安全 Markdown 子集；官方依赖可用后复核替换 |
| 项目会话等待响应 | Loader / Spinner | 已检索官方 [Loader](https://elements.ai-sdk.dev/components/loader)，当前指向 shadcn Spinner，匹配加载语义；项目尚未引入 shadcn 组件体系，复用现有 lucide `LoaderCircle` 和 `.spin`，在项目会话 Feature Wrapper 中配合可访问状态文本；统一基础组件体系引入时复核。 |
| Pi Session Tree entry（含工具） | Conversation / Message / Tool | 会话栏按 `03` 投影整棵树；工具内容及其他节点不得过滤，现有 `conversation.tsx` 可使用原生 disclosure 展开完整内容，官方组件能够承载节点和分支关系时复核 |
| 原生上下文用量 | Context | 已检索官方 Context（https://ai-sdk.dev/elements/components/context）；依赖 AI SDK/shadcn HoverCard 与进度组件，项目尚未引入配套系统且需表达未知容量与最后可信值。当前以 `web/workspace/inspector/native-context-section.tsx` Feature Wrapper 和原生 progress 显示；配套依赖与未知值映射可用时复核替换 |
| 会话树标题导航 | Tree / Conversation | 复核官方 File Tree 与 Conversation 的节点语义；文件目录选择不能直接表达 Pi 分支及正文定位，采用会话树 Feature Wrapper。实现前须重新检索官方目录并记录适配结果；官方支持 Pi 节点导航时复核 |
| Project / Workspace 设置 | 通用表单布局 | 已检索官方sitemap（https://elements.ai-sdk.dev/sitemap.xml）的Panel/Confirmation/File Tree等目录，无业务设置页壳或宿主目录选择语义；复用原生form/main/header/footer，以web/workspace/settings-page.tsx共享版式和操作，DirectoryPicker从工作区页面提取共享；采用统一应用表单基础组件时复核。 |
| Project 导航折叠 | 通用导航触发器 | 官方 AI Elements 无匹配通用 App Shell Sidebar Trigger；沿用原生按钮与现有图标，导航重做时复核 |
| 项目文件树与预览 | File Tree / Code Block | 只读且受 Project Path Guard 约束；Git 只是可选状态 |
| 会话与输入错误气泡 | 通用错误通知 | 已检索官方 [AI Elements 组件目录](https://elements.ai-sdk.dev/components)，Confirmation 表达审批，未发现通用 Toast。使用 `web/workspace/conversation/error-toast.tsx` 共享 Feature Wrapper，以 React portal、原生 alert 和关闭/重试按钮显示现有错误；引入统一通知基础组件时复核。 |
| 本轮参考文件 | [Prompt Input Attachments](https://elements.ai-sdk.dev/components/prompt-input) / [File Tree](https://elements.ai-sdk.dev/components/file-tree) | 官方附件组件面向浏览器上传、File Tree 只提供树投影，均未覆盖本项目的草稿门禁及服务端项目范围；沿用 Composer Feature Wrapper、原生多文件输入和模态目录浏览。统一基础组件支持这些门禁时复核。 |
| 项目对话输入与发送快捷键 | Prompt Input | 已检索官方 [Prompt Input](https://elements.ai-sdk.dev/components/prompt-input)：提供文本输入和 Enter 发送/Shift+Enter 换行，语义符合原有键位习惯；组件还引入项目未使用的 AI SDK/shadcn 输入依赖，且不能直接承载现有会话草稿与运行门禁。保留 `web/workspace/conversation/prompt-input.tsx` Feature Wrapper；PSES-010 的光标内联附件由 `inline-composer-editor.tsx` 使用原生 contentEditable/Selection/Range 承载，官方 Prompt Input Attachments 未提供本项目所需的混合光标文档与项目文件引用，故不引入依赖。DOM 仅承载浏览器草稿，不构成持久消息。Enter 发送、Shift+Enter 换行，并同时检查 composition 状态、`nativeEvent.isComposing` 与旧浏览器 `keyCode=229`，防止候选确认误发。浏览器输入法覆盖或统一基础输入组件接入时复核 |
| 文件 / 会话检查弹窗 | 通用模态与会话设置 | 原生可访问 dialog + Feature Wrapper，文件和会话检查分别装配，Context 仅映射用量。本轮已重新检索官方 Model Selector（https://elements.ai-sdk.dev/components/model-selector）、File Tree 与 Conversation：Model Selector 依赖 CommandDialog/shadcn 体系，File Tree 不表达 Pi 节点关系；当前复用原生 dialog/select 与 web/workspace/auxiliary-dialog.tsx、inspector/session-inspection.tsx Feature Wrapper，API 许可由服务端提供；引入统一组件体系或官方支持 Pi 树定位时复核 |
| 项目导航与会话布局 | 通用应用布局 | AI Elements 不提供应用布局语义；主会话只保留导航与对话，辅助内容使用独立模态。Agent 编辑工作区的 Markdown 列按自身契约保留 |


AI Elements 不承担 API、SSE解析、持久状态或权限校验。Tailwind CSS 与现有项目样式系统承载视觉样式。


IMG-FAIL-001：Pi适配层仅在明确图片能力错误及可靠终结/落盘后返回MODEL_IMAGE_UNSUPPORTED，application按03记录已知失败并保持会话可用；不靠页面隐藏unknown、不改写历史。

## 6. 持久化与运行边界

OPS-006：发布支持 --without-node-modules 选项，跳过依赖目录并随包带入原始 package.json/package-lock.json；服务器执行 npm ci --omit=dev 安装锁定运行依赖后 node server.js 启动，不编译应用。默认继续随包带依赖。无依赖包不保证跨平台编译产物兼容，原生依赖由运行端安装。生产支持 Next standalone 独立发布目录，包含 server.js、编译产物、静态资源、追踪依赖、runtime/database SQL 和 systemd 启动工具，不依赖应用 TS/TSX 源码或服务器 npm install/build。Schema 在发布目录从 runtime/database 读取，源码运行仍读取原 SQL；不改目标模型或迁移。发布目录为稳定应用根，cwd/INIT_CWD、本地 Pi 配置、.data 和原生历史路径归属保持原契约；构建包不包含用户数据库、认证、模型配置或环境文件。原生依赖要求构建与运行平台/架构/Node ABI兼容。OPS-007：npm run release 由 scripts/release.cjs 串行编排，固定在 .next-release 构建，与默认开发目录 .next 隔离；忽略继承的 AI_WORKSPACE_BUILD_DIR，防止误用开发产物。取得发布锁后先校验并删除旧 .next-release（包含缓存），再完整构建并打包到临时目录，成功后发布到默认 release；已有纯发布包临时改名为 release-previous-<唯一标识>，新包放入成功后自动删除该旧包，切换失败时恢复原目录。旧包清理失败须报告残留位置，不伪装为发布失败；不扫描删除其他历史目录。开发目录 .next 不参与清理。含 .data、模型/认证/环境配置、符号链接或缺少发布标识的目录拒绝替换；显式指定的已存在输出仍拒绝覆盖。根目录发布锁阻止并发发布；失败不将旧构建作为新包发布。完成输出绝对目录与 Build ID，release.json 记录打包时间。低层 package-release.cjs 仍仅复制指定构建且拒绝覆盖；不迁移数据、不启停服务。Next生产构建阶段（NEXT_PHASE=phase-production-build）数据库模块仅初始化进程内临时内存库，不创建目录或打开用户库；正式运行仍按固定路径和历史兼容检查。

OPS-005：next.config.mjs 从 AI_WORKSPACE_ALLOWED_DEV_ORIGINS 读取开发资源允许来源，以逗号分隔并去掉首尾空白及空项；未配置时为空数组，保留 Next 默认来源规则，不硬编码部署 IP。只配置开发资源/HMR 校验，不改变监听地址、业务 API、持久模型或 Pi 归属，不调用 Pi。

OPS-004：web/api/random-uuid.ts 统一提供浏览器 API 请求键和本地附件标识的安全随机 UUID，兼容公网 HTTP；不依赖 Node crypto，不修改全局 crypto，不创建持久模型或调用 Pi。

OPS-003：Next配置采用next.config.mjs，构建manifest插件采用显式.cjs导入，不依赖配置加载阶段的TypeScript扩展解析或SWC原生二进制；保留开发manifest原子替换行为。旧glibc平台的SWC回退与后续原生模块兼容性由部署环境验证，不自动升级系统库。

OPS-002：开发、生产及systemd默认监听localhost:3000；可显式指定0.0.0.0、任意本机IPv4或IPv6监听地址，不设来源IP白名单。监听由Next CLI与启动脚本配置，不新增跨域API或修改业务归属校验。

OPS-001：Linux systemd以单实例长驻Node运行生产Next服务。scripts/start-systemd.sh定位仓库根作为WorkingDirectory与INIT_CWD，exec已选Node的next start，保持配置、.data及Pi恢复身份，不调用Pi或迁移数据库。scripts/systemd.cjs仅生成/安装unit（user默认，system显式指定非root运行用户），安装只写unit并daemon-reload，不自动构建/启动/enable。服务保留运行用户HOME与可执行PATH，不启用会遮蔽用户项目/家目录/临时文件的沙箱；停止信号传给Node进程组，stdout/stderr交journald。使用说明在scripts/systemd-guide.md；版本升级构建与服务启停由操作者单独执行，不由应用启动隐式完成。

SLIST-002由application的SessionOpenHistory端口、infrastructure/sessions/session-open-history.server.ts版本化原子文件实现持久最近打开时间；bootstrap为两类会话注入同一端口，按scope/owner/session隔离。不调用Pi或增改SQL。

SLIST-001列表预览由infrastructure/pi只读所属原生树，domain纯函数派生最新用户文本/消息时间，application装配安全DTO。无新存储或替代摘要；Pi身份和会话归属不变。

SCONN-001：当前Session的open/closed是连接使用权投影，不是SQL持久生命周期；历史ended_at不作为执行门禁。具体模型和兼容关闭入口见02/03。Runtime内部活动、SSE订阅和页面连接分别由application协调，打开后页面通过事件及事件触发的快照读取更新，不运行进度轮询。

数据库固定为 .data/ai-workspace-v5.sqlite。目标表与退役映射由 02/06 定义；结构调整不等于历史库迁移授权，启动不对历史库自动执行 DDL、清库或重建；仅全新空库按目标 Schema 初始化。已有原生身份不可替换，不删除 Pi 文件或将损坏历史伪装为空会话。

运行环境是单个长驻 Node 进程、单个 SQLite 数据库；会话执行互斥、连接租约、订阅和后台使用权在进程内共享，Route 不创建各自的独立锁。不声称支持请求结束即冻结的部署或多副本部署。数据库条件更新仍是写入屏障。独立项目会话副作用由 02 §13 的 ProjectSessionOperationJournal 保存耐久准备/观察/完成证据，文件 IO 位于 infrastructure，操作门禁与恢复规则位于 application，HTTP 恢复入口按 03 §13；它不拥有 Pi transcript，也不改变 Workspace 的专属 journal。Agent 编辑对话只持有客户端候选与独立无工具 LLM 请求，不另建 Pi Session 或持久编辑会话。

会话安全 DTO 不单独暴露原生路径、句柄或凭据。messages 和导出按 03 保留全部原生节点及原文，不能因内部节点、thinking 或敏感工具结果而过滤。

## 7. Pi 上下文与会话检查

Pi 管理原生有效窗口、压缩边界和完整历史，应用只调用原生 getContextUsage、compact、abortCompaction 和精确恢复能力。PSES-021：所有业务Session开启Pi原生自动压缩，SettingsManager不传compaction覆盖，阈值、预留、保留近期Token及溢出恢复使用当前依赖版本Pi默认值；应用及页面无关闭入口，不写用户settings文件。自动压缩由所属Pi会话触发、落盘及续跑，应用不建立额外摘要或重试循环。用户仍可在会话设置中手动压缩。

应用上下文端口负责用量、手动压缩、取消与恢复投影；与发送、模型切换、派生、删除及配置写入共用会话互斥，取消保持原操作锁直到 Pi 确认结束。不运行自动总结或回答后辅助任务。

会话检查由树标题导航和 Session 设置组成。树复用 messages 快照及订阅；点击只滚动定位，不调用 navigateTree 或 branch。创建派生会话由独立的临时 SessionManager 调用 createBranchedSession，禁止在源 Runtime 正在使用的 manager 上调用：当前 SDK 会替换调用方的 sessionId、sessionFile、entries 和叶子，并重建 label。适配层从源树只读快照准备隔离候选，按 03 校验并恢复候选中的完整祖先路径，保存新的业务身份和独立 nativeRef，源会话不变。模型切换调用 setModel；导出使用 Pi 原生能力及全树只读序列化适配，不能把分支文件冒充完整树。API 许可及失败恢复见 03，DTO 见 02。

## 8. 页面壳与导航清理

主会话只保留左侧导航和中间对话，文件及会话检查是互斥的独立模态弹窗，投影见 04。页面壳统一在任意左侧按钮和实际会话切换前关闭现有弹窗，取消本地读取或忽略迟到响应；关闭不撤销已接受的后台操作。

会话名称使用 API 返回的 purpose，空白时显示“新会话”，不生成或缓存模型摘要。Agent 编辑工作区的只读 Markdown 列按自身契约保留，不与会话辅助弹窗混为一体。

## SEARCH-002｜应用执行工具搜索

基础设施只提供一个默认inactive的web_fetch工具，通过显式Pi扩展按本轮toolSearch意图激活并在finally恢复原工具集。按03 SEARCH-003的input契约区分URL与查询词：URL由部署主机直接抓取，查询词访问https://www.bing.com/search并解析自然搜索结果，不依赖额外搜索服务或搜索Key。使用Undici联网、linkedom解析、Mozilla Readability提取正文，不执行脚本或加载子资源。HTTP_PROXY/HTTPS_PROXY/NO_PROXY显式生效，代理快照固定本轮并关闭dispatcher；Ubuntu部署即使用Ubuntu网络。Pi原生工具调用/结果拥有全部历史，不另建SQL、Session或摘要。内置搜索沿用SEARCH-001，不自动互相降级。

UI在已有PromptInput包装内复用原生select，不新增组件或依赖。官方PromptInput工具栏承载选择动作，但当前未引入配套依赖，使用原生select表达单选；选项及默认值见04 SEARCH-002，统一输入基础组件时复核。

## SEARCH-001｜服务端联网搜索

共享Runtime显式装配请求级搜索扩展，不开放外部扩展发现。仅openai-responses协议可请求OpenAI内置web_search；保留编程工具，由供应商执行搜索。开关固定本轮工具循环，finally清除，不用于压缩或其他会话。通过provider_stream_event将搜索调用和带引用的原始message output_item.done保存为所属Pi树custom entry（server_web_search），不作为模型输入，不建立第二份对话。原生树和导出原文展示这些证据。cwd/nativeRef和恢复身份不变。

组件评估：已检索官方Prompt Input（https://elements.ai-sdk.dev/components/prompt-input）的工具栏；最终输入投影使用SEARCH-002登记的原生select和lucide图标，选项与默认值见04，不增加独立开关或组件。统一基础输入组件时复核。
