# 02｜数据模型

> 状态：**单项目 SessionMemory 目标模型，目标表结构与 Repository 已实现，历史库迁移须显式执行。** 本文件定义持久事实；跨项目会话、跨项目编排器、旧执行记录、跨项目任务 的下一版结构留待后续设计。现有数据库仍包含旧模型，不能因本文件更新而自动清理历史数据。

## 1. 持久化边界和关系

~~~text
Project 1 ── * Session
                 └─ 1 SessionMemory
SessionMemory 模板 ──复制──> SessionMemory
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
  | "interrupting" | "ended" | "unavailable";
~~~

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

~~~ts
type Session = {
  id: EntityId;
  projectId: EntityId;
  sessionMemoryId: EntityId; // 项目 Session 必填且唯一，映射 sessions.session_memory_id
  purpose: string;
  state: SessionState;
  nativeRef: JsonObject | null;
  nativeMetadata: JsonObject;
  createdAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
  endedAt: ISODateTime | null;
};
~~~

Session 的 Project 与所绑定 SessionMemory 的 Project 必须一致，绑定创建后不可更换。Pi transcript 由 `nativeRef` 指向原生文件，不复制为数据库消息表。Session 的模型、Agent、MCP、工具、扩展和 Skill 运行配置属于独立基础模型和 Runtime 边界，不由 SessionMemory 持有；既有 Session 配置字段的后续目标由这些基础模型单独定义。

资源所有权规则独立于 SessionMemory：Project 为空的资源是模板；复制后生成新 ID 和固定 Project 归属，项目实例的配置、凭据与调试结果互不共享。一个资源实例只用于一个 Project。不建立 SessionMemory 与资源的关联表。

## 7. SQLite 与校验约束

1. `session_memories.project_id` 非空时外键指向 Project；`source_template_id` 是指向 `session_memories.id` 的可选外键，并经约束校验目标是模板。
2. `sessions.session_memory_id` 对项目 Session 必填、唯一且不可变；`(session_memory_id, project_id)` 必须匹配同一SessionMemory，模板 SessionMemory 不可绑定 Session。
3. 新建项目 Session 时，SessionMemory 和 Session 在同一事务中创建；失败不得留下无主的SessionMemory。
4. `context_json` 必须是有效 JSON object，`draft_json` 必须为空或有效 JSON object；应用层严格验证第 3、4 节的字段、数组元素、长度及来源 ID。
7. 不因删除或归档模板而级联删除SessionMemory；被 Session 引用的SessionMemory 不可单独硬删除，历史记录优先保留。

## 8. 展示内容与原生上下文隔离

contextJson 存数据库，只供指导线展示、局部修改与独立总结，不渲染为主请求 system prompt，不写原生用户消息或 custom message。不创建本地记忆文件。Pi 原生 transcript、thinking、工具原始结果、凭据、Runtime、锁和订阅不写入记忆。

本次不改变字段、表结构、游标或已有内容，不需要历史数据迁移。字段的指导模式由固定 LLM 指令承担，不新增任意模式配置字段或资源关联。

## 9. 现有数据库与迁移决策

用户数据库已于 2026-09-30 完成一对一记忆绑定及存储改名。旧库仍须显式执行迁移；本次目标改为 session_memories 和 sessions.session_memory_id；使用独立离线改名脚本，在完整 SQLite 备份后仅重命名当前表、列及相关索引/触发器，不改记录 ID、确认内容、草稿、游标或 transcript 引用。已有历史归档表作为数据库历史保留，不接入运行用例。

未执行改名的库明确返回 SCHEMA_INCOMPATIBLE 并以只读方式打开；不在启动时自动迁移。用户决定执行后方可运行脚本，服务必须停止。临时库副本验证完整性、同项目外键和一对一唯一约束后再交付。

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

- `session_memories` 新目标列为第 5 节字段的 snake_case 映射；不保留旧 context_revision 作为本版版本机制。`context_json` / `draft_json` 设 JSON object CHECK，复杂字段由领域校验器验证。
- `session_memories` 提供 `(id, project_id)` 唯一键，`sessions.session_memory_id` 设 NOT NULL UNIQUE，并通过组合外键保证同 Project；归属和绑定通过 UPDATE 约束保持不可变。模板来源通过 INSERT/UPDATE 约束验证，删除来源模板使用 RESTRICT，项目副本不级联删除。
- Repository 提供同事务创建 Session/SessionMemory、按预期 writeETag 条件更新、总结内容与来源游标原子更新能力。检查与写入在同一短事务完成，禁止先查询再无条件更新。模型和文件读取不占用数据库事务。
- SessionMemory 生成状态、失败原因、运行任务和排队信号仅在进程内存在；当前内容和已处理来源游标才是恢复依据，历史草稿不参与同步。多进程执行部署不在本版支持范围，见 `01-architecture.md`。
- 结构初始化只面向全新空库。检测到旧结构时不得用 CREATE IF NOT EXISTS 当作兼容证明；历史库诊断和迁移决策遵循第 9 节。

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

本次统一清理：业务模型、API 和目标数据库只使用 SessionMemory/sessionMemory/session_memory_id/session_memories 命名，删除旧跨项目执行代码与协议；跨项目会话只保留无提交能力的页面入口，后续流程等待用户定义。已有数据库须离线按独立改名脚本迁移，保持 ID、JSON、原生会话引用和历史归档完整；应用启动不自动改写。

## 总结直接生效（2026-09-30）


历史 draftJson 仅保留旧数据，不再作为待办、不阻塞总结、不自动采用、不删除。新总结不创建 draftJson，模板复制直接初始化 contextJson。移除草稿编辑、确认、拒绝入口；手动总结使用 POST memory/summarize。页面只展示当前记忆、生成状态及局部修改，保存和自动更新后同步侧栏摘要。


## 14. Pi 检查投影边界

`NativeContextInspection` 字段以第 13 节为准，属于非持久化运行时 DTO；sessionState 是业务 Session 状态，runtimeReady 表示原生 Runtime 可检查，canCancelCompaction 表示用户可取消当前原生压缩。取消进行中仍表示 running，保持 Session 互斥直到 Pi 操作结束；取消不能撤销已保存的原生压缩结果。

用量改为直接读取 Pi `AgentSession.getContextUsage()` 的估算 Token。该 API 返回的估计窗口占用标记 estimated，并以读取时刻为采样时间；压缩后 Pi 返回 null 时显示 unavailable，不从旧输入 Token 或数据库正文补成假实时值。可靠固定模型容量仍由模型元数据验证；未知容量不使用 SDK 默认值。UI 不把剩余数值解释为下次请求必然可用的配额。

原生上下文 DTO 在 `domain/native-context.ts` 与浏览器 `domain/native-context.ts` 独立定义，不放在 SessionMemory 内容或模型文件中。完整历史始终由 Pi 原生存储维护，本次不修改数据库结构和历史内容。
