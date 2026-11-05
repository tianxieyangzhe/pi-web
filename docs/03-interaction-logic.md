# 03｜API：模型如何变化

本文范围：独立项目与 SessionMemory 的 API 和状态变化。Bot 的全部专属设计、模型、API、交互与需求统一见 [06｜Bot](06-bot.md)，本文不定义或复写其规则。

本文只定义 `02` 的模型如何变化，以及 API 如何安全触发这些变化。页面布局不是本文职责。

每条流程写明触发者、前置许可、读取的模型和表、事务内写入、外键和幂等约束、失败或 unknown 时保留的事实、调用的 Pi 能力。不调用 Pi 时明确写出。

每个 API 写明方法、路径、调用方、入参、返回 DTO、错误码、幂等键、读写模型和具体 Pi 能力。入参不得替代服务端读取到的归属、角色和权限。返回值不单独暴露运行句柄、配置密钥或原生 Session 文件绝对路径。会话树节点内容按本节 Session Tree 契约原样返回，可能包含 thinking、工具参数、敏感结果、路径或凭据；不得以此过滤或脱敏节点。

## 当前规则

## 1. 总体规则
1. 每个项目 Session 固定属于一个 Project，并绑定一个SessionMemory；SessionMemory 与 Session 的 Project 必须相同。
3. SessionMemory 只供独立总结、展示和人工校正，不进入项目主 Pi 输入。
4. 项目消息直接写入 Pi 原生 Session transcript。SessionMemory 不创建执行记录。
5. SessionMemory 数据只存数据库，不创建本地记忆文件；主模型上下文归 Pi 原生管理。
6. 同一 Session 同时最多执行一个用户请求；同一 SessionMemory 同时最多执行一个自动总结任务。

## 2. 创建 Session 与 SessionMemory
~~~text
用户选择 Project
→ 从独立 Agent 目录选择一个项目 Agent
→ 选择空 SessionMemory 或预览一个无 Project 的 SessionMemory 模板
→ 校验 Project/Agent active、Agent 用途、记忆模板 projectId=null
→ 同一数据库事务创建 SessionMemory 与 Session、保存 AgentSnapshot，固定同一 projectId
→ Session.sessionMemoryId 指向SessionMemory，SessionMemory 只绑定这一条 Session
→ 打开该 Project Session 页面
~~~

复制模板使用新 SessionMemory ID 和可选 `sourceTemplateId`。模板初始内容直接进入 `contextJson`，不创建草稿、不要求确认。模板以后修改不改变已有 SessionMemory。空 SessionMemory 的 `contextJson` 是 02 定义的全空结构。

Agent 是独立版本化 Markdown，不复制成 owner 实例。Session 保存精确版本引用，见 `02`“独立项目 Agent Markdown”。其他资源模板保持独立复制规则。角色引用不写入 SessionMemory。

## 3. 加载和页面状态
进入项目会话时按 PSES-007 打开 Pi Session，并读取 Session 安全摘要、Pi transcript 投影和绑定 SessionMemory 的指导线内容。页面显示当前总结及同步状态，历史草稿不展示。Session 列表携带当前生效记忆的 memorySummary；记忆保存或独立总结写入后刷新侧栏对应项目的会话名称。Project 侧栏的历史 Session 仍按项目按需展开；选择另一 Session 时同时切换其独有 SessionMemory。

SessionMemory 是主会话之外的辅助线：同步状态不锁定 Composer，也不自动发送新用户消息。


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

触发依据是“每次回答增量同步”和主动按钮，不再由“是否值得总结”或寒暄关键词判断。有未处理完整来源且来源可用时调用无工具总结器；完全没有安全来源时返回来源诊断，不静默消耗计数。生成候选与当前上下文完全相同时按“无变化”处理，可条件推进到实际处理终点，后续每次回答继续同步。


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
projectId 与 workspaceId 均为空的 SessionMemory 是模板；工作区归属见 `06`。模板不能绑定 Session，也没有当前 Project 文件和历史 Pi transcript。模板只保存可泛化的初始上下文；模板来源引用用于显示“复制自”，不构成实时共享或自动同步。

项目工具/扩展/MCP/Skill 模板另行设计；Agent 无 owner，独立 Session 使用可选的项目角色引用。记忆不保存资源或授予权限。

## 8. Session 活动与历史展示
项目会话的会话栏是所属 Pi Session Tree 的对话流投影，不是第二份对话。`GET /api/projects/:projectId/sessions/:sessionId/messages` 由页面调用，服务端校验 Project/Session 归属与读取许可，依据精确 nativeRef 使用 Pi SessionManager `getTree()`、`getEntries()` 和 `getLeafId()` 读取整个树、原生追加顺序和当前叶子；不调用 LLM，不改变 Pi 历史、数据库或 SessionMemory。活动句柄必须复用其 manager；无句柄时的历史读取必须只读，不能借 Pi `SessionManager.open()` 的空文件初始化或旧版本自动重写来改变历史。只读恢复遇到需要原生迁移的旧版本时返回 `SESSION_TREE_READ_FAILED`，提示用户单独决定迁移，不自动迁移。已建立且确认为空的 Pi Session 返回空节点和空叶子；无权返回 403、目标不存在或归属不符返回 404，引用缺失或不可恢复返回 `NO_NATIVE_REF`（409），原生读取失败返回 `SESSION_TREE_READ_FAILED`（500），均不伪装为空树、不新建替代历史。读取无幂等键，重复读取不产生写入。

成功响应 JSON 为 `{ "data": { "entries": [...], "activeLeafId": ... } }`，其中 data DTO 为 `{ entries, activeLeafId }`：`entries` 是按 Pi `getEntries()` 原生追加顺序排列的数组，每项为 `{ entry, label, labelTimestamp }`，其中 `entry` 是完整原生 entry 对象，含 `id`、`parentId`、`timestamp`、`type`；标签及其时间不存在时为 null。节点只出现一次，共享祖先不复制。`activeLeafId` 为当前句柄的 `getLeafId()` 或 null；它表示读取时 Pi 的活动指针，不保证是结构上的终端节点。恢复后的值以 Pi 恢复结果为准，不能承诺未写入新 entry 的分支切换在重启后保留。客户端据 parentId 表达分叉和活动路径；用户参考节点 `custom_message/user_reference_files` 只有在唯一后继链通向用户消息时（允许穿过 Pi 首轮插入的 system 消息，其他中间类型或分叉终止），允许视觉上收进该用户消息正文之后的附件折叠区，原始节点只展示一次且完整可查；API 和持久树顺序不变。没有确定用户后继节点或存在分叉时独立保留，不跨分支或按内容猜测附件归属。不得把不同分支拼成同一线性上下文，或以时间戳重排和推断父子关系。

先从 `getEntries()` 检查重复 ID 和父链，避免 Pi `getTree()` 在循环数据上无法终止；对父节点缺失或自引用的节点保留原 parentId 并标记异常；多节点循环、重复 ID 或其他无法可靠表达的损坏返回 `SESSION_TREE_READ_FAILED`，不丢弃或虚构节点。读取时在同一 Session 的短临界区内取得树、顺序、标签和叶子的一致快照，不持锁等待 LLM；无法取得一致快照则返回读取错误。全部节点包括消息、thinking、工具调用及结果、压缩、分支摘要、模型变化、custom 和 display=false 的关联消息；未知类型保留原内容，不按敏感程度过滤或脱敏。Session header 不是 tree entry，不能把 cwd 或原生文件路径作为独立字段下发。节点内容可能包含敏感信息；整个成功响应均为敏感数据，使用 `Cache-Control: no-store`，不写诊断日志。若原生内容无法完整序列化或响应无法生成，返回读取错误，不截断或伪装完整。

读取许可不能只靠客户端提供的 ID 或会话租约：若部署有身份认证与权限机制，服务端必须先核验真实调用方的读取权限及数据库归属；若没有，则服务端核验数据库归属，并且部署只能处于用户控制的可信访问边界，不能把租约、随机 ID 或同源策略当作认证。当前项目 `npm run dev` 监听 `0.0.0.0`，不等于仅本机可访问；服务端的归属检查也不是调用方认证。对不可信网络开放前须另行建立并验收访问控制，本次不将其假定为已有功能，也不增加内容过滤。

实时内容统一采用会话级 SSE：项目 `GET /api/projects/:projectId/sessions/:sessionId/events?leaseId=...`，前置检查归属、读取许可及本进程有效打开使用权。独立项目消息 POST 接受后返回 202 `{accepted:true,sessionId}`，不绑定长运行响应；兼容项目旧 NDJSON 客户端不作为新页面传输。应用启动执行后持续消费直至真实终态，页面断流不取消执行。只读及非发起页面同样订阅原生变化，不定时读取 transcript。所有流及历史响应 `Cache-Control: no-store, no-transform`。

会话 SSE 与兼容项目 NDJSON 使用事件 DTO `{ sessionId, runId, sequence, type, entryId, temporaryId, payload }`：运行事件的 `runId` 为本进程生成、单次运行唯一的临时标识，`sequence` 为该运行内从 1 开始递增的整数；不属于单次运行的应用状态事件两者均为 null。`entryId` 和 `temporaryId` 在无对应身份时为 null；Pi 内容事件的 `type` 和 `payload` 表达对应 Pi 事件，不修改原始内容。完成、失败、调用进度等应用状态事件也使用此封装，但不冒充 Pi 原生 entry；其 payload 使用现有状态与错误契约。文本、thinking、工具调用参数、工具更新和结果按 Pi 实际事件完整传递，不按类型或敏感程度过滤。事件有 Pi 原生 entry ID 时带该 ID；尚无 ID 时使用仅限本次运行的临时关联标识，不能当作持久节点或自行推断父节点。Pi 的普通消息可能在 `message_end` 通知订阅者之后才追加对应 entry，不能假定通知时 ID 已存在；仅在服务端从同一 Pi 运行可靠取得该映射后，发送带两种标识的关联事件。custom 消息对应 `custom_message`，按同一运行中的 customType、content 对象身份和 details 对象身份可靠定位，不按普通 message 查找；Pi 在通知前已追加的节点立即发送关联，通知后才追加者延迟核对。无法确认映射时不按文本或时间猜测。模型或 Pi 没有提供的内容不补造。两类页面打开先订阅 SSE 再读快照，订阅期间缓冲事件并按运行标识和序号去重；项目页面同样先订阅再读快照；消息 POST 只提交意图；断流、重连、运行结束或失败时重读快照，以 Pi 树为准。最终快照成功后移除能确认已关联的临时展示；无法确认某临时内容已持久化时保留并明确标记未确认，不把它编造成节点。快照失败保留当前展示及错误并允许重试，不假报同步。各页面和多次运行的临时标识不能混用；不同 Session 的事件不能混入。SessionMemory 总结仍是独立过程，不插入对话；其来源限制不改变会话树展示。

## 9. API 边界
~~~text
GET/POST  /api/session-memory-templates
GET/PATCH /api/session-memory-templates/:templateId
GET/POST  /api/projects/:projectId/sessions
POST      /api/projects/:projectId/sessions/:sessionId/runtime/open
POST      /api/projects/:projectId/sessions/:sessionId/runtime/pong
GET       /api/projects/:projectId/sessions/:sessionId/events
POST      /api/projects/:projectId/sessions/:sessionId/runtime/close
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


### 页面打开与运行句柄（PSES-007）

项目 Session 使用 `/api/projects/:projectId/sessions/:sessionId/runtime/{open,pong,close}`。页面或其会话管理器调用；服务端从数据库核验项目归属、会话存在及许可。已结束的项目会话可按精确 nativeRef 读取只读历史，但不能发送或重新运行；其只读打开与历史读取均不得创建新 Pi Session 或改写历史，原生历史不可恢复时返回错误。入参不携带 cwd、角色、权限、nativeRef 或运行状态。

- `open` 是 POST，无业务入参；返回安全 DTO `{ leaseId, status, outcome }`，`outcome` 为本进程确认的 `SESSION_BACKGROUND_TIMEOUT` 或 null，`leaseId` 是不可猜的临时使用权标识，`status` 表示就绪或正在运行，不返回句柄、原生路径或内部内容。每次打开创建一个独立租约；请求重试以 `idempotency-key` 去重，同键不同目标或入参返回 409。已存在的活动 Pi 句柄必须复用，包括正在后台运行者；没有句柄且有 nativeRef 时精确恢复；未结束且没有 nativeRef 时创建空 Pi Session，确保原生身份可恢复后条件写入对应业务记录的 nativeRef。已结束且无 nativeRef 时返回 `NO_NATIVE_REF`，不创建替代历史。并发打开、后台调用和首次创建使用同一会话级串行门禁；重复请求不创建第二个 Pi Session。已有 nativeRef 缺失、损坏或身份不符返回 `NO_NATIVE_REF`（409），不能新建替代历史。初始化失败不返回租约、不触发 prompt；若 Pi 文件创建与数据库写入之间失败，需保留可核对的恢复信息，不能自动替换已确定身份或删除历史。数据库只写对应 Session 的 nativeRef，不修改记忆或历史内容；无需 schema 变更或历史库迁移。
- 不再提供页面主动定时 `heartbeat`。`open` 创建临时 lease，允许 120 秒内建立订阅；每条订阅绑定一条 lease。SSE 初始发出 `event: ready`，payload `{connectionId}`；服务端立即及每 30 秒发出 `event: ping`，payload `{connectionId,challenge}`，同连接最多一个待应答挑战，期限 90 秒。页面收到后 POST 对应 `/runtime/pong`，入参仅 `{connectionId,challenge}`，无页面定时器；服务端校验目标归属、读取许可、连接身份、挑战和期限后续租，204 无正文。不匹配或过期返回 `SESSION_SUBSCRIPTION_EXPIRED`（409），不续租、不调用 Pi；已过期挑战不能重放到其他连接。SSE 取消、请求断开或超时释放该连接与 lease，其他页面及后台使用权不受影响。`close` 仍 POST `{leaseId}` 幂等释放，204；连接级服务端心跳与超时在 application，HTTP 层仅传输。重连必须重新 open 并订阅；连接失联不等于执行失败。
- 新选中会话先 `open`；成功后先订阅再读取树；选中变化时立即切换，异步 close 旧租约。打开失败显示错误并允许重试，不自动发送。消息 POST 在 `x-session-lease-id` 请求头附带当前有效租约作为运行句柄使用权；校验失败返回 `RUNTIME_NOT_OPEN`（409），不写入 Pi。服务端仍执行现有归属、互斥、参考材料和幂等校验，再在该句柄调用 Pi `prompt`；发送不新建或替换 Pi Session。
- 最后一个页面租约释放或过期时，若会话空闲且没有后台使用权，释放内存句柄；若自身运行未结束，则以该时刻为起点启动默认 300 秒单调计时。先收到 Pi `agent_settled` 或已确认的运行失败时结束计时，完成现有状态和边界处理后释放无其他使用权的句柄。到期仍在运行且没有页面重新打开时调用 Pi `abort`，等待其真实结束及状态落定后释放；不把超时当作成功。确认因本超时中止时，现有运行事件与重开后的安全状态返回 `SESSION_BACKGROUND_TIMEOUT`，页面据此显示中止而不是成功；不新增持久状态或伪造 Pi transcript。`abort` 失败或结束无法确认时保留互斥与待核对状态，报告错误，不强行伪造结束、重复发送或销毁仍运行的句柄。重新打开在中止开始前取消计时；若中止已开始，不撤销中止，复用句柄等待结束，不启动第二轮。
- 多页面只在最后租约离开时计时；重复 close、续租与超时、结束与切换及并发 open 通过同一会话门禁处理，不得释放新句柄或中止已重新打开的运行。后台使用权与页面使用权独立；页面切离不释放仍被后台执行使用的句柄。后台执行结束后无其他使用权时释放句柄。
- 页面断线不等于运行失败；服务进程退出会丢失句柄、租约和计时器，不保证退出期间执行五分钟中止。重启按现有原生引用和调用恢复规则重新核对，不把旧运行自动标记成功或重发。无可恢复引用或无法确认调用边界时返回错误或 `unknown`。历史、已发生的工具副作用及未完成的原生写入不因中止或释放回滚；释放不删除原生 Session 文件。

订阅覆盖独立项目会话；后台执行与页面使用权独立。后台首次创建经项目初始化端口保存 nativeRef，后续每次调用按精确引用取得当前句柄，不缓存已释放对象。项目发送的 `operation=read` 禁止项目写入；复用句柄时由服务端按本轮意图设置运行时写入门禁，结束时清除，不能因打开时创建了写工具而绕过只读限制。项目首次身份以 Session ID 的 SHA-256 确定 `.data/project-pi-sessions/<hash>.jsonl`，同路径独占锁目录覆盖文件初始化及数据库条件写入；仅对独占创建的空文件调用 Pi `SessionManager.open()` 初始化 header。已存在候选文件必须完整验证版本、cwd 和身份后才可采用；空文件、损坏文件、残留锁保留现场并报错，不自动重建或破锁。条件更新只在 native_ref_json 为 NULL 且 Session 未结束时生效；已有引用以数据库为准，候选文件保留。只读恢复严格解析原文件并以 Pi 内存 SessionManager 读取，不调用 `open()` 或迁移；运行恢复先验证版本、身份和完整末尾，再按精确引用打开。不得更改、删除或自动迁移历史。

恢复初始化（PSES-009）调用 Pi SDK 前，适配层仅在本次初始化期间对 SessionManager 的 model/thinking 追加入口做当前活动分支去重：分别比较该分支最后一个同类配置节点；值相同返回已有节点 ID，不追加、不移动叶子；无同类节点或值实际变化时调用原生追加方法。不能比较其他分支，也不能删除旧重复节点或伪造对话消息让 SDK 误判。初始化成功和失败均恢复原方法；失败不回滚已发生的原生合法追加，业务记录和 nativeRef 保持原契约。项目 Runtime 使用该适配，不修改 SDK 安装文件。无新增 API、表、事务或配置来源，不调用 prompt 或模型。

`open` 调用 Pi SessionManager 创建或打开及 AgentSession 初始化；`close` 在满足条件时调用 Pi dispose，超时调用 abort 并观察真实结束；服务端 ping 与有效 pong 只维护连接和内存使用权，不调用 Pi。原生历史、所有分支和当前叶子由 Pi 管理；`open` 本身不返回树，messages API 按本节 Session Tree 契约返回节点内容。

### 会话本轮参考文件（PSES-006）

PSES-010 粘贴输入沿用本节 references，不新增 API 或持久模型：剪贴板 PNG/JPEG/GIF/WebP 作为上传图片；超过 10 行或 1000 字符的文本作为 UTF-8 文本附件，完整保留换行和内容。浏览器草稿以文字和附件原子块混排，光标插入/删除和位置仅属于临时编辑文档。发送前去掉内部定位标记，将其余文字作为 content、仍在文档内的材料作为 references，定位标记不进入 API 或 Pi；UI 仅显示行数和可移除标记，短文本按光标位置插入纯文本。仅附件发送时 content 使用“请查看本次附带的图片或文本。”；仍执行现有数量、字节、归属及文件签名校验，接受前失败保留选择和草稿。

`POST /api/projects/{projectId}/sessions/{sessionId}/messages` 可选接收 `references` 数组，上传为 `{name,data}`（标准 base64 字节和不含路径的文件名），项目文件为 `{projectId,path}`，路径是所属根目录内相对路径。项目目录沿用 `GET /api/projects/{projectId}/files?path=...`；项目 Session 只能引用所属项目。服务端从数据库核验范围，不信任客户端提供的归属或目录；发送时重新安全读取文件，校验真实路径、敏感路径、忽略目录、普通文件和文件变化。总计最多 10 个、单个 2 MiB、合计 8 MiB，各来源共同计算；请求 JSON 最大 12 MiB，读取时限制字节数。校验 base64、文件名、UTF-8 文本及 PNG/JPEG/GIF/WebP 签名，错误返回 400/403/404/409/413/415/422，不调用 Pi；接受前失败保留输入和选择。不写项目或业务表、不创建授权。消息缓存版本不匹配时消息请求均返回 `REFERENCE_SERVICE_RESTART_REQUIRED`（503），避免旧句柄把历史参考带入普通请求；参考目录查询不依赖旧缓存服务对象。接受后的运行错误由事件报告，不保证自动保留或重发。

服务端以 Pi `sendCustomMessage` 的不可见 reference 内容附加文本和图片快照，再用 `prompt` 发送原样用户文本。每次运行在内存中绑定不可预测的本轮标识；Pi 的 `context` 扩展在每次模型请求前只保留与本轮标识匹配的参考关联消息，过滤旧快照和失败后遗留快照；工具循环及同次运行继续时保留本轮材料，结束或失败清除运行标识。手动压缩的 `session_before_compact` 同样过滤原始参考快照；自动压缩关闭。原生历史已有快照保留，不改写或删除；会话树投影显示原生关联节点内容。材料作为用户显式提供的参考而非指令或授权。图片通过 Pi 原生 image content 发送，模型配置声明图片输入；供应商拒绝或执行失败通过项目错误事件报告，不当作成功。Pi transcript 的不可见关联消息持有快照；会话恢复时模型请求上下文同样过滤旧快照，不清理历史；这不限制会话树展示。模型回答、工具结果或历史压缩摘要可能保留材料派生的信息，不承诺模型遗忘已产生的信息。无数据库写入或 schema 迁移，无新 Agent/项目权限。Pi 写入后失败可能已有原生历史，不自动重发或重新读取参考文件；页面仍按 Session Tree 契约重读原生历史，附加参考成功但 prompt 失败时也可能保留不可见材料，不能承诺跨 Pi 写入原子性。项目会话在会话归属校验后声明流幂等键，再校验参考内容与读取项目文件；声明后即使校验失败也不可复用，重新提交使用新键。新页面以 Accept: application/json 提交，接受后返回 202；运行时错误通过会话订阅报告。旧 NDJSON 客户端仍按兼容流接收，不作为新页面更新机制。

独立项目 Session 的消息 POST 接收用户 `content` 和可选 `references`，校验 Project、Session、同项目 SessionMemory及执行互斥；新页面成功返回 202 接受 DTO，兼容旧请求才返回 NDJSON；服务端独立调用 Pi `prompt` 原样发送文本。项目文件读写工具由独立项目执行策略提供，不以角色或其能力开关决定；仅限项目根目录，遵守敏感路径与符号链接检查、项目写入互斥，实际修改遵循用户意图。可用且匹配的正式角色仅附加指导；无角色、旧式或停用角色不阻止执行，不注入不可用指导，不改历史绑定。会话繁忙或归属不符时返回对应错误，不调用 Pi；接受后的失败通过所属会话错误事件返回。消息归 Pi transcript，成功后异步触发独立记忆总结。服务端对接受的发送输出同一诊断 ID 的阶段耗时：用例接收、句柄复用/创建/恢复、prompt 开始、首个 assistant 流更新、首段可见文字、首个工具活动和结束/失败。时间基于单调时钟；assistant 更新不等于供应商网络首包，缺失阶段不虚构。另在服务端记录首段文字和完成事件写入响应流队列的时间，在浏览器记录这两个事件被解析的时间，使用事件 `runId`（即该诊断的 turnId）和 Session ID 关联；各端记录 ISO 时间及从各自流开始的单调耗时，跨端时间比较须考虑时钟偏差。入队不代表浏览器已收到，浏览器解析不代表 React 已渲染。日志仅包含诊断 ID 或 turnId、Session ID、阶段和时间，不包含提示词、输出、思考、工具参数/结果、原生路径、凭据或异常正文；不写数据库、不改变 API 响应或 Pi 行为。

## 11. API 响应、状态与恢复
### 11.1 SessionMemory 读取与写入契约

SessionMemory GET 返回安全 SessionMemory DTO、读缓存响应头 ETag、行级条件凭据 writeETag 和辅助状态：`generationState`（idle/queued/generating/failed）、`hasUnreviewedMessages`、可安全展示的来源范围（请求数与起止时间）、`canWrite`、`canSummarize`、`completedAnswerCount`、`pendingAnswerCount`、`syncState`、`memoryUpdatedAt` 及可重试错误。DTO 字段以 `02` 为准；状态根据数据库、当前分支和进程内调度器计算，不进入 session_memories JSON。无法读取来源时范围标为不可用，不能伪造计数或误报无积累对话。

| 入口 | 请求要点 | 成功结果 |
| --- | --- | --- |
| 创建项目 Session | 可选 sessionMemoryTemplateId、templateWriteETag、purpose，Idempotency-Key | 201，安全 Session 摘要和绑定 SessionMemory ID |
| PATCH memory/context | 完整 context、If-Match | 200，最新 SessionMemory 与 writeETag |

需要显式重审范围时，基于 messages GET 的完整树另行派生活动分支请求的安全摘要、起止条目 ID、时间与稳定标记，供记忆重审使用；不额外存来源目录表，服务端再次校验客户端提交的范围。


生成状态 DTO 另包含 `lastOutcome`（none/no_new_messages/no_change/memory_updated）和 `sourceStatus`（available/unavailable/branch_changed），供同步结果与来源诊断展示；这些都是进程状态或实时推导，重启后不能声称恢复上次无变化通知。

统一错误包含 code、message、recoverable、可选字段定位，不下发堆栈或原生文件路径。至少区分 MEMORY_CONFLICT(409)、SESSION_BUSY(409)、PRECONDITION_REQUIRED(428)、INVALID_MEMORY_CONTEXT(422)、SUMMARY_SOURCE_TOO_LARGE(422)、SUMMARY_FAILED、SUMMARY_EMPTY_RESULT、MEMORY_DATA_CORRUPT、MEMORY_SOURCE_UNAVAILABLE、SCHEMA_INCOMPATIBLE。不再返回草稿待确认或总结冷却错误。生成失败由记忆辅助状态返回，不使已完成主会话流变成失败。

### 11.2 刷新和调度恢复

SessionMemory 当前会话共享一次读取：生成/排队/未处理来源时每 2 秒；已同步且面板可见每 30 秒，面板关闭且已同步或失败时停止定时读取；页面隐藏时暂停轮询，重新可见立即读取。主请求结束、人工写入完成、重新打开 SessionMemory 面板时立即刷新。使用 ETag/If-None-Match 减少内容传输；读缓存 ETag 由 writeETag 和辅助状态的规范化摘要共同生成；辅助状态改变时读缓存 ETag 也改变。写入条件凭据通过响应字段 `writeETag` 给出，只依赖已存 SessionMemory 行，避免进度变化造成写入冲突。服务端识别它作为应用层写入前置条件，不用读缓存 ETag 的框架自动比较代替 Repository 校验。写请求 If-Match 使用 writeETag；它与读缓存 ETag 不混用。


主会话恢复失败不删除 SessionMemory，不将草稿置空。数据损坏或 Schema 不兼容时阻止写入，页面展示诊断，不偷偷启用无 SessionMemory 的旧提交路径。数据库处理见 `02`“现有数据库与迁移决策”。

## 12. 一次完整交互示例
1. 用户创建项目会话，选择空 SessionMemory；当前内容为空，主对话可直接开始。
2. 用户要求“整理导入流程，保留旧数据”，Pi 完成回复；独立 LLM 整理记忆，校验后直接写入并展示。
3. 调度器重查新增完整回答；用户也可点击“立即总结”处理尚未同步的来源。人工保存使正在生成的旧基线结果失效，后续独立总结以最新内容重查，主 Pi 输入不受影响。

验收场景与需求状态以 `05-requirements.md` 为准。

## 13. 对话与纠错示例
1. Pi 回答项目问题，回答稳定后开始独立 LLM 更新，页面保留原记忆并显示“正在同步”。
2. 用户指出“数据库是五张表而不是四张”，在对应记忆字段局部修改并保存；后续独立总结使用该纠正；主会话仍仅使用 Pi 原生历史。
3. 若旧总结仍在运行，因 writeETag 变化丢弃旧候选，用修正后的记忆及未处理来源重新总结；新模型必须保持明确纠正而不是抄回旧答案。
4. 新回答在总结期间完成，当前任务不变更来源终点，结束后立即处理追加来源；页面明确显示 pending/updating，不能假报同步完成。


[165 more lines in file. Use offset=201 to continue.]
## 14. 原生上下文检查和用户手动压缩
### 14.1 策略与边界

关闭 Pi 自动压缩，包括达到阈值时自动整理、上下文溢出后自动压缩重试。保留原生压缩算法，只由用户在页面点击“压缩原生上下文”触发；没有后台定时压缩、SessionMemory 总结联动压缩或自动点击替代。创建与恢复 Session 都重新落实手动策略，页面常驻显示“自动压缩已关闭”。

SessionMemory 每次完整回答后立即增量同步，并保留“立即总结”。原生压缩不计作回答，不重置累计序号、审阅游标或确认内容。SessionMemory 来源和计数读取 Pi 保存的活动分支历史，不使用压缩后模型窗口替代历史；压缩摘要不冒充新回答或用户确认内容。

### 14.2 使用情况读取

检查面板打开后 GET context 返回 `02`“原生上下文使用情况”定义的 NativeContextInspection。只为读取检查数据不创建新 Pi Session、不发模型请求、不执行压缩；Session 未启动或无法恢复时返回不可用原因。可安全恢复已有原生 Session 后读取指标，但不得启动用户任务或重试模型调用。

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

POST 返回 202 和安全压缩状态。相同 Idempotency-Key 只共用一次压缩执行，实际结果通过 context GET 查询。压缩可消耗模型 Token，页面点击前有简短说明。失败不假装用量已下降、不删除历史或重置 SessionMemory，显示安全错误供用户再次手动重试。进程退出后不从页面刷新自动重放压缩请求，只根据原生记录和当前 Runtime 状态核对结果。

### 14.4 容量不足和失败

关闭自动压缩后，模型上下文过长返回明确 `CONTEXT_LIMIT_REACHED`，保留历史与输入，提示打开检查并手动压缩后重新发送；不压缩后自动重试旧请求。手动压缩失败返回 `COMPACTION_FAILED` 的可见状态，保持原生恢复诊断；若已发生原生写入，由恢复投影核对，不能宣称失败就一定没变。下一次尝试仍须用户点击。

压缩前后指标按相同口径刷新；无法获取时明确标“暂不可用”，不编造节省量或成功百分比。原生压缩摘要和完整 system prompt 不下发检查面板，检查只展示用量、状态、时间及安全原因。

开发热更新或不同 Route Bundle 持有不同 DomainError 类实例时，安全错误映射仍按明确的领域错误形状识别，保证旧库 SCHEMA_INCOMPATIBLE 提示不退化为通用 500；普通 Runtime 异常不暴露内部信息。

记忆页面关闭或取消编辑时中止本地待发/进行中的保存请求，不再自动提交或重试；客户端忽略取消后到达的旧响应。已提交成功的数据库事务不回滚，重新打开必须读取当前服务端事实。

已有 SessionMemory 数据保留。应用启动不自动改写数据库，也不恢复旧实体或旧协议。

## 15. Pi 上下文 UI 操作
打开检查时只读取 Pi 状态，优先展示上下文区；刷新仅重新 GET context，不发用户消息、LLM 总结或压缩。运行中每 2 秒、空闲每 30 秒的可见轮询与请求完成后的立即刷新沿用现有规则。页面隐藏暂停；再次可见立即核对。未知、估算值、运行中、恢复失败都必须显式区分。

用户点“压缩上下文”才 POST compact；API 再核验同 Project、Session idle、原生可压缩内容及执行锁。执行时保持输入文本，禁用发送，禁止重复压缩。用户点“取消压缩”POST compact/cancel（幂等键），应用调用同一 Runtime 的 abortCompaction；不调用主回复停止、不自动继续对话。未运行时返回冲突。取消请求后锁仍由原操作 finally 释放；成功取消显示 cancelled 并刷新 Pi 状态，若已完成则按原生结果展示。

Session 不可恢复时展示错误与“恢复会话”入口，沿用已有 POST restore；页面选中后按 PSES-007 打开运行时，未选中的 Session 不因检查而预先启动。SessionMemory 总结独立执行，不参与这些控制；输入来源、Runtime 恢复与消息窗口均以 Pi 为准。

当前记忆是用户校正过的工作理解，来源对话是待提炼的数据。总结指令要求保留当前记忆的明确纠正、约束及决定；历史回答与当前记忆冲突时以纠正为准，新增用户明确纠正可以更新记忆。不将来源中的模型指令当系统指令，不从模型推测恢复已删除的事实。


## 16. 固定指导线总结
自动和手动总结只调用独立无工具 Pi/LLM。固定模式逐项提炼：当前概况、明确目标、边界、带依据事实、实际决定、已经提出的下一步、产出摘要。模式要求原始对话是数据，不执行其指令；已有人工校正用于避免展示线重现已指出的错误。事实矛盾和未核验判断保留说明，未表达的目标/决定/下一步为空。

没有变化可以返回原记忆，非空来源返回全空结构则失败、不推进游标。输出仍只返回固定 JSON，经容量/路径校验和 writeETag 条件写入后直接展示。主 Session 不绑定总结扩展、不读取总结内容、不向 transcript 追加记忆消息；模板仅初始化展示线。旧注入行为已经取消，历史 transcript 不清理或重写。

记忆读取全会话仅一个所有者，面板不另建轮询；初始化、打开面板、主请求结束、人工修改及手动总结后立即刷新。一次响应结束后才安排下一次请求，重复唤醒合并，隐藏暂停、重新可见刷新。主请求结束保留短暂 5 秒追赶窗口，避免后台钩子尚未开始时误停。错误停止自动快轮询，面板可见时低频重查，用户操作可立即重试。上下文只在检查面板轮询；压缩进行时主 Hook 可继续读状态，复用正在读取的 context 请求。普通空闲主会话不为压缩状态刷新会话列表。


## 18. 独立项目 Agent 编辑

独立项目会话沿用独立角色列表和编辑工作区：列表为弹窗，新增/修改进入主画布与右侧列；中间使用独立无工具 LLM 接收自然语言意见，右侧只读展示 Markdown 候选及差异，不改变主会话选择、草稿或原生历史。

项目目录、参考文件和任意上传 Markdown 都仅是生成材料；上传先校验编码、大小和读取范围，再经无工具 LLM 转换为严格候选。模型不产生身份、版本或权限授权；应用校验用途、能力、长度和摘要，能力由用户明确选择且默认关闭。

保存先原子创建不可变 Markdown 版本，再条件更新目录索引；失败保留旧索引和本地草稿，不覆盖已引用版本。取消丢弃未保存草稿并回到列表。保存定义不建立项目 owner 或执行授权，也不自动更新运行中的 Session。无引用时可删除，有引用时只能归档并保留历史版本。

独立项目 Session 可无 Agent 运行。明确选择时校验项目用途及可用版本并保存精确快照；旧库强制角色触发器导致不兼容时返回 `SCHEMA_INCOMPATIBLE`，不自动迁移。显式采用同一 Agent 新版时，展示差异并核对用途、摘要、范围与空闲状态，只更新选中引用，下一次执行装配新指导，原生历史和历史版本保留。

## 用户删除独立项目会话（PSES-012）

DELETE /api/projects/:projectId/sessions/:sessionId，由导航确认按钮调用，可信单用户许可，入参仅路径且无正文。服务端验证同 Project；项目无需处于 active 状态。会话级互斥覆盖检查、释放句柄及数据库删除，正在打开、回答、压缩、排队/生成记忆时 SESSION_BUSY/409；unavailable（结果未核对）时 REQUEST_UNKNOWN/409；Bot 关联及历史引用 SESSION_REFERENCED/409。不存在或跨 Project 为 NOT_FOUND/404。成功返回 {data:{deleted:true,sessionId}}；重复删除 404，不需要幂等键，不自动重放。事务按 02 删除会话和专属记忆；Pi 仅 dispose 空闲句柄，不 prompt、abort、compact 或改写 transcript。释放失败不删记录；SQL 失败回滚两行，句柄可重新打开。成功清理租约、定时器和观察者；其他页面后续读取 404。
