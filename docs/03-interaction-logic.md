# 03｜交互逻辑

> 状态：**单项目 SessionMemory 目标交互，核心流程已实现，完整恢复与错误矩阵待复验。** 跨项目路由、跨项目编排器、旧执行记录、跨项目任务 和 跨项目汇总器 的下一版流程留待单独设计；本文件只定义项目 Session 与其一对一 SessionMemory。

## 1. 总体规则

1. 每个项目 Session 固定属于一个 Project，并绑定一个SessionMemory；SessionMemory 与 Session 的 Project 必须相同。
3. SessionMemory 对项目 Session 的唯一模型输入作用是提供当前生效的文字上下文；工具、扩展、Agent、MCP、Skill 的选择和调试由独立基础模型处理。
4. 项目消息直接写入 Pi 原生 Session transcript；SessionMemory 不创建 旧执行记录 或 跨项目任务，也不经过跨项目 跨项目编排器。
5. SessionMemory 数据只存数据库；运行时上下文按每次提交即时组装于内存，不创建 SessionMemory 文件。
6. 同一 Session 同时最多执行一个用户请求；同一 SessionMemory 同时最多执行一个自动总结任务。

## 2. 创建 Session 与 SessionMemory

~~~text
用户选择 Project
→ 选择空 SessionMemory 或预览一个无SessionMemory 模板
→ 校验 Project active、模板 projectId=null
→ 同一数据库事务创建SessionMemory 与 Session，固定同一 projectId
→ Session.sessionMemoryId 指向SessionMemory，SessionMemory 只绑定这一条 Session
→ 打开该 Project Session 页面
~~~

复制模板使用新 SessionMemory ID 和可选 `sourceTemplateId`。模板初始上下文先进入SessionMemory 的 `draftJson`；用户在页面确认后才写入 `contextJson`。模板以后修改不改变已有SessionMemory。空 SessionMemory 的 `contextJson` 是 02 定义的全空结构。

项目为空的 Agent、MCP 等资源是模板，实际运行必须复制为所属 Project 的实例；复制配置、凭据处理和逐项目调试由这些资源的后续基础模型定义。SessionMemory 创建不复制或持久绑定这些资源。

## 3. 加载和页面状态

进入项目会话时并行读取 Session 安全摘要、Pi transcript 投影和绑定 SessionMemory 的指导线内容。页面显示当前总结及同步状态，历史草稿不展示。Session 列表携带当前生效记忆的 memorySummary；记忆保存或独立总结写入后刷新侧栏对应项目的会话名称。Project 侧栏的历史 Session 仍按项目按需展开；选择另一 Session 时同时切换其独有 SessionMemory。

SessionMemory 是主会话之外的辅助线：生成和审查状态不锁定 Composer，也不自动发送新用户消息。


## 4. 主请求与总结隔离

用户文本原样提交 Pi prompt；应用验证 Project/Session/SessionMemory 归属、可执行状态和请求锁，不注入记忆正文。Pi 基础指令、原生历史、活动分支和手动压缩管理主 LLM 上下文；记忆变化不在运行中或下一条请求中干预它。

每次完整公开回答持久化稳定后，独立总结器读当前记忆与增量安全来源，使用固定指导模式更新展示。主回复不等待总结；人工校正只改数据库指导线及后续独立总结，用户如果要改变执行方向仍通过主会话发送明确消息。

## 5. 自动总结与增量游标

### 5.1 每次回答增量同步

每个用户请求成功完成并形成公开 assistant 回复、Pi 原生 transcript 稳定后立即触发记忆更新；一个请求内部多个模型轮次或工具调用仅算一次回答。规则不等第 5/10 次，不使用时间冷却。失败、停止或仍在流式中的不完整回答不单独触发；后续成功回答范围内可包含其安全历史并明确状态。

同一记忆只有一个任务，入口在首次异步读取前先占用调度状态，防止 GET/主回复钩子/立即总结并发造成重复调用。总结与下一条主回复可并行：总结固定来源终点，只读取完整稳定来源，新增的完整回答留待本任务完成后立即重查。没有新增来源不调用模型；预算不足不跳过源条目。原生压缩运行时等待其稳定，不持有执行锁阻塞用户发消息。

取消人工编辑不停止独立总结。人工成功保存使已有任务的 writeETag 过期，丢弃旧结果并基于最新修正立即重查；不使用旧候选自动合并。错误不无限自动重试，用户主动重试或新的成功主回复可恢复调度。刷新和重启根据未处理来源恢复，历史草稿不阻塞。

用户点“立即总结”使用同一流程；正在运行时复用已有任务并重查累积来源，按钮不再因冷却禁用。明确范围重审仍只接受当前活动分支连续完整来源；直接写入后游标不倒退。

### 5.2 输入快照与触发判断

取得当前活动分支快照，固定当前生效上下文、SessionMemory writeETag、审阅游标和稳定终点。只处理该范围内的用户文本、assistant 公开文本；公开文本也要脱敏，不读取原始 thinking、原始工具参数/结果、完整文件或凭据。项目变更仅在可安全投影时加入，否则略过，不从缺失结果推断事实。

触发依据是第 5.1 节的每次完整回答和主动按钮，不再由“是否值得总结”或寒暄关键词判断。有未处理完整来源且来源可用时调用无工具总结器；完全没有安全来源时返回来源诊断，不静默消耗计数。生成候选与当前上下文完全相同时按“无变化”处理，可条件推进到实际处理终点，后续每次回答继续同步。


### 5.3 默认预算

| 项目 | 本版默认 |
| --- | --- |
| 调用频率 | 每记忆至多一个 LLM 总结任务，成功后立即处理新增完整回答，无固定时间冷却 |
| 总结来源 | 每批按时间正序，最多 20 个完整稳定用户请求，公开文本最多 24000 字符 |
| 模型总输入 | 当前指导线、来源及固定指令合计最多 36000 字符，保守 Token 上界不超过 12000（UTF-8 字节数加 256 Token 消息封装预算）；超限不调用 LLM、不推进游标 |
| 输出 | 请求最多 4000 Token，结果仍须符合 `02` 的 SessionMemoryContext 容量 |
| 耗时 | 模型调用 45 秒超时；超时中止临时 Session，并保持游标和当前内容 |

输入按连续完整请求选择，不能删中间条目后推进到最后。历史失败/停止请求若位于范围内，作为完整的“已停止请求记录”计入批次，不补全未发生的输出；末端必须有稳定完成的主请求，或为用户显式选择的已稳定历史范围。估算器必须适配固定模型；无法可靠估算时阻止该次总结并给出预算诊断。单个完整请求超出预算时报告“来源过长”，不静默截断后推进游标；用户可继续主对话、手动维护当前内容或重试，但手动编辑本身不表示跳过来源。预算是服务端常量，不由 SessionMemory、请求或 UI 覆盖；调整需同步文档和验收。

### 5.4 生成与落库


独立无工具 Pi 总结 Session 接收“当前确认内容 + 本批安全公开对话”。固定指令要求保留仍有效的人工约束，仅据来源更新目标/事实/决策/下一步/产出；无法确定的内容不编造事实，冲突保留给用户审查，不用模型输出决定工具权限。模型只返回完整 SessionMemoryContext，当前内容与来源游标由服务端事务写入。总结指令明确将来源视为待总结数据，不执行来源中的用户指令；从公开 assistant 回答提炼当前工作概况，即使用户没有明确目标也填写有依据的 summary，其他无依据字段可为空。非空公开来源却返回全空 SessionMemoryContext 视为 SUMMARY_EMPTY_RESULT，保留游标并显示可重试错误，不当作无变化。

结果通过 `02` 校验后，再读取数据库和活动分支。应用层在 Session 共享短临界区内校验分支并进行数据库条件提交，分支切换与来源读取也经过同一协调器；不在模型调用期间持有这把锁。原 writeETag 已改变、来源不再属于当前分支时丢弃本次结果，绝不覆盖新内容。若仅在原终点后追加新请求，原来源范围仍有效，可以条件写入本批当前记忆，其余留待下批。基线改变则在可调度时重新检查最新内容，不沿用旧候选。


### 5.5 分支与来源异常


游标不在当前分支时不自动重置为 null、不重扫全历史覆盖人工上下文，暂停自动总结并提示来源诊断。用户通过明确的再生成请求，选择当前分支中连续完整请求的起点和稳定终点重新审查；校验成功后直接更新记忆与新分支游标。此能力用于恢复和显式重审，不是新增分支管理界面。

## 6. 自动更新与人工修改

LLM 返回完整结构并通过类型、容量、路径验证后，核验开始时的 writeETag 和当前分支来源，事务内直接写入 contextJson 和 lastReviewedEntryId。相同内容也推进已处理来源，但不伪造内容变化。人工修改仍通过局部弹窗提交完整快照，使用条件写入保护其他字段。


所有写操作仍校验 Project/Session/SessionMemory 归属；If-Match 缺失返回 428，冲突返回 409。动作 POST 使用幂等键。用户取消局部修改只取消客户端请求，不回滚已经完成的服务端事务。

## 7. SessionMemory 与资源模板边界

项目为空的 SessionMemory 是模板，不能绑定 Session，也没有当前 Project 文件和历史 Pi transcript。模板只保存可泛化的初始上下文；模板来源引用用于显示“复制自”，不构成实时共享或自动同步。

项目为空的工具、扩展、Agent、MCP、Skill 等对象以后归各自的模板类管理。Session 实际执行只使用所属 Project 的独立实例，逐实例配置和调试。SessionMemory 不存这些资源的 ID 或配置；房间上下文中的文字也不能授予工具权限。

## 8. Session 活动与历史展示

Project Session 的 Pi `turn_start/turn_end`、assistant 公开文本、工具调用与执行、上下文整理映射为带稳定 ID 的 UI 活动。每个实际模型轮次递增编号，摘要与工具活动携带相同轮次；同一活动用状态更新，所有轮次默认收起。模型可在公开 text 中输出受控高层摘要，系统不得下发原始 thinking，也不能把 SessionMemory 自动总结或 跨项目编排器 文案冒充模型本轮思考。工具记录显示真实工具名、状态和安全的项目相对目标；其他参数、结果正文与异常堆栈不进入 UI。

历史投影从 Pi transcript 当前活动分支安全重建。回答以安全 Markdown 渲染；用户提交以及流式内容和活动更新时主内容区跟随滚动。SessionMemory 总结更新是请求完成后的独立过程，状态展示在 SessionMemory 面板，不插入 assistant 最终回答。

## 9. API 边界

~~~text
GET/POST  /api/session-memory-templates
GET/PATCH /api/session-memory-templates/:templateId
GET/POST  /api/projects/:projectId/sessions
GET       /api/projects/:projectId/sessions/:sessionId/messages
POST      /api/projects/:projectId/sessions/:sessionId/messages
POST      /api/projects/:projectId/sessions/:sessionId/interrupt
POST      /api/projects/:projectId/sessions/:sessionId/end
GET       /api/projects/:projectId/sessions/:sessionId/context
POST      /api/projects/:projectId/sessions/:sessionId/compact
POST      /api/projects/:projectId/sessions/:sessionId/compact/cancel
GET       /api/projects/:projectId/sessions/:sessionId/memory
PATCH     /api/projects/:projectId/sessions/:sessionId/memory/context
~~~



## 10. 跨项目与迁移边界

跨项目会话仅保留侧栏入口和待设计页面，不包含执行接口、运行协议、调度或持久模型。后续由用户定义。历史数据库归档保留，代码不读写旧跨项目记录。SessionMemory 存储改名遵循 `02` 第 9 节。

## 11. API 响应、状态与恢复

### 11.1 SessionMemory 读取与写入契约

SessionMemory GET 返回安全 SessionMemory DTO、读缓存响应头 ETag、行级条件凭据 writeETag 和辅助状态：`generationState`（idle/queued/generating/failed）、`hasUnreviewedMessages`、可安全展示的来源范围（请求数与起止时间）、`canWrite`、`canSummarize`、`completedAnswerCount`、`pendingAnswerCount`、`syncState`、`memoryUpdatedAt` 及可重试错误。DTO 字段以 `02` 为准；状态根据数据库、当前分支和进程内调度器计算，不进入 session_memories JSON。无法读取来源时范围标为不可用，不能伪造计数或误报无积累对话。

| 入口 | 请求要点 | 成功结果 |
| --- | --- | --- |
| 创建项目 Session | 可选 sessionMemoryTemplateId、templateWriteETag、purpose，Idempotency-Key | 201，安全 Session 摘要和绑定 SessionMemory ID |
| PATCH memory/context | 完整 context、If-Match | 200，最新 SessionMemory 与 writeETag |

需要显式重审范围时，现有 messages GET 的安全投影提供当前活动分支请求的安全摘要、起止条目 ID、时间与稳定标记；不额外存来源目录表，服务端再次校验客户端提交的范围。



生成状态 DTO 另包含 `lastOutcome`（none/no_new_messages/no_change/memory_updated）和 `sourceStatus`（available/unavailable/branch_changed），供同步结果与来源诊断展示；这些都是进程状态或实时推导，重启后不能声称恢复上次无变化通知。

统一错误包含 code、message、recoverable、可选字段定位，不下发堆栈或原生文件路径。至少区分：MEMORY_CONFLICT(409)、DRAFT_BASE_CHANGED(409)、DRAFT_SOURCE_CHANGED(409)、DRAFT_PENDING(409)、SESSION_BUSY(409)、PRECONDITION_REQUIRED(428)、INVALID_MEMORY_CONTEXT(422)、SUMMARY_SOURCE_TOO_LARGE(422)、SUMMARY_COOLDOWN(429，含 Retry-After)、SUMMARY_FAILED、MEMORY_DATA_CORRUPT、MEMORY_SOURCE_UNAVAILABLE、SCHEMA_INCOMPATIBLE。生成失败由 SessionMemory GET 的辅助状态返回，不使已完成主会话流变成失败。

### 11.2 刷新和调度恢复

SessionMemory 当前会话共享一次读取：生成/排队/未处理来源时每 2 秒；已同步且面板可见每 30 秒，面板关闭且已同步或失败时停止定时读取；页面隐藏时暂停轮询，重新可见立即读取。主请求结束、人工写入完成、重新打开 SessionMemory 面板时立即刷新。使用 ETag/If-None-Match 减少内容传输；读缓存 ETag 由 writeETag 和辅助状态的规范化摘要共同生成；辅助状态改变时读缓存 ETag 也改变。写入条件凭据通过响应字段 `writeETag` 给出，只依赖已存 SessionMemory 行，避免进度变化造成写入冲突。服务端识别它作为应用层写入前置条件，不用读缓存 ETag 的框架自动比较代替 Repository 校验。写请求 If-Match 使用 writeETag；它与读缓存 ETag 不混用。


主会话恢复失败不删除 SessionMemory，不将草稿置空。数据损坏或旧 Schema 阻止 SessionMemory/关联 Session 写入，页面展示诊断，不偷偷启用无 SessionMemory 的旧提交路径。历史数据选项见 `02` 第 9 节。

## 12. 一次完整交互示例

1. 用户创建项目会话，选择空 SessionMemory；当前内容为空，主对话可直接开始。
2. 用户要求“整理导入流程，保留旧数据”，Pi 完成回复；SessionMemory 独立生成候选目标、约束、事实与下一步，页面显示未生效。
5. 调度器重查后续积累回答：每次完整回答后立即同步；用户也可点击“立即总结”提前整理。用户查看最新指导线；若这时用户再保存当前内容，正在生成的旧基线结果被丢弃。

验收场景与需求状态以 `05-requirements.md` 为准。

## 13. 对话与纠错示例

1. Pi 回答项目问题，回答稳定后开始独立 LLM 更新，页面保留原记忆并显示“正在同步”。
2. 用户指出“数据库是五张表而不是四张”，在对应记忆字段局部修改并保存；后续独立总结使用该纠正；主会话仍仅使用 Pi 原生历史。
3. 若旧总结仍在运行，因 writeETag 变化丢弃旧候选，用修正后的记忆及未处理来源重新总结；新模型必须保持明确纠正而不是抄回旧答案。
4. 新回答在总结期间完成，当前任务不变更来源终点，结束后立即处理追加来源；页面明确显示 pending/updating，不能假报同步完成。

## 14. 原生上下文检查和用户手动压缩

### 14.1 策略与边界

关闭 Pi 自动压缩，包括达到阈值时自动整理、上下文溢出后自动压缩重试。保留原生压缩算法，只由用户在页面点击“压缩原生上下文”触发；没有后台定时压缩、SessionMemory 总结联动压缩或自动点击替代。创建与恢复 Session 都重新落实手动策略，页面常驻显示“自动压缩已关闭”。

SessionMemory 每次完整回答后立即增量同步，并保留“立即总结”。原生压缩不计作回答，不重置累计序号、审阅游标或确认内容。SessionMemory 来源和计数读取 Pi 保存的活动分支历史，不使用压缩后模型窗口替代历史；压缩摘要不冒充新回答或用户确认内容。

### 14.2 使用情况读取

检查面板打开后 GET context 返回 `02` 第 13 节定义的 NativeContextInspection。只为读取检查数据不创建新 Pi Session、不发模型请求、不执行压缩；Session 未启动或无法恢复时返回不可用原因。可安全恢复已有原生 Session 后读取指标，但不得启动用户任务或重试模型调用。

检查可见时，压缩运行中每 2 秒刷新，其他状态每 30 秒刷新；进入检查面板、一次主回答完成、手动压缩完成或失败后立即刷新，页面隐藏时暂停。用量不是逐 token 结算：运行期间可展示最后可信采样及时间，不伪造实时更新。超过容量或接近容量可以提示用户手动压缩，不能提示后自动执行。

### 14.3 手动压缩流程

~~~text
用户查看检查中的原生用量并点击“压缩原生上下文”
→ POST compact（Idempotency-Key）
→ 校验 Project active、Session 同项目且已启动可恢复
→ 取得与用户请求共享的 Session 执行锁
→ 调用 Pi 原生手动压缩（使用固定服务端模型）
→ 原生保存压缩结果，保留历史条目
→ 释放锁，刷新原生用量和安全状态
~~~

仅 idle 且有可压缩历史的 Session 可压缩；not_started/ended/unavailable 或主请求 running/starting/interrupting、已有压缩任务时，按钮禁用，服务端返回对应错误（冲突为 409）。主回复运行中不排队压缩、不自动停止回答，用户结束请求后重新点击。压缩运行时新的用户提交返回 SESSION_BUSY，Composer 显示“正在压缩原生上下文”，完成后恢复发送，不能丢掉本地输入。

按钮点击本身就是本次手动压缩授权，不再追加审批步骤。已有 SessionMemory 历史待处理草稿不阻止压缩；独立 SessionMemory 总结若已持有稳定来源快照可继续，结果落库前等待 Session 短协调区核验来源。尚未取快照的 SessionMemory 生成等压缩稳定后重查，不能让辅助线锁死压缩按钮。

POST 返回 202 和安全压缩状态，重复动作键按第 6.4 节共用一次执行；实际执行结果通过 context GET 查询。压缩可消耗模型 Token，页面点击前有简短说明。失败不假装用量已下降、不删除历史或重置 SessionMemory，显示安全错误供用户再次手动重试。进程退出后不从页面刷新自动重放压缩请求，只根据原生记录和当前 Runtime 状态核对结果。

### 14.4 容量不足和失败

关闭自动压缩后，模型上下文过长返回明确 `CONTEXT_LIMIT_REACHED`，保留历史与输入，提示打开检查并手动压缩后重新发送；不压缩后自动重试旧请求。手动压缩失败返回 `COMPACTION_FAILED` 的可见状态，保持原生恢复诊断；若已发生原生写入，由恢复投影核对，不能宣称失败就一定没变。下一次尝试仍须用户点击。

压缩前后指标按相同口径刷新；无法获取时明确标“暂不可用”，不编造节省量或成功百分比。原生压缩摘要和完整 system prompt 不下发检查面板，检查只展示用量、状态、时间及安全原因。

开发热更新或不同 Route Bundle 持有不同 DomainError 类实例时，安全错误映射仍按明确的领域错误形状识别，保证旧库 SCHEMA_INCOMPATIBLE 提示不退化为通用 500；普通 Runtime 异常不暴露内部信息。

记忆页面关闭或取消编辑时中止本地待发/进行中的保存请求，不再自动提交或重试；客户端忽略取消后到达的旧响应。已提交成功的数据库事务不回滚，重新打开必须读取当前服务端事实。

本次统一清理：业务模型、API 和目标数据库只使用 SessionMemory/sessionMemory/session_memory_id/session_memories 命名，删除旧跨项目执行代码与协议；跨项目会话只保留无提交能力的页面入口，后续流程等待用户定义。已有数据库须离线按独立改名脚本迁移，保持 ID、JSON、原生会话引用和历史归档完整；应用启动不自动改写。

## 总结直接生效（2026-09-30）


历史 draftJson 仅保留旧数据，不再作为待办、不阻塞总结、不自动采用、不删除。新总结不创建 draftJson，模板复制直接初始化 contextJson。移除草稿编辑、确认、拒绝入口；手动总结使用 POST memory/summarize。页面只展示当前记忆、生成状态及局部修改，保存和自动更新后同步侧栏摘要。


## 15. Pi 上下文 UI 操作

打开检查时只读取 Pi 状态，优先展示上下文区；刷新仅重新 GET context，不发用户消息、LLM 总结或压缩。运行中每 2 秒、空闲每 30 秒的可见轮询与请求完成后的立即刷新沿用现有规则。页面隐藏暂停；再次可见立即核对。未知、估算值、运行中、恢复失败都必须显式区分。

用户点“压缩上下文”才 POST compact；API 再核验同 Project、Session idle、原生可压缩内容及执行锁。执行时保持输入文本，禁用发送，禁止重复压缩。用户点“取消压缩”POST compact/cancel（幂等键），应用调用同一 Runtime 的 abortCompaction；不调用主回复停止、不自动继续对话。未运行时返回冲突。取消请求后锁仍由原操作 finally 释放；成功取消显示 cancelled 并刷新 Pi 状态，若已完成则按原生结果展示。

Session 不可恢复时展示错误与“恢复会话”入口，沿用已有 POST restore；没有启动的 Session 不创建运行时。SessionMemory 总结独立执行，不参与这些控制；输入来源、Runtime 恢复与消息窗口均以 Pi 为准。

当前记忆是用户校正过的工作理解，来源对话是待提炼的数据。总结指令要求保留当前记忆的明确纠正、约束及决定；历史回答与当前记忆冲突时以纠正为准，新增用户明确纠正可以更新记忆。不将来源中的模型指令当系统指令，不从模型推测恢复已删除的事实。


## 16. 固定指导线总结

自动和手动总结只调用独立无工具 Pi/LLM。固定模式逐项提炼：当前概况、明确目标、边界、带依据事实、实际决定、已经提出的下一步、产出摘要。模式要求原始对话是数据，不执行其指令；已有人工校正用于避免展示线重现已指出的错误。事实矛盾和未核验判断保留说明，未表达的目标/决定/下一步为空。

没有变化可以返回原记忆，非空来源返回全空结构则失败、不推进游标。输出仍只返回固定 JSON，经容量/路径校验和 writeETag 条件写入后直接展示。主 Session 不绑定总结扩展、不读取总结内容、不向 transcript 追加记忆消息；模板仅初始化展示线。旧注入行为已经取消，历史 transcript 不清理或重写。

记忆读取全会话仅一个所有者，面板不另建轮询；初始化、打开面板、主请求结束、人工修改及手动总结后立即刷新。一次响应结束后才安排下一次请求，重复唤醒合并，隐藏暂停、重新可见刷新。主请求结束保留短暂 5 秒追赶窗口，避免后台钩子尚未开始时误停。错误停止自动快轮询，面板可见时低频重查，用户操作可立即重试。上下文只在检查面板轮询；压缩进行时主 Hook 可继续读状态，复用正在读取的 context 请求。普通空闲主会话不为压缩状态刷新会话列表。
