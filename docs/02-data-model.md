# 02｜模型：持久事实与 SQL

本文范围：独立项目、SessionMemory 和通用资源模型。Bot 的全部专属设计、模型、API、交互与需求统一见 [06｜Bot](06-bot.md)，本文不定义或复写其规则。

本文是独立项目与通用持久模型的唯一来源。每项改动先在这里定位对象、表、约束和关系，再允许 `03` 定义 API 如何改变这些事实。

每个模型写清职责、身份、归属、生命周期、不可变字段、关系、对应 SQL 表和关键约束。运行句柄、页面打开使用权及其租约、后台使用权、关闭计时器、锁、订阅、流式文本、页面草稿和 UI 阶段不是持久模型，不新增表或持久状态。派生状态必须标明来源，不能另建含糊状态。

需要新增、合并、拆分、重命名或退役表时，先完成本节要求的事实、问题、取舍、数量、关系和历史映射。未获用户明确授权，不把映射写成可执行迁移。

订阅连接 ID、ping challenge、应答期限和实时节点关联均是进程内事实，不进入 Session 或 SessionMemory。完整历史仍属于各自 Pi Session Tree，本次订阅与紧凑显示不改表、不迁移历史。

### 表数量与模型可读性

任何表结构调整先说明独立持久事实、现有问题、方案取舍、数量变化、关系总览与历史映射。不将流程机械拆表，不用任意 JSON 隐藏唯一性和必须查询的关系；迁移执行须单独授权。

## 当前规则

## 1. 持久化边界和关系
~~~text
Project ── Session ── 1 SessionMemory
Agent Markdown ── 可选的 Session 版本引用
~~~

一个项目 Session 必须且只能绑定一个SessionMemory；一个SessionMemory 只能绑定一个 Session。模板 SessionMemory 的 Project 为空且不绑定 Session。Project 可拥有多个独立的 Session/SessionMemory 对。


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

SessionState 只是原生检查和活动投影，可以实时表达准备、运行、取消中或不可用，不是持久执行结果。

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
  workspaceId?: EntityId | null; // 工作区 owner 规则见 06；历史记录缺省为空
  sourceTemplateId: EntityId | null;
  title: string;
  contextJson: SessionMemoryContext;
  draftJson: SessionMemoryDraft | null;
  lastReviewedEntryId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
~~~

独立项目与模板范围中，`projectId=null` 且 `workspaceId=null` 表示模板；projectId 非空表示只属于这个 Project 的可运行 SessionMemory。工作区 Memory 的 `workspaceId` 必填、projectId 为空，专属归属与外键见 `06`；它不是模板。`sourceTemplateId` 是可选的同表直接引用，只能指向模板 SessionMemory，记录复制来源；模板修改不自动同步给项目副本。模板可保存通用的目标与约束，`facts`、`decisions`、`nextActions` 和 `outputs` 不包含具体 Session 历史或项目路径。复制模板时生成新 SessionMemory ID，初始模板内容直接复制到 contextJson，项目副本独立。

`updatedAt` 在每次实际写入时严格递增（UTC 毫秒时间，至少比旧值多 1ms），相同内容的无变化保存不产生写入。服务端从规范化整行及 `updatedAt` 生成不透明 writeETag，作为读后写的条件凭据；不新增持久化版本号、锁字段或内容历史。

本版不使用 `跨项目关联`、`旧内容记录`、`旧执行记录` 或 `跨项目任务` 表表达SessionMemory。这些旧表在现有数据库中可能含有历史记录，何时迁移或如何保存由用户另行决定。

## 6. Session 与项目资源
项目 Session 的 Project 与 SessionMemory 绑定必填、唯一、同项目且不可变。独立项目 Session 的 Agent 引用及快照可同时为空；非空时保留历史引用，Agent 不是执行权限事实。目标库允许空角色并继续约束非空绑定。历史库强制角色的触发器不自动删除或迁移，须用户单独决定；不更改现有记录、表数量或 Pi 历史。字段见本节和“独立项目 Agent Markdown”。Pi 原生引用首次建立后不可替换或清空，完整 transcript 不复制入数据库。每个项目 Session 对应一个 Pi Session Tree，树中 entry 的身份、父子关系和内容由 Pi 原生历史保存，活动叶子由 Pi SessionManager 管理；当前运行时的叶子指针不一定在单独切换后持久化，恢复时以 Pi 恢复结果为准。历史分支不因不活动而消失。中间会话栏和 API 返回的是原生树的派生投影，不新增业务表或持久副本；本次不改 Schema、不迁移或改写历史。是否忙碌、可恢复及 Token 用量只是运行检查投影。

Agent 是独立版本化 Markdown 定义，没有 Project owner。Session 显式保存版本引用；其他资源模型另行设计，不能借 SessionMemory 保存。

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

数据库文件固定为 `.data/ai-workspace-v5.sqlite`。Project、Agent、Session 和 SessionMemory 的历史保留，结构设计不等于迁移授权，不重建数据库文件。

## 10. JSON 校验和容量
以下是本版默认上限，按 Unicode 字符计数；API 请求体另限 64KiB。服务端对人工输入、模板复制和模型输出执行同一套校验，不靠浏览器约束兜底。

| 对象 | 约束 |
| --- | --- |
| summary / goal | 每项至多 1000 字符 |
| constraints / facts / decisions / nextActions | 每组至多 20 项，每项至多 300 字符；不接受空白项 |
| outputs | 至多 20 项；title 至多 120、summary 至多 500、path 至多 512 字符 |
| ID / Hash / 时间 / Token | ID 至多 256 字符且不得为空白；Hash 为 64 位小写十六进制；时间为有效 UTC ISO 时间；Token 为 null 或非负整数 |


模板判定同时要求 projectId 与 workspaceId 均为空；模板的 facts、decisions、nextActions、outputs 必须为空；summary、goal、constraints 仅包含通用内容。模板自身 draftJson、lastReviewedEntryId、sourceTemplateId 均为 null。读取不合法的已存数据报损坏诊断，不转换成空上下文。

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

原生上下文 DTO 在 `domain/native-context.ts` 与浏览器 `domain/native-context.ts` 独立定义，不放在 SessionMemory 内容或模型文件中。完整历史始终由 Pi 原生存储维护；不新增上下文快照表。


## 15. 独立项目 Agent Markdown

独立项目会话沿用应用管理的 Agent 定义。Markdown 按 Agent ID 和不可变 revision 存为 `.data/agents/<agentId>/<revision>.md`；数据库只保存目录索引、状态、摘要和引用。参考项目和上传材料不建立 owner 或工具授权。

```ts
type AgentSnapshotRef = {
  agentId: EntityId;
  revision: number;
  kind: "coordinator" | "project";
  contentSha256: string;
  name: string;
  description: string | null;
};
```

Session 保存 id、projectId、sessionMemoryId、可空 agentId/agentSnapshot、nativeRef、purpose、state、endedAt 和创建/更新时间等既有事实。Agent 引用和快照同时为空或同时存在；Project、SessionMemory 绑定与原生身份不可替换。nativeRef 含 kind、sessionFile、sessionId、cwd，仅服务端恢复使用，原生绝对路径不单独下发。本次文档拆分不新增字段或改变约束。

保存 Agent 新版本不自动改变已有 Session 引用。明确采用时校验用途、摘要、可用性与空闲条件，保留历史版本和原生历史。正式角色的能力选择不覆盖固定模型、工具上限或项目路径保护。

## 16. 用户删除独立项目会话（PSES-012）

用户确认删除后硬删除 sessions 行及其唯一 session_memories 行；Project、Agent、模板和其他会话不变。有关联 Bot 或被历史外键引用的会话保留并返回 SESSION_REFERENCED。先删除会话再删除记忆，在同一事务完成，外键 RESTRICT 任一失败均回滚。Pi nativeRef 不被改写；对应原生文件保留在磁盘，删除后应用不再提供该会话入口。不新增字段、表或迁移，不修改既有约束。此显式删除是历史保留规则的用户操作例外，后台仍不得自动删除。
