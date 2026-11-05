# 06｜Workspace 首期：项目集合与跨项目会话

本文是 Workspace 与 Bot 专属模型、API、Pi 归属、页面投影及验收的唯一权威。独立项目 Project 与通用 Session、SessionMemory 的共有规则引用 `02`；工作区所属项目 WorkspaceProject 的专属事实由本文定义，通用 Pi Tree、订阅、精确恢复及手动压缩引用 `03`，代码分层引用 `01`。独立项目模式保持其所属文档定义。

本文只保留当前目标。首期交付不包含 Agent.md、Bot 或它们的版本管理，相关能力统一列为 §9 后续计划，不作为首期创建、运行或验收的前置条件。工作区 v1.0.0 功能完成，用户已确认提交并标记版本；包含首期模型、API、Tailwind 页面、会话删除和回复文件链接预览。验收证据与适用限制见 §8。后续计划不作为已批准的 API 或 Schema。用户已授权本次工作区数据升级；仅在离线检查通过后执行 §5 的显式迁移，不在应用启动时迁移。

## 1. 已确定的产品定义

1. Workspace 是项目集合，包含归属于该工作区的 WorkspaceProject。不同工作区各自的项目、工作区项目与独立项目 Project 均为独立业务记录，各自创建和管理，记录、配置及生命周期互不联动；路径允许重复，不以路径判定项目身份。
2. 每个 Workspace 允许创建多个独立 Session。每个 Session 独占一个 Pi Session，在同一会话中直接跨项目读取、修改代码和验证；Workspace 不派发任务、不生成项目 Session。
3. 在 Workspace 新建会话时，用户指定默认工作目录，目录从项目集合中选取。
4. 首期新建会话只选择默认项目，不选择或绑定 Bot、Agent，不加载 Agent.md。
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

WorkspaceProject 是工作区内独立管理的项目记录，保存自身身份、所属 Workspace、真实根目录和管理状态，不定义 description。项目名称由所选目录的最后一级目录名派生，无手工名称字段；服务端从所选目录计算，客户端不能另传名称覆盖。每条记录只属于一个 Workspace；不同 Workspace 不共用项目记录，即使目录相同，也分别拥有项目身份和状态。独立项目 Project 继续由 `02` 定义，工作区项目不与其共用记录，也不通过独立项目 ID 或相同路径建立自动关联。

工作区新增项目直接在当前 Workspace 中登记目录和项目信息，不要求先创建或选择独立项目。独立项目的新增、改名、路径变更、归档及其他配置修改不改变 WorkspaceProject；WorkspaceProject 的新增、路径变更、归档及其他配置修改也不改变独立项目，路径变更后的显示名称仍按最后一级目录名派生。各自的会话、记忆及执行配置不自动复制、共享或同步。

WorkspaceProject 不拥有项目 Session、Memory 或 Pi transcript；会话归 Workspace，跨项目工作在该会话内完成。知识资料目录也可作为工作区项目登记，不因此生成独立项目。

不同工作区之间，以及工作区项目与独立项目之间，允许根目录完全相同或互相包含。创建、修改、列表读取和运行许可不得因其他工作区或独立项目已登记相同、规范化后相同或重叠路径而拒绝，也不得按路径去重、合并记录、自动建立关联或同步配置。不设置跨工作区或跨模式的 rootPath 唯一约束，不以符号链接解析后的同一真实目录作为跨范围冲突依据。

业务记录独立不等于物理文件自动隔离。指向相同目录时，文件修改会作用于同一份代码；本版不自动复制 checkout，也不声称项目身份独立能隔离磁盘副作用。不得以避免此类副作用为由增加跨工作区或跨模式的路径占用校验、重叠目录门禁或 PROJECT_BUSY 拒绝。会话自身的运行互斥继续按通用契约执行。

### 2.2 Workspace

Workspace 保存自身身份并拥有其工作区项目集合，同时保存列表中选定的默认项目。默认项目必须属于当前 Workspace 的项目集合；对可创建会话的配置，整个集合恰有一个默认项目，单选项不是各项目分别保存的多个独立布尔状态。它不拥有独立于会话的 Pi transcript，也不要求对应一个同名物理目录。

工作区范围以服务端保存的 WorkspaceProject 归属和状态为准，系统提示词不授予目录权限。

每个 Workspace 可以拥有零个或多个 Session；每个工作区 Session 只属于一个 Workspace。首期要求至少一个项目及一个默认项目。配置在工作区没有运行、压缩或待核对请求时条件更新；已有会话的默认项目不得移除或改目录。Workspace 本身首期不提供物理删除或归档；会话允许用户显式删除，见 WSP-015。

### 2.3 Session

Session 是属于 Workspace 的一次独立持续对话，独占一个 Pi AgentSession/SessionManager 和一棵原生树。同一个 Session 中的所有项目读取、修改、命令执行和验证都由这个 Pi Session 完成并记录；不同 Session 的原生身份、树与历史分别独立。

新建会话以 Workspace 已选默认项目作为默认工作目录选择；用户如选择其他项目，仍须属于当前 Workspace。创建输入只表达该会话默认工作目录对应的 WorkspaceProject。首期不接收 Bot、Agent、说明版本或提示词生效方式参数；工作区 Session 不绑定独立项目角色，不读取其快照作为指导。独立项目原有 Agent 功能保持所属契约，不因本期范围收敛而删除或改写。

默认目录必须来自当前 Workspace 的项目集合，并由服务端读取 WorkspaceProject.rootPath。客户端不通过自由输入绝对路径替代项目选择。默认项目的语义字段定为 `defaultProjectId`；正式创建 API 契约仍须补齐许可、幂等、事务与返回值。

Pi 初始 cwd 为选定项目根目录。访问其他项目时显式定位目标项目，不为该项目另建 Session。Session 的 workspaceId、defaultProjectId、Memory 绑定及已建立 nativeRef 固定，不允许更换；目录配置不得使已建立会话静默换 cwd。已有 Pi 原生身份继续按 `03` 精确恢复，不根据页面选择或最近目录换树。

SessionMemory 的总结、展示、人工校正及不进入主模型输入的通用规则继续适用。工作区会话持久化于 workspace_sessions；Memory 继续使用 session_memories，新增可空 workspace_id，工作区 Memory 的 project_id=null、workspace_id 必填。独立项目 Memory 的 project_id 必填、workspace_id=null；模板两者均为空。会话与其 Memory 通过组合外键保持同 Workspace、一对一、不可变。工作区记忆的 outputs.path 为 null，跨项目产出以文字说明，不借独立项目记录承载归属。

## 3. 系统提示词中的工作区结构体：已定契约

### 3.1 适用规则

首期保留 Pi 默认编码提示词，应用实际读取 Workspace 和其所属 WorkspaceProject 记录构建工作区结构体，补充到系统提示词中，让模型知道当前 Workspace、项目集合以及默认工作目录。项目名称取目录最后一级目录名，项目信息不含 description，不保留 null 占位，也不从 Agent.md、独立 Agent 库或 Bot 取得补充指导。关闭隐式项目说明文件加载，避免 SDK 自动将 Agent.md/AGENTS.md 装配进系统提示词；模型按用户任务显式读取仓库文档仍属于正常工具操作。

未来接入 Bot 时仍保留同一工作区结构体，不用 Bot 替代真实项目清单；Bot 的具体接入列于 §9。

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

Pi DefaultResourceLoader 保留默认提示词，使用 appendSystemPrompt 添加带来源标签的 XML 工作区结构体及原生工具路径说明，关闭隐式资源发现。定位规则单独放在 <project_resolution> 标签中，明确先按用户提到的项目名称匹配 <projects> 中的项目，再以对应 <cwd> 为检索起点。结构体 projects 是当前完整项目清单，workspace.cwd 仅表示默认目录，不缩小 projects 范围；项目定位直接采用 projects[].cwd，不从知识库、README 或历史工具结果反推。历史 workspace_* 调用记录仅是旧记录，提示词明确工具已退役，当前工具仅为 read/bash/edit/write。保留历史原文，不注册兼容工具或把错误调用重定向为原生工具。每次根请求在会话互斥内重读本工作区配置；空闲句柄配置变化时释放并按精确 nativeRef 恢复，不更换树。工具循环固定使用本轮配置。

结构体上限 64KiB UTF-8，消息正文上限 32KiB；项目数组最多 32 项，按项目 ID 排序。超限返回 WORKSPACE_CONTEXT_TOO_LARGE，不截断项目。使用固定服务端模型，自动压缩关闭；模型上下文不足报告通用错误，由用户手动压缩。

工作区结构体不通过 `workspace_context` custom message 替代系统提示词。本期不定义 Agent.md 格式或说明文件预算。当前 Pi 在模型请求的 role=system 消息中传递系统提示词，不要求 context.systemPrompt 字段有值，也不把它作为普通消息写入原生会话文件；原生树缺少系统提示词节点不能作为未注入的证据。项目集合直接取系统提示词中的结构体，不通过工具或读取磁盘发现集合。Workspace Runtime 不注册任何 workspace_* 工具；请求幂等和恢复记账保存于应用独立 journal，不追加 Pi custom 节点，不转换为模型消息；旧的请求记账 custom 节点只读兼容，原文仍按完整树规则展示。

## 4. Pi 原生编码工具

Workspace 会话直接使用 Pi SDK 原生 read、bash、edit、write，沿用原生参数、返回值和执行行为，不注册任何 workspace_* 或 project_* 工具，不自动启用工作区专属 codemode 扩展。项目集合只通过系统提示词的结构体提供，不提供模型查询项目清单的工具。

Pi cwd 固定为会话默认项目目录；原生工具相对路径从该目录解析，跨项目使用结构体提供的绝对路径，bash 可按用户意图在目标目录执行命令。工具访问采用可信单用户宿主的进程权限，不声称 cwd 或项目清单提供文件系统沙箱，不建立自定义多目录权限层、跨项目路径锁或命令拒绝占位工具。执行修改遵循用户意图。

应用 API 仍校验 Workspace/Session 归属；附件目录浏览和文件引用 API 仍校验项目及真实路径，只属于页面附件选择，不注册为模型工具。原生消息、工具参数、结果、thinking 和所有分支完整投影到所属 Session 的唯一 Pi Tree，不生成项目子会话。

## 5. 持久化设计边界

首期需表达的独立持久事实为：Workspace 身份、WorkspaceProject 身份及其 Workspace 归属、Workspace 与多个独立 Session 的归属关系、工作区选定的默认项目，以及各会话的默认项目。工作区默认项目用于新建会话的初始选择，配置变化不自动改写已有会话的 cwd 或原生身份。Agent.md、Bot、Bot 成员关系和说明版本不进入首期模型，不预建相关字段或表。

Workspace/WorkspaceProject 为一对多归属关系，需要可查询的外键约束；不同工作区的项目身份独立，不跨工作区复用记录，不设置跨工作区或跨模式的路径唯一约束；不建立指向独立项目 Project 的复用关系，也不因工作区项目写入而修改其他工作区或独立项目记录；Workspace/Session 为一对多外键关系，不对 Session 的 workspace_id 设置 UNIQUE；每个 Session 的 Pi 身份必须独占。首期新增三张表 workspaces、workspace_projects、workspace_sessions，并扩展 session_memories；不复用独立项目 sessions 的 project_id 外键，也不创建第二套 Memory 表。workspaces 保存 id/name/default_project_id、创建幂等键及载荷摘要、时间；workspace_projects 保存 id/workspace_id/root_path 和排序 ordinal（名称实时派生，无描述）；workspace_sessions 保存 id/workspace_id/default_project_id/session_memory_id/purpose/native_ref_json/ended_at、创建幂等键及摘要、时间。workspaces 的默认项目和 workspace_sessions 的默认项目均使用组合外键约束同工作区，session_memory_id UNIQUE，归属和 nativeRef 一经建立不可替换。运行状态在进程内，未确认请求从独立的 WorkspaceRequestJournal 派生，并只读兼容既有原生请求记账节点，不新增运行状态列。所有历史外键 ON DELETE RESTRICT。

现有源码基线含七张 Bot 专属表：`bots`、`bot_projects`、`bot_project_agents`、`bot_conversations`、`bot_conversation_projects`、`bot_conversation_project_agents`、`project_calls`。该清单仅说明实施前必须检查的兼容范围，不保留其业务设计，也不证明现场数据库结构。

三张表分别表达工作区身份、所属项目和工作区会话；独立 Session 的既有 Project 外键不适用于工作区，因此工作区会话独立存储。Memory 共有内容仍只有一张表，增加明确 owner 判别，不用 JSON 隐藏关系。旧 Bot 七表及历史不在本期删表范围，不转换、拼接历史 Pi。全新空库使用目标 Schema；现有库缺少目标结构时 Workspace API 返回 SCHEMA_INCOMPATIBLE，独立项目入口保持原有能力。历史升级需单独授权，应用启动不能隐式 DDL。

### 5.1 请求记账与 Pi 对话隔离

WorkspaceRequestJournal 是每个工作区 Session 的应用请求证据，不是对话或工具结果。它固定对应同一 Session ID、Workspace ID、Pi 原生 Session ID 与文件，位于原生 sessionFile 旁的 .workspace-requests.jsonl 文件；只存版本、归属身份、记录 ID、时间、type 和 data（请求 key、载荷 hash、可选 outcome），不存正文、项目配置、thinking 或工具内容。每条记录追加后 fsync，再调用 prompt；可靠结束后追加结果。无文件表示尚未有新请求，损坏、部分行或身份不符返回 REQUEST_UNKNOWN，禁止自动重发，不静默重建。

原生旧请求节点按追加顺序只读合并在 journal 前供恢复判定；不迁移、删除或过滤已有 Pi 节点。新发送、结束回执及 acknowledge 均只追加 journal，不能调用 Pi appendCustomEntry。冷读按精确 nativeRef 读取原生旧证据与 journal，不启动 Runtime、不修改原生文件。该对象不拥有 Pi transcript，不新增 SQL 表，不触发历史库迁移；与 Pi 文件一同备份。Pi 正常消息与工具调用/结果仍由唯一 Pi Session 原生持久化，页面不拿应用记账冒充对话或工具结果。

### 5.2 工作区存储升级

用户授权范围为当前工作区目标结构。scripts/migrate-workspace-storage.cjs 默认只预览，--apply 才执行；执行前检查数据库及 WAL/SHM 均无其他进程打开，不停止或重启用户服务。旧版 session_memories 的九个字段逐值保留，新增 workspace_id 初始均为 null，不改变 Project、Session、Agent、旧 Bot 关系或 nativeRef，不转换旧 Bot 为 Workspace，也不读写 Pi 文件。

迁移先创建完整 SQLite 备份，然后在独占事务中按目标 Schema 重建 session_memories 的归属约束，新增三张工作区空表及其索引/触发器。保留原有额外记忆索引和触发器，替换三条已知记忆归属/模板触发器；其余表、索引、触发器与视图不变。事务提交前核对全部历史表的原字段值摘要、数据库完整性与外键，失败回滚；不识别的旧结构或半迁移状态直接拒绝。已升级目标重复运行只校验、不改写。

迁移测试 tests/workspace-storage-migration.test.cjs 的 3 项验证通过，覆盖历史内容与备份保留、归属约束、工作区创建、重复执行、连接占用拒绝和事务失败回滚；现场库只读备份也已完成试迁移。用户停止服务后，连接复查通过，已执行原库升级。升级前备份为 .data/ai-workspace-v5.sqlite.pre-workspace-2026-11-04T09-13-56-710Z.bak。6 个 Project、5 个 Agent、8 个 Session、8 条 SessionMemory 及全部旧 Bot 关系/记录的原字段值摘要保持一致，旧记忆新增 workspace_id 均为 null；三张工作区表初始为空。升级后完整性检查为 ok，外键错误为 0，Workspace Repository 可读且 available=true。未启动服务、未调用模型、未改写 Pi 历史。

## 6. API 意图与待定契约

以下为首期正式契约，路径相对 /api。成功 {data:...}，错误沿用通用 error envelope；可信单用户长驻部署沿用 `03`。读操作 no-store，无模型调用。创建 POST 要求 Idempotency-Key，同键同载荷返回相同记录、异载荷 409；配置 PUT 要求 If-Match。未知字段拒绝。

| 用户意图 | 应读取或改变的模型 | Pi 边界 |
| --- | --- | --- |
| 管理 Workspace 与项目集合 | Workspace 及其所属 WorkspaceProject、默认项目；目录由目录选择器提交，名称由服务端派生，不接收项目 name/description；默认项目须属于本次保存的集合 | 不调用 Pi，项目集合与默认项目须在同一事务保存，不读写独立项目作为集合成员 |
| 在 Workspace 新建独立会话，可多次创建 | Workspace、默认 WorkspaceProject、工作区 Session/Memory | 创建业务记录不调用 prompt；原生初始化时机沿用通用流程并补专属契约 |
| 打开或恢复会话 | 指定 Session 与其精确 nativeRef | 只创建或恢复该会话的唯一句柄，不派生项目 Session |
| 发送用户消息 | Workspace 项目事实与默认目录 | 保留 Pi 默认编码提示词并补充工作区结构体，再调用该 Session 独占的 Pi prompt；不加载 Agent.md 或 Bot |
| 查看、纠正、停止和恢复 | 同一 Session 的原生证据 | 复用通用 Tree、abort、检查与恢复能力；首期消息无队列，不开放 steer |

| 方法/路径 | 输入与返回 | 事务、许可和副作用 |
| --- | --- | --- |
| GET /workspaces；GET /workspaces/:id | WorkspaceDTO（id/name/defaultProjectId/projects/writeETag） | 只读本范围；旧库不伪装空列表 |
| POST /workspaces | name、projects[{rootPath}]、defaultProjectIndex → WorkspaceDTO | 1..32 项、名称 1..120 字；服务端检查所选项为可访问目录，不查询其他范围路径；同事务插入工作区/项目并绑定默认项 |
| PUT /workspaces/:id | name、projects[{id?,rootPath}]、defaultProjectIndex → WorkspaceDTO | If-Match；整组保存，受引用默认目录固定；无运行/压缩/unknown 才允许，不同步其他范围 |
| GET /workspaces/directories?path= | DirectoryDTO（path/parent/directories[{name,path}]） | 仅目录元数据，不读文件；缺省为服务 cwd；可信部署边界，不授予模型权限 |
| GET/POST /workspaces/:id/sessions | POST defaultProjectId?、purpose? → WorkspaceSessionDTO | 默认选工作区默认项，同事务创建空 Memory/Session，重复创建不增 Memory；GET 返回本工作区会话 |
| GET /workspaces/:id/sessions/:sid | WorkspaceSessionDTO（id/workspaceId/defaultProjectId/purpose/state/endedAt/memorySummary/allowedActions） | 核验精确工作区归属，不下发 nativeRef |
| POST S/runtime/open、pong、close；GET S/events | 沿用 `03` 租约与订阅 DTO；open 允许无正文、零字节请求流或 {}，pong/close 仍要求各自参数 | 复用 SessionPresence/SessionEvents；后台请求持有使用权，断线不重发 |
| GET/POST S/messages | GET 完整 Tree；POST content、references? → 202 accepted | 有效 lease；正文不改写，附件按通用格式，项目引用限本 Workspace；会话 busy 409，无队列 |
| POST S/interrupt、restore、end | 无业务正文（无正文、零字节请求流或 {}）→ SessionDTO | interrupt 调用 abort 并等待；restore 只恢复可确定失败状态，unknown 先核对；end 仅空闲，保留历史 |
| GET S/context；POST S/compact、compact/cancel | 通用 NativeContextInspection | 仅用户手动，压缩与消息互斥；调用唯一 Pi 原生能力 |
| GET S/memory；PATCH S/memory/context；POST S/memory/summarize | WorkspaceMemoryView；PATCH If-Match 与 contextJson；总结无业务正文 | 只访问本会话 Memory；条件保存、每次回答后独立总结及手动总结，不进入主 Pi；未测量的来源计数为 null，不伪装为 0。可见且未编辑时每 5 秒刷新，关闭停止轮询 |
| POST S/recover | action=inspect/acknowledge-unknown | 检查请求 journal 及只读旧证据；用户承认未知时写 journal 回执，再解除本会话门禁，不重发旧输入 |

无业务正文的操作按实际读取的字节数判断空请求，不能依据 request.body 是否存在；零字节等价 {}，非空正文必须是合法 JSON 对象且不含未知字段。仅空白、损坏 JSON、数组、null 仍返回 INVALID_JSON，正文容量限制不变；创建、消息及其他必填正文接口继续拒绝空正文。

S=/workspaces/:id/sessions/:sid。配置 JSON ≤64KiB，目录元数据 ≤2000 子项，purpose ≤500 字符。保存前文件检查在事务外，最终归属/ETag/幂等与 SQL 写入在同一短事务。输出字段来自本范围记录或 Pi 原生证据，工具和 Tree 保留全部原文，不下发原生文件路径或句柄。

消息在 prompt 前向独立 journal 写 workspace_request 准备证据（键、摘要、不含正文），可靠结束后写 workspace_request_result，不追加 Pi custom 节点。重启或异常留下未决准备记录则为 unknown，不重复 prompt；相同键返回已接受回执。所有入口先核验 session.workspaceId；unknown 阻止消息、结束及配置写入，允许读历史与显式核对。失败保留已发生文件副作用。没有准备证据前失败不视为已接受。错误包括 INVALID_INPUT/400、NOT_FOUND/404、PRECONDITION_REQUIRED/428、WRITE_CONFLICT/409、IDEMPOTENCY_CONFLICT/409、SESSION_BUSY/409、REQUEST_UNKNOWN/409、SCHEMA_INCOMPATIBLE/409、PATH_OUTSIDE_WORKSPACE/403。

模型工具沿用 Pi 原生参数；相对路径对应会话 cwd，跨项目使用系统提示词中的绝对路径。不把项目 ID 作为自定义工具参数。

## 7. 页面投影与代码职责

首期 UI 同步范围明确包括左侧导航的列表展示、选择与切换，以及中间会话区域。Workspace 与 Project 在这些通用部分复用组件、布局、样式及交互；后续通用 UI 调整须同步适用于两种会话入口。Workspace 的新增页面及创建业务流程独立定义，不属于与现有 Project 新增页面同步的范围。

| 区域 | 同步与复用要求 | Workspace 的数据差异 |
| --- | --- | --- |
| 左侧导航 | 复用分区、条目、展开/收起、会话列表、选中态与切换交互；新增入口进入 Workspace 自己的创建流程 | 按 Workspace 展示其所属 Session；Project 导航继续展示独立项目 Session，不重复列出 Workspace Session |
| 会话区域 | 复用完整 Pi Tree、消息、thinking、工具展示、输入框、流式反馈、错误与恢复反馈，以及停止、上下文检查和手动压缩入口 | 读取选中 Workspace Session 的 DTO、原生树及事件，动作调用其所属 API；跨项目工具操作展示目标项目身份 |

Workspace 的新增页面主体是项目列表，每行展示所选目录、由最后一级目录名派生的项目名称，以及“默认项目”单选按钮；全部行属于同一单选组。新增与设置页的路径输入统一放在“添加项目目录”弹窗，主页面不另放路径输入框。弹窗提供绝对路径输入框，按 Enter 或点击“跳转”调用既有 GET /workspaces/directories?path=，成功后显示服务端返回的规范目录及子目录，再点击“选择此目录”添加；请求失败显示错误并保留输入，不误选此前目录。不从独立项目列表选择，不提供项目名称输入框或描述字段。路径在保存时沿用 POST/PUT 的服务端真实目录校验；失败保留列表并显示 API 错误。更新请求只提交 name、defaultProjectIndex 及 projects[{id?,rootPath}]，不回传读取 DTO 的 workspaceId、项目 name、时间或 writeETag；条件凭据通过 If-Match 传递。列表的目录和默认项选择提交为工作区项目集合及其默认项目，由服务端派生名称并校验默认项归属，不执行跨工作区或跨模式路径去重。

Workspace 的新增页面按 Workspace 自身的模型和 API 定义，不以现有 Project 的新增页面、表单字段、会话创建流程或资源配置作为业务依据。新建工作区与在工作区中新建会话是各自明确的用户意图，不通过既有项目创建流程代办，也不顺带创建项目 Session。

工作区新增项目直接管理当前 Workspace 的 WorkspaceProject，不从独立项目列表选取或建立绑定。左侧工作区项目列表与独立项目列表各自展示所属 API 数据，编辑和刷新不改变另一侧记录。

工作区新建会话时，预选项目列表中指定的默认项目，目录选择仍限于其 WorkspaceProject 集合；首期不提供 Bot、Agent.md、说明版本或生效方式选择。通用展示组件可复用，创建入参、许可、事务和返回值必须由 Workspace API 自身定义。

Workspace 导航允许列出并选择多个独立 Session；当前选中 Session 展示一个会话画布及其唯一 Pi Tree，切换会话时展示对应的独立历史。跨项目操作展示目标项目，不生成项目会话标签或子会话。首期不新增 Bot 或 Agent.md 管理入口，页面只能投影已定义 API 的真实结果。

共享组件通过 DTO 和 API 适配接入两种会话，不在组件中推导归属、目录权限或第二份运行状态。服务端差异包括会话归属、默认 cwd、Pi 原生工具 cwd，以及系统提示词中的 Workspace 结构体。

新增 UI 使用 Tailwind CSS。已检索官方 AI Elements File Tree（https://elements.ai-sdk.dev/components/file-tree）；它可表达目录树，但不提供服务端目录选择、工作区项目列表或默认项目单选的业务流程；本期用 Tailwind 列表、原生 radio 和目录选择器 Feature Wrapper，官方支持对应受控选择流程或项目引入配套组件体系时复核。会话复用已有 Conversation/PromptInput/上下文检查，不复制消息渲染。新建工作区使用主画布项目列表，旧 Bot 配置/协调会话入口退出当前导航；历史服务端读取能力和文件保留。Workspace 用例、数据库、Pi 装配及页面分别遵守 application/domain/ports/infrastructure/web 的依赖方向，route/page 只做入口装配。

## 8. 需求与验收状态

v1.0.0 提交复核：tests/workspace-model.test.cjs、tests/workspace-storage-migration.test.cjs、tests/workspace-session-api.test.cjs、tests/workspace-settings-api.test.cjs、tests/workspace-empty-body-api.test.cjs、tests/workspace-request-journal.test.cjs、tests/workspace-context.test.cjs、tests/workspace-runtime.test.cjs、tests/workspace-tools.test.cjs、tests/workspace-selection.test.cjs、tests/session-deletion.test.cjs、tests/file-link-preview.test.cjs、tests/markdown-response.test.cjs 共 32 项通过；npm run typecheck 和 git diff --check 通过。全部使用临时数据库/目录、受控流或 DOM，不操作用户服务和数据库，不调用真实模型，不执行全量测试或生产构建。

工作区 v1.0.0 功能完成，按用户本次确认标记交付，Git 标签 workspace-v1.0.0。范围包括独立项目集合、多会话各自独占 Pi、XML 系统上下文、Pi 原生工具、请求 journal、Memory、会话删除及源码链接右侧预览；历史库已按 §5.2 升级。用户现场确认 Markdown 渲染及部分模型采用工作区定义的效果；DeepSeek/GLM 的项目定位遵循效果仍有差异，保留当前 XML 方案。下表中的“浏览器未验收/真实模型未验收”表示未由自动化测试覆盖，不撤销本次用户确认；未运行生产构建或全量测试。§9 Bot 与 Agent.md 不属于 v1.0.0。

| ID | 已确认目标与验收方向 | 状态 |
| --- | --- | --- |
| WSP-001 | Workspace 显式表达所属 WorkspaceProject 集合；不同工作区的项目及独立 Project 均使用独立记录，各自创建、修改和归档，互不联动；项目位置来自工作区项目真实记录 | 模型/API 已接入，临时库归属与独立配置验证通过；首期不开放归档 |
| WSP-002 | 每个 Workspace 可创建多个独立 Session；每个 Session 独占一个 Pi，并在该会话内跨项目修改代码；无派发或生成项目 Session，新建不替换其他会话历史 | 已接入；多会话与 Pi 精确恢复、跨项目工具定向验证通过；真实模型未验收 |
| WSP-003 | 新增与设置页为项目列表，路径输入统一在添加目录弹窗，支持输入路径后 Enter/跳转，并在验证成功后选择；保存时服务端验证目录；名称取最后一级目录名，无名称输入和描述字段；列表默认项目为单选且属于本次保存的集合，新建会话预选该项目，既有会话不随默认项变化改写 cwd | Tailwind 页面与条件保存已接入；派生名称、默认项归属及不可变 cwd 定向验证通过；浏览器未验收 |
| WSP-006 | 保留 Pi 默认编码提示词，补充 §3 XML 工作区结构体，字段取真实记录；不加载 Agent.md、独立角色指导或 Bot，缺少这些资源不阻止创建和运行 | tests/workspace-context.test.cjs 与 tests/workspace-runtime.test.cjs 共 4 项通过：XML 项目清单、定位规则、转义与容量、旧会话恢复后的 OpenAI system payload；真实模型效果未验收 |
| WSP-007 | 单 Pi 使用原生 read/bash/edit/write 跨项目操作，相对路径取会话 cwd，跨项目取系统提示词中的绝对路径；无自定义项目工具或跨范围路径锁 | 原生工具与提示词装配按 §4 实现，定向验收见下方记录 |
| WSP-008 | Pi Tree 保留全部分支和原文，Memory 仍只总结展示；工作区会话与记忆不借独立项目记录承载归属，不读写独立项目会话和记忆 | 专属归属、完整树读取、独立总结和人工校正已接入；临时库与原生分支读取验证通过 |
| WSP-009 | 本文只保留当前定义，旧设计不作为正文或归档副本保留 | 本次文档已更新；未代表功能验收 |
| WSP-013 | 首期左侧列表导航和会话区域与 Project 同步复用通用展示及交互；Workspace 新增页面和创建流程独立定义，不沿用 Project 创建业务；归属、数据和动作来自各自 API，切换时不混入其他 Session 的历史或事件，Workspace Session 不重复列入独立项目导航 | 共用会话组件、输入与 Pi Tree 已接入；Workspace 选择隔离测试通过；浏览器未验收 |
| WSP-014 | 不同工作区之间、工作区与独立项目之间可登记相同或重叠根目录；不跨范围去重、合并、同步或判定路径占用，不以其他范围的相同路径运行产生 PROJECT_BUSY；验证两个工作区的项目配置分别修改且互不联动 | 相同目录的工作区及独立项目记录并存、配置独立测试通过；未设置跨范围路径锁 |

首期验收不依赖 Bot 或 Agent.md 的实现、格式讨论及版本策略。当前定向验证文件为 tests/workspace-model.test.cjs（归属、事务、重复路径及旧库门禁）、tests/workspace-session-api.test.cjs（HTTP、租约、幂等与 unknown）、tests/workspace-tools.test.cjs（仅附件 API 的路径校验）、tests/workspace-context.test.cjs（Pi 系统提示词）、tests/workspace-runtime.test.cjs（实际 Runtime 工具装配、精确恢复、完整分支和只读来源）以及 tests/workspace-selection.test.cjs（独立 Project 选择隔离）。这些文件分别验证当前所属契约，不将此前工具实现的结果作为原生工具验收。共享边界复查 tests/project-session-optional-role.test.cjs、tests/project-session-tree.test.cjs、tests/message-references-composer.test.cjs、tests/session-memory-summary.test.cjs 共 13 项通过；npm run typecheck 与 git diff --check 通过。全部使用临时内存库、目录和受控 Pi；未调用真实模型、未运行服务或改写用户库。旧 Bot 页面、导航和协调会话前端已移除；历史服务端读取与数据保留。应用启动只对空库初始化；缺少目标结构的已有库返回 SCHEMA_INCOMPATIBLE。本地库已按 §5.2 的用户授权显式升级，其他旧库仍须分别决定。

设置更新的请求字段回归由 tests/workspace-settings-api.test.cjs 验证：读取完整 WorkspaceDTO 后通过客户端更新名称和默认项目成功，项目身份保持不变；客户端只发送允许的写字段，服务端仍拒绝直接提交只读字段。该定向测试、修改页 TSX 语法检查与差异检查通过；未操作用户数据库或启动服务。

空正文兼容验证由 tests/workspace-empty-body-api.test.cjs 覆盖：runtime/open 接受无正文、零字节流和 {}，interrupt 接受零字节流；损坏 JSON、未知字段及容量超限仍拒绝，消息接口保持正文必填。该文件与 tests/workspace-session-api.test.cjs 共 5 项测试、类型检查和差异检查通过，使用内存库及受控 Runtime，未操作用户会话或数据库。

原生工具与系统提示词验收：tests/workspace-runtime.test.cjs 用实际 Runtime 和受控模型流验证注册表中只有 Pi 原生 read/bash/edit/write，不包含 workspace_*、project_* 或 codemode；先按默认 cwd 相对路径读取，再用第二个项目绝对路径创建、编辑、读取文件，并执行 bash pwd 验证 cwd。恢复与工作区改名后 role=system 均包含当前结构体，普通消息不含结构体或请求记账。tests/workspace-context.test.cjs 验证默认指导和项目结构；tests/workspace-tools.test.cjs 只验证附件 API 路径检查，不向模型注册工具。旧会话验证由 tests/workspace-runtime.test.cjs 先写入旧 system 工具声明和 workspace_* 调用历史，再精确恢复，检查 OpenAI Chat Completions onPayload 转换后的 messages/tools：system 包含当前全部项目绝对路径，tools 仅包含原生工具，历史原文仍保留；onPayload 截止，不发送网络请求。该测试与 tests/workspace-context.test.cjs 在 XML 格式下共 4 项通过，覆盖项目按 ID 排序、数据转义防止越出标签、转义后的容量限制，以及实际 OpenAI payload 包含当前完整 XML，git diff --check 通过。另对现场会话只读重放得到的 OpenAI payload 核实：全部 5 个项目路径在 system 中，当前 tools 仅原生四个；最新 workspace_list 尝试返回 Tool workspace_list not found，不属于仍注册或成功执行。此核查不证明真实模型一定遵循项目定位指令。三个文件共 4 项测试及类型检查通过，均使用临时目录、Pi 文件和受控流，不调用真实模型、不操作用户数据库、项目或历史。

请求记账隔离由 tests/workspace-request-journal.test.cjs（落盘、身份一致性、损坏拒绝）、tests/workspace-runtime.test.cjs（新记账不产生 custom 节点、真实工具调用与结果入树、旧节点只读兼容及冷恢复）和 tests/workspace-session-api.test.cjs（幂等、unknown、结束回执写入失败不假报确定结果）共 7 项验证通过；类型检查与差异检查通过。没有改写现场数据库或 Pi 历史，既有 custom 节点继续原文保留；新版本 Runtime 加载后才停止追加应用回执节点。

## 9. 后续计划：Agent.md 与 Bot

本节是当前后续计划，不属于首期交付、创建入参、运行前置条件或验收范围。具体模型和 API 在后续实施前另行补齐。

| ID | 后续能力 | 已明确方向与待补内容 |
| --- | --- | --- |
| WSP-004 | 新建会话可选 Bot | 接入后可选 Bot 或不选；版本采用、会话引用与切换规则后续定义 |
| WSP-005 | 独立预制 Bot | Bot 是项目 Agent.md 的集合，与 Workspace 独立；无自己的 Pi，不派发项目 Session |
| WSP-010 | 项目 Agent.md | 表达项目职责、边界、契约、修改约束与验证方式；项目适用关系、内容格式和生成/修订 API 后续定义 |
| WSP-011 | 说明与集合的版本管理 | Agent.md 保存、发布、不可变版本、Bot 集合版本与会话采用规则后续设计；不预建版本平台 |
| WSP-012 | Bot 说明装配 | 用户创建说明时无需选择生效方式；方向为保留 Pi 默认编码提示词与 Workspace 结构体，再统一补充 Bot 的项目说明；实际 Pi 装配、顺序和冲突规则后续定义 |

可评估复用既有独立 Agent 的 Markdown 存储、hash 校验和自然语言编辑能力；角色分类、能力开关、旧 Bot 派发关系不能直接作为项目说明模型。是否调整独立项目 Agent 的共有契约另行决定，不因后续计划自动改写已有 Agent、Session 或历史文件。

## WSP-015｜用户删除工作区会话

Next 工作区 catch-all 路由显式导出 DELETE；tests/session-deletion.test.cjs 通过该入口验证请求转发与删除，共 6 项通过，git diff --check 通过。现场只读 OPTIONS 检查的 Allow 已包含 DELETE；未对现场会话发送删除请求。

每个工作区会话行提供相邻的删除按钮；确认提示会话及专属记忆移除，磁盘 Pi 历史保留。DELETE /api/workspaces/:id/sessions/:sid 无正文或幂等键，调用方为导航，服务端校验同 Workspace，成功 {data:{deleted:true,sessionId}}，不存在或跨工作区 NOT_FOUND/404，重复删除 404。

会话级删除门禁在首次 await 前取得；运行、打开、压缩、记忆总结或配置更新返回 SESSION_BUSY/409，journal 未决或不可读为 REQUEST_UNKNOWN/409。与发送、打开、恢复、压缩、总结及配置更新互斥。释放空闲 Pi 句柄后在单个 SQL 事务先删除 workspace_sessions 指定 id/workspace_id 行，再删除其 session_memories 指定 id/workspace_id 行；外键 RESTRICT 失败为 SESSION_REFERENCED/409，两行均回滚。禁止修改 Workspace、WorkspaceProject、其他会话、模板、归属和 nativeRef。成功清理租约与临时状态；失败保留持久记录。只 dispose 空闲句柄，不 prompt、abort、compact 或删除/改写 Pi transcript、journal 和项目文件。不新增表、字段或迁移。显式删除是用户操作例外，不允许后台清理历史。

页面成功后移除条目，删除当前会话时回到所属工作区；失败保留条目和当前选择并显示 API 错误。按钮复用现有原生按钮及 lucide Trash2，不新增组件。状态：tests/session-deletion.test.cjs 覆盖 HTTP 归属/未知字段、空与 ended 删除、运行/unknown/压缩/记忆生成拒绝、并发打开拦截、释放失败与 FK 事务回滚、租约清理及 Pi/journal/项目文件保留；结合 tests/workspace-session-api.test.cjs、tests/project-session-lifecycle.test.cjs、tests/session-presence.test.cjs 共 12 项通过，类型检查和差异检查通过。只使用临时数据库/目录和受控 Runtime，未操作用户库或服务；浏览器未验收。

## WSP-016｜回复文件链接预览

点击回复中本地文件链接（绝对路径或默认项目相对路径）阻止浏览器导航，在右侧复用 FilePreviewPane。绝对路径按当前 Workspace 项目根目录的最长边界匹配；相对路径按本会话 defaultProjectId 定位。#L84、#L84-L90 或路径末尾 :84 定位行号；项目范围外、非法编码或读取失败显示错误，不跳转、不搜索其他目录。HTTP(S) 和纯锚点保留原行为。选择变化后丢弃过期预览响应。

GET /api/workspaces/:id/projects/:projectId/files/content?path=项目相对路径，无正文/幂等键，可信单用户只读，返回 FilePreview {path,content,size}；先校验 WorkspaceProject 归属，再校验规范根目录、相对路径和真实路径边界，拒绝越界符号链接；仅普通 UTF-8 文本、最大 512KiB。错误 NOT_FOUND/404、PATH_OUTSIDE_WORKSPACE/403、INVALID_FILE/400、FILE_TOO_LARGE/413、BINARY_FILE/415。不写数据库、不调用 Pi 或模型。基础设施实现文件读取，application 校验归属，route 只装配。复用现有预览组件，无新持久模型或迁移。状态：tests/file-link-preview.test.cjs 与 tests/markdown-response.test.cjs 共 5 项通过，覆盖跨项目路径与默认项目相对路径、行号、非法路径、API 归属/越界符号链接/大小/二进制限制、DOM 点击阻止导航、预览行滚动及高亮。类型检查与差异检查通过。只使用临时文件和受控 DOM，未调用模型、启动服务或写用户数据；真实浏览器视觉未验收。
