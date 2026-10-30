# 02｜模型：持久事实与 SQL

本文是持久模型的唯一来源。每项改动先在这里定位对象、表、约束和关系，再允许 `03` 定义 API 如何改变这些事实。

每个模型写清职责、身份、归属、生命周期、不可变字段、关系、对应 SQL 表和关键约束。运行句柄、锁、订阅、流式文本、页面草稿和 UI 阶段不是持久模型。派生状态必须标明来源，不能另建含糊状态。

需要新增、合并、拆分、重命名或退役表时，先完成本节要求的事实、问题、取舍、数量、关系和历史映射。未获用户明确授权，不把映射写成可执行迁移。

### 表数量与模型可读性

协调会话需要记住每一次项目调用。这是现有目标、派发、执行和送达记录都不能代替的独立事实；沿用它们会让一次项目交互跨越多张表才能恢复。

当前取舍是使用一张 `project_calls`，字段只保留调用身份、实际发送内容、状态和 transcript 边界。不把调用状态塞进 Session，也不用 JSON 代替唯一约束。

关系保持为：Bot 拥有协调会话，协调会话拥有项目范围和项目调用，项目调用指向同一协调会话中该项目唯一的项目 Session。

数据库文件固定为 `.data/ai-workspace-v5.sqlite`。项目、Agent、Session 和 SessionMemory 保留。该文件中的 `legacy_v5_*` 与旧 Work、Task、Execution、Message 表已授权删除；`project_calls` 按当前模型新建。旧调度记录不转换成项目调用。

## 当前规则

## 1. 持久化边界和关系
~~~text
Agent Markdown（独立 ID + 不变 revision 文件；agents 表仅目录索引）
Bot ── 1 coordinator Agent 引用 + bot_projects
   └─ bot_project_agents（每个 Bot/Project 绑定项目 Agent）
BotConversation ── 固定 Project/Agent 身份范围，当前版本只经显式安全采用更新
   ├─ bot_conversation_projects → Project
   ├─ bot_conversation_project_agents → 允许的 Agent Markdown revision
   ├─ ProjectCall * → 同一协调会话和项目的一个 Session
   └─ Session（botConversationId 直接归属，多次项目调用复用）
Project ── Session ── 1 SessionMemory
~~~

一个项目 Session 必须且只能绑定一个SessionMemory；一个SessionMemory 只能绑定一个 Session。模板 SessionMemory 的 Project 为空且不绑定 Session。Project 可拥有多个独立的 Session/SessionMemory 对。

项目 Session 可独立存在；一旦纳入 Bot 协作，只归属一个总对话，归属由 Session.botConversationId 直接表达，不通过 SessionMemory 或将 Session.projectId 置空表达。Bot 导航以 Bot → 总对话 → 项目 Session 三层投影此既有父关系，不新增树关系表；Bot 项目 Session 不在 Project 导航重复出现，独立 Project Session 仍属 Project 导航。总对话不是项目 Session，不绑定 SessionMemory。


## 2. 基础类型
~~~ts
type EntityId = string;
type ISODateTime = string;
type JsonObject = Record<string, unknown>;
type ResourceStatus = "active" | "disabled" | "archived";
type SessionState =
  | "not_started" | "starting" | "idle" | "running"
  | "interrupting" | "ended" | "unavailable"; // 仅兼容原生检查/活动 DTO，不是 Session 持久状态
~~~

SessionState 只是原生检查和活动投影，不是协调会话或项目调用的持久状态。项目调用状态只见“协调会话”。原生检查可以实时表达准备、运行、取消中或不可用，不作为项目调用完成或失败的证据。

Project 继续保存独立的 `id`、`name`、`description`、`kind`、`rootPath`、`status`、`createdAt` 和 `updatedAt`。`rootPath` 是存在且可访问的规范化绝对路径；项目文件权限由执行策略决定，不在 Project 上设置通用读写模式。

## 3. SessionMemory 当前上下文
`contextJson` 必须严格符合下列结构，不接受额外字段或任意嵌套的模型输出：

~~~ts
type SessionMemoryOutput = {
  title: string;
  summary: string;
  path: string | null; // 有值时是当前 Project 内经校验的相对路径
};

type SessionMemoryContext = {
  summary: string;
  goal: string;
  constraints: string[];
  facts: string[];
  decisions: string[];
  nextActions: string[];
  outputs: SessionMemoryOutput[];
};
~~~


指导线模式固定，全部字段仅供总结与页面展示，不进入主 Pi 请求。字段含义如下：

| 字段 | 固定问题 | 提炼边界 |
| --- | --- | --- |
| summary | 当前在做什么、进展到哪里？ | 简短工作概况，关联当前话题与已有进展 |
| goal | 用户要达成什么？ | 仅提取明确目标；未表达目标可为空 |
| constraints | 必须遵守哪些边界？ | 明确要求、范围、限制，不授予执行权限 |
| facts | 当前已知什么？ | 有公开对话依据的事实；矛盾和未核验结论显式标注，不升级为确定事实 |
| decisions | 已决定什么？ | 区分实际决定和建议；未采纳建议不记为决策 |
| nextActions | 对话中已提出哪些下一步？ | 记录尚待处理的行动，不自行创造新任务或调用工具 |
| outputs | 已产出什么？ | 标题、摘要及可选安全相对路径，不复制完整产出 |

人工修改校正对应字段，后续独立总结遵循这些校正，不反馈到主会话。空结构仍保留全部字段，无依据时不编造内容。SessionMemory 不保存工具、扩展、Agent、MCP、Skill 的 ID、配置、凭据、快照或启用选择。

## 4. 历史草稿兼容结构
`SessionMemoryDraft` 仅用于读取历史 draftJson，保留既有 id、context、baseContextHash、source、来源两端 ID、Token 用量和 generatedAt 结构。新总结不生成该对象。历史值不进入模型输入、不阻塞任务、不自动采用、不静默清空；不再提供确认或拒绝 API。现有字段无需迁移，类型校验继续防止损坏数据被当作空记忆。

## 5. SessionMemory 表
~~~ts
type SessionMemory = {
  id: EntityId;
  projectId: EntityId | null;
  sourceTemplateId: EntityId | null;
  title: string;
  contextJson: SessionMemoryContext;
  draftJson: SessionMemoryDraft | null;
  lastReviewedEntryId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
~~~

`projectId=null` 表示模板；非空表示只属于这个 Project 的可运行 SessionMemory。`sourceTemplateId` 是可选的同表直接引用，只能指向模板 SessionMemory，记录复制来源；模板修改不自动同步给项目副本。模板可保存通用的目标与约束，`facts`、`decisions`、`nextActions` 和 `outputs` 不包含具体 Session 历史或项目路径。复制模板时生成新 SessionMemory ID，初始模板内容直接复制到 contextJson，项目副本独立。

`updatedAt` 在每次实际写入时严格递增（UTC 毫秒时间，至少比旧值多 1ms），相同内容的无变化保存不产生写入。服务端从规范化整行及 `updatedAt` 生成不透明 writeETag，作为读后写的条件凭据；不新增持久化版本号、锁字段或内容历史。

本版不使用 `跨项目关联`、`旧内容记录`、`旧执行记录` 或 `跨项目任务` 表表达SessionMemory。这些旧表在现有数据库中可能含有历史记录，何时迁移或如何保存由用户另行决定。

## 6. Session 与项目资源
项目 Session 的 Project 与 SessionMemory 绑定必填、唯一、同项目且不可变。独立项目 Session 的 Agent 引用及快照可同时为空；非空时保留历史引用，Agent 不是执行权限事实。目标库允许空角色并继续约束非空绑定。历史库强制角色的触发器不自动删除或迁移，须用户单独决定；不更改现有记录、表数量或 Pi 历史。字段见“Bot、协调会话与可复用项目 Session”。Pi 原生引用首次建立后不可替换或清空，完整 transcript 不复制入数据库。是否忙碌、可恢复及 Token 用量只是运行检查投影。

Agent 是“Agent Markdown 与 Bot 绑定”中的独立 Markdown 定义，没有 Bot 或 Project owner。运行关系只在 Bot、协调会话和 Session 显式建立。其他资源模型另行设计，不能借 SessionMemory 保存。

## 7. SQLite 与校验约束
1. `session_memories.project_id` 非空时外键指向 Project；`source_template_id` 是指向 `session_memories.id` 的可选外键，并经约束校验目标是模板。
2. `sessions.session_memory_id` 对项目 Session 必填、唯一且不可变；`(session_memory_id, project_id)` 必须匹配同一SessionMemory，模板 SessionMemory 不可绑定 Session。
3. 新建项目 Session 时，SessionMemory 和 Session 在同一事务中创建；失败不得留下无主的SessionMemory。
4. `context_json` 必须是有效 JSON object，`draft_json` 必须为空或有效 JSON object；应用层严格验证“SessionMemory 当前上下文”和“历史草稿兼容结构”的字段、数组元素、长度及来源 ID。
7. 不因删除或归档模板而级联删除SessionMemory；被 Session 引用的SessionMemory 不可单独硬删除，历史记录优先保留。

## 8. 展示内容与原生上下文隔离
contextJson 存数据库，只供指导线展示、局部修改与独立总结，不渲染为主请求 system prompt，不写原生用户消息或 custom message。不创建本地记忆文件。Pi 原生 transcript、thinking、工具原始结果、凭据、Runtime、锁和订阅不写入记忆。

指导线展示阶段不改变 SessionMemory 字段、表结构、游标或已有内容。字段的指导模式仍由固定 LLM 指令承担，不新增任意模式配置字段或资源关联。

## 9. 现有数据库与迁移决策

数据库文件固定为 `.data/ai-workspace-v5.sqlite`。项目、Agent、Session 和 SessionMemory 保留。用户已授权删除该文件中的多余表并新建当前缺失表：删除全部 `legacy_v5_*` 表，以及旧调度表 `bot_works`、`bot_tasks`、`bot_task_dependencies`、`bot_executions`、`bot_messages`；新建 `project_calls` 及其索引和身份约束。不把旧调度记录转换成项目调用，不重建数据库文件。

## 10. JSON 校验和容量
以下是本版默认上限，按 Unicode 字符计数；API 请求体另限 64KiB。服务端对人工输入、模板复制和模型输出执行同一套校验，不靠浏览器约束兜底。

| 对象 | 约束 |
| --- | --- |
| summary / goal | 每项至多 1000 字符 |
| constraints / facts / decisions / nextActions | 每组至多 20 项，每项至多 300 字符；不接受空白项 |
| outputs | 至多 20 项；title 至多 120、summary 至多 500、path 至多 512 字符 |
| ID / Hash / 时间 / Token | ID 至多 256 字符且不得为空白；Hash 为 64 位小写十六进制；时间为有效 UTC ISO 时间；Token 为 null 或非负整数 |


模板的 facts、decisions、nextActions、outputs 必须为空；summary、goal、constraints 仅包含通用内容。模板自身 draftJson、lastReviewedEntryId、sourceTemplateId 均为 null。读取不合法的已存数据报损坏诊断，不转换成空上下文。

## 11. 数据库和 Repository 落地边界
- `session_memories` 新目标列为“SessionMemory 表”字段的 snake_case 映射；不保留旧 context_revision 作为本版版本机制。`context_json` / `draft_json` 设 JSON object CHECK，复杂字段由领域校验器验证。
- `session_memories` 提供 `(id, project_id)` 唯一键，`sessions.session_memory_id` 设 NOT NULL UNIQUE，并通过组合外键保证同 Project；归属和绑定通过 UPDATE 约束保持不可变。模板来源通过 INSERT/UPDATE 约束验证，删除来源模板使用 RESTRICT，项目副本不级联删除。
- Repository 提供同事务创建 Session/SessionMemory、按预期 writeETag 条件更新、总结内容与来源游标原子更新能力。检查与写入在同一短事务完成，禁止先查询再无条件更新。模型和文件读取不占用数据库事务。
- SessionMemory 生成状态、失败原因、运行任务和排队信号仅在进程内存在；当前内容和已处理来源游标才是恢复依据，历史草稿不参与同步。多进程执行部署不在本版支持范围，见 `01-architecture.md`。
- 结构初始化只面向全新空库。检测到旧结构时不得用 CREATE IF NOT EXISTS 当作兼容证明；历史库诊断和迁移决策遵循“现有数据库与迁移决策”。

## 12. 记忆同步进度的事实来源
每次完整公开回答稳定后增量更新，已处理位置仍为 lastReviewedEntryId。当前活动分支完整回答数减去游标及之前的完整回答数，得到 pendingAnswerCount；不新建计数、消息或内容版本表。Pi 压缩条目、工具轮次、失败及中止回答不算成功完成回答。

GET memory 返回派生字段 syncState（synced/updating/pending/failed/unavailable），pendingAnswerCount 和 memoryUpdatedAt；synced 仅指已完成的公开回答都被处理，不指仍在生成的半条回答。updating 表示独立 LLM 正在处理，pending 表示还有已完成来源待处理，failed/unavailable 如实显示错误；当前内容及游标来自数据库，运行状态不持久化。旧 nextAutoSummaryAt/answersUntilAutoSummary/retryAfterSeconds 字段撤销，页面不再表示周期阈值或冷却。

人工修改不推进来源游标，只更新当前内容和 writeETag。LLM 任务原基线过期不写入，重读最新人工修正再总结；历史 draftJson 保持只读兼容且不参与同步。无需改表或迁移历史记录。

## 13. 原生上下文使用情况（运行时 DTO）
下列指标属于 Pi Session 的安全运行时读取结果，不是 SessionMemory 内容，不写入 session_memories，不新增指标快照或压缩历史表。Pi 原生压缩结果与压缩记录由原生 SessionManager 保存，数据库继续只保留 nativeRef。

~~~ts
type NativeContextUsage = {
  usedTokens: number | null;
  contextWindowTokens: number | null;
  remainingTokens: number | null;
  usageRatio: number | null; // used / contextWindow；可超过 1，不静默钳制
  measurement: "native" | "estimated" | "unavailable";
  measuredAt: ISODateTime | null;
  freshness: "current" | "last_known" | "unavailable";
};

type NativeContextInspection = {
  sessionState: SessionState;
  runtimeReady: boolean;
  canCancelCompaction: boolean;
  usage: NativeContextUsage;
  autoCompactionEnabled: false;
  compactionState: "idle" | "running" | "cancelled" | "failed";
  canCompact: boolean;
  unavailableReason: string | null;
  lastCompactedAt: ISODateTime | null;
  error: { code: string; message: string; recoverable: boolean } | null;
};
~~~


容量来自固定服务端模型的可靠元数据，不由浏览器或 SessionMemory 设置。容量未知时 remainingTokens / usageRatio 为 null；否则 remainingTokens=max(0,window-used)。指标数值必须有限且 Token 非负整数，null 表示未知，不能显示为 0。输出预留和下一条尚未提交的用户文本不属于已用输入，不能将“剩余”解释为可安全发送的保证。

运行中的状态、错误及实时指标不承诺进程重启恢复；最近压缩时间仅在 Pi 原生历史可验证时恢复，否则为 null。手动压缩不修改 SessionMemory 当前内容、草稿、来源和审阅游标。

Session 安全 DTO 的 `memorySummary` 派生自绑定 SessionMemory 的当前生效 `contextJson.summary`，不新增数据库字段，不读取 draftJson，不改写 Session.purpose。

已有 SessionMemory 数据保留。应用启动不自动改写数据库，也不恢复旧实体或旧协议。

## 14. Pi 检查投影边界
`NativeContextInspection` 字段以“原生上下文使用情况”为准，属于非持久化运行时 DTO；sessionState 是业务 Session 状态，runtimeReady 表示原生 Runtime 可检查，canCancelCompaction 表示用户可取消当前原生压缩。取消进行中仍表示 running，保持 Session 互斥直到 Pi 操作结束；取消不能撤销已保存的原生压缩结果。

用量改为直接读取 Pi `AgentSession.getContextUsage()` 的估算 Token。该 API 返回的估计窗口占用标记 estimated，并以读取时刻为采样时间；压缩后 Pi 返回 null 时显示 unavailable，不从旧输入 Token 或数据库正文补成假实时值。可靠固定模型容量仍由模型元数据验证；未知容量不使用 SDK 默认值。UI 不把剩余数值解释为下次请求必然可用的配额。

原生上下文 DTO 在 `domain/native-context.ts` 与浏览器 `domain/native-context.ts` 独立定义，不放在 SessionMemory 内容或模型文件中。完整历史始终由 Pi 原生存储维护；Bot 检查复用同一指标语义，不新增上下文快照表。

## 15. Bot、协调会话与可复用项目 Session

Bot 保存长期协调配置，不保存对话历史。协调会话是 Bot 下的独立 Pi Session，负责观测、修正和传递，不直接读写项目代码。项目 Session 不是它的子会话。

~~~ts
type Bot = {
  id: EntityId;
  name: string;
  description: string | null;
  workingDirectory: string; // 创建后不可变；留空则使用 .data/bots/<botId>/workspace
  workspaceKind: "user_selected" | "managed"; // 与工作目录同时固定
  coordinatorAgentId: EntityId | null;
  coordinatorAgentSnapshot: AgentSnapshotRef | null;
  maxParallelExecutions: number; // 1..8，只限制不同项目的并行调用
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

type BotConversation = {
  id: EntityId;
  botId: EntityId; // 不可变
  title: string;
  coordinatorAgentId: EntityId;
  coordinatorAgentSnapshot: AgentSnapshotRef; // 创建时复制，只能经同 Agent 显式采用更新
  nativeRef: { kind: "pi"; sessionFile: string; sessionId: string; cwd: string } | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
};

type ProjectSession = {
  id: EntityId;
  projectId: EntityId;
  sessionMemoryId: EntityId;
  botConversationId: EntityId | null; // 首次纳入后不可变，不能转移到其他协调会话
  agentId: EntityId;
  agentSnapshot: AgentSnapshotRef;
  nativeRef: { kind: "pi"; sessionFile: string; sessionId: string; cwd: string } | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
};
~~~

Bot 没有协调 Agent 时可以保存，但不能创建协调会话。协调会话没有目标、调度模式或归档状态；删除是物理删除，不是改成归档。原始用户输入只保存一次，它属于协调 Pi transcript，不另建消息表。

项目 Session 仍保留独立项目会话所需的状态、结束时间和项目资源字段。这些字段不能表达项目调用是否完成。纳入协调会话后，用户不能绕过该会话直接向该 Session 输入。

## 16. 协调会话

协调会话通过项目调用观测项目 Session。项目调用不是 Work、Task、Execution 或 Message，也不保存项目返回的副本。

| 对象 | 职责 | 不包含 |
| --- | --- | --- |
| 协调会话 | 用户对话、实际发送内容、项目调用和汇总 | 项目代码、项目 transcript |
| 原始输入 | 用户提示词只保存一次，是最终目标 | 预先划分的项目范围 |
| 实际发送 | 默认原样发送；只有项目返回不足以确认时才修改或拆分 | 必须改写后的第二份任务说明 |
| 项目会话 | 同一协调会话和同一项目只有一个独立 Pi Session | 其他项目会话的访问权限 |
| 项目调用 | 调用 ID、目标项目会话、实际发送内容、状态和 transcript 起止条目 | 没有状态的调用 |
| 项目返回 | `completed` 后按起止条目读取 assistant 原文 | 固定 JSON、字段或章节 |
| 桥梁插件 | 只加载在协调会话上，负责启动、订阅、读取、`prompt` 和 `steer` | 项目会话之间的直接通道 |

项目调用状态只允许：

| 状态 | 事实 | 不能做 |
| --- | --- | --- |
| `accepted` | 调用已保存，项目 Session 尚未确认开始 | 读取输出、视为完成 |
| `working` | 项目 Session 已开始处理这次调用 | 读取最终输出 |
| `completed` | 收到未中止的 `agent_settled`，结束条目已保存 | 把进度信号当成输出 |
| `aborted` | 调用已中止，没有可交付结果 | 传递或汇总为结果 |
| `unknown` | 无法确认启动、结束或结果边界 | 自动重试、传递或视为失败 |

调用身份：

- 调用 ID 由应用生成。
- 同一协调会话、项目、原始输入和实际发送内容重复提交时，返回已有调用。
- 项目 Session ID 在首次成功启动后不可替换。
- 原始输入指向用户消息，实际发送内容保存后不可改。
- 起始条目在 `working` 时写入，结束条目只在 `completed` 时写入。
- 进度可以在重启后丢失；调用状态和 transcript 边界不能丢失。

同一项目 Session 同时只能有一个 `accepted` 或 `working` 调用。不同项目可以并行，数量不超过 Bot 并发上限。`unknown` 在明确放弃前不释放该项目 Session。

~~~ts
type ProjectCall = {
  id: EntityId; // 应用生成，不可变
  conversationId: EntityId;
  projectId: EntityId;
  sessionId: EntityId | null; // 首次成功启动后不可替换
  sourceEntryId: string; // 指向协调 transcript 中只保存一次的原始用户输入
  sentContent: string; // 保存后不可改
  status: "accepted" | "working" | "completed" | "aborted" | "unknown";
  startEntryId: string | null; // 只在 working 时写入
  endEntryId: string | null; // 只在 completed 时写入
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
~~~

相同协调会话、项目、原始输入和实际发送内容只对应一次调用。进度不持久化；调用状态和 transcript 起止条目必须持久化。项目返回不另存字段，只在 `completed` 后按起止条目读取。

有界进度只由插件在内存中计算：`accepted` 为尚未开始，`working` 为处理中，终态为已结束。进度不包含 assistant 原文、工具结果、路径或百分比。

项目调用在新库中对应 `project_calls`。旧库中的 Work、Task、Execution 或 Message 表不改作项目调用表，也不复制到新库。

## 17. 项目范围与导航

协调会话只能使用本会话复制的项目范围。项目 Agent 定义只提供功能、职责和边界，不证明项目代码事实。项目文件、代码、测试和运行状态只能通过项目调用取得；用户在当前输入中显式选择的文件快照例外。本轮参考包括用户上传的文件内容、用户选择的项目文件快照，以及协调会话所属 Bot 工作目录文件快照；上传与项目及 Bot 工作目录无关，项目文件属于所属项目或协调会话绑定的活动项目，Bot 工作目录由服务端读取所属 Bot 记录；该例外不扩大协调 Agent 的工具权限。参考文件不是独立持久业务对象，不建立授权关系；其内容快照只进入所属 Pi Session 的不可见关联消息，随原生历史保留；不投影文件名、正文、来源路径或绝对路径。该快照仅供本次用户输入发起的运行使用，不能作为后续模型请求的原始参考材料；模型已产生的回答或工具结果仍可能保留材料衍生信息。

协调会话不注册项目搜索、项目文件或项目运行工具。Bot 工作目录与任何已登记 Project.rootPath 重叠时，协调会话的文件工具拒绝访问。

导航只投影既有归属：Bot→协调会话→`Session.botConversationId` 指向本会话的项目 Session。项目 Session 不在 Project 树重复列出。顶部标签在协调 transcript 和这些项目 transcript 间切换，不复制任何一方的内容。

## 18. Agent Markdown 与 Bot 绑定

Agent 是独立版本化 Markdown，没有 Bot 或 Project owner。数据库只保存目录索引、状态、摘要和关系，不保存新版本正文。正文按 Agent ID 和不可变 revision 保存为 `.data/agents/<agentId>/<revision>.md`。

~~~ts
type AgentSnapshotRef = {
  agentId: EntityId;
  revision: number;
  kind: "coordinator" | "project";
  contentSha256: string;
  name: string;
  description: string | null;
};
~~~

关系只有以下四类：

| 关系 | 表 | 不可变事实 |
| --- | --- | --- |
| Bot 默认协调 Agent | `bots.coordinator_agent_id` 与快照 | 只影响后续新协调会话 |
| Bot 项目范围 | `bot_projects` | Bot 与 Project 的允许组合 |
| Bot 项目 Agent | `bot_project_agents` | 每个 Bot/Project 允许的项目 Agent 版本 |
| 协调会话快照 | `bot_conversation_projects`、`bot_conversation_project_agents` | 创建时复制，后续 Bot 配置不回写 |

创建 Agent、选择参考项目或上传 Markdown 都不建立上述关系。能力默认关闭，只有用户明确选择才开启。已开始的项目调用继续使用启动时绑定的 Agent 版本。

同 Agent 的新版本只能在没有未完成项目调用时显式采用。采用不改变历史调用，也不能把协调 Agent 替换成另一个 Agent。
