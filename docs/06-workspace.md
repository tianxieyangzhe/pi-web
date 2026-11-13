# 06｜Workspace 首期：项目集合与跨项目会话

## CHANGE-001｜Workspace最新一轮原生编辑差异

Workspace专属事实仅复用所属Pi Session Tree和已有workspace_request/result记录。最新无operation的workspace_request为根请求，runId取其key，边界取entryIds及匹配result.entryIds；operation=steer的记录不新建轮次。GET /api/workspaces/:id/sessions/:sessionId/changes及changes/content?runId=&fileId=先验证workspace_sessions所属workspace_id，其余DTO、匹配、只读和错误遵循03 CHANGE-001；缺少可信边界不猜测。无新增表/字段、文件扫描、正文快照、额度或Pi调用。

UI-057：Workspace会话辅助按钮组恢复至标题栏右侧，与标题同一行，依次为本轮变更、文件检查、会话检查；三个按钮统一采用04定义的共享primary绿色背景，与发送按钮同色；发送按钮使用共享24×24px图标尺寸；共享标准尺寸与长标题省略遵循04 UI-057，不改变模型/API。

“文件检查”旁“本轮变更”复用04浮窗，仅按顺序显示Pi原生edit差异，与文件/会话检查互斥；Session切换清除选择及旧响应，运行中按原规则刷新。跨项目路径按03词法转换为相对所属成员项目根路径，按03的完整projectPath分组，标题与详情仅显示成员项目根目录名，title保留完整路径，组内相对路径单行省略，不同项目同名文件保持独立；文件检查沿用04无横向滚动条高度占位规则；不扫描成员项目或补算bash/write。停止读写旧快照及正文目录；本次按用户明确清理要求删除本地退役目录，不迁移或触及Pi原生记录。验收沿用05并覆盖Workspace归属与steer。状态：代码已实现；`tests/session-file-changes-api.test.cjs` 的Workspace接口场景通过（原生差异、steer、归属、冷打开及边界），浏览器待验收。

MODEL-SWITCH-001：Workspace的PUT S/model成功后沿用原lease及订阅，按返回结果恢复可发送投影并刷新树／上下文／列表，不调用open；主动重开按MCFG-003沿用已保存型号。不新增持久事实、接口或迁移；验收状态见05。

UI-054／055／056：Workspace同步采用04的运行与选中分离、名称旁运行计数、顶部居中通知和Composer单行省略。运行来源为既有GET /api/workspaces/:id/sessions的allowedActions包含interrupt，仅主请求执行时成立；不以open或当前选择推断运行。导航每3秒读取列表的例外仅用于运行投影，页面隐藏暂停、恢复立即刷新，失败显示状态不可用；不请求transcript、不创建lease或Pi句柄，不新增模型／表／API。验收：多个会话同时运行及切换后各自标记正确，收起工作区仍显示数量，停止／完成后下次刷新移除，错误不伪装0；提示与快捷键按04。状态：代码已接入，类型检查与差异检查通过；浏览器多会话与视觉待验收。
UI-053：Workspace复用04会话树标题规则，纯工具调用assistant按toolCall名称显示，thinking等按实际内容类型显示，真正空节点才标无正文；保留全部节点及原父子关系，验收见05。

UI-052：Workspace复用04的空assistant占位规则，尚无内容的实时开始事件不绘制空标头，原始事件仍保留，已结束或历史空消息保留可展开原文；不影响thinking/工具/未知块与错误，验收状态见05。

UI-051：Workspace复用04的会话状态分派修复；session_state只更新运行与等待显示，不进入Pi临时内容列表，真实Pi原文保留。验收及状态见05 UI-051；无Workspace模型/API变化。

UI-049：Workspace采用04连续工具组投影，复用Conversation/Disclosure及01组件评估，保留全部内容、关系和浏览选择。UI-050由RUN-001替代。

## RUN-001｜Workspace单轮统计

WorkspaceSession复用02 RUN-001的统计定义及RUN-002原生用量派生规则、03 RUN-001事件DTO与累加规则、04的单处投影。既有POST S/messages接受新请求后计时，幂等重放不产生新统计；RUN-002：GET S/events同步通用03的进程内快照恢复及messages.latestRunUsage和run_progress，切换回来通过SSE ready.runMetrics恢复耗时及已报告Token，快照按通用03进程共享、不随事件服务重建清除；新根请求替换，结束/关闭保留内存；重启后不恢复耗时。根workspace_request/result复用现有journal增加原生entryIds前后边界，用于原生usage归属（steer不另起轮）；历史记录缺边界返回null，不改写旧数据。沿用归属/lease/忙碌/unknown门禁及错误，统计本次Runtime.send的assistant message_end，工具循环及steer归原轮次；正常/停止/失败收尾只发送一份。GET S/messages同步增加03 RUN-001的tokenUsage累计DTO，复用本次readTree全树数据按02口径累计，包含压缩与非活动分支；空树为0，缺失用量标不完整。RUN-003：页面按04独立显示最后一轮Token、耗时及会话累计，缺失项单独标不可用，不互相隐藏；重开恢复累计及原生最新轮Token，耗时仅原进程内可用，不逐历史轮次展示。取消新增统计文件，不保存统计计数；既有journal仅增加执行边界，无新SQL/原生历史写入或Pi调用，不改写旧记录或迁移；验收及状态见05 RUN-002。


FILE-003：新增GET /api/workspaces/:id/sessions/:sessionId/files/content与files/download，application先从workspace_sessions核验归属并读取nativeRef，复用03会话目录只读契约；不得将Workspace会话文件当作WorkspaceProject文件。无新模型/表/迁移，无Pi调用。点击当前会话文件链接先预览，左上角下载原件。


FILE-002：工作区文件预览同步支持通用03定义的XLSX/PPTX/PDF派生格式，按工作区项目归属读取；PDF仍经同范围download API获取，不新增Workspace模型/表或授权。页面复用文件浮窗与原件下载，验收按05 FILE-002的两类API测试。


IMG-FAIL-001：图片输入不支持沿用03的明确错误分类；Workspace消息已有已知DomainError的failed收尾，保持idle，未确认结束仍保留unknown；不自动修改旧请求证据。

## FILE-001 工作区文件下载与Word预览

GET /api/workspaces/:id/projects/:projectId/files/download?path=相对路径：application先从Workspace读取并校验WorkspaceProject归属，错误NOT_FOUND/404；其余下载头、50MB上限、原始字节及失败契约复用03 FILE-001。GET同路径files/content扩展通用FilePreview与DOCX内容块，取代WSP-016仅UTF-8限制；保留根目录身份与路径边界检查，并统一执行通用敏感路径/真实文件身份校验。只读项目文件，不写三张Workspace表、不调用Pi或模型，不产生新持久对象。已有文件浮窗投影预览及下载按钮，关闭/切换丢弃晚响应；相对链接从默认项目解析，绝对链接仍必须属于工作区项目。


本文是 Workspace专属模型、API、Pi 归属、页面投影及验收的唯一权威。独立项目 Project 与通用 Session 的共有规则引用 `02`；工作区所属项目 WorkspaceProject 的专属事实由本文定义，通用 Pi Tree、订阅、精确恢复、模型切换、手动压缩、派生会话及导出引用 `03`，应用级 Pi 配置来源和代码分层引用 `01`，共享弹窗投影引用 `04`。独立项目模式保持其所属文档定义。

本文只保留当前目标。首期交付不包含 项目说明及其版本管理，相关能力统一列为 §9 后续计划，不作为首期创建、运行或验收的前置条件。工作区 v1.0.0 功能完成，用户已确认提交并标记版本；包含首期模型、API、Tailwind 页面、会话删除和回复文件链接预览。验收证据与适用限制见 §8。后续计划不作为已批准的 API 或 Schema。此前工作区数据升级已按当时授权完成，见 §5.2；功能退役未复用该授权；后续用户另行授权DBUP-002，当前7表结构迁移已完成，Workspace三表逐值保留，结果见05 DBUP-002。

BOT-REMOVE-001：旧协作功能及未来接入计划全部退役，模型与历史数据边界唯一见02；后续用户已授权DBUP-002迁移，Workspace三表全部列值原样保留，完整旧库备份与事务规则见02 §11.2。Workspace仅使用原生Pi Session，不依赖退役服务或工具；验收覆盖当前7表、旧库拒写、原生执行/附件/恢复。

## 1. 已确定的产品定义

SETTINGS-001：工作区配置页面与独立项目设置共享04的主画布布局及保存/取消反馈，继续使用本章已有配置API和幂等键，失败保留草稿，提交中禁用关闭/取消；切换对象后晚响应不重新导航。Workspace无物理删除/归档入口，项目集合和默认项目规则不变。共享交互的定向验收见05 SETTINGS-001：settings-layout-behavior覆盖工作区提交中禁用、失败保留、同载荷重试保持幂等键、未修改不提交及晚响应隔离；workspace-settings-api验证HTTP字段投影。此子项完成不代表WSP-017整体验收。

1. Workspace 是项目集合，包含归属于该工作区的 WorkspaceProject。不同工作区各自的项目、工作区项目与独立项目 Project 均为独立业务记录，各自创建和管理，记录、配置及生命周期互不联动；路径允许重复，不以路径判定项目身份。
2. 每个 Workspace 允许创建多个独立 Session。每个 Session 独占一个 Pi Session，在同一会话中直接跨项目读取、修改代码和验证；Workspace 不派发任务、不生成项目 Session。
3. 在 Workspace 新建会话时，用户指定默认工作目录，目录从项目集合中选取。
4. 首期新建会话只选择默认项目，不选择或绑定 Agent，不加载 Agent.md。
5. 首期保留 Pi 默认编码提示词，补充应用构建的工作区结构体；项目信息仅包含身份、目录派生名称和目录，不包含描述字段，不依赖 Markdown 说明文件。
6. 系统提示词中的工作区结构体声明工作区、默认工作目录及项目信息，字段以 §3 为准。
7. 本文不保存旧设计、旧方案、旧验证记录或归档副本；追溯使用 git 历史。

```text
Workspace ── 项目集合 ── WorkspaceProject *
    └─ Session * ── 每个 Session 独占一个 Pi Session / Pi Tree
           └─ 默认工作目录：从项目集合选取

系统提示词：Pi 默认编码提示词 + Workspace 结构体
```

Workspace 与 Session 是一对多关系。已有会话时仍可创建新的独立会话；每个会话分别选择默认项目，拥有自己的 Pi 身份、原生树与历史。一个 Session 内的跨项目工作不拆分为项目 Session。新建会话不替换其他会话的原生身份，也不清空或删除其历史。

## 2. 模型事实与 Pi 归属

### 2.1 WorkspaceProject：工作区所属项目

WorkspaceProject 是工作区内独立管理的项目记录，保存自身身份、所属 Workspace、真实根目录和排序；是否仍在当前项目集合中由关联记录的存在派生，不新增管理状态列，不定义 description。项目名称由所选目录的最后一级目录名派生，无手工名称字段；服务端从所选目录计算，客户端不能另传名称覆盖。每条记录只属于一个 Workspace；不同 Workspace 不共用项目记录，即使目录相同，也分别拥有项目身份和状态。独立项目 Project 继续由 `02` 定义，工作区项目不与其共用记录，也不通过独立项目 ID 或相同路径建立自动关联。

工作区新增项目直接在当前 Workspace 中登记目录和项目信息，不要求先创建或选择独立项目。独立项目的新增、改名、路径变更、归档及其他配置修改不改变 WorkspaceProject；WorkspaceProject 的新增、路径变更、归档及其他配置修改也不改变独立项目，路径变更后的显示名称仍按最后一级目录名派生。各自的会话与执行配置不自动复制、共享或同步。

WorkspaceProject 不拥有项目 Session 或 Pi transcript；会话归 Workspace，跨项目工作在该会话内完成。知识资料目录也可作为工作区项目登记，不因此生成独立项目。

不同工作区之间，以及工作区项目与独立项目之间，允许根目录完全相同或互相包含。创建、修改、列表读取和运行许可不得因其他工作区或独立项目已登记相同、规范化后相同或重叠路径而拒绝，也不得按路径去重、合并记录、自动建立关联或同步配置。不设置跨工作区或跨模式的 rootPath 唯一约束，不以符号链接解析后的同一真实目录作为跨范围冲突依据。

业务记录独立不等于物理文件自动隔离。指向相同目录时，文件修改会作用于同一份代码；本版不自动复制 checkout，也不声称项目身份独立能隔离磁盘副作用。不得以避免此类副作用为由增加跨工作区或跨模式的路径占用校验、重叠目录门禁或 PROJECT_BUSY 拒绝。会话自身的运行互斥继续按通用契约执行。

### 2.2 Workspace

Workspace 保存自身身份并拥有其工作区项目集合，同时保存列表中选定的默认项目。默认项目必须属于当前 Workspace 的项目集合；对可创建会话的配置，整个集合恰有一个默认项目，单选项不是各项目分别保存的多个独立布尔状态。它不拥有独立于会话的 Pi transcript，也不要求对应一个同名物理目录。

工作区范围以服务端保存的 WorkspaceProject 归属和状态为准，系统提示词不授予目录权限。

每个 Workspace 可以拥有零个或多个 Session；每个工作区 Session 只属于一个 Workspace。首期要求至少一个项目及一个默认项目。配置在工作区没有运行、压缩或待核对请求时条件更新；已有会话的默认项目不得移除或改目录。Workspace 本身首期不提供物理删除或归档；会话允许用户显式删除，见 WSP-015。

### 2.3 Session

SLIST-002同步适用于WorkspaceSessionDTO：返回lastOpenedAt，按02的SessionOpenHistory记录workspace作用域和精确owner/session身份，按03在成功打开颁发lease前记录；与Project相互隔离，无workspace_sessions变更或历史回填。侧栏标题仅用最新用户输入，时间仅用最后打开时间，投影按04。

SLIST-001同步适用于WorkspaceSessionDTO：增加通用02定义的lastUserInput/lastActivityAt/previewUnavailable，只读所属Pi树派生，列表投影与用户气泡右对齐复用04规则，不写workspace_sessions或purpose。

SCONN-001同样适用于Workspace：公共会话只暴露status=open|closed，来源为连接租约；不暴露内部state/历史endedAt。历史ended_at不限制重新打开同一Pi会话，新关闭不调用Repository.end或写SQL。事件ready提供订阅时运行快照；回答、压缩与恢复反馈使用SSE和事件触发的读取，不轮询。旧end作为关闭兼容入口，DELETE实际移除workspace_sessions记录。当前许可按本段及通用02/03连接契约；不改变默认目录、身份、journal或数据库结构。

Session 是属于 Workspace 的一次独立持续对话，独占一个 Pi AgentSession/SessionManager 和一棵原生树。同一个 Session 中的所有项目读取、修改、命令执行和验证都由这个 Pi Session 完成并记录；不同 Session 的原生身份、树与历史分别独立。

新建会话以 Workspace 已选默认项目作为默认工作目录选择；用户如选择其他项目，仍须属于当前 Workspace。创建输入只表达该会话默认工作目录对应的 WorkspaceProject。首期不接收 Agent、说明版本或提示词生效方式参数；工作区 Session 不绑定独立项目角色，不读取其快照作为指导。独立项目原有 Agent 功能保持所属契约，不因本期范围收敛而删除或改写。

默认目录必须来自当前 Workspace 的项目集合，并由服务端读取 WorkspaceProject.rootPath。客户端不通过自由输入绝对路径替代项目选择。默认项目的语义字段定为 `defaultProjectId`，正式创建 API 见 §6。

Pi 初始 cwd 为选定项目根目录。访问其他项目时显式定位目标项目，不为该项目另建 Session。Session 的 workspaceId、defaultProjectId 及已建立 nativeRef 固定，不允许更换；目录配置不得使已建立会话静默换 cwd。已有 Pi 原生身份继续按 `03` 精确恢复，不根据页面选择或最近目录换树。

工作区会话仅持久化于 workspace_sessions，不绑定独立记忆。会话元数据和原生树属于该会话自身，不借独立项目 sessions 承载；持久名称保留purpose；侧栏按SLIST-001/002投影最新用户输入与最后打开时间，无输入时显示新会话。

## 3. 系统提示词中的工作区结构体：已定契约

### 3.1 适用规则

首期保留 Pi 默认编码提示词，应用实际读取 Workspace 和其所属 WorkspaceProject 记录构建工作区结构体，补充到系统提示词中，让模型知道当前 Workspace、项目集合以及默认工作目录。项目名称取目录最后一级目录名，项目信息不含 description，不保留 null 占位，也不从 Agent.md、独立 Agent 库 取得补充指导。关闭隐式项目说明文件加载，避免 SDK 自动将 Agent.md/AGENTS.md 装配进系统提示词；模型按用户任务显式读取仓库文档仍属于正常工具操作。

工作区结构体只来源于当前Workspace和WorkspaceProject。

目录字段统一使用 `cwd`，表示 current working directory，即工作目录。本版不定义 `cmd` 或启动、构建、验证命令字段；需要时另行明确其模型来源和契约。

结构体是数据库事实的运行时投影，不是新的持久模型，也不是工具授权依据。

### 3.2 结构与字段

以下 XML 的字段和层级已定，示例值仅说明格式，不是实际项目事实。该结构用于系统提示词，不等于对外 API DTO 或 SQL Schema：

```xml
<workspace id="workspace-example" name="示例工作区">
  <defaultProjectId>project-a</defaultProjectId>
  <cwd>/example/project-a</cwd>
  <projects>
    <project id="project-a" name="project-a">
      <cwd>/example/project-a</cwd>
    </project>
    <project id="project-b" name="project-b">
      <cwd>/example/project-b</cwd>
    </project>
  </projects>
</workspace>
```

字段语义：

| 字段 | 来源与含义 |
| --- | --- |
| workspace.id / name | 当前工作区真实记录 |
| defaultProjectId | 创建会话时选择的 WorkspaceProject.id，不是独立项目 Project.id |
| workspace.cwd | 默认 WorkspaceProject.rootPath 的运行时投影 |
| projects | 当前工作区内允许参与本轮工作的项目清单 |
| projects[].id | 当前 Workspace 所属 WorkspaceProject 身份 |
| projects[].name | 项目所选目录最后一级目录名，由服务端派生，不接收手工名称 |
| projects[].cwd | WorkspaceProject.rootPath 的运行时投影，明确每个项目的位置 |

这里的 `cwd` 只是在模型输入里展示目录，不新增数据库 cwd 列。结构体中的字符串必须正确序列化，目录及其派生名称不能逃逸结构边界。XML 文本与属性统一转义 &、<、>、双引号和单引号；项目按 ID 排序，容量按转义后的 XML UTF-8 字节计算。

### 3.3 首期装配规则

Pi DefaultResourceLoader 保留默认提示词，使用 appendSystemPrompt 添加带来源标签的 XML 工作区结构体及原生工具路径说明，关闭隐式资源发现。定位规则单独放在 <project_resolution> 标签中，明确先按用户提到的项目名称匹配 <projects> 中的项目，再以对应 <cwd> 为检索起点。结构体 projects 是当前完整项目清单，workspace.cwd 仅表示默认目录，不缩小 projects 范围；项目定位直接采用 projects[].cwd，不从知识库、README 或历史工具结果反推。历史 workspace_* 调用记录仅是旧记录，提示词明确旧工具已退役，项目编码工具为 read/bash/edit/write；可选联网工具以本轮实际声明为准（SEARCH-002），不得把联网工具当作本地项目检索入口。保留历史原文，不注册兼容工具或把错误调用重定向为原生工具。每次根请求在会话互斥内重读本工作区配置；空闲句柄配置变化时释放并按精确 nativeRef 恢复，不更换树。工具循环固定使用本轮配置。

结构体上限 64KiB UTF-8，消息正文上限 32KiB；项目数组最多 32 项，按项目 ID 排序。超限返回 WORKSPACE_CONTEXT_TOO_LARGE，不截断项目。模型装配遵循 `01` 的应用级 Pi 配置及当前 Session 模型选择，自动压缩按03 PSES-021开启，使用Pi默认参数及原生溢出恢复；最终仍失败才返回CONTEXT_LIMIT_REACHED，应用不重发。

工作区结构体不通过 `workspace_context` custom message 替代系统提示词。本期不定义 Agent.md 格式或说明文件预算。当前 Pi 在模型请求的 role=system 消息中传递系统提示词，不要求 context.systemPrompt 字段有值，也不把它作为普通消息写入原生会话文件；原生树缺少系统提示词节点不能作为未注入的证据。项目集合直接取系统提示词中的结构体，不通过工具或读取磁盘发现集合。Workspace Runtime 不注册任何 workspace_* 工具；请求幂等和恢复记账保存于应用独立 journal，不追加 Pi custom 节点，不转换为模型消息；旧的请求记账 custom 节点只读兼容，原文仍按完整树规则展示。

## 4. Pi 原生编码工具

Workspace 会话默认使用 Pi SDK 原生 read、bash、edit、write，沿用原生参数、返回值和执行行为；用户本轮显式开启时额外装配SEARCH-002工具搜索。不注册任何 workspace_* 或 project_* 工具，不自动启用工作区专属 codemode 扩展。项目集合只通过系统提示词的结构体提供，不提供模型查询项目清单的工具。

Pi cwd 固定为会话默认项目目录；原生工具相对路径从该目录解析，跨项目使用结构体提供的绝对路径，bash 可按用户意图在目标目录执行命令。工具访问采用可信单用户宿主的进程权限，不声称 cwd 或项目清单提供文件系统沙箱，不建立自定义多目录权限层、跨项目路径锁或命令拒绝占位工具。执行修改遵循用户意图。

应用 API 仍校验 Workspace/Session 归属；附件目录浏览和文件引用 API 仍校验项目及真实路径，只属于页面附件选择，不注册为模型工具。PSES-024：Workspace项目参考由服务端按该WorkspaceProject.rootPath生成位置，沿用03位置描述与按需读取契约；提示模型用现有Pi原生read/bash读取当前文件，不注入文件全文。REF-REMOVE-001已由BOT-REMOVE-001整体退役覆盖，旧验收以git历史为准；只保留Project/Workspace位置引用与上传附件能力。原生消息、工具参数、结果、thinking 和所有分支完整投影到所属 Session 的唯一 Pi Tree，不生成项目子会话。

## 5. 持久化设计边界

首期需表达的独立持久事实为：Workspace 身份、WorkspaceProject 身份及其 Workspace 归属、Workspace 与多个独立 Session 的归属关系、工作区选定的默认项目，以及各会话的默认项目。工作区默认项目用于新建会话的初始选择，配置变化不自动改写已有会话的 cwd 或原生身份。项目说明和版本关系不进入首期模型，不预建相关字段或表。

Workspace/WorkspaceProject 为一对多外键归属关系；不同工作区的项目身份独立，不跨工作区复用记录，不按路径判定身份或设置跨模式唯一约束。Workspace/Session 为一对多关系，每个 Session 独占 Pi 身份。目标工作区使用 workspaces、workspace_projects、workspace_sessions 三张表，不复用独立项目 sessions 的 Project 外键。

workspaces 保存 id/name/default_project_id、创建幂等键及载荷摘要、时间；workspace_projects 保存 id/workspace_id/root_path 和排序 ordinal，名称实时派生，无描述；workspace_sessions 保存 id/workspace_id/default_project_id/purpose/native_ref_json/ended_at、创建幂等键及摘要、时间。默认项目使用组合外键约束同 Workspace，会话的归属、default_project_id、创建身份及已建立 nativeRef 不可替换；工作区的默认项允许按 §6 条件更新，不能将会话不变约束套到 workspaces.default_project_id。所有历史外键 ON DELETE RESTRICT。运行状态在进程内，未确认请求由独立 WorkspaceRequestJournal 派生，不新增运行状态列。

工作区表数量保持三张；全局退役表及数量变化见 02“表数量与模型可读性”，本文只定义工作区专属映射：workspace_sessions 删除 session_memory_id、相关唯一/组合外键及身份触发器中的旧绑定检查；目标创建、派生和删除只写 workspace_sessions。会话 ID、workspace_id、default_project_id、purpose、时间、创建幂等事实及 native_ref_json 原值保留，不创建新归属或替代摘要。旧必填绑定未处理时阻止写入并返回 SCHEMA_INCOMPATIBLE，不为兼容结构生成占位记录。

磁盘历史数据不在本次源码退役中删除或转换，不拼接 Pi 历史。全新空库使用目标 Schema，旧库不在应用启动时执行 DDL；历史表清理、归档及迁移须单独决定。

### 5.1 请求记账与 Pi 对话隔离

WorkspaceRequestJournal 是每个工作区 Session 的应用请求证据，不是对话或工具结果。它固定对应同一 Session ID、Workspace ID、Pi 原生 Session ID 与文件，位于原生 sessionFile 旁的 .workspace-requests.jsonl 文件；只存版本、归属身份、记录 ID、时间、type 和 data（请求 key、载荷 hash、可选 outcome，以及模型切换的可选 operation 标识），不存正文、项目配置、thinking 或工具内容。每条记录追加后 fsync，再调用 prompt；可靠结束后追加结果。无文件表示尚未有新请求，损坏、部分行或身份不符返回 REQUEST_UNKNOWN，禁止自动重发，不静默重建。

原生旧请求节点按追加顺序只读合并在 journal 前供恢复判定；不迁移、删除或过滤已有 Pi 节点。新发送、结束回执及 acknowledge 均只追加 journal，不能调用 Pi appendCustomEntry。冷读按精确 nativeRef 读取原生旧证据与 journal，不启动 Runtime、不修改原生文件。该对象不拥有 Pi transcript，不新增 SQL 表，不触发历史库迁移；与 Pi 文件一同备份。Pi 正常消息与工具调用/结果仍由唯一 Pi Session 原生持久化，页面不拿应用记账冒充对话或工具结果。

### 5.2 历史升级与本轮退役

此前工作区存储升级已经完成，完整性和外键检查当时通过；升级前备份为 .data/ai-workspace-v5.sqlite.pre-workspace-2026-11-04T09-13-56-710Z.bak。该记录仅证明当时授权及执行结果，不保留旧目标 Schema 作为当前契约，也不授权本次退役迁移。

本轮不执行脚本或改写用户库。用户可暂缓升级，保留原库与只读历史；或另行授权先备份、导出退役数据及旧关联，再按 02 的全局映射和本节工作区映射执行显式迁移。迁移须保留工作区、项目、会话、原生身份、请求 journal 及其他历史，事务失败回滚，不能重建数据库或改写 Pi 文件绕过。连接占用检查和不操作用户服务启停的边界继续适用。

## 6. 首期 API 契约

工作区客户端请求键的 HTTP 兼容生成沿用 03 的 OPS-004；表单修改后换键、同一提交重试复用原键的规则保持不变，不改变工作区持久模型或 Pi 身份。

以下为首期正式契约，路径相对 /api。成功 {data:...}，错误沿用通用 error envelope；可信单用户长驻部署沿用 `03`。读操作 no-store，无模型调用。创建 POST 要求 Idempotency-Key，同键同载荷返回相同记录、异载荷 409；配置 PUT 要求 If-Match。未知字段拒绝。

| 用户意图 | 应读取或改变的模型 | Pi 边界 |
| --- | --- | --- |
| 管理 Workspace 与项目集合 | Workspace 及其所属 WorkspaceProject、默认项目；目录由目录选择器提交，名称由服务端派生，不接收项目 name/description；默认项目须属于本次保存的集合 | 不调用 Pi，项目集合与默认项目须在同一事务保存，不读写独立项目作为集合成员 |
| 在 Workspace 新建独立会话，可多次创建 | Workspace、默认 WorkspaceProject、工作区 Session | 创建业务记录不调用 prompt；原生初始化时机沿用通用流程并补专属契约 |
| 打开或恢复会话 | 指定 Session 与其精确 nativeRef | 只创建或恢复该会话的唯一句柄，不派生项目 Session |
| 发送用户消息 | Workspace 项目事实与默认目录 | 保留 Pi 默认编码提示词并补充工作区结构体，再调用该 Session 独占的 Pi prompt；不加载 Agent.md |
| 查看、纠正、停止和恢复 | 同一 Session 的原生证据 | 复用通用 Tree、abort、检查与恢复能力；运行中纠正按WSP-020调用steer |

| 方法/路径 | 输入与返回 | 事务、许可和副作用 |
| --- | --- | --- |
| GET /workspaces；GET /workspaces/:id | WorkspaceDTO（id/name/defaultProjectId/projects/writeETag） | 只读本范围；旧库不伪装空列表 |
| POST /workspaces | name、projects[{rootPath}]、defaultProjectIndex → WorkspaceDTO | 1..32 项、名称 1..120 字；服务端检查所选项为可访问目录，不查询其他范围路径；同事务插入工作区/项目并绑定默认项 |
| PUT /workspaces/:id | name、projects[{id?,rootPath}]、defaultProjectIndex → WorkspaceDTO | If-Match；整组保存，受引用默认目录固定；无运行/压缩/unknown 才允许，不同步其他范围 |
| GET /workspaces/directories?path= | DirectoryDTO（path/parent/directories[{name,path}]） | 仅目录元数据，不读文件；缺省为服务 cwd；可信部署边界，不授予模型权限 |
| GET/POST /workspaces/:id/sessions | POST defaultProjectId?、purpose? → WorkspaceSessionDTO | 默认选工作区默认项，同事务只创建 Session，重复创建返回同一记录；GET 返回本工作区会话 |
| GET /workspaces/:id/sessions/:sid | WorkspaceSessionDTO（id/workspaceId/defaultProjectId/purpose/status/allowedActions） | 核验精确工作区归属，不下发 nativeRef |
| POST S/runtime/open、pong、close；GET S/events | 沿用 `03` 租约与订阅 DTO；open 允许无正文、零字节请求流或 {}，pong/close 仍要求各自参数 | 复用 SessionPresence/SessionEvents；后台请求持有使用权，断线不重发 |
| GET/POST S/messages | GET 完整 Tree；POST content、references? → 202 accepted | 有效 lease；正文不改写，附件格式及跨轮上下文按03 PSES-006/PSES-022，项目位置参考按PSES-024，非图片上传按PSES-025，客户端租约失效恢复按03 PSES-026，项目引用限本 Workspace；messages遇会话busy返回409；运行中纠正使用WSP-020的steer入口 |
| POST S/interrupt、restore、end | 无业务正文（无正文、零字节请求流或 {}）→ SessionDTO | interrupt 调用 abort 并等待；restore 只恢复可确定失败状态，unknown 先核对；end 仅空闲，保留历史 |
| GET S/context；POST S/compact、compact/cancel | 通用 NativeContextInspection | 此API为手动入口，压缩与消息互斥；自动压缩按03 PSES-021由唯一Pi会话执行 |
| POST S/recover | action=inspect/acknowledge-unknown | 检查请求 journal 及只读旧证据；用户承认未知时写 journal 回执，再解除本会话门禁，不重发旧输入 |

无业务正文的操作按实际读取的字节数判断空请求，不能依据 request.body 是否存在；零字节等价 {}，非空正文必须是合法 JSON 对象且不含未知字段。仅空白、损坏 JSON、数组、null 仍返回 INVALID_JSON，正文容量限制不变；创建、消息及其他必填正文接口继续拒绝空正文。

S=/workspaces/:id/sessions/:sid。配置 JSON ≤64KiB，目录元数据 ≤2000 子项，purpose ≤500 字符。保存前文件检查在事务外，最终归属/ETag/幂等与 SQL 写入在同一短事务。输出字段来自本范围记录或 Pi 原生证据，工具和 Tree 保留全部原文，不下发原生文件路径或句柄。

消息在 prompt 前向独立 journal 写 workspace_request 准备证据（键、摘要、不含正文），可靠结束后写 workspace_request_result，不追加 Pi custom 节点。重启或异常留下未决准备记录则为 unknown，不重复 prompt；相同键返回已接受回执。所有入口先核验 session.workspaceId；unknown 阻止消息、结束及配置写入，允许读历史与显式核对。失败保留已发生文件副作用。没有准备证据前失败不视为已接受。错误包括 INVALID_INPUT/400、NOT_FOUND/404、PRECONDITION_REQUIRED/428、WRITE_CONFLICT/409、IDEMPOTENCY_CONFLICT/409、SESSION_BUSY/409、REQUEST_UNKNOWN/409、SCHEMA_INCOMPATIBLE/409、PATH_OUTSIDE_WORKSPACE/403。

模型工具沿用 Pi 原生参数；相对路径对应会话 cwd，跨项目使用系统提示词中的绝对路径。不把项目 ID 作为自定义工具参数。

## 7. 页面投影与代码职责

共享同步：UI-048工具结果折叠与跨实时/历史同步的浏览状态沿用04，复用同一Conversation，无新增Workspace模型或API，验收状态见05。UI-047 thinking空正文提示和完整原始块展开沿用04及05，复用同一Conversation，不新增API。UI-046方向键用户输入回填复用04的交互及05的验收要求，数据仅来自当前Workspace Session已有GET messages全树快照，浏览位置与草稿不跨会话混用，不新增Workspace API或持久模型；状态随05记录。PSES-021自动压缩和UI-045会话滚动按01～05实施与验收，Workspace无关闭自动压缩的独立配置。历史Bot Runtime也采用Pi默认压缩参数，不扩展旧Bot产品范围。

PSES-010共享粘贴行为同步：工作区Composer无文件项的粘贴文字超过10行显示可展开/移除的“已粘贴 N 行”正文块，10行及以内直接显示；均随完整content发送，复制保留原文，不转附件或占附件额度；图片/真实文件仍按既有上传附件处理。通用入参映射见03、投影见04，不新增Workspace模型或API，不改写历史附件。

首期 UI 同步范围明确包括左侧导航的列表展示、选择与切换，以及中间会话区域。Workspace 与 Project 在这些通用部分复用组件、布局、样式及交互；后续通用 UI 调整须同步适用于两种会话入口。Workspace 的新增页面及创建业务流程独立定义，不属于与现有 Project 新增页面同步的范围。

| 区域 | 同步与复用要求 | Workspace 的数据差异 |
| --- | --- | --- |
| 左侧导航 | 复用分区、条目、展开/收起、会话列表、选中态与切换交互；新增入口进入 Workspace 自己的创建流程 | 按 Workspace 展示其所属 Session；Project 导航继续展示独立项目 Session，不重复列出 Workspace Session |
| 会话区域 | 复用完整 Pi Tree、消息、thinking、工具展示、输入框、流式反馈、错误与恢复反馈，以及停止、文件弹窗、会话检查的树标题导航与 Session 设置 | 读取选中 Workspace Session 的 DTO、原生树及事件，动作调用其所属 API；模型切换、派生与导出映射见 WSP-017，跨项目工具操作展示目标项目身份 |

Workspace 的新增页面主体是项目列表，每行展示所选目录、由最后一级目录名派生的项目名称，以及“默认项目”单选按钮；全部行属于同一单选组。新增与设置页的路径输入统一放在“添加项目目录”弹窗，主页面不另放路径输入框。弹窗提供绝对路径输入框，按 Enter 或点击“跳转”调用既有 GET /workspaces/directories?path=，成功后显示服务端返回的规范目录及子目录，再点击“选择此目录”添加；请求失败显示错误并保留输入，不误选此前目录。不从独立项目列表选择，不提供项目名称输入框或描述字段。路径在保存时沿用 POST/PUT 的服务端真实目录校验；失败保留列表并显示 API 错误。更新请求只提交 name、defaultProjectIndex 及 projects[{id?,rootPath}]，不回传读取 DTO 的 workspaceId、项目 name、时间或 writeETag；条件凭据通过 If-Match 传递。列表的目录和默认项选择提交为工作区项目集合及其默认项目，由服务端派生名称并校验默认项归属，不执行跨工作区或跨模式路径去重。

Workspace 的新增页面按 Workspace 自身的模型和 API 定义，不以现有 Project 的新增页面、表单字段、会话创建流程或资源配置作为业务依据。新建工作区与在工作区中新建会话是各自明确的用户意图，不通过既有项目创建流程代办，也不顺带创建项目 Session。

工作区新增项目直接管理当前 Workspace 的 WorkspaceProject，不从独立项目列表选取或建立绑定。左侧工作区项目列表与独立项目列表各自展示所属 API 数据，编辑和刷新不改变另一侧记录。

工作区新建会话时，预选项目列表中指定的默认项目，目录选择仍限于其 WorkspaceProject 集合；首期不提供 Agent.md、说明版本或生效方式选择。通用展示组件可复用，创建入参、许可、事务和返回值必须由 Workspace API 自身定义。

Workspace 导航允许列出并选择多个独立 Session；当前选中 Session 展示一个会话画布及其唯一 Pi Tree，切换会话时展示对应的独立历史。所有左侧按钮和实际会话身份变化按 `04` 先关闭现有弹窗；文件与会话检查使用04定义的等高非模态浮窗，标题栏支持指针拖动及键盘移动，复用AuxiliaryDialog的位置边界和生命周期；保持Composer和左侧可交互，左侧任意单击关闭浮窗，不为主会话保留辅助右侧列。跨项目操作展示目标项目，不生成项目会话标签或子会话。首期不新增Agent.md 管理入口，页面只能投影已定义 API 的真实结果。

会话树复用04的Pi TUI样式投影（分叉连线、平齐单链、选中游标与活动路径），不改变工作区API或Pi分支。会话区移除打开/关闭文字和开闭按钮；会话检查入口、设置容器、Session信息和模型/上下文统一复用04的投影；“会话树”和“Session 设置”为选项卡，不呈现操作按钮外观。Session设置移除助手分区，名称与更换仅投影Composer引用入口；模型运行忙碌原因按04显示自然语言而非SESSION_BUSY。Session设置不展示“待核对操作”及核对/承认未知入口，不删除既有recover API、journal或unknown门禁，不自动重放或解除阻塞。

共享组件通过 DTO 和 API 适配接入两种会话，不在组件中推导归属、目录权限或第二份运行状态。服务端差异包括会话归属、默认 cwd、Pi 原生工具 cwd，以及系统提示词中的 Workspace 结构体。

新增 UI 使用 Tailwind CSS。已检索官方 AI Elements File Tree（https://elements.ai-sdk.dev/components/file-tree）；它可表达目录树，但不提供服务端目录选择、工作区项目列表或默认项目单选的业务流程；本期用 Tailwind 列表、原生 radio 和目录选择器 Feature Wrapper，官方支持对应受控选择流程或项目引入配套组件体系时复核。会话复用已有 Conversation/PromptInput/上下文检查，不复制消息渲染。新建工作区使用主画布项目列表，页面只显示当前Workspace及Session API；磁盘历史文件保留。Workspace 用例、数据库、Pi 装配及页面分别遵守 application/domain/ports/infrastructure/web 的依赖方向，route/page 只做入口装配。

## 8. 需求与验收状态

v1.0.0 提交复核：tests/workspace-model.test.cjs、tests/workspace-storage-migration.test.cjs、tests/workspace-session-api.test.cjs、tests/workspace-settings-api.test.cjs、tests/workspace-empty-body-api.test.cjs、tests/workspace-request-journal.test.cjs、tests/workspace-context.test.cjs、tests/workspace-runtime.test.cjs、tests/workspace-tools.test.cjs、tests/workspace-selection.test.cjs、tests/session-deletion.test.cjs、tests/file-link-preview.test.cjs、tests/markdown-response.test.cjs 共 32 项通过；npm run typecheck 和 git diff --check 通过。全部使用临时数据库/目录、受控流或 DOM，不操作用户服务和数据库，不调用真实模型，不执行全量测试或生产构建。

工作区 v1.0.0 是此前已确认的交付基线，Git 标签 workspace-v1.0.0；不覆盖本轮应用记忆退役与会话检查整改。范围包括独立项目集合、多会话各自独占 Pi、XML 系统上下文、Pi 原生工具、请求 journal、会话删除及源码链接预览；历史库曾按 §5.2 的旧目标升级，新退役结构已按另行授权的DBUP-002迁移。用户现场确认 Markdown 渲染及部分模型采用工作区定义的效果；DeepSeek/GLM 的项目定位遵循效果仍有差异，保留当前 XML 方案。下表中的“浏览器未验收/真实模型未验收”表示未由自动化测试覆盖，不撤销本次用户确认；未运行生产构建或全量测试。§9所列退役计划不属于当前功能。

| ID | 已确认目标与验收方向 | 状态 |
| --- | --- | --- |
| WSP-001 | Workspace 显式表达所属 WorkspaceProject 集合；不同工作区的项目及独立 Project 均使用独立记录，各自创建、修改和归档，互不联动；项目位置来自工作区项目真实记录 | 模型/API 已接入，临时库归属与独立配置验证通过；首期不开放归档 |
| WSP-002 | 每个 Workspace 可创建多个独立 Session；每个 Session 独占一个 Pi，并在该会话内跨项目修改代码；无派发或生成项目 Session，新建不替换其他会话历史 | 已接入；多会话与 Pi 精确恢复、跨项目工具定向验证通过；真实模型未验收 |
| WSP-003 | 新增与设置页为项目列表，路径输入统一在添加目录弹窗，支持输入路径后 Enter/跳转，并在验证成功后选择；保存时服务端验证目录；名称取最后一级目录名，无名称输入和描述字段；列表默认项目为单选且属于本次保存的集合，新建会话预选该项目，既有会话不随默认项变化改写 cwd | Tailwind 页面与条件保存已接入；派生名称、默认项归属及不可变 cwd 定向验证通过；浏览器未验收 |
| WSP-006 | 保留 Pi 默认编码提示词，补充 §3 XML 工作区结构体，字段取真实记录；不加载 Agent.md或独立角色指导，缺少这些资源不阻止创建和运行 | tests/workspace-context.test.cjs 与 tests/workspace-runtime.test.cjs 共 4 项通过：XML 项目清单、定位规则、转义与容量、旧会话恢复后的 OpenAI system payload；真实模型效果未验收 |
| WSP-007 | 单 Pi 使用原生 read/bash/edit/write 跨项目操作，相对路径取会话 cwd，跨项目取系统提示词中的绝对路径；无自定义项目工具或跨范围路径锁 | 原生工具与提示词装配按 §4 实现，定向验收见下方记录 |
| WSP-008 | Pi Tree 保留全部分支和原文；工作区会话不借独立项目记录承载归属，不读写独立项目会话 | 专属归属和完整树读取已接入；本次解除退役绑定待 WSP-018 验收 |
| WSP-009 | 本文只保留当前定义，旧设计不作为正文或归档副本保留 | 本次文档已更新；未代表功能验收 |
| WSP-013 | 首期左侧列表导航和会话区域与 Project 同步复用通用展示及交互；Workspace 新增页面和创建流程独立定义，不沿用 Project 创建业务；归属、数据和动作来自各自 API，切换时不混入其他 Session 的历史或事件，Workspace Session 不重复列入独立项目导航 | 共用会话组件、输入与 Pi Tree 已接入；Workspace 选择隔离测试通过；浏览器未验收 |
| WSP-014 | 不同工作区之间、工作区与独立项目之间可登记相同或重叠根目录；不跨范围去重、合并、同步或判定路径占用，不以其他范围的相同路径运行产生 PROJECT_BUSY；验证两个工作区的项目配置分别修改且互不联动 | 相同目录的工作区及独立项目记录并存、配置独立测试通过；未设置跨范围路径锁 |

首期验收不依赖 Agent.md 的实现、格式讨论及版本策略。当前定向验证文件为 tests/workspace-model.test.cjs（归属、事务、重复路径及旧库门禁）、tests/workspace-session-api.test.cjs（HTTP、租约、幂等与 unknown）、tests/workspace-tools.test.cjs（仅附件 API 的路径校验）、tests/workspace-context.test.cjs（Pi 系统提示词）、tests/workspace-runtime.test.cjs（实际 Runtime 工具装配、精确恢复、完整分支和只读来源）以及 tests/workspace-selection.test.cjs（独立 Project 选择隔离）。这些文件分别验证当前所属契约，不将此前工具实现的结果作为原生工具验收。共享边界复查 tests/project-session-optional-role.test.cjs、tests/project-session-tree.test.cjs、tests/message-references-composer.test.cjs 等既有定向测试通过；npm run typecheck 与 git diff --check 通过。全部使用临时内存库、目录和受控 Pi；未调用真实模型、未运行服务或改写用户库。退役页面、导航与服务端功能已移除，磁盘历史数据保留。应用启动只对空库初始化；缺少目标结构的已有库返回 SCHEMA_INCOMPATIBLE。本地库此前按 §5.2 的旧授权升级；本轮目标结构仍须另行决定，不能视为已经兼容。共享模型、DTO、幂等与恢复缺项按 05 §15 跟踪；工作区专属文件列表 API、writeETag 的生成/变更范围、WorkspaceProjectDTO 和 recover 的完整返回/恢复条件仍须在本文补齐，补齐前不视为设计闭合。

设置更新的请求字段回归由 tests/workspace-settings-api.test.cjs 验证：读取完整 WorkspaceDTO 后通过客户端更新名称和默认项目成功，项目身份保持不变；客户端只发送允许的写字段，服务端仍拒绝直接提交只读字段。该定向测试、修改页 TSX 语法检查与差异检查通过；未操作用户数据库或启动服务。

空正文兼容验证由 tests/workspace-empty-body-api.test.cjs 覆盖：runtime/open 接受无正文、零字节流和 {}，interrupt 接受零字节流；损坏 JSON、未知字段及容量超限仍拒绝，消息接口保持正文必填。该文件与 tests/workspace-session-api.test.cjs 共 5 项测试、类型检查和差异检查通过，使用内存库及受控 Runtime，未操作用户会话或数据库。

原生工具与系统提示词验收：tests/workspace-runtime.test.cjs 用实际 Runtime 和受控模型流验证注册表中只有 Pi 原生 read/bash/edit/write，不包含 workspace_*、project_* 或 codemode；先按默认 cwd 相对路径读取，再用第二个项目绝对路径创建、编辑、读取文件，并执行 bash pwd 验证 cwd。恢复与工作区改名后 role=system 均包含当前结构体，普通消息不含结构体或请求记账。tests/workspace-context.test.cjs 验证默认指导和项目结构；tests/workspace-tools.test.cjs 只验证附件 API 路径检查，不向模型注册工具。旧会话验证由 tests/workspace-runtime.test.cjs 先写入旧 system 工具声明和 workspace_* 调用历史，再精确恢复，检查 OpenAI Chat Completions onPayload 转换后的 messages/tools：system 包含当前全部项目绝对路径，tools 仅包含原生工具，历史原文仍保留；onPayload 截止，不发送网络请求。该测试与 tests/workspace-context.test.cjs 在 XML 格式下共 4 项通过，覆盖项目按 ID 排序、数据转义防止越出标签、转义后的容量限制，以及实际 OpenAI payload 包含当前完整 XML，git diff --check 通过。另对现场会话只读重放得到的 OpenAI payload 核实：全部 5 个项目路径在 system 中，当前 tools 仅原生四个；最新 workspace_list 尝试返回 Tool workspace_list not found，不属于仍注册或成功执行。此核查不证明真实模型一定遵循项目定位指令。三个文件共 4 项测试及类型检查通过，均使用临时目录、Pi 文件和受控流，不调用真实模型、不操作用户数据库、项目或历史。

请求记账隔离由 tests/workspace-request-journal.test.cjs（落盘、身份一致性、损坏拒绝）、tests/workspace-runtime.test.cjs（新记账不产生 custom 节点、真实工具调用与结果入树、旧节点只读兼容及冷恢复）和 tests/workspace-session-api.test.cjs（幂等、unknown、结束回执写入失败不假报确定结果）共 7 项验证通过；类型检查与差异检查通过。没有改写现场数据库或 Pi 历史，既有 custom 节点继续原文保留；新版本 Runtime 加载后才停止追加应用回执节点。

## 9. 已退役计划

WSP-004、WSP-005、WSP-011、WSP-012随旧协作模型整体退役，不保留接入路线；WSP-010若需实施须独立定义项目说明模型及API，当前没有实现授权。旧结论以git历史为准。

## WSP-015｜用户删除工作区会话

Next 工作区 catch-all 路由显式导出 DELETE；tests/session-deletion.test.cjs 通过该入口验证请求转发与删除，共 6 项通过，git diff --check 通过。现场只读 OPTIONS 检查的 Allow 已包含 DELETE；未对现场会话发送删除请求。

每个工作区会话行提供相邻的删除按钮；确认提示会话移除，磁盘 Pi 历史保留。DELETE /api/workspaces/:id/sessions/:sid 无正文或幂等键，调用方为导航，服务端校验同 Workspace，成功 {data:{deleted:true,sessionId}}，不存在或跨工作区 NOT_FOUND/404，重复删除 404。

DEL-001：用户确认删除会话拥有最高操作优先级。已校验归属后在首次await前建立删除门禁；打开、运行、压缩、模型不可用或journal未知/损坏均不作为拒绝删除条件。不新增持久状态或表。先阻止目标会话的新操作，终止prompt/工具循环及自动或手动压缩，等待正在初始化、配置修改和其他已接受操作收尾，再释放句柄并在短事务中删除本会话行。DELETE保持请求等待，完成前不返回202或成功；并发同会话DELETE共用同一结果，完成后再次DELETE为404。停止/释放或SQL失败如实报错并保留会话记录，解除删除门禁，不伪造成功；不强行丢弃运行句柄、不伪造未知操作成功，不改写/删除原生历史、journal、附件或项目文件。目标会话其余新操作在删除期间返回SESSION_BUSY/409；页面确认后全局阻止点击、输入和导航直到请求结束，成功后移除记录并退出已删会话，失败解除屏障并显示错误。 Workspace使用相同DEL-001验收：只DELETE workspace_sessions指定id/workspace_id行，禁止修改Workspace、WorkspaceProject、其他会话或nativeRef；实际FK错误SESSION_REFERENCED并回滚。成功清理租约和临时状态，配置保存必须在提交前复核删除门禁，删除不等待用户核对journal。

页面成功后移除条目，删除当前会话时回到所属工作区；失败保留条目和当前选择并显示 API 错误。按钮复用现有原生按钮及 lucide Trash2，不新增组件。DEL-001当前验证：tests/session-deletion.test.cjs共12项通过，覆盖本节优先删除、取消等待、并发复用、失败与数据保留；详情见05 DEL-001。浏览器进度屏障待实机验收。状态：以下为既有删除能力的历史验证，不证明本轮解除绑定、单行删除或旧库门禁完成；新事务与退役边界须按 WSP-018 重新验收。tests/session-deletion.test.cjs 覆盖 HTTP 归属/未知字段、空与 ended 删除、运行/unknown/压缩拒绝、并发打开拦截、释放失败与 FK 事务回滚、租约清理及 Pi/journal/项目文件保留；结合 tests/workspace-session-api.test.cjs、tests/project-session-lifecycle.test.cjs、tests/session-presence.test.cjs 共 12 项通过，类型检查和差异检查通过。只使用临时数据库/目录和受控 Runtime，未操作用户库或服务；浏览器未验收。

## WFILE-001｜工作区文件检查

会话工具栏在“会话检查”左侧增加“文件检查”，使用既有非模态AuxiliaryDialog，与会话检查和回复文件预览互斥，左侧任意单击、关闭、Esc或切换会话关闭。按当前Workspace.projects顺序在浮窗顶部展示横向项目选项卡，复用共享tab样式；默认选中会话defaultProjectId（不存在则首项），始终只选中一个项目，不使用可折叠分类按钮。下方tabpanel复用FileBrowser逐级浏览，仅挂载当前项目，不请求其他项目、不合并相同目录。选项卡保留tablist/tab/tabpanel关联、单一键盘焦点及左右方向键/Home/End切换；长项目名截断并提供完整提示，项目较多时选项卡栏可横向滚动，预览打开时栏仍可见。项目选择仅为页面状态，不改变默认项目、助手范围或会话cwd。点击文件复用FilePreviewPane预览与原件下载，下载按钮后增加“设置参考文件”，复用当前会话tree.addContextFiles与既有POST S/context-files，提交所选WorkspaceProject的{projectId,path}并同步Composer参考清单；不上传预览正文，不改变默认项目。无许可、运行/压缩/停止/未就绪、重复引用时禁用，格式/容量与错误沿用通用参考文件API，失败保留原清单，切换文件丢弃晚反馈。窄屏预览时可关闭预览返回分类；关闭/切换丢弃晚响应。列表、正文、下载分别调用既有GET /api/workspaces/:id/projects/:projectId/files、files/content、files/download，服务端核验成员归属及真实路径边界，不新增API、持久模型、SQL或Pi调用。FILE-004：GET /api/workspaces/:id/projects/:projectId/changes 为当前成员项目的只读Git差异API；可信单用户调用，无正文、lease、幂等键或SQL写入，不调用Pi。application先读取workspace及成员关系，不存在或非成员NOT_FOUND/404；基础设施从该成员rootPath核验真实根目录身份，复用通用目录/Git读取器，不查独立Project。files返回03 §14的ProjectFileListing（包括实际isGitRepository与gitState，不得固定false），目录安全/排序/截断遵循该契约；changes返回03 §14的ProjectChanges，容量、无提交仓库、非仓库空结果与GIT_READ_FAILED/500、GIT_TIMEOUT/504沿用该契约，根身份变化PATH_OUTSIDE_WORKSPACE/403。no-store，不修改索引、项目文件、SQL或Pi。缺少已装配读取器SERVICE_RESTART_REQUIRED/503，不自动重启。页面注入workspaceApi.projectChanges，以04 FILE-004投影diff按钮，不能调用独立项目changes接口。模型仅现有WorkspaceProject及临时Git派生事实，无新持久对象/字段/迁移。验收覆盖Git/非Git/缺少Git的列表状态、工作区/暂存区patch、成员隔离与只读副作用；状态：修复已接入；tests/workspace-project-git-api.test.cjs 的HTTP接口测试通过，使用临时内存库/临时仓库覆盖实际Git检测、首次提交前、工作区/暂存区patch、无Git与非仓库、成员隔离及文件/索引不改写；未访问独立Project或调用Pi。npm run typecheck与git diff --check通过；浏览器待验。已缓存旧workspaceServices的长驻进程需要操作者重启后加载新装配，不由应用自动重启。组件只注入所属范围API适配，不按路径推导归属。

复用既有FileBrowser、FilePreviewPane、Button和AuxiliaryDialog，不新增组件体系；官方File Tree/Code Block评估与替代沿用01组件治理及本节已有File Tree评估。验收：工具栏顺序、项目选项卡与键盘切换、按需读取、工作区API定位、预览/下载、切换晚响应隔离、浮窗互斥及背景可交互。状态：代码投影及预览“设置参考文件”入口已接入；复用FileBrowser的可选API适配，项目默认行为不变，工作区只调用成员文件API。参考设置复用既有会话hook和API，设置期间防重复，已有引用同步显示；文件预览、项目装配与工作区装配3个改动TSX、类型及差异检查通过，未运行API测试（接口契约未变）。类型、3个改动TSX语法及差异检查通过；未运行浏览器验收。没有API契约变化，不新增测试文件，也未运行非API测试。

## WSP-016｜回复文件链接预览

点击回复中本地文件链接（绝对路径或默认项目相对路径）阻止浏览器导航，在独立非模态文件浮窗内复用 FilePreviewPane。绝对路径按当前 Workspace 项目根目录的最长边界匹配；相对路径按本会话 defaultProjectId 定位。#L84、#L84-L90 或路径末尾 :84 定位行号；项目范围外的本地链接仅交给FILE-003当前会话目录API核验；也不属于会话目录、非法编码或读取失败时显示错误，不跳转、不搜索其他目录。HTTP(S) 和纯锚点保留原行为。选择变化后丢弃过期预览响应。

GET /api/workspaces/:id/projects/:projectId/files/content?path=项目相对路径，无正文/幂等键，可信单用户只读，返回 FilePreview {path,content,size}；先校验 WorkspaceProject 归属，再校验规范根目录、相对路径和真实路径边界，拒绝越界符号链接；预览格式、容量、二进制回退及下载按FILE-001扩展，替代原仅UTF-8限制。错误沿用FILE-001及工作区归属/根路径校验。不写数据库、不调用 Pi 或模型。基础设施实现文件读取，application 校验归属，route 只装配。复用现有预览组件，无新持久模型或迁移。状态：既有读取与链接映射由 tests/file-link-preview.test.cjs 与 tests/markdown-response.test.cjs 共 5 项通过，覆盖跨项目路径与默认项目相对路径、行号、非法路径、API 归属/越界符号链接/大小/二进制限制、DOM 点击阻止导航、预览行滚动及高亮。类型检查与差异检查通过。只使用临时文件和受控 DOM，未调用模型、启动服务或写用户数据；文件弹窗容器与主动关闭规则尚待 WSP-017 验收，既有测试不证明新投影完成。

## WSP-017｜会话检查、应用级模型配置与独立弹窗

状态：整体目标仍待按 05 §15 完整验收；型号失效恢复子项已实现并定向验证，证据见下，不宣称GAP-006整体闭合。v1.0.0 的历史交付状态不覆盖本需求。通用要求 UI-042～044、PCFG-001～003、PSES-014～016 按 05 验收，完整模型及 DTO 引用 02“会话检查与模型配置投影”“从节点创建独立会话与导出”、操作流程与错误引用 03 §10，页面投影只引用 04，不在本文复制配置优先级或完整 DTO。

### 归属与 Pi

工作区模型设置同步支持03 PSES-019的可选thinkingLevel，返回共享思考等级DTO；同一switch-model journal摘要包含显式等级，互斥/恢复语义不变，只写所属Pi的thinking_level_change。定向验证tests/workspace-model-recovery.test.cjs新增HTTP等级透传、同键异等级冲突和非法值拒绝；实际Pi持久化/冷恢复与共享UI验证记录见05 PSES-019；不代表WSP-017其余功能已整体验收。

工作区会话共享应用级配置来源，不从 WorkspaceProject.rootPath 或会话默认 cwd 查找模型与设置文件。settings 默认模型、完整模型参数、原生会话选择与容量的语义沿用通用规则，Workspace XML、原生工具及 cwd 不受模型切换改变。所有动作仅操作当前 workspace_sessions 的唯一 Pi 身份，不借独立项目 sessions 承载。

派生时沿用 03 §10.2 的隔离 manager 与原始祖先路径校验；不能对源 Runtime 的 manager 直接调用 createBranchedSession。派生会话继续归源 workspace_id，default_project_id 保持原值，拥有新 id 和新 Pi sessionId/文件，继承选定节点祖先路径及该路径模型。工作区来源没有独立 Agent 引用，派生不添加 Agent 或项目 Session。源工作区配置、会话归属、原生身份和叶子均不变；新会话接下来按当前工作区结构体装配提示词。

派生本身不新增表；退役所需结构变更见 §5。派生创建在一笔事务内只 INSERT workspace_sessions 新行，default_project_id 组合外键须同 Workspace，首次 native_ref_json 保存独立身份，purpose 沿用源值，时间为新值，创建键与载荷摘要按已有创建约束绑定到源 Session/entryId。SQL 失败回滚该插入，原生准备失败、提交后响应丢失及候选文件按 03 的证据与 unknown 规则处理，不删除来源或自动重发。新的请求 journal 独立绑定新身份，不复制源 journal 或未决请求；继承的原生旧记账节点仍保留原文，但来源 Session 的请求不作为新 Session 的待执行请求或新请求幂等凭据，恢复判定必须核验 Session 身份。

### 型号失效恢复修复（WSP-017 模型子项）

MCFG-003／MCFG-002：Workspace与通用规则一致，仅Pi当前分支无model_change的首次初始化使用当前默认；已有会话冷恢复、复用句柄、重连及派生沿用原生模型和思考等级，默认变化不覆盖。空闲打开／发送／压缩校验当前注册、enabledModels及认证，不可用时保留模型／历史、不回退默认；已有nativeRef核验完整后open返回status=unavailable恢复lease，显式切型号后继续。默认无效不影响已有可用型号；运行／压缩保留本轮快照，无新模型／表／迁移。验收与状态见05。MODEL-FAIL-001：共享Pi在可靠终结并落盘后报告已知模型请求失败，Workspace按既有journal failed收尾，不自动重发，不改变默认cwd/nativeRef/模型配置；真实unknown仍阻止配置写入。独立项目模型设置的针对性recover入口由04定义，不额外恢复Workspace的待核对分区。模型列表及切换同样按enabledModels过滤。GET models 仍返回当前原生选择、可用列表与来源；canSwitch 仅在有精确nativeRef、有效租约、无配置写入/打开/主请求/压缩/切换及未决journal时允许。没有原生身份的新会话仍需先成功初始化，不以模型恢复入口创建替代树。

PUT model 的正文和输入校验引用03，使用 Idempotency-Key 和 x-session-lease-id；校验归属后在会话互斥内重新读取记录、journal与配置。沿用 WorkspaceRequestJournal 的准备/结果证据，data 可选 operation='switch-model' 区分消息键空间，hash包含本次操作和目标型号；同键异目标409，已完成键不再切换，prepared但没有结果时REQUEST_UNKNOWN，不能重放。冷恢复准备记录通过精确nativeRef写sidecar，不需先创建AgentSession。Pi确认setModel及原生文件持久化后追加settled结果，已确认无副作用的配置/认证错误追加failed；不能确认时保留未决证据。写SQL、改默认设置、自动重试旧消息和改变原生身份均禁止。

设置投影复用模型选择组件，显示失效的当前型号和可用选项，必须用户点击应用；成功刷新树/会话并重新打开订阅，错误保留选择及服务端门禁。此修复只验收模型子项，不代表GAP-006、派生/导出或WSP-017全部完成。旧进程缓存尚无模型恢复方法时，模型入口返回SERVICE_RESTART_REQUIRED/503，要求用户重启应用以加载修复，不在热更新中替换旧运行协调器。

模型子项验收：tests/workspace-model-recovery.test.cjs覆盖HTTP归属、恢复租约、严格输入、幂等/冲突、互斥、无SQL身份变更、重启unknown不重放、冷journal承认及新键恢复；tests/workspace-request-journal.test.cjs覆盖耐久sidecar与损坏拒绝；tests/pi-session-fork-export.test.cjs使用实际SDK和临时模型配置，覆盖缺失供应商冷恢复、列表只读、只追加显式型号、身份/原字节不变及容量；tests/session-model-settings.test.cjs覆盖共享模型选择的显式应用、不可用项和离开后的晚响应；tests/session-auxiliary-dialog.test.cjs复验现有弹窗投影。五个文件共12项通过，npm run typecheck与git diff --check通过。没有真实模型请求、用户配置/原生历史写入或服务启停；真实浏览器及真实认证仍未验收。

### API 映射

S=/api/workspaces/:id/sessions/:sid。每个入口先校验真实调用方许可及 workspace_sessions.workspace_id，与 Project 的同名接口共享行为，通过所属 application/ports 适配，不转换成独立项目 API。

| 方法/路径 | 工作区专属边界 |
| --- | --- |
| GET S/messages | 复用本工作区会话完整树，标题点击仅客户端正文定位 |
| GET S/models；PUT S/model | 输入与行为引用 03，SessionModelView 引用 02；PUT 要求有效本会话 lease，核验 Workspace 可用、本会话 idle 且 journal 无 unknown；仅 Pi 原生模型变化，不写工作区配置、SQL 模型副本或默认项目 |
| POST S/fork | entryId 与 Idempotency-Key 沿用通用契约，源节点属于本树；本会话无运行/压缩/unknown，且 Workspace 无配置写入；事务按本节的工作区会话表完成，返回 201 安全 WorkspaceSessionDTO |
| GET S/export?format=…&scope=… | 同本工作区会话读取许可，参数、下载与范围沿用通用契约；只读原生快照，不包含独立请求 journal 作为对话，不调用模型 |

许可与恢复检查由服务端执行，归属不符 NOT_FOUND/404；删除按DEL-001优先执行，不因忙碌或journal拒绝。其余修改操作忙碌 SESSION_BUSY/409，未决/不可读 journal 为 REQUEST_UNKNOWN/409；只读树和导出不因 journal 未决或不可读自动拒绝，仍须验证原生历史与一致快照；其他错误沿用 03。WorkspaceSessionDTO.allowedActions 按 02 的共享动作定义扩展，许可由本范围记录与 journal 派生。模型切换、派生和导出不能读取其他工作区或独立项目的 Session。工作区配置更新、删除、发送、打开与派生/模型切换沿用同一互斥协调器，不能用界面禁用代替服务端门禁。

### 验收

两种会话使用相同等高非模态文件/会话检查浮窗和左侧任意单击主动关闭逻辑；所有全树标题、节点定位、设置状态、模型选择、压缩、派生与导出以本范围 API 投影。临时工作区验证配置来源与 cwd 无关、模型完整参数与上下文窗口生效、跨工作区拒绝、独立派生身份与单行事务、事务回滚、请求 journal 身份隔离与 unknown、全树/分支下载，以及左侧按钮与会话切换丢弃旧弹窗响应。文档一致性检查通过不代表实现或测试通过，完成状态须以实际定向验收证据更新。

## WSP-018｜删除工作区会话的应用记忆依赖

状态：目标已定，目标 Schema 及共享 DTO 待按 05 §15 补齐，未实现验收。本轮只整改文档，不修改运行代码或用户库。通用 SREM-001～003 引用 05；工作区专属要求是 Session/DTO/创建/删除/派生不再持有记忆绑定，删除全部本范围记忆/总结 API、后台任务与轮询，名称只用 purpose。目标创建和删除仅写 workspace_sessions；旧库必须按 §5 显式处理约束后才允许目标写入。退役路径 404，旧字段不继续接收；Pi 身份、完整树、模型选择、压缩、订阅和请求 journal 保留。定向验收须覆盖跨工作区归属、幂等、unknown、旧库门禁，以及回答结束不再启动独立总结。

## SEARCH-002｜工作区工具搜索

工作区POST S/messages同步接受toolSearch?:boolean（默认false），消息哈希仅在true时增加toolSearch。引用03 SEARCH-002的配置预检、错误、工具参数（SEARCH-003单一必填input及旧格式归一化）、Bing和本机网页读取、代理、限额和生命周期；与webSearch独立校验。沿用工作区归属、cwd、journal和共享输入框，不新增表/会话或替换原生四个编程工具；搜索工具只在本轮显式开启后可用。状态：已整改为单一web_fetch（无URL时访问Bing），定向验证与限制见05 SEARCH-002；真实Bing/Ubuntu出网与浏览器待验。

## SEARCH-001｜工作区服务端搜索

工作区POST S/messages同步接受webSearch:boolean（默认false），共享03 SEARCH-001的协议校验、错误、请求扩展、Pi证据及输入框投影；支持OpenAI Responses和Google GenerateContent/Vertex，Workspace不另建协议适配器。校验在workspace_request准备前完成；true进入原body摘要，false/省略沿用旧摘要。工作区归属、默认cwd、项目集合、原生身份与既有journal不变。不新增Bot或搜索服务表。状态：已实现，定向验证与实际限制见05 SEARCH-001；真实模型和浏览器待验。

## WSP-020｜运行中纠正

同步PSES-029文字输入、Pi队列时序、终态清除与共享Composer投影；POST S/steer，输入{content}，返回202 {data:{accepted:true,sessionId,delivery:"steer"}}，要求所属Workspace/Session、有效lease及Idempotency-Key。不接受附件/搜索，不调用prompt，不新建身份或写SQL。活动主请求允许纠正，配置中/压缩/删除SESSION_BUSY，空闲/停止中SESSION_NOT_RUNNING，不绕过其他未知请求。

WorkspaceRequestJournal的operation增加steer，按operation+key隔离；workspace_request准备，成功以workspace_request_result(outcome=queued)确认接收，只存摘要。并发同键共用结果、异载荷冲突；未决非活动证据为unknown，不自动重发。queued仅证明接收，未消费内容可随停止/失败/退出丢弃，不构造持久队列。验收同PSES-029并增加跨Workspace归属；代码已接入，tests/session-steer-api.test.cjs的HTTP归属/租约、并发幂等、unknown、删除等待及SSE重连队列验证通过，联合回归及限制见05 PSES-029。浏览器与真实Pi队列消费/清除待验证，不标记整体验收完成。不新增SQL或迁移。

## CTX-001｜Session持续参考文件

Workspace采用02/03/04/05的CTX-001模型/API/投影，归属WorkspaceSession。按当前WorkspaceProject核验来源后保存快照；替代新选择仅传路径，保留旧历史。显式context files，不隐式加载；写入受运行/打开/关闭/配置/unknown门禁保护。

WAGENT-010中的双模式助手与规则归属已由ASSIST-011取代；逐项目Pi读取技能能力由项目规则生成API复用。

## AGENT-002｜工作区助手（替代首期不接入Agent的规则）

工作区默认无助手时仍使用Pi默认及固定workspace XML。来源及逐项目生成流程见WAGENT-010。generated每个项目拥有独立AGENTS.md，运行时按项目ID填入对应project/rules；没有生成规则的项目省略规则节点，不能把工作区自身作为项目生成来源。custom工作区仅有工作区自身一份AGENTS.md，完整替换默认系统提示词，仍保留应用的固定工作区定位结构。版本文件保存在agents目录，不覆盖各项目仓库的AGENTS.md。工作区级助手不能用于独立项目，项目级助手可供工作区引用；工作区项目被移除后拒绝采用相关助手并要求显式更新。历史workspaceRules只读兼容，不允许新建或继续生成。

S/assistant使用类型化文件保存精确版本引用，不修改workspace_sessions SQL。配置受本服务运行/打开/关闭/unknown/删除门禁保护；事件通知刷新，下一轮使用、运行中固定。删除会话后原生历史/助手版本及选择文件保留。验收与状态统一按05 AGENT-002；共享02 AGENT-004的agents保存目录及旧目录读取兼容，无历史迁移授权。


AGENT-003：工作区来源生成复用通用03的生成技能API与04的选择投影，技能可选，不选时模型直接调查项目；所选技能指导各项目独立规则整理；自动修订可按意见同时调整多段，未涉及项目规则保持原文，服务端拒绝越界项目，不扩大projectIds分析范围，不改变固定workspace XML、会话技能、Pi权限或版本模型。


## REF-ASSIST-001｜消息引用助手与Skill

会话输入工具栏按“引用助手 → 引用 Skill → 上传文件”排列，独立项目与工作区复用。助手从候选API及GET /api/agents/:id读取正式精确版本，选择后通过既有GET/PUT S/assistant写入会话助手选择（精确agentId/revision/contentSha256、If-Match和当前lease），下一轮按ASSIST-011装配系统提示词。只允许active正式版本；继承默认提示词的助手同样可选。助手不转换为附件、不写messages.references、不占附件额度、不在输入框或对话中显示合成文件。选择持续生效至显式更换或移除，在Composer引用入口查看名称与更换；会话检查不再展示助手分区，既有移除API保留但不新增移除入口；不隐藏既有Pi历史或用户上传文件。Skill列表复用GET /api/agents/skills，新增GET /api/agents/skills/:skillId返回{id,name,description,sha256,content}完整技能文本，受控技能目录读取与错误沿用AGENT-003，无Pi调用、数据库写入或新增持久模型。技能只作为本次消息材料，不自动安装或授予能力。客户端不提供路径，响应不含绝对路径。

选择器复用现有弹窗；助手使用既有会话选择模型，失败保留旧选择，运行/压缩/停止/提交或无有效lease时禁用选择；读取失败可重试，切换会话取消本地请求，不自动重放PUT。Skill继续使用上传附件模型，原子加入，遵循总计10项及附件字节限制，重复选择按所引用文件处理；可在输入内删除，发送成功清空，失败保留。加载/读取失败可重试，关闭或切换会话取消未完成选择；运行/停止/阻塞及提交中禁用，避免转成steer附件。API验收完整Skill正文/摘要及不存在与非法ID错误，页面检查按钮顺序和共用附件发送逻辑。

REF-ASSIST-001验证：tests/agent-preparation-api.test.cjs四项通过，含Skill正文/摘要、无绝对路径、404及非法ID；类型检查、输入组件JSX和差异检查通过。浏览器交互未实测。


PSES-011接口核对：tests/session-entry-link-api.test.cjs的Workspace application/SSE场景通过，受控模型流执行临时文件write/edit，流式assistant和工具结果均唯一关联最终原生树；具体共享验收记录见05 PSES-011。未复现终态残留，生成中的未确认标记不表示项目文件保存失败；真实浏览器未验。

## ASSIST-011｜工作区当前目标
本节替代WAGENT-010与AGENT-002中助手种类、文件归属、范围与装配规则。统一助手不持有项目规则，工作区source.projectIds=null表示全部当前成员，非空数组表示显式子集；自定义/项目生成入口取消。项目AGENTS.md由工作区成员项目设置单独生成/启停，存储键包含workspaceId+projectId，模型/存储通用契约见02 ASSIST-011，API见03 ASSIST-011。助手采用后固定XML仅列其范围项目并填入启用规则；无助手仍保留原全部工作区成员逻辑。会话nativeRef.cwd不改变，不能用XML范围冒充OS沙箱。仅配置指纹变化才更新装配，不随每轮重复填充；活动轮次固定配置。无SQL变化或历史迁移。

ASSIST-011验证：tests/unified-assistant-api.test.cjs与tests/agent-preparation-api.test.cjs共9项通过；覆盖统一助手版本无AGENTS.md、继承/替换、子集/全工作区、两范围规则开关与版本、并发生成冲突/取消、无助手不加载、真实Pi连续两轮不新增系统配置以及变化时复用句柄更新。类型检查、改动JSX语法与差异检查通过；无历史迁移、生产构建、服务启停或真实模型调用。


ASSIST-012：通用型助手的通用定义见02，工作区会话可采用，保留既有工作区定位，不加载project-rules。工作区引用列表以当前Session.defaultProjectId和workspaceId调用03的候选查询，先返回覆盖该成员的本工作区助手和匹配成员的独立项目助手，再列通用型；其他工作区及不覆盖该成员的助手不展示。Tailwind编辑与公共列表投影见04。无新增SQL、迁移或Pi历史改写。

ASSIST-012验证：tests/unified-assistant-api.test.cjs共7项通过，新增覆盖通用型创建/修改/润色、非法归属组合、项目优先及通用型排序、工作区成员过滤、越界和缺失项目错误，以及两类会话采用通用型助手后不加载项目规则；沿用受控Pi验证跨轮次不重复装配。类型检查、变更JSX语法、Tailwind样式及使用的工具类编译、git diff --check通过。未执行浏览器、真实模型或生产构建。


RULEGEN-001：工作区成员的规则生成与进度采用通用02/03模型和API，任务身份同时含workspaceId与projectId，与同目录独立项目隔离。生成开始及发布前均核验成员仍存在；移出工作区后不能发布。成员设置复用04的规则控件与可选技能，生成按钮与技能同行，补充要求通过润色修改该成员已保存规则；任务mode、输入校验、幂等与发布沿用02/03，不能修改其他成员规则。两列顺序和单项目选择按WSET-002；离开工作区页面不取消生成。此目标取代以前必须选技能和POST断开即取消的规则，不修改任何工作区业务Session或既有规则版本。

RULEGEN-001验证：tests/project-rule-generations-api.test.cjs、tests/unified-assistant-api.test.cjs、tests/agent-preparation-api.test.cjs共18项通过；另定向运行tests/assistant-api.test.cjs中的generation skill list and prepare APIs用例1项通过。覆盖202异步接受、HTTP断开后继续、持久进度查询、同键幂等、单项目并发、取消/失败保留旧版、目录及规则变更冲突、项目/成员任务隔离、服务重建中断及发布结果核对，以及有/无技能的真实Pi读取工具循环（受控模型）。类型、改动JSX与Tailwind编译、差异检查通过。未执行浏览器、真实模型、生产构建、服务启停或数据迁移。


BUTTON-001：工作区导航、会话操作、项目成员设置及目录弹窗统一采用04 BUTTON-001共用按钮，不新增工作区变体，不改变当前模型、API或运行许可。


## WSET-002｜工作区设置单项目规则投影

工作区新增与设置铺满导航右侧剩余画布，不设最大宽度。项目列表操作列并排放置“AGENTS.md 设置”和移除按钮；已保存成员可选择规则设置，未保存的新成员禁用设置并提示先保存工作区。当前规则选择只保存于页面，不改变默认项目、工作区配置或Session。

下方仅装配当前选择的一个已保存且仍在编辑列表内的项目规则区，初始选已保存默认项目，否则首个已保存成员；移除当前项后回退首个可用成员，没有可用成员时不装配。点击设置切换所属项目，旧读取及轮询随组件卸载停止，旧响应不得写入新项目；已接受后台生成继续运行，重新进入从原API恢复状态。未提交生成要求属于页面草稿，切换时丢弃。

整个设置主体宽屏采用两列：左侧从上至下为工作区信息、项目列表、保存操作和所选项目的生成配置，右侧仅所选项目的只读AGENTS.md预览；不再将工作区信息放在两列上方。窄屏信息和配置在上，预览在下；无已保存项目时右侧显示保存后可预览的占位。独立项目原有左右顺序不变。仍调用所属成员agent-rules既有GET/PUT/POST/PATCH，无模型/API/SQL/Pi变化，无历史迁移。

验收：全宽、操作列入口、单成员切换、未保存成员禁用、移除选择回退、右预览和侧栏NAV-002同步。状态：实现完成；类型检查、变更组件JSX解析、布局Tailwind类编译与git diff --check通过；整体左信息与规则/右预览布局已同步核对。未新增或运行测试；浏览器视觉及实际切换交互待验收。
