# 03｜API：模型如何变化

本文只定义 `02` 的模型如何变化，以及 API 如何安全触发这些变化。页面布局不是本文职责。

每条流程写明触发者、前置许可、读取的模型和表、事务内写入、外键和幂等约束、失败或 unknown 时保留的事实、调用的 Pi 能力。不调用 Pi 时明确写出。

每个 API 写明方法、路径、调用方、入参、返回 DTO、错误码、幂等键、读写模型和具体 Pi 能力。入参不得替代服务端读取到的归属、角色和权限。返回值不单独暴露运行句柄、配置密钥或原生 Session 文件绝对路径。会话树节点内容按本节 Session Tree 契约原样返回，可能包含 thinking、工具参数、敏感结果、路径或凭据；不得以此过滤或脱敏节点。

## 当前规则

## 1. 总体规则
1. 每个项目 Session 固定属于一个 Project，并绑定一个SessionMemory；SessionMemory 与 Session 的 Project 必须相同。
3. SessionMemory 只供独立总结、展示和人工校正，不进入协调会话或项目主 Pi 输入；项目调用不能由记忆自动生成。
4. 项目消息直接写入 Pi 原生 Session transcript。SessionMemory 不创建执行记录，也不参与协调会话调度。
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

Agent 是独立版本化 Markdown，不复制成 owner 实例。Bot 配置建立运行关系，Session 保存精确版本引用，见 `02`“Bot、协调会话与可复用项目 Session”和“Agent Markdown 与 Bot 绑定”。其他资源模板保持独立复制规则。角色引用不写入 SessionMemory。

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
项目为空的 SessionMemory 是模板，不能绑定 Session，也没有当前 Project 文件和历史 Pi transcript。模板只保存可泛化的初始上下文；模板来源引用用于显示“复制自”，不构成实时共享或自动同步。

项目工具/扩展/MCP/Skill 模板另行设计；Agent 无 owner，Session 使用 Bot/总对话显式允许的项目角色引用。记忆不保存资源或授予权限。

## 8. Session 活动与历史展示
项目会话和协调会话的会话栏是所属 Pi Session Tree 的对话流投影，不是第二份对话。`GET /api/projects/:projectId/sessions/:sessionId/messages` 与 `GET /api/bots/:botId/conversations/:conversationId/messages` 分别由页面调用，服务端校验 Project/Session 或 Bot/协调会话归属与读取许可，依据精确 nativeRef 使用 Pi SessionManager `getTree()`、`getEntries()` 和 `getLeafId()` 读取整个树、原生追加顺序和当前叶子；不调用 LLM，不改变 Pi 历史、数据库或 SessionMemory。活动句柄必须复用其 manager；无句柄时的历史读取必须只读，不能借 Pi `SessionManager.open()` 的空文件初始化或旧版本自动重写来改变历史。只读恢复遇到需要原生迁移的旧版本时返回 `SESSION_TREE_READ_FAILED`，提示用户单独决定迁移，不自动迁移。已建立且确认为空的 Pi Session 返回空节点和空叶子；无权返回 403、目标不存在或归属不符返回 404，引用缺失或不可恢复返回 `NO_NATIVE_REF`（409），原生读取失败返回 `SESSION_TREE_READ_FAILED`（500），均不伪装为空树、不新建替代历史。读取无幂等键，重复读取不产生写入。

成功响应 JSON 为 `{ "data": { "entries": [...], "activeLeafId": ... } }`，其中 data DTO 为 `{ entries, activeLeafId }`：`entries` 是按 Pi `getEntries()` 原生追加顺序排列的数组，每项为 `{ entry, label, labelTimestamp }`，其中 `entry` 是完整原生 entry 对象，含 `id`、`parentId`、`timestamp`、`type`；标签及其时间不存在时为 null。节点只出现一次，共享祖先不复制。`activeLeafId` 为当前句柄的 `getLeafId()` 或 null；它表示读取时 Pi 的活动指针，不保证是结构上的终端节点。恢复后的值以 Pi 恢复结果为准，不能承诺未写入新 entry 的分支切换在重启后保留。客户端据 parentId 表达分叉和活动路径；用户参考节点 `custom_message/user_reference_files` 只有在唯一后继链通向用户消息时（允许穿过 Pi 首轮插入的 system 消息，其他中间类型或分叉终止），允许视觉上收进该用户消息正文之后的附件折叠区，原始节点只展示一次且完整可查；API 和持久树顺序不变。没有确定用户后继节点或存在分叉时独立保留，不跨分支或按内容猜测附件归属。不得把不同分支拼成同一线性上下文，或以时间戳重排和推断父子关系。

先从 `getEntries()` 检查重复 ID 和父链，避免 Pi `getTree()` 在循环数据上无法终止；对父节点缺失或自引用的节点保留原 parentId 并标记异常；多节点循环、重复 ID 或其他无法可靠表达的损坏返回 `SESSION_TREE_READ_FAILED`，不丢弃或虚构节点。读取时在同一 Session 的短临界区内取得树、顺序、标签和叶子的一致快照，不持锁等待 LLM；无法取得一致快照则返回读取错误。全部节点包括消息、thinking、工具调用及结果、压缩、分支摘要、模型变化、custom 和 display=false 的关联消息；未知类型保留原内容，不按敏感程度过滤或脱敏。Session header 不是 tree entry，不能把 cwd 或原生文件路径作为独立字段下发。节点内容可能包含敏感信息；整个成功响应均为敏感数据，使用 `Cache-Control: no-store`，不写诊断日志。若原生内容无法完整序列化或响应无法生成，返回读取错误，不截断或伪装完整。

读取许可不能只靠客户端提供的 ID 或会话租约：若部署有身份认证与权限机制，服务端必须先核验真实调用方的读取权限及数据库归属；若没有，则服务端核验数据库归属，并且部署只能处于用户控制的可信访问边界，不能把租约、随机 ID 或同源策略当作认证。当前项目 `npm run dev` 监听 `0.0.0.0`，不等于仅本机可访问；服务端的归属检查也不是调用方认证。对不可信网络开放前须另行建立并验收访问控制，本次不将其假定为已有功能，也不增加内容过滤。

实时内容统一采用会话级 SSE：项目 `GET /api/projects/:projectId/sessions/:sessionId/events?leaseId=...`，协调 `GET /api/bots/:botId/conversations/:conversationId/events?leaseId=...`，前置检查归属、读取许可及本进程有效打开使用权。独立项目和协调消息 POST 接受后返回 202 `{accepted:true,sessionId|conversationId}`，不绑定长运行响应；兼容项目旧 NDJSON 客户端不作为新页面传输。应用启动执行后持续消费直至真实终态，页面断流不取消执行。只读及非发起页面同样订阅原生变化，不定时读取 transcript。所有流及历史响应 `Cache-Control: no-store, no-transform`。

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



### 页面打开与运行句柄（PSES-007，目标契约，尚未实现）

项目 Session 使用 `/api/projects/:projectId/sessions/:sessionId/runtime/{open,pong,close}`，协调会话使用 `/api/bots/:botId/conversations/:conversationId/runtime/{open,pong,close}`。页面或其会话管理器调用；服务端从数据库核验项目或 Bot 归属、会话存在及许可。已结束的项目会话可按精确 nativeRef 读取只读历史，但不能发送或重新运行；其只读打开与历史读取均不得创建新 Pi Session 或改写历史，原生历史不可恢复时返回错误。Bot 项目 Session 可打开只读 transcript，但不能直接发消息。入参不携带 cwd、角色、权限、nativeRef 或运行状态。

- `open` 是 POST，无业务入参；返回安全 DTO `{ leaseId, status, outcome }`，`outcome` 为本进程确认的 `SESSION_BACKGROUND_TIMEOUT` 或 null，`leaseId` 是不可猜的临时使用权标识，`status` 表示就绪或正在运行，不返回句柄、原生路径或内部内容。每次打开创建一个独立租约；请求重试以 `idempotency-key` 去重，同键不同目标或入参返回 409。已存在的活动 Pi 句柄必须复用，包括正在后台运行者；没有句柄且有 nativeRef 时精确恢复；未结束且没有 nativeRef 时创建空 Pi Session，确保原生身份可恢复后条件写入对应业务记录的 nativeRef。已结束且无 nativeRef 时返回 `NO_NATIVE_REF`，不创建替代历史。并发打开、后台调用和首次创建使用同一会话级串行门禁；重复请求不创建第二个 Pi Session。已有 nativeRef 缺失、损坏或身份不符返回 `NO_NATIVE_REF`（409），不能新建替代历史。初始化失败不返回租约、不触发 prompt；若 Pi 文件创建与数据库写入之间失败，需保留可核对的恢复信息，不能自动替换已确定身份或删除历史。数据库只写对应 Session 或 BotConversation 的 nativeRef，不修改记忆、项目调用或历史内容；无需 schema 变更或历史库迁移。
- 不再提供页面主动定时 `heartbeat`。`open` 创建临时 lease，允许 120 秒内建立订阅；每条订阅绑定一条 lease。SSE 初始发出 `event: ready`，payload `{connectionId}`；服务端立即及每 30 秒发出 `event: ping`，payload `{connectionId,challenge}`，同连接最多一个待应答挑战，期限 90 秒。页面收到后 POST 对应 `/runtime/pong`，入参仅 `{connectionId,challenge}`，无页面定时器；服务端校验目标归属、读取许可、连接身份、挑战和期限后续租，204 无正文。不匹配或过期返回 `SESSION_SUBSCRIPTION_EXPIRED`（409），不续租、不调用 Pi；已过期挑战不能重放到其他连接。SSE 取消、请求断开或超时释放该连接与 lease，其他页面及后台使用权不受影响。`close` 仍 POST `{leaseId}` 幂等释放，204；连接级服务端心跳与超时在 application，HTTP 层仅传输。重连必须重新 open 并订阅；连接失联不等于执行失败。
- 新选中会话先 `open`；成功后协调页面按 Session 活动与历史展示契约先订阅再读取，项目页面同样先订阅再读取树；选中变化时立即切换，异步 close 旧租约。打开失败显示错误并允许重试，不自动发送。消息 POST 在 `x-session-lease-id` 请求头附带当前有效租约作为运行句柄使用权；校验失败返回 `RUNTIME_NOT_OPEN`（409），不写入 Pi。服务端仍执行现有归属、互斥、参考材料和幂等校验，再在该句柄调用 Pi `prompt`；发送不新建或替换 Pi Session。项目调用由桥梁作为后台使用者持有句柄，不依赖页面租约。
- 最后一个页面租约释放或过期时，若会话空闲且没有后台使用权，释放内存句柄；若自身运行未结束，则以该时刻为起点启动默认 300 秒单调计时。先收到 Pi `agent_settled` 或已确认的运行失败时结束计时，完成现有状态和边界处理后释放无其他使用权的句柄。到期仍在运行且没有页面重新打开时调用 Pi `abort`，等待其真实结束及状态落定后释放；不把超时当作成功。确认因本超时中止时，现有运行事件与重开后的安全状态返回 `SESSION_BACKGROUND_TIMEOUT`，页面据此显示中止而不是成功；不新增持久状态或伪造 Pi transcript。`abort` 失败或结束无法确认时保留互斥与待核对状态，报告错误，不强行伪造结束、重复发送或销毁仍运行的句柄。重新打开在中止开始前取消计时；若中止已开始，不撤销中止，复用句柄等待结束，不启动第二轮。
- 多页面只在最后租约离开时计时；重复 close、续租与超时、结束与切换及并发 open 通过同一会话门禁处理，不得释放新句柄或中止已重新打开的运行。协调会话和各项目 Session 是独立 Pi Session：切换不直接中止后台项目调用，协调会话的超时只作用于协调 Pi，不级联中止项目；后台调用持续持有项目句柄至其自身确认结束或既有恢复规则接管。若项目 Session 同时被页面查看，其项目调用不因查看页面离开而计时中止。后台调用结束后无其他使用权时释放项目句柄。
- 页面断线不等于运行失败；服务进程退出会丢失句柄、租约和计时器，不保证退出期间执行五分钟中止。重启按现有原生引用和调用恢复规则重新核对，不把旧运行自动标记成功或重发。无可恢复引用或无法确认调用边界时返回错误或 `unknown`。历史、已发生的工具副作用及未完成的原生写入不因中止或释放回滚；释放不删除原生 Session 文件。

本轮订阅覆盖独立项目、协调会话和 Bot 项目会话只读查看；后台调用与页面使用权独立，页面离开不能释放仍有 accepted/working/unknown 调用的项目句柄。后台首次创建经项目初始化端口保存 nativeRef，后续每次调用按精确引用取得当前句柄，不缓存已释放对象。协调空会话使用 Bot 原生目录中的稳定身份候选文件初始化 header，数据库提交失败保留候选文件和恢复依据；同样采用独占创建、版本与 cwd 完整校验及残留锁报错规则。项目发送的 `operation=read` 禁止项目写入；复用句柄时由服务端按本轮意图设置运行时写入门禁，结束时清除，不能因打开时创建了写工具而绕过只读限制。项目首次身份以 Session ID 的 SHA-256 确定 `.data/project-pi-sessions/<hash>.jsonl`，同路径独占锁目录覆盖文件初始化及数据库条件写入；仅对独占创建的空文件调用 Pi `SessionManager.open()` 初始化 header。已存在候选文件必须完整验证版本、cwd 和身份后才可采用；空文件、损坏文件、残留锁保留现场并报错，不自动重建或破锁。条件更新只在 native_ref_json 为 NULL 且 Session 未结束时生效；已有引用以数据库为准，候选文件保留。只读恢复严格解析原文件并以 Pi 内存 SessionManager 读取，不调用 `open()` 或迁移；运行恢复先验证版本、身份和完整末尾，再按精确引用打开。不得更改、删除或自动迁移历史。

恢复初始化（PSES-009）调用 Pi SDK 前，适配层仅在本次初始化期间对 SessionManager 的 model/thinking 追加入口做当前活动分支去重：分别比较该分支最后一个同类配置节点；值相同返回已有节点 ID，不追加、不移动叶子；无同类节点或值实际变化时调用原生追加方法。不能比较其他分支，也不能删除旧重复节点或伪造对话消息让 SDK 误判。初始化成功和失败均恢复原方法；失败不回滚已发生的原生合法追加，业务记录和 nativeRef 保持原契约。项目与协调 Runtime 共用该适配，不修改 SDK 安装文件。无新增 API、表、事务或配置来源，不调用 prompt 或模型。

`open` 调用 Pi SessionManager 创建或打开及 AgentSession 初始化；`close` 在满足条件时调用 Pi dispose，超时调用 abort 并观察真实结束；服务端 ping 与有效 pong 只维护连接和内存使用权，不调用 Pi。原生历史、所有分支和当前叶子由 Pi 管理；`open` 本身不返回树，messages API 按本节 Session Tree 契约返回节点内容。

### 会话本轮参考文件（PSES-006）

PSES-010 粘贴输入沿用本节 references，不新增 API 或持久模型：剪贴板 PNG/JPEG/GIF/WebP 作为上传图片；超过 10 行或 1000 字符的文本作为 UTF-8 文本附件，完整保留换行和内容。浏览器草稿以文字和附件原子块混排，光标插入/删除和位置仅属于临时编辑文档。发送前去掉内部定位标记，将其余文字作为 content、仍在文档内的材料作为 references，定位标记不进入 API 或 Pi；UI 仅显示行数和可移除标记，短文本按光标位置插入纯文本。仅附件发送时 content 使用“请查看本次附带的图片或文本。”；仍执行现有数量、字节、归属及文件签名校验，接受前失败保留选择和草稿。

`POST /api/projects/{projectId}/sessions/{sessionId}/messages` 与 `POST /api/bots/{botId}/conversations/{conversationId}/messages` 可选接收 `references` 数组，上传为 `{name,data}`（标准 base64 字节和不含路径的文件名），项目文件为 `{projectId,path}`，Bot 工作目录文件为 `{source:"bot",path}`，路径是所属根目录内相对路径。项目目录沿用 `GET /api/projects/{projectId}/files?path=...`；Bot 工作目录使用 `GET /api/bots/{botId}/conversations/{conversationId}/files?purpose=references&path=...`，服务端校验会话属于 Bot 并读取 Bot 工作目录。工作目录与登记项目重叠不影响本轮显式参考，普通工作目录预览与工具权限规则不变。项目 Session 只能引用所属项目，协调会话只能引用自身工作目录和其绑定的活动项目。服务端从数据库核验范围，不信任客户端提供的归属或目录；发送时重新安全读取文件，校验真实路径、敏感路径、忽略目录、普通文件和文件变化。总计最多 10 个、单个 2 MiB、合计 8 MiB，各来源共同计算；请求 JSON 最大 12 MiB，读取时限制字节数。校验 base64、文件名、UTF-8 文本及 PNG/JPEG/GIF/WebP 签名，错误返回 400/403/404/409/413/415/422，不调用 Pi；接受前失败保留输入和选择。Bot 项目 Session 禁止直接输入；不写项目或业务表、不创建授权。消息缓存版本不匹配时消息请求均返回 `REFERENCE_SERVICE_RESTART_REQUIRED`（503），避免旧句柄把历史参考带入普通请求；参考目录查询不依赖旧缓存服务对象。接受后的运行错误由事件报告，不保证自动保留或重发。

服务端以 Pi `sendCustomMessage` 的不可见 reference 内容附加文本和图片快照，再用 `prompt` 发送原样用户文本。每次运行在内存中绑定不可预测的本轮标识；Pi 的 `context` 扩展在每次模型请求前只保留与本轮标识匹配的参考关联消息，过滤旧快照和失败后遗留快照；工具循环及同次运行继续时保留本轮材料，结束或失败清除运行标识。手动压缩的 `session_before_compact` 同样过滤原始参考快照；自动压缩关闭。原生历史已有快照保留，不改写或删除；会话树投影显示原生关联节点内容。材料作为用户显式提供的参考而非指令或授权。图片通过 Pi 原生 image content 发送，模型配置声明图片输入；供应商拒绝或执行失败通过项目错误事件或 Bot 事件报告，不当作成功。Pi transcript 的不可见关联消息持有快照；会话恢复时模型请求上下文同样过滤旧快照，不清理历史；这不限制会话树展示。模型回答、工具结果或历史压缩摘要可能保留材料派生的信息，不承诺模型遗忘已产生的信息。无数据库写入或 schema 迁移，无新 Agent/项目权限。Pi 写入后失败可能已有原生历史，不自动重发或重新读取参考文件；页面仍按 Session Tree 契约重读原生历史，附加参考成功但 prompt 失败时也可能保留不可见材料，不能承诺跨 Pi 写入原子性。协调会话使用现有 `idempotency-key`，接受后返回 202；项目会话在会话归属校验后声明流幂等键，再校验参考内容与读取项目文件；声明后即使校验失败也不可复用，重新提交使用新键。新页面以 Accept: application/json 提交，接受后返回 202；运行时错误通过会话订阅报告。旧 NDJSON 客户端仍按兼容流接收，不作为新页面更新机制。

独立项目 Session 的消息 POST 接收用户 `content` 和可选 `references`，校验 Project、Session、同项目 SessionMemory、执行互斥及非 Bot 归属；新页面成功返回 202 接受 DTO，兼容旧请求才返回 NDJSON；服务端独立调用 Pi `prompt` 原样发送文本。项目文件读写工具由独立项目执行策略提供，不以角色或其能力开关决定；仅限项目根目录，遵守敏感路径与符号链接检查、项目写入互斥，实际修改遵循用户意图。可用且匹配的正式角色仅附加指导；无角色、旧式或停用角色不阻止执行，不注入不可用指导，不改历史绑定。会话繁忙或归属不符时返回对应错误，不调用 Pi；接受后的失败通过所属会话错误事件返回。消息归 Pi transcript，成功后异步触发独立记忆总结。服务端对接受的发送输出同一诊断 ID 的阶段耗时：用例接收、句柄复用/创建/恢复、prompt 开始、首个 assistant 流更新、首段可见文字、首个工具活动和结束/失败。时间基于单调时钟；assistant 更新不等于供应商网络首包，缺失阶段不虚构。另在服务端记录首段文字和完成事件写入响应流队列的时间，在浏览器记录这两个事件被解析的时间，使用事件 `runId`（即该诊断的 turnId）和 Session ID 关联；各端记录 ISO 时间及从各自流开始的单调耗时，跨端时间比较须考虑时钟偏差。入队不代表浏览器已收到，浏览器解析不代表 React 已渲染。日志仅包含诊断 ID 或 turnId、Session ID、阶段和时间，不包含提示词、输出、思考、工具参数/结果、原生路径、凭据或异常正文；不写数据库、不改变 API 响应或 Pi 行为。

## 10. Bot 与迁移边界
Bot 流程见“协调会话 API”。旧跨项目入口不恢复。数据库边界遵循 `02`“现有数据库与迁移决策”：只初始化用户指定的新空库，不迁移旧库。

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

## 17. 协调会话 API（当前对象）

页面只使用以下 API 及 PSES-008 的协调会话 runtime 打开、服务端心跳应答和关闭 API，不直接读写 Pi 或数据库。模型见 `02`“协调会话”。项目调用由协调会话内的桥梁插件完成，不新增页面派发接口。

| API | 作用 | 入参 | 返回 |
| --- | --- | --- | --- |
| `POST /api/bots/:botId/conversations` | 创建协调会话 | 无项目目标 | 协调会话、项目范围和协调 Agent 版本 |
| `GET /api/bots/:botId/conversations/:id` | 读取协调会话 | 协调会话 ID | 协调上下文、项目会话引用、项目调用状态和操作许可 |
| `GET .../messages` | 读取协调 Pi 历史 | 协调会话 ID | 返回所属协调 Pi 的完整 Session Tree 投影，不混入项目树 |
| `POST .../messages` | 向协调会话输入 | 用户原文 | 202：已接受并开始处理；只写入协调 Pi |
| `GET .../events` | 订阅协调会话实时事件 | 协调会话 ID | SSE；按 Session 活动与历史展示契约返回事件，不写 Pi |
| `PATCH ... {status:"deleted"}` | 强制删除协调会话 | 协调会话 ID | 删除本会话及其开启的项目会话、独有记忆和对应 Pi 历史 |

创建不预建项目 Session、SessionMemory 或项目调用。读取不把项目 transcript 混入协调 transcript。用户输入不携带目标项目 Session，页面不能绕过协调会话直接写项目会话。

`POST .../messages` 返回 202 后，协调会话即为处理中，不等待首个模型事件。同一会话已在处理时返回 `SESSION_BUSY`，不写入 Pi、不排队。接受前校验失败不改变 transcript；接受后 Pi 的写入或执行失败遵守 PSES-006 中的原生历史非原子性规则。

协调会话先按 PSES-007 的 open API 创建或恢复句柄；消息请求验证有效租约后复用该句柄并调用 `prompt`，不在发送时创建新 Session。打开期间一次输入结束只释放处理锁；最后页面切离后的运行、五分钟中止和释放按 PSES-007。

协调会话的普通输入不注入 `bot_evidence` 或 `bot_report_result`，也不要求模型先报告结构化结果。Pi 结束后立即发出完成事件；页面收到后恢复输入，不等待历史刷新。

删除是物理删除，不是归档，也不等待 `accepted`、`working` 或 `unknown` 调用结束。先中止活动 Pi 调用和压缩，再删除本会话的项目调用，以及 `botConversationId` 指向本会话的项目 Session 和独有 SessionMemory。Bot、Bot 工作目录、Project、Agent 和其他协调会话保留。

协调会话的桥梁插件只提供以下工具。工具立即返回，不在一次调用中等待项目完成。

| 工具 | 入参 | 返回 | Pi 能力 |
| --- | --- | --- | --- |
| 读取项目 Agent | 项目 ID | 绑定 Agent 的功能、职责和边界 | 读取 Agent 定义，不读取项目文件 |
| 发起项目调用 | 项目 ID、原始输入引用、实际发送内容 | 调用 ID、项目会话 ID、`accepted` 或 `working` | 启动或复用项目 Session，再调用 `prompt` |
| 查询项目调用 | 调用 ID | 当前明确状态和有界进度 | 读取插件订阅状态，不读取项目输出 |
| 读取项目返回 | 调用 ID | 仅 `completed` 时返回该次 assistant 原文 | 按调用边界读取项目 transcript |
| 修正项目调用 | 调用 ID、修正文本 | 修正已送入原项目会话 | 对原项目 Session 调用 `steer` |
| 放弃项目调用 | 调用 ID | 仅 `unknown` 改为 `aborted` | 不调用 Pi，不读取项目输出 |

实际发送内容默认等于原始输入。只有已有项目返回不足以确认时，才允许修改或拆分。`aborted` 和 `unknown` 不能作为结果传递。项目返回不校验固定格式。

协调输入和桥梁工具的服务端关键诊断记录接收、运行结束或失败、各桥梁工具进入/返回/失败，以及项目调用的保存、重复、排队原因、获取句柄、prompt、订阅及结束状态。日志仅使用服务端已确认的会话/调用/项目 Session ID、固定工具名、固定阶段、受限错误码和耗时，不记录用户内容、模型输出、工具参数与结果、路径、密钥、异常正文或堆栈；日志失败不影响执行。日志不写数据库、不改变 API 或 Pi 行为。

发起调用时，插件先保存 `accepted` 和实际发送内容，再启动或复用该协调会话已有的项目 Session。项目 Session 确认开始后改为 `working`，并记录 transcript 起始条目。收到未中止的 `agent_settled` 后记录结束条目并改为 `completed`。中止改为 `aborted`。启动、订阅或边界无法确认时改为 `unknown`，不自动重试。

同一项目 Session 同时只处理一个调用。已有 `accepted` 或 `working` 调用时，新调用保持 `accepted`，不把提示词写入该 Session。进度信号只包含调用 ID 和有界进度，不包含 assistant 输出。完成信号只提示协调会话再次调用“读取项目返回”。

修正只允许作用于 `working` 调用，并使用 `steer` 把修正文本送入原项目 Session。它不创建新调用，不改写已经发送的内容。`completed` 后需要继续询问时，必须发起新的项目调用。

读取协调会话时返回每次项目调用的 ID、项目会话 ID、状态和有界进度。只有 `completed` 才按 transcript 起止条目附加该次 assistant 原文，供协调画布投影；这不是另一份持久结果。边界无效时返回读取错误，不把调用改成已完成。`accepted`、`working`、`aborted` 和 `unknown` 不返回项目原文。插件工具仍按调用 ID 独立读取。

幂等和并发：

- 相同协调会话、项目、原始输入和实际发送内容重复发起时，返回已有调用和当前状态。
- 同一项目 Session 已有 `accepted` 或 `working` 调用时，不同内容的新调用保存为 `accepted`，等前一次进入终态后再启动。
- 不同项目的调用可以并行，超过 Bot 并发上限的调用保持 `accepted`。
- 查询和读取使用调用 ID。调用 ID 不存在、不属于当前协调会话，或状态不是 `completed` 时，不返回项目原文。
- 修正请求只在调用仍为 `working` 时送入 `steer`。状态已变化时返回当前状态，不补送。

恢复：

- 服务重启不把内存进度当作结果。能重新核对起始和结束条目的调用保持或进入 `completed`。
- 不能核对边界的 `accepted` 或 `working` 调用进入 `unknown`。
- `unknown` 不自动重试、不自动中止，也不释放成可写入同一项目 Session 的新调用，直到用户删除协调会话或明确放弃该调用。
- 放弃只接受 `unknown`。插件把它改为 `aborted`，不调用 Pi，不读取或传递项目输出。调用已变化时返回当前状态。
- 热重载不能把本进程仍在运行的调用改成 `unknown`。

错误按调用返回：项目不在当前协调会话范围、项目 Agent 不存在、调用不存在、状态不允许读取或修正、项目 Session 无法启动、并发上限已满。失败不改变原始输入。除协调会话被强制删除外，不删除已保存调用。

当前 API 不提供暂停调度、停止工作、Work/Task 派发、向项目 Session 直接输入，或把 `unknown` 改成完成或失败的接口。

## 18. 独立 Agent 列表、编辑对话与 Bot 绑定
### 18.1 角色列表弹窗

点击侧栏 Agent/角色入口，先打开角色列表弹窗；不替换或复用当前项目/Bot 对话。列表顶部是“新增 Agent”，每行显示名称、协调/项目用途、当前版本、状态，并提供“修改”和“删除”。新增/修改时列表弹窗收起，Agent 编辑器以非弹窗工作区占据主画布与右侧列，左侧导航保留；它隐藏当前会话视图但不改变会话选择或草稿。取消编辑丢弃本次未保存候选并返回列表，已存版本不变；保存新版本后返回列表并刷新。

删除先检查 Bot、Project、Session 和项目调用引用。没有任何引用时可以删除目录索引和版本文件；有引用时拒绝物理删除，并提供归档且保留历史。已运行会话和历史版本仍可读取，后续 Bot 不能再新选该 Agent。

### 18.2 独立材料与 LLM 转换

新增 Agent 时先选择用途 coordinator/project，然后提供三种生成依据：选择一个已登记 Project 根目录、指定/上传参考文件，或上传 Agent Markdown。目录和文件只为本次 LLM 生成提供材料，不绑定 Project，不给 Agent 永久目录权限；可按项目目录和指定文件组合提供来源，界面逐项列出待发送材料及相对路径。

任何上传的 Markdown（包括 OpenCode、Claude、Pi 或普通文档、即使看似已是规范 Agent.md）均调用固定服务端模型转换；不走确定性语义解析捷径。文件本身是非可信数据，LLM 无工具、不执行内容中的指令、命令或链接。应用先做编码/大小校验，对项目材料按根目录和预算读取；任何来源范围变化、要求变化或新上传文件会让旧候选失效。

生成结果必须是严格结构化的候选字段和来源依据、未映射项、事实/推测区分与能力提示，由应用校验后序列化为规范 Agent Markdown。模型不产生 agentId、kind 最终值、revision、Bot/Project 关系或 permission grant；kind 由用户在创建时明确选择，能力开关由用户单独设置且默认全关。若文件无足够角色信息，标为需补充，不编造确定角色事实。

### 18.3 独立编辑对话与右侧 Markdown

编辑工作区中央显示专用 Agent 编辑对话，与正在进行的任何 Bot 总对话/Project Session 独立：使用独立无工具 LLM 请求，不能读取/写入主对话历史、SessionMemory、任务、Pi transcript 或当前 Agent 的执行句柄。中间编辑对话提供 Project 选择器、参考文件上传和自然语言修改输入；选中的 Project/文件只作本轮来源材料。

右侧固定展示当前工作草稿的只读 Agent.md 与版本差异，不提供直接编辑原始 Markdown 的文本区。新增时展示第一份候选；修改时默认展示已保存版本，并区分“当前保存版本”与“本地修订稿”。每次用户提交意见后，LLM 生成新候选；验证通过后右侧更新为工作草稿并显示变更摘要/差异，用户可继续多轮输入意见。候选失败、超时或取消时保持最近有效工作草稿；不得覆盖已保存文件。

“取消”丢弃整个未保存工作草稿、编辑对话历史和未完成请求，返回角色列表；“保存新版本”仅持久化新 Agent.md 文件及数据库目录索引，返回列表。若编辑的是已保存 Agent，不改任何 Bot 绑定或运行会话；Bot 默认版本采用只影响后续新对话；当前总对话/项目 Session 的同角色安全采用是另一项明确动作，见“持续 Session 的同角色新版采用”。创建 Agent 不绑定 Agent-Bot 或 Agent-Project 关系。

### 18.4 新建 Bot 时绑定角色和项目

新建 Bot 表单可选择一个协调 Agent，搜索并选择 0..N 个 Project，再为每个 Project 选择 0 或 1 个项目 Agent。没有协调 Agent 时可以保存待配置 Bot，但不能创建协调会话。只有这个配置流程建立 Bot、Project 和 Agent 关系；Agent 列表和生成材料选择不建立关系。零 Project 仍可进行普通讨论。

创建协调会话直接继承 Bot 当前协调 Agent、Project 范围和项目 Agent 版本，不重复弹选择框。Bot 配置修改只影响后续协调会话。项目调用只能使用当前协调会话已复制的范围。独立项目会话可以不绑定项目 Agent；角色是可选指导，不决定项目工具权限。已有角色停用或不可用不阻止发送，保留历史绑定。用户在创建时明确选择角色仍须保存可用且匹配的项目 Agent 快照。SessionMemory 仍独立创建。旧库触发器若要求非空角色，则创建时返回 `SCHEMA_INCOMPATIBLE` 并说明需用户单独决定迁移；不自动改写历史库。

### 18.5 保存、恢复与失败

Agent 文件写入使用应用生成的 ID、revision、规范化 YAML frontmatter 和 Markdown 正文。LLM 输出先通过严格 schema、能力、用途、长度和内容摘要校验。保存先原子创建不可变版本文件，再条件更新目录索引；已有版本不覆盖。数据库提交失败时保留旧索引，并标记或清理孤立新文件。

取消或关闭 Agent 编辑不自动保存；保存失败保留工作区中的草稿以便重试。切换回主会话时主 Composer 草稿和会话运行状态保持原样。项目生成准备、Markdown 转换、意见修订都不会启动 Bot/Project 执行或修改 SessionMemory。

### 18.6 持续 Session 的同角色新版采用

Agent 独立编辑和保存不自动采用。用户在协调会话或项目 Session 明确选择同一 Agent 的新版本后，先展示指导和能力差异，再核对角色可用、文件摘要、范围，以及没有未完成项目调用。事务只更新选中的当前引用，历史调用不变。已有 Pi 历史保留，下一次项目调用才装配新指导；不能在调用运行中更换提示词或扩大范围。替换 Agent 身份必须新建 Session。未选择的 Session 保留旧版，Bot 默认版本采用仍只影响新协调会话。
