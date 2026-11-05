# 03｜API：模型如何变化

本文范围：独立项目与通用会话的 API 和状态变化。Bot 的全部专属设计、模型、API、交互与需求统一见 [06｜Bot](06-bot.md)，本文不定义或复写其规则。

本文只定义 `02` 的模型如何变化，以及 API 如何安全触发这些变化。页面布局不是本文职责。

每条流程写明触发者、前置许可、读取的模型和表、事务内写入、外键和幂等约束、失败或 unknown 时保留的事实、调用的 Pi 能力。不调用 Pi 时明确写出。

每个 API 写明方法、路径、调用方、入参、返回 DTO、错误码、幂等键、读写模型和具体 Pi 能力。入参不得替代服务端读取到的归属、角色和权限。返回值不单独暴露运行句柄、配置密钥或原生 Session 文件绝对路径。会话树节点内容按本节 Session Tree 契约原样返回，可能包含 thinking、工具参数、敏感结果、路径或凭据；不得以此过滤或脱敏节点。

## 1. 总体规则

每个项目 Session 固定属于一个 Project，独占一个 Pi Session Tree。消息写入原生 transcript，不建立应用级记忆或总结。归属、许可、运行互斥、默认模型、恢复与错误均由服务端核验，客户端只提交定位和用户意图。运行时只有 Pi，持久化边界见 02。

## 2. 创建 Session

调用方为会话创建界面。POST /api/projects/:projectId/sessions 接收可选 agentId、purpose，使用 Idempotency-Key；不接收模板、记忆、归属、角色正文、模型配置或 nativeRef。服务端校验 Project active；提供 Agent 时验证用途与版本可用性，不提供时可直接创建。旧记忆参数作为未知入参返回 INVALID_INPUT/400，不再解释或忽略。

一笔短事务只 INSERT sessions，保存新 id、数据库读取的 project_id、可空精确 Agent 引用及快照、purpose 和创建时间；nativeRef 首次按打开流程建立。成功 201 返回安全 Session DTO，含 purpose、运行派生状态和 allowedActions，不含记忆 ID 或摘要。相同幂等键及相同载荷复用结果，异载荷 IDEMPOTENCY_CONFLICT/409。不存在或归属不符 NOT_FOUND/404，项目不可用或角色无效返回既有领域错误；数据库失败不留下半条记录、不调用模型。

旧库仍要求退役绑定或目标约束不兼容时，写入前返回 SCHEMA_INCOMPATIBLE/409；不创建占位记忆绕过约束，也不启动时自动迁移。退役数据处理仅见 02 的历史映射。

## 3. 加载、命名与功能退役

选中会话按 PSES-007 建立或恢复句柄，先订阅再读取唯一 Pi 树。GET /api/projects/:projectId/sessions 及会话读取返回 purpose，页面 trim 后显示，空白为“新会话”；创建、恢复、每次回答或列表刷新都不调用模型生成名称。实时和主请求生命周期沿用后文。

删除全部应用记忆、模板、内容校正及手动/自动总结 API，包括 /api/session-memory-templates 与会话路径下 /memory、/memory/context、/memory/summarize 及其子操作；退役路径返回 NOT_FOUND/404，不读写历史表、不调用 Pi、不创建后台任务。删除请求结束钩子、调度器、记忆轮询、相关 DTO 和端口。旧库中的退役记录不影响只读 Pi 历史；不可兼容的写操作明确阻止。

## 4. Session 活动与历史展示
项目会话的会话栏是所属 Pi Session Tree 的对话流投影，不是第二份对话。`GET /api/projects/:projectId/sessions/:sessionId/messages` 由页面调用，服务端校验 Project/Session 归属与读取许可，依据精确 nativeRef 使用 Pi SessionManager `getTree()`、`getEntries()` 和 `getLeafId()` 读取整个树、原生追加顺序和当前叶子；不调用 LLM，不改变 Pi 历史或数据库。活动句柄必须复用其 manager；无句柄时的历史读取必须只读，不能借 Pi `SessionManager.open()` 的空文件初始化或旧版本自动重写来改变历史。只读恢复遇到需要原生迁移的旧版本时返回 `SESSION_TREE_READ_FAILED`，提示用户单独决定迁移，不自动迁移。已建立且确认为空的 Pi Session 返回空节点和空叶子；无权返回 403、目标不存在或归属不符返回 404，引用缺失或不可恢复返回 `NO_NATIVE_REF`（409），原生读取失败返回 `SESSION_TREE_READ_FAILED`（500），均不伪装为空树、不新建替代历史。读取无幂等键，重复读取不产生写入。

成功响应 JSON 为 `{ "data": { "entries": [...], "activeLeafId": ... } }`，其中 data DTO 为 `{ entries, activeLeafId }`：`entries` 是按 Pi `getEntries()` 原生追加顺序排列的数组，每项为 `{ entry, label, labelTimestamp }`，其中 `entry` 是完整原生 entry 对象，含 `id`、`parentId`、`timestamp`、`type`；标签及其时间不存在时为 null。节点只出现一次，共享祖先不复制。`activeLeafId` 为当前句柄的 `getLeafId()` 或 null；它表示读取时 Pi 的活动指针，不保证是结构上的终端节点。恢复后的值以 Pi 恢复结果为准，不能承诺未写入新 entry 的分支切换在重启后保留。客户端据 parentId 表达分叉和活动路径；用户参考节点 `custom_message/user_reference_files` 只有在唯一后继链通向用户消息时（允许穿过 Pi 首轮插入的 system 消息，其他中间类型或分叉终止），允许视觉上收进该用户消息正文之后的附件折叠区，原始节点只展示一次且完整可查；API 和持久树顺序不变。没有确定用户后继节点或存在分叉时独立保留，不跨分支或按内容猜测附件归属。不得把不同分支拼成同一线性上下文，或以时间戳重排和推断父子关系。

先从 `getEntries()` 检查重复 ID 和父链，避免 Pi `getTree()` 在循环数据上无法终止；对父节点缺失或自引用的节点保留原 parentId 并标记异常；多节点循环、重复 ID 或其他无法可靠表达的损坏返回 `SESSION_TREE_READ_FAILED`，不丢弃或虚构节点。读取时在同一 Session 的短临界区内取得树、顺序、标签和叶子的一致快照，不持锁等待 LLM；无法取得一致快照则返回读取错误。全部节点包括消息、thinking、工具调用及结果、压缩、分支摘要、模型变化、custom 和 display=false 的关联消息；未知类型保留原内容，不按敏感程度过滤或脱敏。Session header 不是 tree entry，不能把 cwd 或原生文件路径作为独立字段下发。节点内容可能包含敏感信息；整个成功响应均为敏感数据，使用 `Cache-Control: no-store`，不写诊断日志。若原生内容无法完整序列化或响应无法生成，返回读取错误，不截断或伪装完整。

读取许可不能只靠客户端提供的 ID 或会话租约：若部署有身份认证与权限机制，服务端必须先核验真实调用方的读取权限及数据库归属；若没有，则服务端核验数据库归属，并且部署只能处于用户控制的可信访问边界，不能把租约、随机 ID 或同源策略当作认证。当前项目 `npm run dev` 监听 `0.0.0.0`，不等于仅本机可访问；服务端的归属检查也不是调用方认证。对不可信网络开放前须另行建立并验收访问控制，本次不将其假定为已有功能，也不增加内容过滤。

实时内容统一采用会话级 SSE：项目 `GET /api/projects/:projectId/sessions/:sessionId/events?leaseId=...`，前置检查归属、读取许可及本进程有效打开使用权。独立项目消息 POST 接受后返回 202 `{accepted:true,sessionId,operationId}`，不绑定长运行响应；兼容项目旧 NDJSON 客户端不作为新页面传输。应用启动执行后持续消费直至真实终态，页面断流不取消执行。只读及非发起页面同样订阅原生变化，不定时读取 transcript。所有流及历史响应 `Cache-Control: no-store, no-transform`。

会话 SSE 与兼容项目 NDJSON 使用事件 DTO `{ sessionId, runId, sequence, type, entryId, temporaryId, payload }`：运行事件的 `runId` 为本进程生成、单次运行唯一的临时标识，`sequence` 为该运行内从 1 开始递增的整数；不属于单次运行的应用状态事件两者均为 null。`entryId` 和 `temporaryId` 在无对应身份时为 null；Pi 内容事件的 `type` 和 `payload` 表达对应 Pi 事件，不修改原始内容。完成、失败、调用进度等应用状态事件也使用此封装，但不冒充 Pi 原生 entry；其 payload 使用现有状态与错误契约。文本、thinking、工具调用参数、工具更新和结果按 Pi 实际事件完整传递，不按类型或敏感程度过滤。事件有 Pi 原生 entry ID 时带该 ID；尚无 ID 时使用仅限本次运行的临时关联标识，不能当作持久节点或自行推断父节点。Pi 的普通消息可能在 `message_end` 通知订阅者之后才追加对应 entry，不能假定通知时 ID 已存在；仅在服务端从同一 Pi 运行可靠取得该映射后，发送带两种标识的关联事件。custom 消息对应 `custom_message`，按同一运行中的 customType、content 对象身份和 details 对象身份可靠定位，不按普通 message 查找；Pi 在通知前已追加的节点立即发送关联，通知后才追加者延迟核对。无法确认映射时不按文本或时间猜测。模型或 Pi 没有提供的内容不补造。两类页面打开先订阅 SSE 再读快照，订阅期间缓冲事件并按运行标识和序号去重；项目页面同样先订阅再读快照；消息 POST 只提交意图；断流、重连、运行结束或失败时重读快照，以 Pi 树为准。最终快照成功后移除能确认已关联的临时展示；无法确认某临时内容已持久化时保留并明确标记未确认，不把它编造成节点。快照失败保留当前展示及错误并允许重试，不假报同步。各页面和多次运行的临时标识不能混用；不同 Session 的事件不能混入。

## 5. API 边界
~~~text
GET/POST  /api/projects/:projectId/sessions
POST      /api/projects/:projectId/sessions/:sessionId/runtime/open
POST      /api/projects/:projectId/sessions/:sessionId/runtime/pong
GET       /api/projects/:projectId/sessions/:sessionId/events
POST      /api/projects/:projectId/sessions/:sessionId/runtime/close
GET       /api/projects/:projectId/sessions/:sessionId/messages
POST      /api/projects/:projectId/sessions/:sessionId/messages
POST      /api/projects/:projectId/sessions/:sessionId/interrupt
POST      /api/projects/:projectId/sessions/:sessionId/end
POST      /api/projects/:projectId/sessions/:sessionId/restore
DELETE    /api/projects/:projectId/sessions/:sessionId
GET       /api/projects/:projectId/sessions/:sessionId/models
PUT       /api/projects/:projectId/sessions/:sessionId/model
POST      /api/projects/:projectId/sessions/:sessionId/fork
GET       /api/projects/:projectId/sessions/:sessionId/export
GET       /api/projects/:projectId/sessions/:sessionId/context
POST      /api/projects/:projectId/sessions/:sessionId/compact
POST      /api/projects/:projectId/sessions/:sessionId/compact/cancel
~~~

以上为会话路径索引，不替代逐项契约；Project/生命周期、Agent、耐久操作、文件及导出分别按 §11～15。POST S/role、POST S/recover 与 POST P/session-requests/:operationId/recover 也由这些章节定义。

### 页面打开与运行句柄（PSES-007）

项目 Session 使用 `/api/projects/:projectId/sessions/:sessionId/runtime/{open,pong,close}`。页面或其会话管理器调用；服务端从数据库核验项目归属、会话存在及许可。历史ended_at不限制打开或执行；已有nativeRef必须精确恢复，原生历史不可恢复时返回错误，不创建替代会话。入参不携带 cwd、角色、权限、nativeRef 或运行状态。

- `open` 是 POST，无业务入参；返回安全 DTO `{ leaseId, status, outcome }`，`outcome` 为本进程确认的 `SESSION_BACKGROUND_TIMEOUT` 或 null，`leaseId` 是不可猜的临时使用权标识，`status` 为 ready/running，原型号失效时先按§13自动回退默认模型，默认也不可用才返回仅恢复用途的unavailable；不返回句柄、原生路径或内部内容。每次打开创建一个独立租约；请求重试以 `idempotency-key` 去重，同键不同目标或入参返回 409。已存在的活动 Pi 句柄必须复用，包括正在后台运行者；没有句柄且有 nativeRef 时精确恢复；没有 nativeRef 时创建空 Pi Session，确保原生身份可恢复后条件写入对应业务记录的 nativeRef。并发打开、后台调用和首次创建使用同一会话级串行门禁；重复请求不创建第二个 Pi Session。已有 nativeRef 缺失、损坏或身份不符返回 `NO_NATIVE_REF`（409），不能新建替代历史。初始化失败不返回租约、不触发 prompt；若 Pi 文件创建与数据库写入之间失败，需保留可核对的恢复信息，不能自动替换已确定身份或删除历史。数据库只写对应 Session 的 nativeRef，不修改历史内容；无需 schema 变更或历史库迁移。
- 不再提供页面主动定时 `heartbeat`。`open` 创建临时 lease，允许 120 秒内建立订阅；每条订阅绑定一条 lease。SSE 初始发出 `event: ready`，payload `{connectionId}`；服务端立即及每 30 秒发出 `event: ping`，payload `{connectionId,challenge}`，同连接最多一个待应答挑战，期限 90 秒。页面收到后 POST 对应 `/runtime/pong`，入参仅 `{connectionId,challenge}`，无页面定时器；服务端校验目标归属、读取许可、连接身份、挑战和期限后续租，204 无正文。不匹配或过期返回 `SESSION_SUBSCRIPTION_EXPIRED`（409），不续租、不调用 Pi；已过期挑战不能重放到其他连接。SSE 取消、请求断开或超时释放该连接与 lease，其他页面及后台使用权不受影响。`close` 仍 POST `{leaseId}` 幂等释放，204；连接级服务端心跳与超时在 application，HTTP 层仅传输。重连必须重新 open 并订阅；连接失联不等于执行失败。
- 新选中会话先 `open`；成功后先订阅再读取树；选中变化时立即切换，异步 close 旧租约。打开失败显示错误并允许重试，不自动发送。消息 POST 在 `x-session-lease-id` 请求头附带当前有效租约作为运行句柄使用权；校验失败返回 `RUNTIME_NOT_OPEN`（409），不写入 Pi。服务端仍执行现有归属、互斥、参考材料和幂等校验，再在该句柄调用 Pi `prompt`；发送不新建或替换 Pi Session。
- 最后一个页面租约释放或过期时，若会话空闲且没有后台使用权，释放内存句柄；若自身运行未结束，则以该时刻为起点启动默认 300 秒单调计时。先收到 Pi `agent_settled` 或已确认的运行失败时结束计时，完成现有状态和边界处理后释放无其他使用权的句柄。到期仍在运行且没有页面重新打开时调用 Pi `abort`，等待其真实结束及状态落定后释放；不把超时当作成功。确认因本超时中止时，现有运行事件与重开后的安全状态返回 `SESSION_BACKGROUND_TIMEOUT`，页面据此显示中止而不是成功；不新增持久状态或伪造 Pi transcript。`abort` 失败或结束无法确认时保留互斥与待核对状态，报告错误，不强行伪造结束、重复发送或销毁仍运行的句柄。重新打开在中止开始前取消计时；若中止已开始，不撤销中止，复用句柄等待结束，不启动第二轮。
- 多页面只在最后租约离开时计时；重复 close、续租与超时、结束与切换及并发 open 通过同一会话门禁处理，不得释放新句柄或中止已重新打开的运行。后台使用权与页面使用权独立；页面切离不释放仍被后台执行使用的句柄。后台执行结束后无其他使用权时释放句柄。
- 页面断线不等于运行失败；服务进程退出会丢失句柄、租约和计时器，不保证退出期间执行五分钟中止。重启按现有原生引用和调用恢复规则重新核对，不把旧运行自动标记成功或重发。无可恢复引用或无法确认调用边界时返回错误或 `unknown`。历史、已发生的工具副作用及未完成的原生写入不因中止或释放回滚；释放不删除原生 Session 文件。

订阅覆盖独立项目会话；后台执行与页面使用权独立。后台首次创建经项目初始化端口保存 nativeRef，后续每次调用按精确引用取得当前句柄，不缓存已释放对象。内部后台项目调用若携带 `operation=read` 则禁止项目写入；该标记不属于用户消息 POST 的入参。复用句柄时由服务端按本轮意图设置运行时写入门禁，结束时清除，不能因打开时创建了写工具而绕过只读限制。项目首次身份以 Session ID 的 SHA-256 确定 `.data/project-pi-sessions/<hash>.jsonl`，同路径独占锁目录覆盖文件初始化及数据库条件写入；仅对独占创建的空文件调用 Pi `SessionManager.open()` 初始化 header。已存在候选文件必须完整验证版本、cwd 和身份后才可采用；空文件、损坏文件、残留锁保留现场并报错，不自动重建或破锁。条件更新只在 native_ref_json 为 NULL 时生效；已有引用以数据库为准，候选文件保留。只读恢复严格解析原文件并以 Pi 内存 SessionManager 读取，不调用 `open()` 或迁移；运行恢复先验证版本、身份和完整末尾，再按精确引用打开。不得更改、删除或自动迁移历史。

恢复初始化（PSES-009）调用 Pi SDK 前，适配层仅在本次初始化期间对 SessionManager 的 model/thinking 追加入口做当前活动分支去重：分别比较该分支最后一个同类配置节点；值相同返回已有节点 ID，不追加、不移动叶子；无同类节点或值实际变化时调用原生追加方法。不能比较其他分支，也不能删除旧重复节点或伪造对话消息让 SDK 误判。初始化成功和失败均恢复原方法；失败不回滚已发生的原生合法追加，业务记录和 nativeRef 保持原契约。项目 Runtime 使用该适配，不修改 SDK 安装文件。无新增 API、表、事务或配置来源，不调用 prompt 或模型。

`open` 调用 Pi SessionManager 创建或打开及 AgentSession 初始化；`close` 在满足条件时调用 Pi dispose，超时调用 abort 并观察真实结束；服务端 ping 与有效 pong 只维护连接和内存使用权，不调用 Pi。原生历史、所有分支和当前叶子由 Pi 管理；`open` 本身不返回树，messages API 按本节 Session Tree 契约返回节点内容。

### 会话本轮参考文件（PSES-006）

PSES-010 粘贴输入沿用本节 references，不新增 API 或持久模型：剪贴板 PNG/JPEG/GIF/WebP 作为上传图片；超过 10 行或 1000 字符的文本作为 UTF-8 文本附件，完整保留换行和内容。浏览器草稿以文字和附件原子块混排，光标插入/删除和位置仅属于临时编辑文档。发送前去掉内部定位标记，将其余文字作为 content、仍在文档内的材料作为 references，定位标记不进入 API 或 Pi；UI 仅显示行数和可移除标记，短文本按光标位置插入纯文本。仅附件发送时 content 使用“请查看本次附带的图片或文本。”；仍执行现有数量、字节、归属及文件签名校验，接受前失败保留选择和草稿。

`POST /api/projects/{projectId}/sessions/{sessionId}/messages` 可选接收 `references` 数组，上传为 `{name,data}`（标准 base64 字节和不含路径的文件名），项目文件为 `{projectId,path}`，路径是所属根目录内相对路径。项目目录沿用 `GET /api/projects/{projectId}/files?path=...`；项目 Session 只能引用所属项目。服务端从数据库核验范围，不信任客户端提供的归属或目录；发送时重新安全读取文件，校验真实路径、敏感路径、忽略目录、普通文件和文件变化。总计最多 10 个、单个 2 MiB、合计 8 MiB，各来源共同计算；请求 JSON 最大 12 MiB，读取时限制字节数。校验 base64、文件名、UTF-8 文本及 PNG/JPEG/GIF/WebP 签名，错误返回 400/403/404/409/413/415/422，不调用 Pi；接受前失败保留输入和选择。不写项目或业务表、不创建授权。消息缓存版本不匹配时消息请求均返回 `REFERENCE_SERVICE_RESTART_REQUIRED`（503），避免旧句柄把历史参考带入普通请求；参考目录查询不依赖旧缓存服务对象。接受后的运行错误由事件报告，不保证自动保留或重发。

服务端以 Pi `sendCustomMessage` 的不可见 reference 内容附加文本和图片快照，再用 `prompt` 发送原样用户文本。每次运行在内存中绑定不可预测的本轮标识；Pi 的 `context` 扩展在每次模型请求前只保留与本轮标识匹配的参考关联消息，过滤旧快照和失败后遗留快照；工具循环及同次运行继续时保留本轮材料，结束或失败清除运行标识。手动压缩的 `session_before_compact` 同样过滤原始参考快照；自动压缩关闭。原生历史已有快照保留，不改写或删除；会话树投影显示原生关联节点内容。材料作为用户显式提供的参考而非指令或授权。图片通过 Pi 原生 image content 发送，模型配置声明图片输入；供应商拒绝或执行失败通过项目错误事件报告，不当作成功。Pi transcript 的不可见关联消息持有快照；会话恢复时模型请求上下文同样过滤旧快照，不清理历史；这不限制会话树展示。模型回答、工具结果或历史压缩摘要可能保留材料派生的信息，不承诺模型遗忘已产生的信息。无数据库写入或 schema 迁移，无新 Agent/项目权限。Pi 写入后失败可能已有原生历史，不自动重发或重新读取参考文件；页面仍按 Session Tree 契约重读原生历史，附加参考成功但 prompt 失败时也可能保留不可见材料，不能承诺跨 Pi 写入原子性。项目会话在会话归属校验后声明流幂等键，再校验参考内容与读取项目文件；声明后即使校验失败也不可复用，重新提交使用新键。新页面以 Accept: application/json 提交，接受后返回 202；运行时错误通过会话订阅报告。旧 NDJSON 客户端仍按兼容流接收，不作为新页面更新机制。

独立项目 Session 的消息 POST 接收用户 `content` 和可选 `references`（其余字段拒绝）；content 为保留原始空白的非空 string、UTF-8≤32KiB，只有附件时按前述固定文本提交，正文为空或超限分别 INVALID_INPUT/400、REQUEST_TOO_LARGE/413。要求 Idempotency-Key 与当前 lease；校验 Project、Session、执行互斥；新页面成功返回 202 接受 DTO，兼容旧请求才返回 NDJSON；服务端独立调用 Pi `prompt` 原样发送文本。项目文件读写工具由独立项目执行策略提供，不以角色或其能力开关决定；仅限项目根目录，遵守敏感路径与符号链接检查、项目写入互斥，实际修改遵循用户意图。可用且匹配的正式角色仅附加指导；无角色、旧式或停用角色不阻止执行，不注入不可用指导，不改历史绑定。会话繁忙或归属不符时返回对应错误，不调用 Pi；接受后的失败通过所属会话错误事件返回。消息归 Pi transcript，不调度回答后的应用总结任务。服务端对接受的发送输出同一诊断 ID 的阶段耗时：用例接收、句柄复用/创建/恢复、prompt 开始、首个 assistant 流更新、首段可见文字、首个工具活动和结束/失败。时间基于单调时钟；assistant 更新不等于供应商网络首包，缺失阶段不虚构。另在服务端记录首段文字和完成事件写入响应流队列的时间，在浏览器记录这两个事件被解析的时间，使用事件 `runId`（即该诊断的 turnId）和 Session ID 关联；各端记录 ISO 时间及从各自流开始的单调耗时，跨端时间比较须考虑时钟偏差。入队不代表浏览器已收到，浏览器解析不代表 React 已渲染。日志仅包含诊断 ID 或 turnId、Session ID、阶段和时间，不包含提示词、输出、思考、工具参数/结果、原生路径、凭据或异常正文；不写数据库、不改变 API 响应或 Pi 行为。



## 6. 原生上下文检查和用户手动压缩
### 6.1 策略与边界

关闭 Pi 自动压缩，包括达到阈值时自动整理、上下文溢出后自动压缩重试。保留原生压缩算法，只由用户在会话检查的设置页点击“压缩上下文”触发；没有后台定时压缩或自动点击替代。创建与恢复 Session 都重新落实手动策略，会话设置展示“自动压缩已关闭”。


### 6.2 使用情况读取

会话检查的设置页打开后 GET context 返回 `02`“原生上下文使用情况”定义的 NativeContextInspection。只为读取检查数据不创建或初始化 Pi Session、不发模型请求、不执行压缩；未有可用句柄时按 §11 返回 runtimeReady=false 及原因，显式打开/恢复后再读取。不得因 GET 检查追加配置节点或进行写入型恢复。

设置页可见时，压缩运行中每 2 秒刷新，其他状态每 30 秒刷新；进入设置页、一次主回答完成、模型切换成功、手动压缩完成或失败后立即刷新，页面隐藏时暂停。用量不是逐 token 结算：运行期间可展示最后可信采样及时间，不伪造实时更新。超过容量或接近容量可以提示用户手动压缩，不能提示后自动执行。

### 6.3 手动压缩流程

~~~text
用户查看会话设置中的原生用量并点击“压缩上下文”
→ POST compact（Idempotency-Key）
→ 校验 Project active、Session 同项目且已启动可恢复
→ 取得与用户请求共享的 Session 执行锁
→ 调用 Pi 原生手动压缩（使用当前 Session 的已解析模型及其完整参数）
→ 原生保存压缩结果，保留历史条目
→ 释放锁，刷新原生用量和安全状态
~~~

仅 idle 且有可压缩历史的 Session 可压缩；not_started/ended/unavailable 或主请求 running/starting/interrupting、已有压缩任务时，按钮禁用，服务端返回对应错误（冲突为 409）。主回复运行中不排队压缩、不自动停止回答，用户结束请求后重新点击。压缩运行时新的用户提交返回 SESSION_BUSY，Composer 显示“正在压缩原生上下文”，完成后恢复发送，不能丢掉本地输入。

按钮点击本身就是本次手动压缩授权，不再追加审批步骤。

POST 返回 202 和安全压缩状态。相同 Idempotency-Key 只共用一次压缩执行，实际结果通过 context GET 查询。压缩可消耗模型 Token，页面点击前有简短说明。失败不假装用量已下降、不删除历史或更改业务会话身份，显示安全错误供用户再次手动重试。进程退出后不从页面刷新自动重放压缩请求，只根据原生记录和当前 Runtime 状态核对结果。

### 6.4 容量不足和失败

关闭自动压缩后，模型上下文过长返回明确 `CONTEXT_LIMIT_REACHED`，保留历史与输入，提示打开会话检查的设置页，手动压缩后重新发送；不压缩后自动重试旧请求。手动压缩失败返回 `COMPACTION_FAILED` 的可见状态，保持原生恢复诊断；若已发生原生写入，由恢复投影核对，不能宣称失败就一定没变。下一次尝试仍须用户点击。

压缩前后指标按相同口径刷新；无法获取时明确标“暂不可用”，不编造节省量或成功百分比。设置用量 API 不另行返回原生压缩摘要或完整 system prompt，仅返回用量、状态、时间及原因；完整树和导出仍保留所有原生节点。

开发热更新或不同 Route Bundle 持有不同 DomainError 类实例时，安全错误映射仍按明确的领域错误形状识别，保证旧库 SCHEMA_INCOMPATIBLE 提示不退化为通用 500；普通 Runtime 异常不暴露内部信息。

关闭弹窗时中止本地读取并忽略过期响应，不自动重放任何操作；关闭不撤销已接受的压缩、模型切换或创建会话。操作的结果以服务器与 Pi 原生事实为准。


## 7. Pi 上下文 UI 操作
打开会话检查的设置页时只读取模型及 Pi 上下文状态；刷新仅重新 GET context，不发用户消息或压缩。首次读取后通过回答终态、compaction_start/compaction_end及context_changed事件重新读取；请求完成后立即刷新，不定时轮询。未知、估算值、运行中、恢复失败都必须显式区分。

用户点“压缩上下文”才 POST compact；API 再核验同 Project、Session idle、原生可压缩内容及执行锁。执行时保持输入文本，禁用发送，禁止重复压缩。用户点“取消压缩”POST compact/cancel（幂等键），应用调用同一 Runtime 的 abortCompaction；不调用主回复停止、不自动继续对话。未运行时返回冲突。取消请求后锁仍由原操作 finally 释放；成功取消显示 cancelled 并刷新 Pi 状态，若已完成则按原生结果展示。

Session 不可恢复时展示错误与“恢复会话”入口，沿用已有 POST restore；页面选中后按 PSES-007 打开运行时，未选中的 Session 不因检查而预先启动。输入来源、Runtime 恢复与消息窗口均以 Pi 为准。



## 8. 独立项目 Agent 编辑

独立项目会话沿用独立角色列表和编辑工作区：列表为弹窗，新增/修改进入主画布与右侧列；中间使用独立无工具 LLM 接收自然语言意见，右侧只读展示 Markdown 候选及差异，不改变主会话选择、草稿或原生历史。

项目目录、参考文件和任意上传 Markdown 都仅是生成材料；上传先校验编码、大小和读取范围，再经无工具 LLM 转换为严格候选。模型不产生身份、版本或权限授权；应用校验用途、能力、长度和摘要，能力由用户明确选择且默认关闭。

保存先原子创建不可变 Markdown 版本，再条件更新目录索引；失败保留旧索引和本地草稿，不覆盖已引用版本。取消丢弃未保存草稿并回到列表。保存定义不建立项目 owner 或执行授权，也不自动更新运行中的 Session。无引用时可删除，有引用时只能归档并保留历史版本。

独立项目 Session 可无 Agent 运行。明确选择时校验项目用途及可用版本并保存精确快照；旧库强制角色触发器导致不兼容时返回 `SCHEMA_INCOMPATIBLE`，不自动迁移。显式采用同一 Agent 新版时，展示差异并核对用途、摘要、范围与空闲状态，只更新选中引用，下一次执行装配新指导，原生历史和历史版本保留。

## 9. 用户删除独立项目会话（PSES-012）

DELETE /api/projects/:projectId/sessions/:sessionId，由导航确认按钮调用，可信单用户许可，入参仅路径且无正文。服务端验证同 Project；项目无需处于 active 状态。会话级互斥覆盖检查、释放句柄及数据库删除，正在打开、回答、压缩时 SESSION_BUSY/409；unavailable（结果未核对）时 REQUEST_UNKNOWN/409；Bot 关联及历史引用 SESSION_REFERENCED/409。不存在或跨 Project 为 NOT_FOUND/404。成功返回 {data:{deleted:true,sessionId}}；重复删除 404，不需要幂等键，不自动重放。事务按 02 只删除 sessions 指定行；Pi 仅 dispose 空闲句柄，不 prompt、abort、compact 或改写 transcript。释放失败不删记录；SQL 失败回滚删除，句柄可重新打开。成功清理租约、定时器和观察者；其他页面后续读取 404。

## 10. 会话检查：树定位、模型、派生与导出

本节对应 UI-042～044、PCFG-001～003、PSES-014～016；状态见 05，以下是目标 API，尚未实现验收。S=/api/projects/:projectId/sessions/:sessionId。所有入口核验数据库 Project/Session 归属与真实调用方许可，沿用 §4 的可信单用户部署边界；读操作 no-store，无幂等键，不调用模型。配置来源和完整参数装配仅引用 01，DTO 仅引用 02，不允许客户端提交配置路径、凭据、cwd、nativeRef 或容量覆盖值。provider/modelId 为与 Pi 注册表精确匹配的非空字符串、各≤1024字符；entryId 为非空原生节点ID、≤128字符；export 的 format 只取 html/jsonl、scope 只取 tree/branch，未知查询参数拒绝 INVALID_INPUT/400。Session 读取返回 02 定义的 allowedActions；模型切换时它与 SessionModelView.canSwitch 使用同一规则，创建许可不替代 entryId 校验。

| 方法/路径 | 调用方、入参与成功返回 | 许可、读写模型与 Pi 能力 |
| --- | --- | --- |
| GET S/messages | 会话树预览复用现有全树 DTO | 只读 Session 与精确 Pi 树；定位为客户端动作，不新建导航 API、不调用 navigateTree/branch、不改变叶子 |
| GET S/models | 会话设置，无正文 → 200 {data:SessionModelView} | 解析应用配置与 Pi 注册表，读取当前模型及许可，不发探测请求，不创建 Session 或写默认文件 |
| PUT S/model | 设置选择；{provider,modelId,thinkingLevel?}，Idempotency-Key、x-session-lease-id → 200 {data:SessionModelView} | 有效运行租约、active Project、可恢复且 idle，无 unknown；原型号失效时允许 §13 的仅恢复 lease；会话执行互斥内重新解析配置、检查 chat 模型与认证、调用当前 AgentSession.setModel，原生 model_change 为唯一持久模型事实；禁止写 sessions、其他会话及配置文件 |
| POST S/fork | 设置创建；{entryId}，Idempotency-Key → 201 {data:安全 Session DTO} | active Project、源会话已启动且历史可恢复，无运行/压缩/unknown 或未决创建；源会话互斥内验证节点属于该树，Pi createBranchedSession 复制到独立身份，再同事务插入新 Session；不调用 prompt/LLM，不改变源叶子 |
| GET S/export?format=…&scope=… | 设置下载；两个参数必填 → 文件流，Content-Disposition: attachment；HTML 为 text/html;charset=utf-8，JSONL 为 application/x-ndjson | 同树读取许可；完整快照在短临界区取得，流式生成不持锁；只读 Pi 原生证据，不写业务表、不调用模型；ended 可导出，原生缺失报错 |

### 10.1 模型切换与失败

模型列表返回所有 Pi 可用于会话的 chat 模型及可用状态；非 chat 模型不冒充可选会话模型，配置对其余原生参数的支持不因此被裁剪。canSwitch 和原因由服务端按当前会话事实计算。用户选中已用模型时为无变化成功，不追加相同 model_change。PUT 相同键同参数按 §13 的耐久证据复用执行及结果，异参数 IDEMPOTENCY_CONFLICT/409；重启后核对本操作的 model_change 与落盘边界，不能仅凭当前型号认定完成，不重放无法确认的操作。

PSES-019：PUT model可携带thinkingLevel（off/minimal/low/medium/high/xhigh/max），省略维持Pi既有模型切换规则；携带时必须属于目标模型的Pi getSupportedThinkingLevels，否则INVALID_INPUT/400且无副作用。仅调整思考等级也提交当前provider/modelId，不新增API。目标及等级一同纳入switch-model journal载荷摘要，重试异等级409；原生setModel后调用setThinkingLevel，persistManager并核对实际等级及thinking_level_change；相同等级不追加重复节点。读取GET models返回当前thinkingLevel（无记录null）及每个型号thinkingLevels，不写SQL、默认设置或其他会话，不调用prompt；许可/互斥/unknown与模型切换一致。跨Pi/文件失败仍按证据核验，不伪造回滚。思考等级变化事件及应用完成后刷新树、模型和上下文。

切换前完成配置、参数、模型及认证验证，失败保持原模型；执行中失败或持久化结果不明则重新读取原生证据，能确认时返回实际结果，无法确认返回 REQUEST_UNKNOWN/409 并保持写入门禁，允许读取和现有恢复核对，不宣称已回滚。成功后刷新树、模型与 context，用量依 02 重新测量；不改写历史消息或自动压缩以适应小窗口。下次请求按新模型能力校验图片、工具及容量，失败保留草稿。

### 10.2 从节点创建与跨存储失败

选中的 entryId 必须是源树已有原生节点，不能用实时 temporaryId、另一 Session 的节点或浏览器正文替代。读取根到该节点的一致祖先路径并校验完整性，包含该节点；Pi 原生能力必须支持该 entry 类型，不得静默改到邻近用户消息。来源 Agent 引用按原版本保存，无法合法创建则报告错误，不选择其他 Agent。

操作在首次 await 前取得源 Session 的创建门禁，和打开、发送、删除、压缩、切换模型及相关配置写入互斥。Idempotency-Key 的作用域为源 Session 与 fork，entryId 纳入载荷摘要；同键同参数复用一次结果，同键换节点为409；使用服务端从作用域与键派生的新业务 ID 和独占文件准备位置，重试先核验现有新 Session 及精确原生引用，不能创建第二份结果。参数摘要与操作边界按 02 §13 耐久保存；重启后只读核验 SQL、候选与源基线，未完成时通过 §13 的显式 finalize-fork 或 acknowledge-unknown 处理，不自动补写或删除候选文件。

先读取源 manager 的一致快照，在隔离的临时 manager 上调用 Pi createBranchedSession；不得对源 Runtime 的 manager 调用，也不能靠调用后改回引用假装源身份未变。当前 SDK 会替换调用方身份及 entries、移除并重建 label、重连 parentId，且纯配置路径不保证立即落盘。适配层只在新候选中保留新 header 身份，将 entries 校正为快照中根到选中节点的原始完整路径（含 label），保证原 id、parentId、内容、压缩引用与选中叶子一致；不得把 SDK 追加的路径外 label 当成继承历史。配置节点或无普通消息的路径也须显式持久化并验证可恢复；无法保真支持的类型返回 FORK_NODE_UNSUPPORTED，不静默跳点。源 manager 的身份、叶子和原文件字节必须保持不变。

验证新 sessionId、文件、cwd、完整祖先路径及模型后，再在一笔 SQLite 事务中 INSERT sessions（新 id、源 project_id、可空精确 Agent 引用、首次 native_ref_json、原 purpose 及新时间）；校验外键及原生身份约束。SQL 失败回滚该插入，源记录不变，已生成原生文件保留为待核对候选，操作保持unknown并报告operationId，不把它接到源会话或自动删文件。提交成功但响应丢失时按新 ID 查询并验证后返回同一结果。无稳定证据不自动重试创建；恢复核对完成前保留该键的 unknown 门禁。

### 10.3 导出范围与错误

导出范围按 02 定义；branch 使用读取时的活动叶子，tree 使用全树，页面不得用标题列表替代正文。Pi exportToJsonl 的原生范围是当前分支，完整树必须使用 SessionManager 全部 entries 的只读序列化适配；HTML 使用原生能力与全树适配保证选定范围完整。源文件不改写，导出临时文件置于应用临时目录，不能落入项目目录或冒充新 Pi Session。中断下载只清理本次临时输出，不删除源历史。

参数错误 INVALID_INPUT/400；无权限 FORBIDDEN/403；目标或节点不属于该 Session 为 NOT_FOUND/404；需要活动句柄的操作未打开时 RUNTIME_NOT_OPEN/409；修改操作忙碌 SESSION_BUSY/409、结果未知 REQUEST_UNKNOWN/409；无原生引用 NO_NATIVE_REF/409；只读导出不因运行或 unknown 自动拒绝，仍须取得一致且完整的快照；配置错误 MODEL_CONFIGURATION_ERROR/503；型号缺失 MODEL_NOT_FOUND/422；认证不可用 MODEL_UNAVAILABLE/409；不支持的节点 FORK_NODE_UNSUPPORTED/422；创建失败 SESSION_FORK_FAILED/500；导出失败 SESSION_EXPORT_FAILED/500。错误均保留已有会话、配置和源历史；已发生的原生写入按证据核对，不伪造事务回滚。配置错误消息不包含密钥、请求头或配置全文。

## 最后打开时间（SLIST-002）

现有Project open与Workspace open在归属/原生恢复/只读或模型失效可读检查成功后、颁发新lease之前，通过SessionOpenHistory记录当前服务器ISO时间。Project相同打开键重放只复用结果，不更新时间；每次实际新开连接更新时间，SSE心跳重连若复用lease不写。GET列表/详情返回lastOpenedAt；无记录返回null，不回填历史。存取失败分别SESSION_OPEN_TIME_READ_FAILED/WRITE_FAILED（500），不伪造时间；写失败不颁发新lease，保留已建立原生身份/句柄，可用新打开请求重试。无SQL写入、额外Pi节点或新路由。文件原子替换和fsync在infrastructure完成。

## 会话列表预览（SLIST-001）

现有会话GET列表/详情及返回SessionDTO的动作增补02定义的lastUserInput/lastActivityAt/previewUnavailable，无新接口和SQL事务。服务端从数据库nativeRef核验身份及cwd，只读Pi树，按追加顺序派生，不改分支、不prompt。原生读取失败只标记本条预览不可用，不隐藏记录。订阅后的原生输入落盘/终态触发客户端现有列表重读，无定时轮询。Workspace同样映射06。

## 当前连接 API（SCONN-001）

用户已要求会话只有打开与关闭两态。runtime/open取得租约并按精确Pi身份初始化/恢复，GET events订阅ready后才视为页面打开；runtime/close释放当前lease并结束该订阅，保留SQL记录和原生文件。关闭后可重新打开，历史ended_at不再参与许可。旧POST end仅作为关闭兼容入口，释放本会话连接/空闲句柄，不更新SQL或产生新的end journal。删除继续DELETE指定Session行，删除后GET/打开404，不伪造closed记录。

打开后的agent_start/agent_settled、compaction_start/compaction_end、context_changed（服务端完成收尾）、entry_link、错误和连接关闭事件驱动UI；首次订阅ready和重新连接先订阅后读一致快照，事件触发必要的树/上下文/元数据读取，禁止定时轮询。SSE ready携带{connectionId,activity:{running:boolean,compacting:boolean}}当前运行活动快照，避免HTTP open到订阅之间遗漏终态；连接关闭由明确事件通知，客户端仅在网络断线时自动重连，用户关闭后不自动重开。运行许可仍校验租约、归属、模型、互斥和unknown，错误表示操作结果，不是新的Session状态。历史end journal仅供核验，不能重放为新的SQL写入。

## 11. 通用 HTTP 与 Project / Session 生命周期（GAP-002）

本节及 §12～15 补齐 GAP-001～005，仅定义独立项目与通用能力，不调整 06 或 GAP-006。所有路径以 /api 为根，P=/api/projects/:projectId，S=P/sessions/:sessionId。调用方为当前应用页面/API Client；真实访问许可按 §4，服务端先核验数据库归属，跨 Project 一律 NOT_FOUND/404。读操作 no-store、无副作用/幂等键；除明确调用 Pi 的动作外均不调用 Pi。成功 JSON {data:T}；错误 {error:{code:string,message:string,recoverable:boolean,operationId?:string}}，不包含堆栈、原生路径、配置或凭据。下载成功不套 JSON。

写正文为 JSON 对象，未知字段拒绝 INVALID_INPUT/400；损坏 JSON、数组、null、仅空白为 INVALID_JSON/400。标明无正文的动作接受零字节或 {}；不得仅依据 request.body 是否存在判断。默认 JSON≤64KiB，Agent prepare≤512KiB，消息沿用 §5 的12MiB；超限 REQUEST_TOO_LARGE/413。ID 为非空定位字符串（≤128字符），不能用其拼接用户文件路径。可选字符串省略采用文档默认值，null 只在明确可空字段接受。name trim 后非空，description trim 后空串归一 NULL；purpose 只 trim 首尾，省略为 ''，null/非字符串或超过500字符 INVALID_INPUT/400。错误消息可本地化，code 不变。

条件写用 If-Match：缺失 PRECONDITION_REQUIRED/428，不符 WRITE_CONFLICT/409；ETag 规则见 02 §12。Project 和 Agent 写入没有自动重放语义，不要求 Idempotency-Key，客户端不得在网络失败后自动重复创建；通过列表及返回 ID 核对，不把同名视为同一资源。Session 有外部副作用的操作要求 §13 的键；DELETE 无键、重复404。目录/Markdown/原生文件验证在事务外，最终身份、状态、ETag、键及 FK 在短事务内再次验证；SQL 失败回滚本事务，不宣称磁盘副作用已撤销。

| 方法/路径 | 入参与返回 | 前置条件、事务与错误 |
| --- | --- | --- |
| GET /projects；GET P | 无正文→ProjectDTO[] / ProjectDTO | 只读 projects；单条不存在404 |
| POST /projects | {name,rootPath,description?,kind?}→201 ProjectDTO | 名称/说明限额见02，kind默认code、description默认null；验证可访问真实目录，单事务 INSERT projects、status=active；重复独立项目根路径 ROOT_PATH_CONFLICT/409；不创建磁盘目录/Pi |
| PATCH P | {name?,description?,kind?,rootPath?,status?}、If-Match→200 ProjectDTO | 至少一项；范围字段不能由客户端覆盖。事务 UPDATE 指定列及 updated_at；改目录时只要已有 Session/其他FK引用即 PROJECT_REFERENCED/409（含未启动会话），其他字段可更新；状态变更与本项目执行协调，已有打开/运行/压缩/unknown 时 SESSION_BUSY/409或REQUEST_UNKNOWN/409 |
| DELETE P | 无正文、If-Match→200 {deleted:true} | 无Session/其他引用、无本项目进行中创建；事务只DELETE projects；FK失败PROJECT_REFERENCED/409，目录/文件不删除 |
| GET P/sessions；GET S | 无正文→SessionDTO[] / SessionDTO | 从sessions与运行/操作证据投影；列表按created_at,id排序；读取损坏记录返回错误，不跳过或伪造空列表 |
| POST P/sessions | {agentId?,purpose?}、Idempotency-Key→201 SessionDTO | §2与§13；agentId省略表示NULL，若提供须非空且正式active/project用途；创建载荷摘要只包含规范化用户agentId/purpose，不含当时Agent版本，prepared另存当时精确revision/hash，重试不得改为最新版本；同事务仅INSERT sessions及创建键，native_ref_json=NULL、ended_at=NULL；updated_at=created_at；ROLE_UNAVAILABLE/409、ROLE_BINDING_INVALID/409、SCHEMA_INCOMPATIBLE/409；不调用模型/Pi |
| POST S/interrupt | 无正文、Idempotency-Key→200 SessionDTO | 无须active或lease；会话门禁内仅对本进程主请求调用abort，等待真实settled，释放原请求锁由原请求负责；无可取消请求 SESSION_NOT_RUNNING/409；压缩需compact/cancel，unknown拒绝；无法确认中止 REQUEST_UNKNOWN/409，不强行销毁句柄 |
| POST S/end | 无正文、Idempotency-Key→200 SessionDTO | 无主请求/压缩/打开/unknown；关闭本会话连接并释放空闲句柄，不写SQL/journal，不append原生消息、不删历史。重复关闭返回closed DTO，可再次打开 |
| POST S/restore | 无正文、Idempotency-Key→200 SessionDTO | 无活任务；只核对journal和原生引用，按精确nativeRef恢复确定可恢复的失败句柄，关闭自动压缩，不prompt。unknown仅核对，未证明结果仍REQUEST_UNKNOWN/409；损坏/缺失历史NO_NATIVE_REF/409，不建替代树。恢复不清ended_at、不改归属、型号或旧输入 |
| POST S/role | {agentId,revision,contentSha256}、If-Match、Idempotency-Key→200 SessionDTO | 显式采用同一Agent的正式active/project版本；当前无Agent或ID不同ROLE_BINDING_INVALID/409，不以采用入口更换身份。空闲、active、无unknown；读取/校验不可变文件，事务仅UPDATE agent_snapshot_json与updated_at，下一轮装配，不改Pi历史/当前运行 |

interrupt/end/restore/role 的 journal 结果通过 §13 核对；写操作均先做结构兼容检查，失败不生成占位行。GET context 的200为NativeContextInspection（套通用data）；POST compact无正文、键与有效lease，202 {operationId,inspection:NativeContextInspection}；POST compact/cancel无正文、键，202 {operationId,inspection}，取消中的inspection仍running直至实际结束；原生/配置/许可错误使用本契约错误码。GET context不创建或初始化Runtime；已打开句柄可读，否则返回runtimeReady=false及RUNTIME_NOT_OPEN，不因只读检查进行写入型恢复。

## 12. Agent 编辑、版本与保存 API（GAP-002）

编辑对话是浏览器持有的候选与自然语言轮次，不是持久Session，不拥有Pi transcript。prepare每次使用独立无工具LLM的默认模型；请求结束即释放，不注册工具/扩展/项目权限，不写数据库。现有Agent用途包括coordinator/project，但工作区首期接入与GAP-006不在本节范围。

| 方法/路径 | 入参与返回 | 许可、事务、副作用与失败 |
| --- | --- | --- |
| GET /agents；GET /agents/:agentId | 无正文→AgentDTO[] / AgentDTO | 只读agents目录与对应版本文件，不调用LLM；按id排序；缺失404、版本损坏ROLE_VERSION_MISSING/409；旧legacy只读 |
| POST /agents/prepare | {kind,mode,requirements?,feedback?,markdown?,fileName?,projectId?,referenceFiles?,currentDraft?}→200 AgentCandidate | mode=generate/import/revise，kind=project/coordinator；generate要求requirements或材料，import要求markdown，revise要求feedback与currentDraft；只收本轮材料，不保存项目owner，错误不修改已存Agent |
| POST /agents | {name,description?,kind,definition,status?}→201 AgentDTO | definition={instructions,capabilities}，status默认active，其他限额按02；先生成新ID/revision=1并独占写版本文件，再事务INSERT agents索引；失败保留待核对文件，不重用ID/覆盖文件，不把失败候选当正式版本 |
| PATCH /agents/:agentId | {name?,description?,definition?,status?,kind?}、If-Match→200 AgentDTO | 不接受id/owner/revision/hash覆盖；正式Agent不接受kind变化，旧legacy转换时kind必填且定义完整、用户明确确认转换；至少一项。正文或frontmatter变化创建revision+1候选并fsync，事务按旧ETag条件更新name/description/revision/content_sha256/status/updated_at（独立legacy首次正式转换还写kind）；仅status变化不写新文件；冲突保留旧索引及候选，WRITE_CONFLICT/409 |
| DELETE /agents/:agentId | 无正文、If-Match→200 {deleted:boolean,archived:boolean} | 有Session/历史FK引用时只条件UPDATE status=archived与updated_at，返回false/true；无引用时DELETE目录行，true/false；同事务重查引用，不删除Markdown历史；旧引用不能因归档丢失 |

AgentCandidate={name,description,definition,warnings:string[],sources:{path:string,hash:string}[],markdown:string}；hash为材料字节SHA256，path为上传显示名或项目内相对路径，不泄露宿主绝对目录。LLM只产出name/description/instructions/warnings，应用将capabilities初始化false；revise也不沿用LLM返回的授权，用户选择保存在编辑器本地，在保存请求显式提交。markdown由应用按02格式生成，仅只读展示。

requirements≤2000字符、feedback≤4000；markdown UTF-8≤64KiB，fileName≤256字符；referenceFiles最多8项，每项{name,content}、name≤256字符、UTF-8内容≤64KiB、合计≤256KiB。currentDraft={name,description,instructions}按02限额；name/description/instructions不接受额外身份或能力字段。projectId仅作本轮收集定位，须读取真实Project及允许材料；目录边界/敏感路径与§14相同。发给LLM的总材料按当前默认模型容量与实际输入估算校验，超过预算ROLE_INPUT_TOO_LARGE/413，不用应用固定Token常数覆盖contextWindow/maxTokens。材料不执行、不作为系统授权。

错误：INVALID_ROLE/422（字段/frontmatter/能力约束）、ROLE_MATERIALS_UNAVAILABLE/422、ROLE_INPUT_TOO_LARGE/413、ROLE_GENERATION_INVALID/422（模型候选不符）、REQUEST_ABORTED/409、MODEL_CONFIGURATION_ERROR/503、MODEL_UNAVAILABLE/409、ROLE_VERSION_MISSING/409；模型/SQL/磁盘失败保留已存版本与客户端草稿，不自动重试LLM。prepare取消中止本次独立LLM；保存提交前取消不写索引，提交后按GET核对，不承诺回滚。保存文件成功而SQL失败时，只有旧索引可被执行加载；管理员可通过GET精确版本引用核对，被引用版本永不覆盖。旧legacy转换须由用户通过prepare再保存；owner/source均为空的独立legacy可PATCH以当前ETag明确产生正式新版本；历史仍有Bot/Project owner或source引用的legacy保持原记录，使用POST创建新独立Agent，不清空或重解释旧归属。旧会话绑定不自动转到新ID，不自动转换。

## 13. 耐久幂等、恢复与不可用型号（GAP-004）

本节落实02 §13的独立项目证据，不改Workspace journal。执行顺序为：校验调用方/归属/输入→首次await前取得所属串行门禁→规范化载荷/计算operationId→读取或独占创建journal并fsync prepared→按操作验证并执行副作用→fsync observed/completed或failed→返回。确定性无副作用校验失败可在prepared前直接拒绝；prepared之后任何不确定结果都保留unknown。不同键的修改也被同Session未决操作阻挡；读树/导出/inspect仍可用。failed仅指可证明副作用边界已确定的失败；SQL失败但Pi候选已形成、原生写入不明或完成证据未耐久时不能记failed，须保持unknown。create以项目范围门禁保护检查与SQL，fork还锁源Session。不持SQL事务跨LLM/文件操作。

控制通道例外：interrupt与compact/cancel只在短门禁内核验、登记父operationId并取得当前取消句柄，随后调用abort/abortCompaction；不能等待父任务持有的整轮执行锁，否则会死锁。父任务继续独占执行锁，只有父任务确认结束才释放。恢复修改动作针对未决操作，在恢复门禁中执行，不被该目标unknown本身拒绝，但其他独立未决操作仍阻挡；同一父请求的取消/中止控制记录不互相阻挡恢复检查，仍须分别核对/确认，所有相关未决记录解除后才允许新执行。

操作名称固定为 create/open/restore/message/switch-model/compact/compact-cancel/interrupt/end/adopt-agent/fork/recover；API角色采用映射为adopt-agent，PUT model映射为switch-model。恢复动作的载荷包含目标operationId/action，避免不同恢复动作共用结果；HTTP错误在已声明操作时附operationId，202消息接受返回{accepted:true,sessionId,operationId}。无进行中操作的lease读取不写journal，读取pendingOperations可定位重启后的未知操作。

同键同载荷：completed复用原HTTP语义及稳定业务结果（SessionDTO按当前事实重读，不能重放旧state/许可）；failed返回原安全错误；本进程仍运行的compact/message返回原202及operationId，其他同步操作共用同一Promise；重启后的prepared/observed先只读核验，不能重发prompt/compact/setModel。异载荷始终IDEMPOTENCY_CONFLICT/409（含已确认unknown）。取消压缩/interrupt有自己的键与journal，必须记录所指向的当前父operationId，重试不能取消下一轮任务；父任务已完成时返回实际结果，无新abort。

| 操作 | completed所需持久证据 | 重启后如何处理 |
| --- | --- | --- |
| create | 相同确定Session ID、project_id、create_request_key_hash及载荷摘要的已提交行 | 完全匹配返回同一结果；仅prepared且确认无行、无Pi候选与其他副作用可记failed，用户新键重试；键相同载荷不同409；行已删除410，不重建 |
| open | 精确header身份/cwd/版本、已持久化的nativeRef，且基线合法 | 核验后可新建本进程lease（旧lease不恢复），同键每进程最多一个lease；候选/引用冲突保持unknown，不自动替换 |
| message / compact | observed中的原生结束证据、原生文件耐久摘要/末尾节点，与prepared基线及同操作独占区间一致；message必须观察agent_settled，compact必须确认新compaction节点 | 只有输入或assistant节点存在不足以证明工具循环终结；无completed/可靠终结证据保持unknown，不重发；压缩取消有settled且无新结果可记cancelled，不能以abort返回即视为结束 |
| switch-model | prepared记录旧模型与基线节点；observed记录本操作实际追加的model_change ID/provider/model及落盘摘要；同值无变化须在副作用前记completed no-op | 仅当前型号相同不能证明旧键完成；只有匹配独占区间的新节点及目标身份可核验成功，否则unknown；内存变化但无耐久节点不能成功返回 |
| adopt-agent | prepared保存目标Agent精确引用及原ETag，observed保存提交后的持久ETag | 比对业务行的完整预期字段及前后ETag；匹配才确认，其他操作未知时不反向假定已提交，不再次采用。历史end证据只核验，不创建新end journal |
| interrupt / compact-cancel / restore | 取消须有指定父操作的settled/取消终态与耐久证据；restore须验证精确身份且未执行prompt | 重启后无活任务仍不等于此前已成功取消；核验父操作实际结果，无法证明则unknown；restore可只重建内存句柄，不重放输入 |
| fork | 源基线摘要、entryId/路径摘要、唯一候选身份/摘要，以及确定新Session行及同创建键 | 源树/候选/SQL三方匹配才completed；仅有候选须用户显式finalize-fork；缺失/冲突保持unknown，不重新派生 |

所有原生成功必须确认文件耐久写入。SDK可能延迟纯配置或空会话落盘：适配层在会话门禁内将manager完整header/entries序列化为同目录临时文件，fsync后原子替换自身所属文件并fsync目录，核对内存/磁盘身份与原顺序；仅用于本次已授权的原生追加/候选初始化，不借此迁移旧版本、修改已有节点或清理历史。不能依赖SDK私有方法；当前文件与prepared基线不符时立即unknown，不覆盖外部变化。

新增 POST S/recover，调用方为明确的恢复动作，输入 {operationId,action}；action=inspect|acknowledge-unknown|finalize-fork。inspect无幂等键，200 {operationId,operation,status:'running'|'completed'|'failed'|'unknown'|'acknowledged',resultSessionId:string|null,errorCode:string|null,allowedRecovery:{acknowledgeUnknown:boolean,finalizeFork:boolean}}；只读验证journal、SQL和原生文件，不启动Runtime/模型、不写结果。无此作用域操作NOT_FOUND/404，坏journal仍返回unknown及安全错误，不返回内部路径/正文。create未有行时可用POST P/session-requests/:operationId/recover，正文与行为同上、只有inspect/acknowledge-unknown，服务端由证据定位项目及确定Session ID，不接受任意文件位置。

acknowledge-unknown要求可信调用方显式承认该操作可能已经发生副作用、当前无活任务、原生身份与journal完整且历史可读；fsync acknowledged后解除本操作写入门禁，200同恢复DTO（status=acknowledged）。它不是成功/失败判定，不回滚工具，不重发旧输入；旧键永久保留REQUEST_UNKNOWN（recover inspect可读acknowledged），新用户意图才用新键。损坏journal、身份/文件不符或仍运行不允许ack，返回REQUEST_UNKNOWN/409或SESSION_BUSY/409；需要单独离线修复，API不截尾/重建。动作需Idempotency-Key，按恢复操作与目标operationId作用域记账，重试只返回已有确认，不能解除其他操作的门禁。

finalize-fork要求目标是有效未提交候选，源归属/节点快照、候选完整路径/身份/模型及SQL创建约束全部可验证，Project active、无源活任务。使用Idempotency-Key；仅短事务INSERT确定ID的sessions行（含相同创建键/摘要/nativeRef/Agent引用），已存在相同行为成功、不同引用为REQUEST_UNKNOWN/409。fsync完成证据后200恢复DTO，resultSessionId为新ID；不重新调用createBranchedSession、不改候选或源树。候选不支持/已损坏则拒绝，不自动删除；用户可在满足ack条件时放弃本操作，新键发出新的创建意图。

不可用型号的恢复：GET models通过只读nativeRef/当前分支读取current，仍返回可用模型列表与switch许可，已保存型号缺失以models项/不可用原因投影，不因current不可用而阻断整个列表；配置文件解析错误仍503。MCFG-002：打开/恢复和空闲操作刷新先验证当前型号（注册、enabledModels范围、认证）；失败时尝试settings默认型号。默认通过后在同一Pi身份追加model_change并持久化，原历史前缀保留，不改SQL/配置文件、不prompt。默认缺失、被过滤或认证不可用才返回MODEL_UNAVAILABLE及仅恢复lease（status='unavailable',send=false）；配置损坏仍MODEL_CONFIGURATION_ERROR。GET models只读且按enabledModels过滤，不触发回退；显式PUT model严格校验目标，不自动改选。PUT model在无unknown/活任务、历史完整时接受该lease，用显式目标型号初始化同一Pi身份并setModel，按本节持久化校验；只允许追加本次目标model_change，不先写默认model_change。成功后同一lease成为可执行状态；失败保留原型号/树或按证据unknown。缺失/损坏历史不能靠切型号恢复；不清ended_at。

## 14. 独立项目文件与可选 Git API（GAP-003）

本节为Project文件弹窗、附件候选与源码预览的唯一接口契约；不定义Workspace列表API。只读调用方许可按§4；所有GET无键、无SQL写入、不调用Pi/LLM、no-store。Project disabled/archived 不阻断只读浏览。rootPath来自数据库，不接受自由宿主路径。path缺省''表示根；只收项目内相对路径，拒绝NUL、绝对路径、..逃逸，逐段lstat/realpath及读取后身份核验，符号链接解析越界拒绝PATH_OUTSIDE_PROJECT/403；项目根缺失ROOT_UNAVAILABLE/409。

默认隐藏并拒绝访问.git、node_modules、.next、.data、.env及.env.*、*.pem、*.key和敏感凭据文件（id_rsa/id_ed25519/credentials/auth.json）；.env.example/.env.sample可读。目录浏览、预览、附件引用使用同一服务端策略，不因客户端已持有路径绕过；Pi原生transcript/导出不受此文件API过滤策略影响。

| 方法/路径 | 输入 / DTO | 边界与错误 |
| --- | --- | --- |
| GET P/files?path= | ProjectFileListing={path:string,entries:FileEntry[],isGitRepository:boolean,gitState:'available'\|'not_repository'\|'unavailable',truncated:boolean}；FileEntry={name,path,parentPath,type:'file'\|'directory',gitStatus?:'added'\|'modified'\|'deleted'\|'renamed'\|'untracked'\|'conflicted'} | 仅列指定目录直接子项，path为项目内相对路径；目录优先、名称按Unicode排序，最多2000条，截断为排序前2000条并truncated=true，不假装完整；不存在NOT_FOUND/404，非目录INVALID_DIRECTORY/400；Git失败仍返回目录，gitState=unavailable且不伪造clean |
| GET P/files/content?path= | FilePreview={path:string,content:string,size:number} | path必填，仅普通文件、有效UTF-8、≤512KiB，原始换行不变；NOT_FOUND/404、PATH_OUTSIDE_PROJECT/403、FILE_FORBIDDEN/403、INVALID_FILE/400、FILE_TOO_LARGE/413、BINARY_FILE/415、FILE_CHANGED/409 |
| GET P/changes | ProjectChanges={isGitRepository:boolean,status:string,workingPatch:string,stagedPatch:string,truncated:boolean} | status为porcelain原文，patch来自工作区/暂存区，只读git；非Git返回false及空串、truncated=false；合计UTF-8≤1MiB，超过按字段顺序status/workingPatch/stagedPatch在完整字符边界截断并标true，不当完整diff；Git失败GIT_READ_FAILED/500，超时GIT_TIMEOUT/504（10秒），不执行hook/写索引 |

isGitRepository只表示仓库事实，不表示Git状态读取成功。文件列表不等待changes；git补充失败不阻断预览。读取中目录/文件身份变化返回FILE_CHANGED/409；IO错误FILE_READ_FAILED/500，保留页面现有数据，用户可重试。源码绝对路径先在客户端/服务端适配为本Project相对path，仍重做上述校验；API不接受绝对path。附件内容的2MiB额度不改变本预览512KiB上限。Git输出不进入SessionMemory、SQL或第二份对话。

## 15. 派生与导出的确定适配及验收边界（GAP-005）

fork使用prepared操作目录 .data/project-session-forks/<operationId>/，exclusive创建，隔离manager的sessionDir固定在该目录。SDK派生生成的随机候选文件名只允许一个；header/候选摘要先fsync observed再提交SQL。崩溃留下零文件表示未形成可用候选，有一个完整候选按§13检查，多文件/半文件/摘要不符为unknown，不按最新时间猜测。SDK不保证原始label和父链，候选必须按§10.2重建原始选定路径，再通过独立只读解析验证。

所有已知entry类型（消息、model_change、thinking_level_change、compaction、branch_summary、custom、custom_message、label）均允许作为选中节点，只要完整祖先链及引用自洽；未知类型可保留原文但SDK不能恢复其上下文时FORK_NODE_UNSUPPORTED/422。compaction.firstKeptEntryId及label.targetId须指向继承路径中合法节点或Pi认可的自引用语义；引用旁支或缺失目标不得偷偷复制旁支、改引用或跳到邻近用户节点。继承以选中entry为叶子；在label处创建也保留该label，不把SDK重建的末尾label当作原路径。仅header/配置节点的新树也必须可持久恢复，未选节点/空树无法fork。新文件header保留Pi新身份、源cwd及合法parentSession关系，源manager/file/leaf/模型不变。

JSONL导出在短临界区读取header、全部entries、活动叶子的一致快照后释放锁，tree保持原生追加顺序，branch按父链从根到叶子；空已初始化树输出header，branch叶子为空亦为header。label不重新生成；全部原始字段、原始字符串、未知节点及敏感工具原文保留。SDK exportToJsonl只保证分支且可能有格式处理，必须对比快照逐项；任何不能保真的范围由只读序列化适配生成，不调用branch/navigateTree，不初始化或迁移源文件。序列化失败SESSION_EXPORT_FAILED/500，不用替换文本冒充完整。

HTML由快照生成静态阅读文件，正文按安全Markdown输出、每个原始entry提供完整转义JSON；不包含执行型script、事件属性、iframe、object、自动外链资源，原文中的HTML仅作文字，href仅允许http/https和文内锚点，其他链接作为文字保留。采用原生details实现折叠，完整原文使用转义pre，覆盖</script>、引号、实体、Unicode分隔字符和图片data内容，编码不丢值；CSP为default-src 'none'、style-src 'unsafe-inline'、base-uri 'none'、form-action 'none'。不直接复用无法满足此约定的SDK HTML模板。

输出先在应用临时目录完整生成、核验并计算Content-Length，再发送attachment（文件名仅安全SessionID与scope/format）；tree/branch都显式写入HTML标题或下载名，JSONL不新增伪entry。下载中断仅清理本次临时文件，不写completed操作或新会话；未发头可JSON错误，发头后失败中断连接，客户端按状态、完整长度与下载完成判定，不保留截断文件为成功。原生读取/生成失败、unknown/ended只读、无消息路径均纳入定向验收；全部仅用临时目录与受控SDK，不能以文档已定标记实现通过。
