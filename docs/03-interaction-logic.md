# 03｜API：模型如何变化

## CHANGE-001｜Session原生编辑差异API

S=/api/projects/:projectId/sessions/:sessionId。GET S/changes校验SQL Session所属Project，无正文、lease或幂等键要求；只读所属Pi树和既有根请求journal。返回{runId:string|null,status:not_recorded|boundary_unavailable|running|recorded,notice:string|null,files:[{id,path,projectPath:string|null,editCount}]}。runId为既有根请求operationId，文件id为该路径首个原生edit结果entryId。GET S/changes/content?runId=&fileId=只接受这两个唯一非空定位参数（各最多256字符），返回{runId,fileId,edits:[{entryId,patch,firstChangedLine:number|null}]}，patch逐字取自成功edit的details.diff，不由模型或应用重算，不返回完整前后正文。列表path由对应原生工具参数按服务端项目根作词法相对化，统一/分隔符：项目内取相对所属根路径，Workspace内取相对最长匹配成员根路径，范围外相对当前cwd（可含../）；不读文件系统。projectPath派生自最长匹配的服务端项目根路径（完整根路径，仅用于用户要求的项目分组显示），未知路径或范围外为null，不推导虚假项目归属；页面按projectPath分组。原生diff与transcript原文保持不变。

边界和匹配遵循02；只显示最新根请求内的成功edit结果。同一路径保留全部编辑顺序，不抵消还原，不扩展为write/bash的净变化。无边界返回boundary_unavailable及明确notice；原生树空且无请求为not_recorded。有可信边界但无edit返回空列表并说明没有原生编辑差异，不宣称文件未变化。running只表示根执行仍在进行；recorded只表示可读原生记录，不宣称执行成功。

旧runId返回CHANGE_RUN_REPLACED/409；文件不存在NOT_FOUND/404；原生树读失败沿用SESSION_TREE_READ_FAILED；归属错误404；参数错误INVALID_INPUT/400；响应no-store。两种GET不调用prompt/steer/模型，不写SQL、journal、项目文件、快照或Pi transcript；执行路径移除文件采集包装，原生prompt、锁、lease与中止流程保持原职责。旧缓存服务尚未加载新实现时SERVICE_RESTART_REQUIRED/503，不隐式重启服务。

UI-050由RUN-001替代。

## RUN-001｜单轮运行统计事件

RUN-001补充：既有GET S/messages在原{entries,activeLeafId}中增加tokenUsage:{totalTokens:number|null,complete:boolean}，归属/读取许可/错误保持原契约，不增加端点或Pi模型调用。application复用本次readTree结果按02累计，完整空树为0，不另读文件或查询历史轮次；缺失/非法用量保留已知累计并标不完整，没有已知用量则null。既有历史消息和分支原样保留。打开/刷新/终态事件通过原messages查询恢复累计，最新一轮Token通过下述RUN-002原生用量及请求边界恢复，精确耗时仅在当前进程保留。

既有独立项目POST S/messages与GET S/events增加run_started/run_metrics，沿用归属、lease、幂等与运行门禁，无新端点、入参、SQL或Pi调用。接受新根请求时记录单调时钟并发送run_started={type,requestId,startedAt}；本次Runtime.send的pi_event/message_end仅累加assistant.usage，按本次temporaryId去重（无ID按消息对象），非负有限input/output/cacheRead/cacheWrite/totalTokens分别累计，reasoning不重复加。工具循环及steer属于同一轮。完成/停止/失败收尾后仅一次run_metrics={type,requestId,startedAt,durationMs,input,output,cacheRead,cacheWrite,totalTokens,complete}；无有效usage时计数null，部分缺失或失败complete=false并保留已报告合计。失败零占位不算完整用量。RUN-002补充：事件在当前服务进程globalThis内按Session保留最近一轮快照，不随事件服务重建丢弃；SSE ready同时携带runMetrics（当前耗时及用量快照或null），客户端在ready即恢复requestId与显示，再消费进度/终态事件；订阅建立后补发run_started和当前run_progress／最终run_metrics（runId/sequence为null），运行中durationMs按服务端单调时钟推进。run_progress在assistant message_end后更新已报告用量，未完成标complete=false。新根请求替换进程内快照；取消统计文件存储。耗时只在当前进程恢复，重启后不可用。GET S/messages追加latestRunUsage:{totalTokens:number|null,complete:boolean}|null，复用本次原生树及既有执行journal的最新根请求entryIds前后范围，仅汇总assistant usage；缺少边界为null，不猜测纠正输入归属。Workspace根request/result按06保存执行边界，项目沿用现有baseline/after；无新统计文件、模型调用或SQL。不持久保存统计，不改变运行错误或unknown门禁。页面仅投影统计，不把这些事件放入临时对话；重连恢复进程内快照；无快照则只按已有执行边界汇总最新轮原生usage，不估算耗时、不自动重放模型请求。


FILE-003：新增GET S/files/content?path=与GET S/files/download?path=，两者仅只读所属Pi会话文件目录。application从SQL核验Project/Session归属并读取nativeRef.sessionId，不接受客户端身份；基础设施以sessionFileDirectory(nativeRef.sessionId)定位会话目录，path可为回复内原生绝对路径或该目录内相对路径，仅作定位意图，拒绝目录外/其他会话/符号链接/敏感路径。没有nativeRef返回NO_NATIVE_REF/409；缺路径400，越界403，缺失404，身份变化409，其余容量/预览DTO/下载头复用FILE-001/002。不得仅凭文件名搜索或允许任意宿主路径。无SQL写入/幂等键/Pi调用或模型调用，不改文件权限或内容，响应不新增绝对路径。


FILE-002：FilePreview.format扩展xlsx/pptx/pdf。XLSX按workbook与relationships顺序显示工作表名、单元格位置、共享/内联字符串、布尔值、数值及公式的已存缓存值，无缓存时显示公式而不重算；日期保留存储值并提示。PPTX按presentation关系顺序显示幻灯片、文本与表格，不承诺主题/动画/图像版式。沿用ZIP≤50MB/10000条目，表格最多100000个投影单元格、每行最多512列、最多10000行，超限返回binary并明确提示。内容块复用FILE-001，不新增持久事实。PDF校验%PDF-签名后返回format=pdf，不提取/改写正文，浏览器通过现有download API读取原始字节并以application/pdf Blob在文件浮窗内显示，不上传第三方；不支持内嵌PDF的浏览器提示下载查看。无新接口、SQL事务、Pi或模型调用；损坏/加密Office与旧.xls/.ppt只提示并下载原件。


## FILE-001 文件下载与Word预览

GET /api/projects/:projectId/files/download?path=项目相对路径，调用方为文件浮窗，按已有Project读取许可与路径/敏感文件/符号链接/文件身份检查，只读普通文件≤50,000,000字节；成功200原始字节，Content-Type按扩展名、Content-Length精确字节数、Content-Disposition: attachment（UTF-8原文件名）、Cache-Control: no-store, no-transform（避免中间转换影响长度核验）、X-Content-Type-Options: nosniff。不接受客户端绝对路径，无幂等键、SQL写入、Pi调用或转换。错误沿用文件API的400/403/404/409/413及读取失败500，不发送部分文件。

GET同范围files/content保留原UTF-8≤512KiB的{path,content,size}返回；新增FilePreview可选format:"text"|"docx"|"xlsx"|"pptx"|"pdf"|"binary"（新增格式规则见FILE-002）、notice:string、blocks:FileBlock[]。FileBlock为{type:"paragraph"|"code",text:string}、{type:"heading",level:number,text:string}或{type:"table",rows:string[][]}。DOCX输入≤50MB、ZIP总展开≤50MB、≤10000条目，按正文顺序保留标题1～6、段落、代码样式和表格单元格文本，不执行HTML/脚本/外部资源，不承诺分页、字体、图像或公式渲染。解析失败/其他二进制/超出文本预览上限返回binary元数据及notice，仍允许下载原件；超过下载上限413。路径/权限/读取错误仍返回错误。预览不改源文件，不创建缓存记录。浏览器下载前检查HTTP状态和长度，失败显示原API错误，不将错误JSON保存成文件。


本文范围：独立项目与通用会话的 API 和状态变化。Workspace 的专属设计、模型、API、交互与需求统一见 [06｜Workspace](06-workspace.md)，本文不定义或复写其规则。

本文只定义 `02` 的模型如何变化，以及 API 如何安全触发这些变化。页面布局不是本文职责。

每条流程写明触发者、前置许可、读取的模型和表、事务内写入、外键和幂等约束、失败或 unknown 时保留的事实、调用的 Pi 能力。不调用 Pi 时明确写出。

每个 API 写明方法、路径、调用方、入参、返回 DTO、错误码、幂等键、读写模型和具体 Pi 能力。入参不得替代服务端读取到的归属、角色和权限。返回值不单独暴露运行句柄、配置密钥或原生 Session 文件绝对路径。会话树节点内容按本节 Session Tree 契约原样返回，可能包含 thinking、工具参数、敏感结果、路径或凭据；不得以此过滤或脱敏节点。

## 1. 总体规则

OPS-004：浏览器 API 客户端的请求键使用共享安全随机 UUID 生成器，不要求 crypto.randomUUID 存在；HTTP 环境用 getRandomValues 回退。已提供的幂等键继续原样传递，重试复用规则不变；生成失败时不发送请求。此客户端修复不改变接口入参、返回、错误码、SQL 事务或 Pi 调用。

每个项目 Session 固定属于一个 Project，独占一个 Pi Session Tree。消息写入原生 transcript，不建立应用级记忆或总结。归属、许可、运行互斥、默认模型、恢复与错误均由服务端核验，客户端只提交定位和用户意图。运行时只有 Pi，持久化边界见 02。

## 2. 创建 Session

调用方为会话创建界面。POST /api/projects/:projectId/sessions 接收可选 agentId、purpose，使用 Idempotency-Key；不接收模板、记忆、归属、角色正文、模型配置或 nativeRef。服务端校验 Project active；提供 Agent 时验证用途与版本可用性，不提供时可直接创建。旧记忆参数作为未知入参返回 INVALID_INPUT/400，不再解释或忽略。

一笔短事务只 INSERT sessions，保存新 id、数据库读取的 project_id、可空精确 Agent 引用及快照、purpose 和创建时间；nativeRef 首次按打开流程建立。成功 201 返回安全 Session DTO，含 purpose、运行派生状态和 allowedActions，不含记忆 ID 或摘要。相同幂等键及相同载荷复用结果，异载荷 IDEMPOTENCY_CONFLICT/409。不存在或归属不符 NOT_FOUND/404，项目不可用或角色无效返回既有领域错误；数据库失败不留下半条记录、不调用模型。

旧库仍要求退役绑定或目标约束不兼容时，写入前返回 SCHEMA_INCOMPATIBLE/409；不创建占位记忆绕过约束，也不启动时自动迁移。退役数据处理仅见 02 的历史映射。

## 3. 加载、命名与功能退役

选中会话按 PSES-007 建立或恢复句柄，先订阅再读取唯一 Pi 树。GET /api/projects/:projectId/sessions 及会话读取返回 purpose，页面 trim 后显示，空白为“新会话”；创建、恢复、每次回答或列表刷新都不调用模型生成名称。实时和主请求生命周期沿用后文。

删除全部应用记忆、模板、内容校正及手动/自动总结 API，包括 /api/session-memory-templates 与会话路径下 /memory、/memory/context、/memory/summarize 及其子操作；ROUTE-CLEAN-001：退役路由文件直接删除，不保留固定404处理器，由框架自然返回404；不承诺退役URL的JSON格式或缓存头，不读写历史表、不调用Pi、不创建后台任务。删除请求结束钩子、调度器、记忆轮询、相关 DTO 和端口。旧库中的退役记录不影响只读 Pi 历史；不可兼容的写操作明确阻止。

## 4. Session 活动与历史展示
项目会话的会话栏是所属 Pi Session Tree 的对话流投影，不是第二份对话。`GET /api/projects/:projectId/sessions/:sessionId/messages` 由页面调用，服务端校验 Project/Session 归属与读取许可，依据精确 nativeRef 使用 Pi SessionManager `getTree()`、`getEntries()` 和 `getLeafId()` 读取整个树、原生追加顺序和当前叶子；不调用 LLM，不改变 Pi 历史或数据库。活动句柄必须复用其 manager；无句柄时的历史读取必须只读，不能借 Pi `SessionManager.open()` 的空文件初始化或旧版本自动重写来改变历史。只读恢复遇到需要原生迁移的旧版本时返回 `SESSION_TREE_READ_FAILED`，提示用户单独决定迁移，不自动迁移。已建立且确认为空的 Pi Session 返回空节点和空叶子；无权返回 403、目标不存在或归属不符返回 404，引用缺失或不可恢复返回 `NO_NATIVE_REF`（409），原生读取失败返回 `SESSION_TREE_READ_FAILED`（500），均不伪装为空树、不新建替代历史。读取无幂等键，重复读取不产生写入。

成功响应 JSON 为 `{ "data": { "entries": [...], "activeLeafId": ... } }`，其中 data DTO 为 `{ entries, activeLeafId }`：`entries` 是按 Pi `getEntries()` 原生追加顺序排列的数组，每项为 `{ entry, label, labelTimestamp }`，其中 `entry` 是完整原生 entry 对象，含 `id`、`parentId`、`timestamp`、`type`；标签及其时间不存在时为 null。节点只出现一次，共享祖先不复制。`activeLeafId` 为当前句柄的 `getLeafId()` 或 null；它表示读取时 Pi 的活动指针，不保证是结构上的终端节点。恢复后的值以 Pi 恢复结果为准，不能承诺未写入新 entry 的分支切换在重启后保留。客户端据 parentId 表达分叉和活动路径；用户参考节点 `custom_message/user_reference_files` 只有在唯一后继链通向用户消息时（允许穿过 Pi 首轮插入的 system 消息，其他中间类型或分叉终止），允许视觉上收进该用户消息正文之后的附件折叠区，原始节点只展示一次且完整可查；API 和持久树顺序不变。没有确定用户后继节点或存在分叉时独立保留，不跨分支或按内容猜测附件归属。不得把不同分支拼成同一线性上下文，或以时间戳重排和推断父子关系。

先从 `getEntries()` 检查重复 ID 和父链，避免 Pi `getTree()` 在循环数据上无法终止；对父节点缺失或自引用的节点保留原 parentId 并标记异常；多节点循环、重复 ID 或其他无法可靠表达的损坏返回 `SESSION_TREE_READ_FAILED`，不丢弃或虚构节点。读取时在同一 Session 的短临界区内取得树、顺序、标签和叶子的一致快照，不持锁等待 LLM；无法取得一致快照则返回读取错误。PSES-020：活动manager与原生文件的header/全部entries按Pi实际JSON持久化语义比较（JSON.stringify再解析后规范键序），对象undefined省略、数组undefined为null不算差异；不能因JSON不保存的可选字段误报REQUEST_UNKNOWN。原生身份、条目数量/顺序/父链及所有可序列化值仍必须一致，真实差异继续409；不可序列化值按读取失败处理。只读校验不追加、覆盖、截断、重载manager或修复原生文件，不改SQL/journal，亦不重发消息。全部节点包括消息、thinking、工具调用及结果、压缩、分支摘要、模型变化、custom 和 display=false 的关联消息；未知类型保留原内容，不按敏感程度过滤或脱敏。Session header 不是 tree entry，不能把 cwd 或原生文件路径作为独立字段下发。节点内容可能包含敏感信息；整个成功响应均为敏感数据，使用 `Cache-Control: no-store`，不写诊断日志。若原生内容无法完整序列化或响应无法生成，返回读取错误，不截断或伪装完整。

读取许可不能只靠客户端提供的 ID 或会话租约：若部署有身份认证与权限机制，服务端必须先核验真实调用方的读取权限及数据库归属；若没有，则服务端核验数据库归属，并且部署只能处于用户控制的可信访问边界，不能把租约、随机 ID 或同源策略当作认证。当前项目开发、生产及systemd默认监听 `0.0.0.0`，接受所有IPv4网卡上的访问，可显式指定其他本机IPv4/IPv6监听地址；服务端的归属检查也不是调用方认证。对不可信网络开放前须另行建立并验收访问控制，本次不将其假定为已有功能，也不增加内容过滤。

实时内容统一采用会话级 SSE：项目 `GET /api/projects/:projectId/sessions/:sessionId/events?leaseId=...`，前置检查归属、读取许可及本进程有效打开使用权。独立项目消息 POST 接受后返回 202 `{accepted:true,sessionId,operationId}`，不绑定长运行响应；旧项目NDJSON服务端适配和客户端解析整体删除，消息POST仅返回202 JSON；实时输出只通过已有SSE。应用启动执行后持续消费直至真实终态，页面断流不取消执行。只读及非发起页面同样订阅原生变化，不定时读取 transcript。所有流及历史响应 `Cache-Control: no-store, no-transform`。

会话SSE使用事件DTO `{ sessionId, runId, sequence, type, entryId, temporaryId, payload }`：运行事件的 `runId` 为本进程生成、单次运行唯一的临时标识，`sequence` 为该运行内从 1 开始递增的整数；不属于单次运行的应用状态事件两者均为 null。`entryId` 和 `temporaryId` 在无对应身份时为 null；Pi 内容事件的 `type` 和 `payload` 表达对应 Pi 事件，不修改原始内容。完成、失败、调用进度等应用状态事件也使用此封装，但不冒充 Pi 原生 entry；其 payload 使用现有状态与错误契约。文本、thinking、工具调用参数、工具更新和结果按 Pi 实际事件完整传递，不按类型或敏感程度过滤。事件有 Pi 原生 entry ID 时带该 ID；尚无 ID 时使用仅限本次运行的临时关联标识，不能当作持久节点或自行推断父节点。Pi 的普通消息可能在 `message_end` 通知订阅者之后才追加对应 entry，不能假定通知时 ID 已存在；仅在服务端从同一 Pi 运行可靠取得该映射后，发送带两种标识的关联事件。custom 消息对应 `custom_message`，按同一运行中的 customType、content 对象身份和 details 对象身份可靠定位，不按普通 message 查找；Pi 在通知前已追加的节点立即发送关联，通知后才追加者延迟核对。无法确认映射时不按文本或时间猜测。模型或 Pi 没有提供的内容不补造。两类页面打开先订阅 SSE 再读快照，订阅期间缓冲事件并按运行标识和序号去重；项目页面同样先订阅再读快照；消息 POST 只提交意图；断流、重连、运行结束或失败时重读快照，以 Pi 树为准。最终快照成功后移除能确认已关联的临时展示；无法确认某临时内容已持久化时保留并明确标记未确认，不把它编造成节点。快照失败保留当前展示及错误并允许重试，不假报同步。各页面和多次运行的临时标识不能混用；不同 Session 的事件不能混入。

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

- `open` 是 POST，无业务入参；返回安全 DTO `{ leaseId, status, outcome }`，`outcome` 为本进程确认的 `SESSION_BACKGROUND_TIMEOUT` 或 null，`leaseId` 是不可猜的临时使用权标识，`status` 为 ready/running，按MCFG-003沿用当前分支保存的模型及思考等级，仅无模型事实的首次初始化使用当前默认；当前模型不可用则返回仅恢复用途的unavailable；不返回句柄、原生路径或内部内容。每次打开创建一个独立租约；请求重试以 `idempotency-key` 去重，同键不同目标或入参返回 409。已存在的活动 Pi 句柄必须复用，包括正在后台运行者；没有句柄且有 nativeRef 时精确恢复；没有 nativeRef 时创建空 Pi Session，确保原生身份可恢复后条件写入对应业务记录的 nativeRef。并发打开、后台调用和首次创建使用同一会话级串行门禁；重复请求不创建第二个 Pi Session。已有 nativeRef 缺失、损坏或身份不符返回 `NO_NATIVE_REF`（409），不能新建替代历史。初始化失败不返回租约、不触发 prompt；若 Pi 文件创建与数据库写入之间失败，需保留可核对的恢复信息，不能自动替换已确定身份或删除历史。数据库只写对应 Session 的 nativeRef，不修改历史内容；无需 schema 变更或历史库迁移。
- 不再提供页面主动定时 `heartbeat`。`open` 创建临时 lease，允许 120 秒内建立订阅；每条订阅绑定一条 lease。SSE 初始发出 `event: ready`，payload `{connectionId}`；服务端立即及每 30 秒发出 `event: ping`，payload `{connectionId,challenge}`，同连接最多一个待应答挑战，期限 90 秒。页面收到后 POST 对应 `/runtime/pong`，入参仅 `{connectionId,challenge}`，无页面定时器；服务端校验目标归属、读取许可、连接身份、挑战和期限后续租，204 无正文。不匹配或过期返回 `SESSION_SUBSCRIPTION_EXPIRED`（409），不续租、不调用 Pi；已过期挑战不能重放到其他连接。SSE 取消、请求断开或超时释放该连接与 lease，其他页面及后台使用权不受影响。`close` 仍 POST `{leaseId}` 幂等释放，204；连接级服务端心跳与超时在 application，HTTP 层仅传输。重连必须重新 open 并订阅；连接失联不等于执行失败。
- PSES-026：消息接受前校验有效租约及实际Runtime句柄；句柄缺失返回RUNTIME_NOT_OPEN/409，必须发生在准备message操作journal之前，不写Pi/附件、不调用prompt。客户端保留API错误code/status；RUNTIME_NOT_OPEN或RUNTIME_LEASE_EXPIRED时清除对应旧lease、禁用发送并重新open/订阅，同一nativeRef按既有open规则精确恢复。重连不自动重发消息，接受前失败由Composer保留原草稿与文件，用户待连接恢复后重新提交；普通校验/模型错误不触发重连。旧请求迟到错误不得清空已取得的新lease或切换后的会话。不会因上传耗时延长过期lease、绕过SSE挑战或创建替代Pi历史。
- 新选中会话先 `open`；成功后先订阅再读取树；选中变化时立即切换，异步 close 旧租约。打开失败显示错误并允许重试，不自动发送。消息 POST 在 `x-session-lease-id` 请求头附带当前有效租约作为运行句柄使用权；校验失败返回 `RUNTIME_NOT_OPEN`（409），不写入 Pi。服务端仍执行现有归属、互斥、参考材料和幂等校验，再在该句柄调用 Pi `prompt`；发送不新建或替换 Pi Session。
- 最后一个页面租约释放或过期时，若会话空闲且没有后台使用权，释放内存句柄；若自身运行未结束，则以该时刻为起点启动默认 300 秒单调计时。先收到 Pi `agent_settled` 或已确认的运行失败时结束计时，完成现有状态和边界处理后释放无其他使用权的句柄。到期仍在运行且没有页面重新打开时调用 Pi `abort`，等待其真实结束及状态落定后释放；不把超时当作成功。确认因本超时中止时，现有运行事件与重开后的安全状态返回 `SESSION_BACKGROUND_TIMEOUT`，页面据此显示中止而不是成功；不新增持久状态或伪造 Pi transcript。`abort` 失败或结束无法确认时保留互斥与待核对状态，报告错误，不强行伪造结束、重复发送或销毁仍运行的句柄。重新打开在中止开始前取消计时；若中止已开始，不撤销中止，复用句柄等待结束，不启动第二轮。
- 多页面只在最后租约离开时计时；重复 close、续租与超时、结束与切换及并发 open 通过同一会话门禁处理，不得释放新句柄或中止已重新打开的运行。后台使用权与页面使用权独立；页面切离不释放仍被后台执行使用的句柄。后台执行结束后无其他使用权时释放句柄。
- 页面断线不等于运行失败；服务进程退出会丢失句柄、租约和计时器，不保证退出期间执行五分钟中止。重启按现有原生引用和调用恢复规则重新核对，不把旧运行自动标记成功或重发。无可恢复引用或无法确认调用边界时返回错误或 `unknown`。历史、已发生的工具副作用及未完成的原生写入不因中止或释放回滚；释放不删除原生 Session 文件。

订阅覆盖独立项目会话；后台执行与页面使用权独立。首次打开经项目初始化端口保存nativeRef，后续每次调用按精确引用取得当前句柄，不缓存已释放对象。内部只读项目调用若携带 `operation=read`，独立项目按PSES-028在prompt前仅激活Pi原生read，禁用bash/edit/write，结束或失败后恢复；该标记不属于用户消息POST入参。Bot功能按02/06 BOT-REMOVE-001整体删除，不保留兼容路径。项目首次身份以 Session ID 的 SHA-256 确定 `.data/project-pi-sessions/<hash>.jsonl`，同路径独占锁目录覆盖文件初始化及数据库条件写入；仅对独占创建的空文件调用 Pi `SessionManager.open()` 初始化 header。已存在候选文件必须完整验证版本、cwd 和身份后才可采用；空文件、损坏文件、残留锁保留现场并报错，不自动重建或破锁。条件更新只在 native_ref_json 为 NULL 时生效；已有引用以数据库为准，候选文件保留。只读恢复严格解析原文件并以 Pi 内存 SessionManager 读取，不调用 `open()` 或迁移；运行恢复先验证版本、身份和完整末尾，再按精确引用打开。不得更改、删除或自动迁移历史。

恢复初始化（PSES-009）调用 Pi SDK 前，适配层仅在本次初始化期间对 SessionManager 的 model/thinking 追加入口做当前活动分支去重：分别比较该分支最后一个同类配置节点；值相同返回已有节点 ID，不追加、不移动叶子；无同类节点或值实际变化时调用原生追加方法。不能比较其他分支，也不能删除旧重复节点或伪造对话消息让 SDK 误判。初始化成功和失败均恢复原方法；失败不回滚已发生的原生合法追加，业务记录和 nativeRef 保持原契约。项目 Runtime 使用该适配，不修改 SDK 安装文件。无新增 API、表、事务或配置来源，不调用 prompt 或模型。

`open` 调用 Pi SessionManager 创建或打开及 AgentSession 初始化；`close` 在满足条件时调用 Pi dispose，超时调用 abort 并观察真实结束；服务端 ping 与有效 pong 只维护连接和内存使用权，不调用 Pi。原生历史、所有分支和当前叶子由 Pi 管理；`open` 本身不返回树，messages API 按本节 Session Tree 契约返回节点内容。

### 会话本轮参考文件（PSES-006）

PSES-025：非图片上传文件和粘贴文件统一按工具读取，不按2MB分流；API输入仍为{name,data}，不接受客户端存储路径，成功仍为既有202接受DTO。域解析保留已校验的原名/base64为内部file材料，禁止把原始file块直接发送给供应商。图片按现有签名识别及image能力检查处理。非图片接受有效UTF-8、DOCX/XLSX/PPTX/ODT/ODS/ODP的ZIP包、DOC/XLS/PPT的OLE原件及PDF；格式与扩展不匹配、未知二进制返回BINARY_FILE/415，不运行宏或文档内代码。快照字节额度继续约束上传字节，项目位置不计；数量共同最多10。

Runtime调用prompt前按02 PSES-025的会话身份存储原始文件。UTF-8直接提供原件路径；常见OpenXML/OpenDocument通过受控ZIP/XML提取生成content.txt，保留段落/表格单元格/页或工作表来源；ZIP解压累计上限50MB、条目数上限10000，超限、损坏、加密或旧版二进制不生成假正文，参考文本保留原件位置并说明提取失败或需额外解析器。PDF和旧DOC/XLS/PPT只保存原件，提示通过已有bash/可用解析器处理，不承诺部署环境已安装解析器。参考文本引导Pi原生read按行读取，必要时bash/rg搜索；只发送位置、格式及提取结果，不发送原始base64或全文。图片能力不受普通文件影响。

存储不写数据库，不改变cwd/nativeRef/原生文件身份；PSES-028独立项目及Workspace均保留Pi原生read/bash/edit/write策略，不注册附件专用或project_*工具，旧包装及Bot功能按02/06 BOT-REMOVE-001整体删除；原件由应用按只读策略存储，工具访问服从宿主权限，不再宣称工具层只允许本会话目录。存储身份/完整性错误报告REFERENCE_STORE_FAILED（500、可恢复），不调用prompt；此前已存文件与历史保留，不自动重发。接受后的错误通过既有订阅报告。应用只验证文件可提供给工具，不保证真实模型一定调用工具；附件可跨轮/恢复读取，生命周期及无自动清理见02。

PSES-010 粘贴输入沿用本节 references，不新增 API 或持久模型：剪贴板中的文件项全部作为上传材料，保留文件名、类型和原始字节，PNG/JPEG/GIF/WebP 作为上传图片；items 无文件时回退读取剪贴板 files，文件读取失败明确报错，不退化为粘贴文件名或忽略文件；存在文件时不重复粘贴剪贴板的文本表示。文件格式仍由服务端按下述 UTF-8/图片签名契约校验。不含文件时，text/plain正文完整保留在当前光标/选区位置并随content提交；超过10行时仅在临时编辑DOM折叠显示“已粘贴 N 行”，可展开为可编辑正文或移除，10行及以内直接显示文字，字符长度不触发折叠。不生成File或references，不创建附件快照、不计附件数量或字节额度，折叠行数标签和控件不进入content。浏览器草稿以文字和附件原子块混排，光标插入/删除和位置仅属于临时编辑文档。发送前去掉内部定位标记，将其余文字作为 content、仍在文档内的材料作为 references，定位标记不进入 API 或 Pi；普通粘贴文本按上述规则展示；折叠块的完整原文参与正文读取、复制及发送，编辑边界删除或选区替换移除该段正文而非附件；剪贴板真实文件项仍按上传附件处理。仅附件发送时 content 使用“请查看本次附带的图片或文本。”；仍执行现有数量、字节、归属及文件签名校验，接受前失败保留选择和草稿。

`POST /api/projects/{projectId}/sessions/{sessionId}/messages` 可选接收 `references` 数组，上传为 `{name,data}`（标准 base64 字节和不含路径的文件名），项目文件为 `{projectId,path}`，路径是所属根目录内相对路径。项目目录沿用 `GET /api/projects/{projectId}/files?path=...`；项目 Session 只能引用所属项目。服务端从数据库核验范围，不信任客户端提供的归属或目录；发送时只安全解析项目文件位置，校验真实路径、敏感路径、忽略目录、普通文件与路径身份，不读取正文、不做base64或图片/UTF-8解析。服务端生成{name,absolutePath}内部定位描述并转为参考文本，明确projectId、项目内path和经校验的absolutePath，提示模型优先用read按需/按行读取、用bash配合rg定位；路径按JSON编码，不能拼接执行Shell。定位本身不授予额外目录或工具权限；实际读取仍由所属Runtime工具边界校验。Pi工具按执行时刻读取最新内容，发送时到读取前文件可能变化或消失，失败保留真实工具错误，不回退旧快照。总计最多 10 个；统一 references 入口按 OpenAI 原生文件输入的保守额度设为单个小于 50 MB、合计不超过 50 MB（MB=1,000,000字节），该字节额度仅计算上传与粘贴快照；项目文件只计入10个材料数量，不受快照字节额度限制，大文件及二进制文件均可定位，后续可否读取由Pi工具决定。该额度是当前内联文本/图片 API 的应用上限，不代表已接入 OpenAI Files/PDF 解析，亦不宣称图片原生 API 只有50MB。消息 JSON 上限为 ceil(50,000,000/3)×4+1,048,576 字节，为 base64 和正文/元数据留空间，按流读取限制字节数，不能仅检查Content-Length。上传/粘贴快照按49,999,999字节上限执行，项目参考不读取内容，预览上限不变。依据为 OpenAI [文件输入](https://developers.openai.com/api/docs/guides/pdf-files)（每文件<50MB、合计≤50MB）及[图片输入](https://developers.openai.com/api/docs/guides/images-vision)（图片请求payload≤512MB）；模型contextWindow及供应商网关的实际限制仍独立生效，不保证50MB文本能直接进入模型窗口。校验 base64、文件名、图片签名及PSES-025文件格式，错误返回 400/403/404/409/413/415/422，不调用 Pi；接受前失败保留输入和选择。不写项目或业务表、不创建授权。消息缓存版本不匹配时消息请求均返回 `REFERENCE_SERVICE_RESTART_REQUIRED`（503），避免旧句柄把历史参考带入普通请求；参考目录查询不依赖旧缓存服务对象。接受后的运行错误由事件报告，不保证自动保留或重发。

服务端以 Pi `sendCustomMessage` 的不可见 reference 内容附加上传/粘贴的图片快照，以及非图片附件和项目文件的位置描述，再用 `prompt` 发送原样用户文本。每次追加在 details 保留不可预测的 referenceTurnId 作为来源标识，不作为模型上下文有效期。参考材料属于所属 Pi 当前活动分支的原生历史：后续追问、工具循环和精确恢复均保留 Pi 有效窗口内已有的图片及文本快照，不因新一轮未带 references 而排除旧材料。上传/粘贴图片快照不重新读取源文件；非图片附件读取按PSES-025，项目位置描述随分支保留，模型需要内容时通过工具重新读取当前文件，既有工具结果仅是当时读取证据。分支选择、上下文窗口与手动/自动压缩完全交给 Pi；应用不在 context 或 session_before_compact 中过滤参考节点。压缩允许 Pi 生成原生摘要，压缩后不承诺原图细节仍在有效窗口，需要精确复核时用户可重新附图；不创建应用摘要或额外附件存储。原生历史已有快照保留，不改写或删除；会话树投影显示原生关联节点内容。材料作为用户显式提供的参考而非指令或授权。图片通过 Pi 原生 image content 发送，模型配置声明图片输入；参考材料写入 Pi 前检查实际 Session.model.input 包含 image，不满足时抛出 MODEL_IMAGE_UNSUPPORTED（422、可恢复），提示切换支持图片的模型或修正对应 models.json 声明，不写入本轮参考节点、不调用 prompt，接受后的请求通过所属运行错误事件报告。禁止依赖 Pi 将图片降级为占位文字后继续回答。IMG-FAIL-001：声明检查拒绝或供应商明确返回不支持图片输入（且已观察agent_settled、isIdle并成功持久化原生历史）统一为MODEL_IMAGE_UNSUPPORTED；本轮为已知失败，独立项目message journal追加observed（结束证据/错误码）及failed，不留unknown，运行状态回到idle。提示“当前模型不支持此图片输入，请切换模型后重试”，不显示模型连接不可用或要求人工核对；不忽略图片继续发送，不自动重发。仅含图片而发生网络/鉴权/未确认终结错误不能据此分类。重复失败键返回原错误，新键可继续。旧unknown记录不因错误文案自动解除，仍按恢复API核对。上传和粘贴图片快照共用该检查；项目文件位置描述本身不含image，工具读取图片时沿用Pi原生能力检查；不按型号名称推测能力、不在应用覆盖配置。供应商拒绝或执行失败通过项目错误事件报告，不当作成功。Pi transcript 的不可见关联消息持有快照；会话恢复使用所属活动分支的原生上下文，旧参考快照与普通消息按相同 Pi 规则恢复，不清理历史、不混入其他分支；这不限制会话树展示。模型回答、工具结果或历史压缩摘要可能保留材料派生的信息，不承诺模型遗忘已产生的信息。无数据库写入或 schema 迁移，无新 Agent/项目权限。Pi 写入后失败可能已有原生历史，不自动重发或重新读取参考文件；页面仍按 Session Tree 契约重读原生历史，附加参考成功但 prompt 失败时也可能保留不可见材料，不能承诺跨 Pi 写入原子性。项目会话在会话归属校验后声明流幂等键，再校验参考内容与解析项目位置；声明后即使校验失败也不可复用，重新提交使用新键。新页面以 Accept: application/json 提交，接受后返回 202；运行时错误通过会话订阅报告。旧NDJSON客户端路径已删除，输出统一读取SSE。

独立项目 Session 的消息 POST 接收用户 `content` 和可选 `references`、`webSearch`、`toolSearch`（搜索参数按本文SEARCH-001/002，其余字段拒绝）；content 为保留原始空白的非空 string、UTF-8≤32KiB，只有附件时按前述固定文本提交，正文为空或超限分别 INVALID_INPUT/400、REQUEST_TOO_LARGE/413。要求 Idempotency-Key 与当前 lease；校验 Project、Session、执行互斥；消息成功仅返回202接受DTO；服务端独立调用 Pi `prompt` 原样发送文本。PSES-028：独立项目使用Pi原生read/bash/edit/write，不以角色或其能力开关决定；cwd为项目根目录，原生工具按宿主权限访问文件或执行命令，不套用原project_*敏感路径/符号链接包装。页面参考选择与预览API仍遵守§14路径校验，项目写入互斥与用户意图规则保留。内部read请求按§5临时禁用bash/edit/write；失败、中止、完成均恢复工具集，搜索开关仍按SEARCH-002组合，不能将bash留在只读轮次。打开/恢复精确nativeRef，模型可通过bash调用部署已有Python，不安装依赖、不新增Office服务或工具。可用且匹配的正式角色仅附加指导；无角色、旧式或停用角色不阻止执行，不注入不可用指导，不改历史绑定。会话繁忙或归属不符时返回对应错误，不调用 Pi；接受后的失败通过所属会话错误事件返回。消息归 Pi transcript，不调度回答后的应用总结任务。服务端对接受的发送输出同一诊断 ID 的阶段耗时：用例接收、句柄复用/创建/恢复、prompt 开始、首个 assistant 流更新、首段可见文字、首个工具活动和结束/失败。时间基于单调时钟；assistant 更新不等于供应商网络首包，缺失阶段不虚构。旧NDJSON专用的流入队/浏览器解析计时随适配器退役；保留执行服务的阶段计时，不把服务端事件发生时间解释为浏览器收到或React渲染时间。日志仅包含诊断 ID 或 turnId、Session ID、阶段和时间，不包含提示词、输出、思考、工具参数/结果、原生路径、凭据或异常正文；不写数据库、不改变 API 响应或 Pi 行为。



## 6. 原生上下文检查和用户手动压缩
### 6.1 策略与边界

PSES-021：自动压缩必须开启，创建/恢复使用SettingsManager.inMemory()取得Pi默认compaction参数，不覆盖阈值、预留或保留近期Token。发送、句柄复用及手动压缩不改变此策略，无关闭API/页面控件、不写settings文件。Pi按原生阈值/溢出规则压缩并继续同次运行；应用只订阅compaction_start/end及agent_settled，在Pi真正idle前保持原请求锁和使用权，不另发prompt或提前完成journal。GET context返回实际autoCompactionEnabled（未连接返回默认策略true）；压缩记录属于原Pi树，不写SQL，失败/取消保留已有原生证据。手动compact/cancel入口及互斥保持不变。


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

Pi默认自动压缩及原生恢复仍不能处理的上下文过长返回明确 `CONTEXT_LIMIT_REACHED`，保留历史与输入并提示检查原生压缩结果；应用不额外重发旧请求。手动压缩失败返回 `COMPACTION_FAILED` 的可见状态，保持原生恢复诊断；若已发生原生写入，由恢复投影核对，不能宣称失败就一定没变。下一次尝试仍须用户点击。

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

DELETE /api/projects/:projectId/sessions/:sessionId，由导航确认按钮调用，可信单用户许可，入参仅路径且无正文或幂等键。服务端验证同Project，Project无需active，成功返回{data:{deleted:true,sessionId}}。DEL-001：用户确认删除会话拥有最高操作优先级。已校验归属后在首次await前建立删除门禁；打开、运行、压缩、模型不可用或journal未知/损坏均不作为拒绝删除条件。不新增持久状态或表。先阻止目标会话的新操作，终止prompt/工具循环及自动或手动压缩，等待正在初始化、配置修改和其他已接受操作收尾，再释放句柄并在短事务中删除本会话行。DELETE保持请求等待，完成前不返回202或成功；并发同会话DELETE共用同一结果，完成后再次DELETE为404。停止/释放或SQL失败如实报错并保留会话记录，解除删除门禁，不伪造成功；不强行丢弃运行句柄、不伪造未知操作成功，不改写/删除原生历史、journal、附件或项目文件。目标会话其余新操作在删除期间返回SESSION_BUSY/409；页面确认后全局阻止点击、输入和导航直到请求结束，成功后移除记录并退出已删会话，失败解除屏障并显示错误。 事务只DELETE sessions指定id/project_id行，实际外键引用返回SESSION_REFERENCED/409并回滚，结构不兼容仍SCHEMA_INCOMPATIBLE。不存在或跨Project为NOT_FOUND/404。成功清理租约、定时器、观察者和临时幂等缓存；其他页面后续读取404。

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

写正文为 JSON 对象，未知字段拒绝 INVALID_INPUT/400；损坏 JSON、数组、null、仅空白为 INVALID_JSON/400。标明无正文的动作接受零字节或 {}；不得仅依据 request.body 是否存在判断。默认 JSON≤64KiB，Agent prepare≤512KiB，消息沿用 §5 的base64请求额度；超限 REQUEST_TOO_LARGE/413。ID 为非空定位字符串（≤128字符），不能用其拼接用户文件路径。可选字符串省略采用文档默认值，null 只在明确可空字段接受。name trim 后非空，description trim 后空串归一 NULL；purpose 只 trim 首尾，省略为 ''，null/非字符串或超过500字符 INVALID_INPUT/400。错误消息可本地化，code 不变。

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
| POST S/restore | 无正文、Idempotency-Key→200 SessionDTO | 无活任务；只核对journal和原生引用，按精确nativeRef恢复确定可恢复的失败句柄，保持Pi默认自动压缩开启，不prompt。unknown仅核对，未证明结果仍REQUEST_UNKNOWN/409；损坏/缺失历史NO_NATIVE_REF/409，不建替代树。恢复不清ended_at、不改归属、型号或旧输入 |
| POST S/role | {agentId,revision,contentSha256}、If-Match、Idempotency-Key→200 SessionDTO | 显式采用同一Agent的正式active/project版本；当前无Agent或ID不同ROLE_BINDING_INVALID/409，不以采用入口更换身份。空闲、active、无unknown；读取/校验不可变文件，事务仅UPDATE agent_snapshot_json与updated_at，下一轮装配，不改Pi历史/当前运行 |

interrupt/end/restore/role 的 journal 结果通过 §13 核对；写操作均先做结构兼容检查，失败不生成占位行。GET context 的200为NativeContextInspection（套通用data）；POST compact无正文、键与有效lease，202 {operationId,inspection:NativeContextInspection}；POST compact/cancel无正文、键，202 {operationId,inspection}，取消中的inspection仍running直至实际结束；原生/配置/许可错误使用本契约错误码。GET context不创建或初始化Runtime；已打开句柄可读，否则返回runtimeReady=false及RUNTIME_NOT_OPEN，不因只读检查进行写入型恢复。

## 12. Agent 编辑、版本与保存 API（GAP-002）

编辑对话是浏览器持有的候选与自然语言轮次，不是持久Session，不拥有Pi transcript。prepare每次使用独立无工具LLM的默认模型；请求结束即释放，不注册工具/扩展/项目权限，不写数据库。Agent用途仅project、能力仅readFiles/writeFiles；工作区Agent接入与GAP-006不在本节范围。

| 方法/路径 | 入参与返回 | 许可、事务、副作用与失败 |
| --- | --- | --- |
| GET /agents；GET /agents/:agentId | 无正文→AgentDTO[] / AgentDTO | 只读agents目录与对应版本文件，不调用LLM；按id排序；缺失404、版本损坏ROLE_VERSION_MISSING/409；旧legacy只读 |
| POST /agents/prepare | {kind,mode,requirements?,feedback?,markdown?,fileName?,projectId?,referenceFiles?,currentDraft?}→200 AgentCandidate | mode=generate/import/revise，kind=project；generate要求requirements或材料，import要求markdown，revise要求feedback与currentDraft；只收本轮材料，不保存项目owner，错误不修改已存Agent |
| POST /agents | {name,description?,kind,definition,status?}→201 AgentDTO | definition={instructions,capabilities}，status默认active，其他限额按02；先生成新ID/revision=1并独占写版本文件，再事务INSERT agents索引；失败保留待核对文件，不重用ID/覆盖文件，不把失败候选当正式版本 |
| PATCH /agents/:agentId | {name?,description?,definition?,status?,kind?}、If-Match→200 AgentDTO | 不接受id/owner/revision/hash覆盖；正式Agent不接受kind变化，旧legacy转换时kind必填且定义完整、用户明确确认转换；至少一项。正文或frontmatter变化创建revision+1候选并fsync，事务按旧ETag条件更新name/description/revision/content_sha256/status/updated_at（独立legacy首次正式转换还写kind）；仅status变化不写新文件；冲突保留旧索引及候选，WRITE_CONFLICT/409 |
| DELETE /agents/:agentId | 无正文、If-Match→200 {deleted:boolean,archived:boolean} | 有Session/历史FK引用时只条件UPDATE status=archived与updated_at，返回false/true；无引用时DELETE目录行，true/false；同事务重查引用，不删除Markdown历史；旧引用不能因归档丢失 |

AgentCandidate={name,description,definition,warnings:string[],sources:{path:string,hash:string}[],markdown:string}；hash为材料字节SHA256，path为上传显示名或项目内相对路径，不泄露宿主绝对目录。LLM只产出name/description/instructions/warnings，应用将capabilities初始化false；revise也不沿用LLM返回的授权，用户选择保存在编辑器本地，在保存请求显式提交。markdown由应用按02格式生成，仅只读展示。

requirements≤2000字符、feedback≤4000；markdown UTF-8≤64KiB，fileName≤256字符；referenceFiles最多8项，每项{name,content}、name≤256字符、UTF-8内容≤64KiB、合计≤256KiB。currentDraft={name,description,instructions}按02限额；name/description/instructions不接受额外身份或能力字段。projectId仅作本轮收集定位，须读取真实Project及允许材料；目录边界/敏感路径与§14相同。发给LLM的总材料按当前默认模型容量与实际输入估算校验，超过预算ROLE_INPUT_TOO_LARGE/413，不用应用固定Token常数覆盖contextWindow/maxTokens。材料不执行、不作为系统授权。

错误：INVALID_ROLE/422（字段/frontmatter/能力约束）、ROLE_MATERIALS_UNAVAILABLE/422、ROLE_INPUT_TOO_LARGE/413、ROLE_GENERATION_INVALID/422（模型候选不符）、REQUEST_ABORTED/409、MODEL_CONFIGURATION_ERROR/503、MODEL_UNAVAILABLE/409、ROLE_VERSION_MISSING/409；模型/SQL/磁盘失败保留已存版本与客户端草稿，不自动重试LLM。prepare取消中止本次独立LLM；保存提交前取消不写索引，提交后按GET核对，不承诺回滚。保存文件成功而SQL失败时，只有旧索引可被执行加载；管理员可通过GET精确版本引用核对，被引用版本永不覆盖。旧legacy转换须由用户通过prepare再保存；owner/source均为空的独立legacy可PATCH以当前ETag明确产生正式新版本；历史仍有Project owner或source引用的legacy保持原记录，使用POST创建新独立Agent，不清空或重解释旧归属。旧会话绑定不自动转到新ID；没有当前版本摘要的历史引用仅投影agentId/revision/name/legacy，不解析或执行已退役的policy/extension/调度能力，不自动改写SQL。MCP的isInUse仅检查sessions.mcp_ids_json；没有Task或其他旧执行对象引用查询。

## 13. 耐久幂等、恢复与不可用型号（GAP-004）

本节落实02 §13的独立项目证据，不改Workspace journal。执行顺序为：校验调用方/归属/输入→首次await前取得所属串行门禁→规范化载荷/计算operationId→读取或独占创建journal并fsync prepared→按操作验证并执行副作用→fsync observed/completed或failed→返回。确定性无副作用校验失败可在prepared前直接拒绝；prepared之后任何不确定结果都保留unknown。不同键的修改也被同Session未决操作阻挡；读树/导出/inspect仍可用。failed仅指可证明副作用边界已确定的失败；SQL失败但Pi候选已形成、原生写入不明或完成证据未耐久时不能记failed，须保持unknown。create以项目范围门禁保护检查与SQL，fork还锁源Session。不持SQL事务跨LLM/文件操作。

控制通道例外：interrupt与compact/cancel只在短门禁内核验、登记父operationId并取得当前取消句柄，随后调用abort/abortCompaction；不能等待父任务持有的整轮执行锁，否则会死锁。父任务继续独占执行锁，只有父任务确认结束才释放。恢复修改动作针对未决操作，在恢复门禁中执行，不被该目标unknown本身拒绝，但其他独立未决操作仍阻挡；同一父请求的取消/中止控制记录不互相阻挡恢复检查，仍须分别核对/确认，所有相关未决记录解除后才允许新执行。

操作名称固定为 create/open/restore/message/steer/switch-model/compact/compact-cancel/interrupt/end/adopt-agent/fork/recover；API角色采用映射为adopt-agent，PUT model映射为switch-model。恢复动作的载荷包含目标operationId/action，避免不同恢复动作共用结果；HTTP错误在已声明操作时附operationId，202消息接受返回{accepted:true,sessionId,operationId}。无进行中操作的lease读取不写journal，读取pendingOperations可定位重启后的未知操作。

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

MODEL-FAIL-001：消息失败是否已确定由Runtime证据而非错误文案判断。Pi在观察agent_settled、isIdle且本轮历史持久化成功后，对明确DomainError携带内部requestSettled=true；该标记不进入DTO、SQL或原生模型配置。供应商404无模型路由等已结束模型请求返回MODEL_REQUEST_FAILED，提示在Session设置切换模型或检查配置后以新请求发送；完整供应商错误仍保留原生transcript。模型注册/认证校验在调用Pi写入前失败可携带noSideEffects=true。独立项目消息对这两类已知失败追加observed（after及错误码/本轮结束或未执行证据）与failed并释放任务，运行阶段恢复idle，原模型/nativeRef/lease及历史不变；旧消息键返回失败不重发，新键只代表新意图。收尾或journal写入失败、裸网络异常、REQUEST_UNKNOWN以及未证明终结的错误仍保留unknown，不按404/文案解除。restore前置SESSION_NOT_UNAVAILABLE是确定无副作用拒绝，prepared记录须failed，不制造新的unknown。Workspace沿用原有DomainError结果收尾，不改journal格式。历史prepared未知记录不自动转换；模型设置的核对入口使用既有recover inspect/acknowledge-unknown，用户先查看原生树/错误与API的allowedRecovery，明确承认可能已有副作用后才以新幂等键追加acknowledged。它不证明失败、不修改历史、不自动恢复或重发旧输入；解除后重新GET models计算canSwitch，用户另行选择模型。

不可用型号的恢复：GET models通过只读nativeRef/当前分支读取current，仍返回可用模型列表与switch许可，已保存型号缺失以models项/不可用原因投影，不因current不可用而阻断整个列表；配置文件解析错误仍503。MCFG-003：POST open在原生历史完整和身份核验后，冷恢复及复用空闲句柄均读取当前分支最后model_change及thinking_level_change；已有模型只校验该型号（注册、enabledModels、认证），不读取默认来覆盖、不追加重复model_change。仅当前分支无模型事实的首次初始化选择settings默认型号并保存原生模型事实，默认变化只影响此类初始化；不保存旧默认或模型来源标记。继承模型的派生会话同样沿用。活动回复或压缩不在流中更新型号／配置。MCFG-002：发送、压缩等空闲操作按相同规则验证当前型号和更新其配置参数；不存在、被过滤或无认证均返回MODEL_UNAVAILABLE，不自动选择默认或其他模型、不写model_change或thinking_level_change、不调用prompt。已有nativeRef在open时核验历史后返回仅恢复lease（status='unavailable',send=false），GET models展示实际current及可选模型，显式PUT model成功才恢复执行；首次初始化默认不可用不返回成功租约。配置损坏仍MODEL_CONFIGURATION_ERROR。GET models只读且按enabledModels过滤，不触发回退；显式PUT model严格校验目标，不自动改选。PUT model在无unknown/活任务、历史完整时接受该lease，用显式目标型号初始化同一Pi身份并setModel，按本节持久化校验；只允许追加本次目标model_change，不先写默认model_change。成功后同一lease成为可执行状态；PUT响应在本次journal完成及互斥释放后重新计算SessionModelView.canSwitch，不把自身切换锁误报为SESSION_BUSY。客户端只刷新树、上下文和列表，并依据成功响应恢复原lease的可发送投影，不调用runtime/open或重建订阅；后续用户主动重开仍按MCFG-003沿用已保存型号。失败保留原型号/树或按证据unknown。缺失/损坏历史不能靠切型号恢复；不清ended_at。

## 14. 独立项目文件与可选 Git API（GAP-003）

本节为Project文件弹窗、附件候选与源码预览的唯一接口契约；不定义Workspace列表API。只读调用方许可按§4；所有GET无键、无SQL写入、不调用Pi/LLM、no-store。Project disabled/archived 不阻断只读浏览。rootPath来自数据库，不接受自由宿主路径。path缺省''表示根；只收项目内相对路径，拒绝NUL、绝对路径、..逃逸，逐段lstat/realpath及读取后身份核验，符号链接解析越界拒绝PATH_OUTSIDE_PROJECT/403；项目根缺失ROOT_UNAVAILABLE/409。

默认隐藏并拒绝访问.git、node_modules、.next、.data、.env及.env.*、*.pem、*.key和敏感凭据文件（id_rsa/id_ed25519/credentials/auth.json）；.env.example/.env.sample可读。目录浏览、预览、附件引用使用同一服务端策略，不因客户端已持有路径绕过；Pi原生transcript/导出不受此文件API过滤策略影响。

| 方法/路径 | 输入 / DTO | 边界与错误 |
| --- | --- | --- |
| GET P/files?path= | ProjectFileListing={path:string,entries:FileEntry[],isGitRepository:boolean,gitState:'available'\|'not_repository'\|'unavailable',truncated:boolean}；FileEntry={name,path,parentPath,type:'file'\|'directory',gitStatus?:'added'\|'modified'\|'deleted'\|'renamed'\|'untracked'\|'conflicted'} | 仅列指定目录直接子项，path为项目内相对路径；目录优先、名称按Unicode排序，最多2000条，截断为排序前2000条并truncated=true，不假装完整；不存在NOT_FOUND/404，非目录INVALID_DIRECTORY/400；Git失败仍返回目录，gitState=unavailable且不伪造clean |
| GET P/files/content?path= | FilePreview，见FILE-001 | path必填，普通文件≤50MB；文本≤512KiB、Office结构/PDF原件预览按FILE-001/002，其余返回下载提示；路径、文件身份与读取错误沿用FILE-001 |
| GET P/files/download?path= | 原始文件字节与下载响应头 | 许可、大小、路径与错误统一见FILE-001，不套JSON |
| GET P/changes | ProjectChanges={isGitRepository:boolean,status:string,workingPatch:string,stagedPatch:string,truncated:boolean} | status为porcelain原文，patch来自工作区/暂存区，只读git；非Git返回false及空串、truncated=false；合计UTF-8≤1MiB，超过按字段顺序status/workingPatch/stagedPatch在完整字符边界截断并标true，不当完整diff；Git失败GIT_READ_FAILED/500，超时GIT_TIMEOUT/504（10秒），不执行hook/写索引 |

isGitRepository只表示仓库事实，不表示Git状态读取成功。文件列表不等待changes；git补充失败不阻断预览。读取中目录/文件身份变化返回FILE_CHANGED/409；IO错误FILE_READ_FAILED/500，保留页面现有数据，用户可重试。源码绝对路径先在客户端/服务端适配为本Project相对path，仍重做上述校验；API不接受绝对path。附件内容额度按§5，不改变本预览512KiB上限。Git输出不进入SessionMemory、SQL或第二份对话。

## 15. 派生与导出的确定适配及验收边界（GAP-005）

fork使用prepared操作目录 .data/project-session-forks/<operationId>/，exclusive创建，隔离manager的sessionDir固定在该目录。SDK派生生成的随机候选文件名只允许一个；header/候选摘要先fsync observed再提交SQL。崩溃留下零文件表示未形成可用候选，有一个完整候选按§13检查，多文件/半文件/摘要不符为unknown，不按最新时间猜测。SDK不保证原始label和父链，候选必须按§10.2重建原始选定路径，再通过独立只读解析验证。

所有已知entry类型（消息、model_change、thinking_level_change、compaction、branch_summary、custom、custom_message、label）均允许作为选中节点，只要完整祖先链及引用自洽；未知类型可保留原文但SDK不能恢复其上下文时FORK_NODE_UNSUPPORTED/422。compaction.firstKeptEntryId及label.targetId须指向继承路径中合法节点或Pi认可的自引用语义；引用旁支或缺失目标不得偷偷复制旁支、改引用或跳到邻近用户节点。继承以选中entry为叶子；在label处创建也保留该label，不把SDK重建的末尾label当作原路径。仅header/配置节点的新树也必须可持久恢复，未选节点/空树无法fork。新文件header保留Pi新身份、源cwd及合法parentSession关系，源manager/file/leaf/模型不变。

JSONL导出在短临界区读取header、全部entries、活动叶子的一致快照后释放锁，tree保持原生追加顺序，branch按父链从根到叶子；空已初始化树输出header，branch叶子为空亦为header。label不重新生成；全部原始字段、原始字符串、未知节点及敏感工具原文保留。SDK exportToJsonl只保证分支且可能有格式处理，必须对比快照逐项；任何不能保真的范围由只读序列化适配生成，不调用branch/navigateTree，不初始化或迁移源文件。序列化失败SESSION_EXPORT_FAILED/500，不用替换文本冒充完整。

HTML由快照生成静态阅读文件，正文按安全Markdown输出、每个原始entry提供完整转义JSON；不包含执行型script、事件属性、iframe、object、自动外链资源，原文中的HTML仅作文字，href仅允许http/https和文内锚点，其他链接作为文字保留。采用原生details实现折叠，完整原文使用转义pre，覆盖</script>、引号、实体、Unicode分隔字符和图片data内容，编码不丢值；CSP为default-src 'none'、style-src 'unsafe-inline'、base-uri 'none'、form-action 'none'。不直接复用无法满足此约定的SDK HTML模板。

输出先在应用临时目录完整生成、核验并计算Content-Length，再发送attachment（文件名仅安全SessionID与scope/format）；tree/branch都显式写入HTML标题或下载名，JSONL不新增伪entry。下载中断仅清理本次临时文件，不写completed操作或新会话；未发头可JSON错误，发头后失败中断连接，客户端按状态、完整长度与下载完成判定，不保留截断文件为成功。原生读取/生成失败、unknown/ended只读、无消息路径均纳入定向验收；全部仅用临时目录与受控SDK，不能以文档已定标记实现通过。

## SEARCH-002｜消息工具搜索

项目POST messages增加toolSearch?:boolean（省略false），调用方共享输入框。归属/lease/互斥/202回执/SQL和journal边界沿用既有消息契约；非法类型INVALID_INPUT/400，true纳入消息幂等摘要，false/省略保持旧摘要。可与webSearch同时为true，分别校验，不静默降级。journal准备前校验Runtime能力及HTTP(S)代理配置格式；配置错误TOOL_SEARCH_UNAVAILABLE/422，无请求记录或prompt副作用。不要求API Key、搜索服务地址或额外服务，不在接受前联网探活；网络不可达在工具实际执行时返回明确错误。配置仅在服务环境设置，不开放配置写入API。

本轮prompt前只激活web_fetch，所有模型均可使用但仍需自身支持Pi工具调用；结束、失败、abort后清除配置和计数并恢复原工具集，不影响其他会话或压缩。默认inactive，关闭时不声明且拒绝调用。历史完整保留，工具切换通过Pi原生工具声明变化记录。web_fetch输入input:string（必填、非空，最多2048字符）和maxResults?（整数1..5，默认5）；input以HTTP(S)开头则按公开网页地址直接GET，其余文本按查询词（最多400字符）处理。工具schema不再声明两个可选互斥字段，字段description提供网址及关键词示例。prepareArguments只读兼容旧url/query：优先非空input，否则非空url，否则非空query；空白字段忽略，两旧字段并存时明确URL优先，不改写已有历史；无有效值明确要求input，不调用网络。关键词模式通过https://www.bing.com/search?q=...获取并解析自然搜索结果，返回{query,url,results:[{title,url,content}]}，解码Bing跳转链接并保留来源；检测验证码/反爬、结果格式变化和无可解析结果时明确报错，不编造结果或切换其他服务。

全部请求最多5次手动重定向并逐跳校验，拒绝环回/私网/链路本地地址及解析至这些地址的域名；直连DNS固定已校验地址，代理自身负责连接及DNS。只接收HTML/XHTML、纯文本/Markdown及JSON；HTML不执行脚本，Readability提取正文，不可提取时报错，不把登录/反爬/空壳页伪装正文。URL模式返回{url,title,content,contentType}，url为最终来源地址。网页内容视为外部资料，不授予指令权限。

每轮web_fetch最多8次，单请求20秒，响应最多2MiB（超限明确失败，不伪造完整结果）。传递Pi AbortSignal，支持中止，禁止自动重试；超时/网络/非2xx/不支持内容或无法解析分别报告工具失败，不把响应头、凭据或上游错误原文带给模型，已收到的成功结果原文保留。Bing和目标网页请求只在模型实际执行工具时发生，使用部署主机的网络/显式环境代理；不引入浏览器、额外服务、第三方代抓取或自动搜索降级。运行中上游失败为Pi原生工具错误，由模型继续或结束，不自动改用OpenAI搜索。

## SEARCH-001｜消息服务端搜索

POST /api/projects/:projectId/sessions/:id/messages增加可选webSearch:boolean，默认false；调用方为共享输入框。非法类型INVALID_INPUT/400。沿用现有归属、lease、互斥、幂等、事务和202回执，true纳入消息摘要，false/省略保留既有摘要。服务端在准备journal前校验当前Runtime模型协议；允许openai-responses、google-generative-ai、google-vertex，其他协议WEB_SEARCH_UNSUPPORTED/422，记录和原生历史不变。不根据provider名称猜测能力；兼容端点/型号是否实际支持由上游返回，失败不静默降级或重发。

本轮prompt前固定搜索意图，before_provider_request保留原payload与tools，按Pi解析后的model.api分派：openai-responses在payload.tools追加一次{type:web_search}；google-generative-ai/google-vertex在SDK payload.config.tools追加一次{googleSearch:{}}，保留config中的thinking、toolConfig、abortSignal及原有functionDeclarations；不改顶层REST字段，不按模型名或provider分派，不修改用户配置。已有googleSearch/google_search声明不重复追加。默认由模型按需调用；仅在本轮主请求/工具循环注入，不用于其他会话或手动压缩，结束/失败/abort后清除。Pi provider_stream_event中，OpenAI的搜索调用和含来源引用message的output_item.done原文按原格式追加server_web_search custom entry；Google只在原始chunk的candidates中存在groundingMetadata字段时追加{api,provider,model,data:完整原始chunk}，保留查询、来源、引用关系及Search Suggestions原文，不执行HTML，不伪造搜索成功；没有该字段不保存为搜索证据。两类证据均不转换成客户端执行工具。SQL只沿用既有消息记账，不新增列。上游拒绝沿用Runtime错误、journal和恢复边界，不撤销已发生的Pi或文件副作用，不自动重试。

## PSES-029｜运行中发送文字纠正

POST /api/projects/:projectId/sessions/:sessionId/steer，调用方为运行中的Composer；JSON精确为{content:string}，非空且UTF-8≤32KiB，不改写正文，不接受附件/搜索参数。要求有效X-Session-Lease-Id、Idempotency-Key、Project active、结构可写、归属正确、无未知历史操作且主请求正在运行。返回202 {data:{accepted:true,sessionId,operationId,delivery:"steer"}}。空闲/停止中SESSION_NOT_RUNNING/409，删除/压缩SESSION_BUSY/409；其他错误沿用messages，不自动降级为prompt。

先追加steer prepared证据，再调用同一句柄AgentSession.steer(content)，成功写observed/completed接收回执。并发同键共用结果、同键同载荷返回回执、异载荷IDEMPOTENCY_CONFLICT；不确定副作用或回执失败为REQUEST_UNKNOWN，不自动重放；明确调用前拒绝可记failed。无SQL写入，不释放原主请求锁。当前活动请求及活动纠正不算未知历史，其他未决证据仍阻止提交。接收不等于消费：Pi在本轮assistant工具调用完成后、下一次模型请求前按原生模式读取；停止/删除/终态清空未消费队列，已消费消息和工具副作用保留。

SSE ready的activity增加steering:string[]，从当前Pi队列读取供重连同步；SSE透传Pi queue_update的steering:string[]与followUp:string[]，消费后原生user消息进入唯一Tree；接收回执不伪造树节点。丢弃未消费队列时发送应用事件steering_cleared，供页面显示清除提示；不开放followUp。

## CTX-001｜Session持续参考文件API

两类S=/api/projects/:projectId/sessions/:sessionId及/api/workspaces/:workspaceId/sessions/:sessionId。GET S/context-files→{files:[{id,name,source:project,projectId,path,kind:document}],writeETag}；POST {references:[{projectId,path}]}添加项目快照，拒绝上传{name,data}；DELETE {id}取消引用。读取核验归属；写入要求lease、If-Match、空闲/无unknown/非删除。错误NOT_FOUND/RUNTIME_NOT_OPEN/SESSION_BUSY/REQUEST_UNKNOWN/PRECONDITION_REQUIRED/WRITE_CONFLICT/INVALID_REFERENCES/CONTEXT_FILE_UNREADABLE/CONTEXT_FILES_TOO_LARGE。先校验全部，再原子替换并fsync；不写SQL。响应丢失GET核对，不自动重放。最多10项，全文累计1MiB；UTF-8和可提取Office支持，PDF/旧Office等拒绝而非仅注入位置。每个根prompt加载快照，通过公开getAgentsFiles/setActiveToolsByName装配project_context，上传和粘贴仍使用原messages.references逻辑；工具循环/steer固定本轮。Pi处理容量与压缩，不截断/摘要。删除只影响后续装配，不删除原件和原生历史。仅替代参考项目文件随消息提交的旧规则；上传/粘贴的内联展示、随消息提交和发送后清空全部保留。历史messages.references兼容，不自动升级。

## AGENT-002｜助手API（替代旧Agent生成/正文写入契约）

GET/POST /api/agents、GET/PATCH/DELETE /api/agents/:id沿用目录与If-Match语义，正文写请求上限1MiB，正文合计限制按02。definition支持02的新格式，旧格式只读兼容；新UI提交definition.format=3，名字/说明及项目XML组织结构不写入AGENTS.md。返回markdown与新保存文件均为原始正文；范围从类型化项目关系读取，只有Pi运行时装配XML。旧存储format=2文件按原布局验证后恢复规则，新保存存储format=4，不改旧文件。save先按02的agents默认目录写不可变AGENTS.md/definition.json并fsync，再在短SQL事务更新索引；读取按02逐版本兼容历史目录，损坏返回ROLE_VERSION_MISSING，不迁移历史文件；失败保留旧索引和候选，GET核对不自动重放。删除检查原SQL及Session助手文件引用，有引用归档，历史版本不删除。

POST /api/agents/prepare接收{mode:generate|revise,source?,requirements?,feedback?,inputText?,currentDraft?,target?:systemPrompt|projects|auto}，请求体上限1MiB。source为02的显式来源，前端不传cwd、项目名或权限。服务端从Project/Workspace记录读取并核对项目集合（generated工作区projectIds可为全部有效ID或选定非空子集，custom工作区必须为空）；读取只在所选根目录内，无越界/符号链接跟随，无运行项目命令。generated按06 WAGENT-010逐项目进入真实cwd，Pi读取工具主动调查，逐项目调用LLM返回规则；每个项目必须有结果，不允许LLM伪造ID或范围。返回{name,description,definition,markdown,warnings,sources:[{path,hash}]}，来源路径带项目标识，不单独暴露绝对路径。自定义首次输入或上传调用prepare(mode=generate,currentDraft为custom,inputText为完整材料)，inputText非空且UTF-8不超过256KiB，作为材料而非正式正文。LLM润色成功后返回完整系统提示词，失败或取消保留已有草稿和待处理输入；修订省略target时默认auto：模型依据完整currentDraft及feedback返回changes:{systemPrompt?}|{rules:[{id,rules}]}，每项为该段完整替换正文，可一次涉及多段；未返回的段落逐字符保留。服务端按创建方式严格验证：custom只接受系统提示词，generated只接受已选择项目的规则；禁止instructions、混合两类内容、重复/越界、修改mode/scope/source及给generated添加系统提示词；空changes拒绝。显式target只能是与创建方式匹配的systemPrompt或projects，instructions返回INVALID_INPUT；省略target时初次生成按创建方式选择，修订为auto。custom允许保留作用范围source，由服务端核验项目/工作区；工作区只允许自身，projectIds必须为空；不采集范围项目资料、不使用生成技能、不生成项目规则，空系统提示词保存返回INVALID_ROLE。custom修订可以显式调整范围，系统提示词仍完整替换；范围本身不送入正文。source范围调整须显式提交。生成失败/取消保留客户端草稿与已存助手。错误沿用INVALID_INPUT/INVALID_ROLE/ROLE_GENERATION_INVALID/ROLE_MATERIALS_UNAVAILABLE/ROLE_INPUT_TOO_LARGE/REQUEST_ABORTED；不存在NOT_FOUND，越界REFERENCE_OUTSIDE_SCOPE。

两类S=/api/projects/:projectId/sessions/:sessionId或/api/workspaces/:workspaceId/sessions/:sessionId新增GET S/assistant→{selection:AgentSnapshotRef|null,writeETag}；PUT S/assistant接收{selection:null|{agentId,revision,contentSha256}}，要求If-Match、x-session-lease-id，归属有效、active/空闲、无unknown、非打开/关闭/删除/配置操作。服务端读取精确版本并校验active与scope，独立项目拒绝workspace助手；工作区助手source.workspaceId必须相同。原子保存后返回相同DTO并发context_changed；无SQL/Pi副作用，下一轮重建提示词；冲突409、缺前置428，失败保持旧配置。GET不调用模型。工具和模型不由助手授予。PUT允许空会话采用、切换身份和移除，不使用旧POST role身份固定规则。原接口继续兼容旧精确版本采用。


AGENT-003：GET /api/agents/skills返回{defaultSkillId:"create-agentsmd",skills:[{id,name,description,sha256}]}，只读仓库技能、不调用Pi。POST /api/agents/prepare增加skillId?:string|null；从项目生成且target为projects或auto时省略默认create-agentsmd，generated的null返回INVALID_INPUT，字符串只允许本地有效技能id，不接收路径或技能正文。所选完整SKILL.md由服务端装入生成输入，返回额外skill:{id,name,description,sha256}|null用于来源核对；自定义系统提示词不使用技能。技能不存在返回GENERATION_SKILL_NOT_FOUND(404)，格式/读取损坏返回GENERATION_SKILL_UNAVAILABLE(503)，非法参数INVALID_INPUT(400)，均不调用模型、不改草稿或已有助手。读取技能只用受控仓库目录，拒绝符号链接和超过128KiB文件；项目资料与技能分别标识，资料仍为参考数据。


工作区助手的项目独立文件、工作区自身AGENTS.md、自定义单选及存储format=5由06 WAGENT-010统一定义，取代本文先前的工作区合并正文与自定义多选描述；通用独立项目行为不变。

修复要求 WAGENT-010：项目生成在目标cwd使用完整读取工具执行技能，按项目串行并反馈进度；generated不含工作区自身规则，custom工作区仅自身一份文件。最新模型/API/验收统一见06 WAGENT-010，替代此前工作区生成入口及预采集规则。


## REF-ASSIST-001｜消息引用助手与Skill

会话输入工具栏按“引用助手 → 引用 Skill → 上传文件”排列，独立项目与工作区复用。助手从候选API及GET /api/agents/:id读取正式精确版本，选择后通过既有GET/PUT S/assistant写入会话助手选择（精确agentId/revision/contentSha256、If-Match和当前lease），下一轮按ASSIST-011装配系统提示词。只允许active正式版本；继承默认提示词的助手同样可选。助手不转换为附件、不写messages.references、不占附件额度、不在输入框或对话中显示合成文件。选择持续生效至显式更换或移除，在Composer引用入口查看名称与更换；会话检查不再展示助手分区，既有移除API保留但不新增移除入口；不隐藏既有Pi历史或用户上传文件。Skill列表复用GET /api/agents/skills，新增GET /api/agents/skills/:skillId返回{id,name,description,sha256,content}完整技能文本，受控技能目录读取与错误沿用AGENT-003，无Pi调用、数据库写入或新增持久模型。技能只作为本次消息材料，不自动安装或授予能力。客户端不提供路径，响应不含绝对路径。

选择器复用现有弹窗；助手使用既有会话选择模型，失败保留旧选择，运行/压缩/停止/提交或无有效lease时禁用选择；读取失败可重试，切换会话取消本地请求，不自动重放PUT。Skill继续使用上传附件模型，原子加入，遵循总计10项及附件字节限制，重复选择按所引用文件处理；可在输入内删除，发送成功清空，失败保留。加载/读取失败可重试，关闭或切换会话取消未完成选择；运行/停止/阻塞及提交中禁用，避免转成steer附件。API验收完整Skill正文/摘要及不存在与非法ID错误，页面检查按钮顺序和共用附件发送逻辑。


## ASSIST-013｜无上传润色与生成错误原因

POST /api/agents/prepare仍沿用ASSIST-011。初次无正文时，用户直接输入或粘贴的材料通过{mode:generate,currentDraft,inputText}提交，不要求File、文件名或上传记录；正文非空时修改意见沿用{mode:revise,currentDraft,feedback}。额度和校验沿用现有契约，传递原始空白，不将标签/附件说明写入材料。仅成功结果将候选置为replace并替换完整正文；输入、候选、scope/source在失败或取消时不变，不写SQL或正式版本。

模型返回的助手草稿允许前后有说明文字，或包在Markdown代码块中。服务端去掉代码块围栏后，选择含text、rules或changes且字段名合法的唯一平衡JSON对象；对象内字符串原样保留。提示词正文里的示例花括号不使该对象失效，字段、目标、空正文和范围校验不变。该规则同时用于助手润色和项目规则生成。没有合格对象、多个合格对象、数组、残缺JSON或字段非法仍ROLE_GENERATION_INVALID/422。message逐字符返回模型原始回复，保留空白、换行和JSON，不改写为“未找到JSON对象”“模型未返回有效草稿”或其他说明，不截断，也不附加密钥或请求内容。不重试、不改模型、不放宽正文校验。润色提示明确要求最终只输出一个JSON对象，不增加工具或改变模型。Pi助手错误响应的errorMessage非空时，ROLE_GENERATION_FAILED/503的message为完整原字符串；SDK抛出的普通Error.message或字符串错误也按原文包装该错误码，不由通用500覆盖。已有DomainError保留code/status/message。用户显式取消仍REQUEST_ABORTED/409；缺失助手响应或原始错误原因时才使用兜底原因。成功但文字为空或仅含空白时，ROLE_GENERATION_FAILED/503的message改为逐字符返回该助手消息的原始text内容，保留空白、换行和JSON，不改写成“模型返回空内容”、不截断；text完全缺失时才使用该兜底文案。不因该错误执行thinking或toolCall。JSON候选无效仍按既有ROLE_GENERATION_INVALID。HTTP JSON和NDJSON error事件以及客户端逐字符保留message，不添加路径、前缀、截断或执行其中HTML。只返回已有模型错误原因，不额外返回请求头、配置、认证详情或句柄，不记原始错误日志；不自动重试/降级/改默认型号。临时Pi会话仍在finally释放，无新Session/transcript归属。

## ASSIST-011｜统一助手与项目规则API
助手目录沿用GET/POST /api/agents及GET/PATCH /api/agents/:id，新正文只接受02的format=4；服务端校验来源成员，空数组非法。POST /api/agents/prepare仅负责统一助手系统提示词润色，不再执行项目规则生成；入参沿用mode generate|revise,currentDraft,inputText/feedback，返回统一定义和正文；无工具，无项目读取，不改正式版本。
独立项目R=/api/projects/:projectId/agent-rules；工作区成员R=/api/workspaces/:workspaceId/projects/:projectId/agent-rules。GET返回{identity,revision,contentSha256,enabled,markdown,writeETag}；PUT {enabled:boolean}要求If-Match，只改开关；POST {requirements?:string,skillId?:string}要求If-Match，通过现有逐项目Pi读取技能流程生成，成功原子发布不可变正文及state，失败/取消原state保持不变。均服务端核验项目存在与归属；错误NOT_FOUND、REFERENCE_OUTSIDE_SCOPE、PRECONDITION_REQUIRED、WRITE_CONFLICT、INVALID_INPUT、PROJECT_RULES_UNAVAILABLE、REQUEST_ABORTED，生成工具/模型错误沿用原规范。POST可Accept application/x-ndjson，沿用progress/result/error事件，成功result为规则DTO；生成过程中开关或版本改变则提交返回WRITE_CONFLICT，不覆盖并发结果。默认无SQL副作用，无源项目写入；生成采用真实cwd与read/grep/find/ls、完整技能及临时Pi会话。
运行时只在有明确助手时加载项目规则；没有助手完全沿用原逻辑。新助手作用范围控制项目XML集合，单项目助手在工作区必须匹配实际成员ID或相同真实目录。整个工作区动态匹配全部成员。单/多项目范围不改变已持久化nativeRef.cwd，不把当前cwd额外算作范围项目，XML明确cwd是执行定位而非项目集合。开关关闭或正文缺失只略过rules节点。使用由助手版本、当前范围/项目元信息及项目规则ETag构成的指纹；首次加载和指纹变化时更新一次Runtime配置，后续prompt不重复附加系统提示词或XML消息，Pi原生system sections差异机制保留；每次根请求仅核对指纹，活动轮次固定。


ASSIST-012：POST/PATCH助手与prepare接受02的scope=global/source=null，不读取项目或工作区。会话助手选择API允许通用型助手；运行时只应用其提示词模式，保留原会话项目定位，不因该助手读取或注入项目规则。GET /api/agents?references=1&projectId=:id[&workspaceId=:id]返回现有Agent DTO数组，仅active且有正式版本，先返回当前项目适用助手，再返回通用型助手；workspaceId存在时projectId指其成员，允许省略projectId查询该工作区全部适用助手。服务端校验项目存在/工作区成员归属，NOT_FOUND或REFERENCE_OUTSIDE_SCOPE；缺少两个ID时仅返回通用型助手。工作区候选包含本工作区全范围/覆盖当前成员的助手以及能按ID或真实目录匹配成员的独立项目助手。通用型包括scope=global/source=null和旧版本未指定来源的助手，不把损坏的新格式当通用型；同组沿用目录顺序。普通无query的GET保留完整目录。无Pi调用或持久化副作用。引用助手通过既有会话选择API保存精确版本，按REF-ASSIST-001生效，不形成附件或重复注入。


RULEGEN-001替代ASSIST-011的项目规则POST流式连接生命周期。R仍为两类项目的agent-rules路径：GET返回原ProjectRuleView加generation(最新任务的公开状态或null)，读取时核对无执行句柄的未结束任务，按02确认已发布结果或标记interrupted。POST {mode?:generate|revise,requirements?:string,skillId?:string|null}，mode缺省generate；revise为按非空requirements润色已存在的AGENTS.md，revision=0或正文缺失返回PROJECT_RULES_REQUIRED/409，空润色意见或非法mode返回INVALID_INPUT/400。要求If-Match及Idempotency-Key(1～128可打印ASCII)，先校验项目、正文ETag、输入与所选技能，再持久queued任务，返回202及完整当前状态，不等模型、不依赖Request.signal。省略/空技能均为模型直接调查，选定技能无效返回原技能错误。相同项目同key同参数（含mode，历史缺省generate）/baseETag返回原任务及当前规则，不启动第二次；同key异参数返回IDEMPOTENCY_CONFLICT。已有活动任务返回PROJECT_RULE_GENERATION_BUSY 409。工作在服务端串行处理该项目，写入读取进度；generate按技能与项目事实重新生成，不使用页面润色意见。revise在执行前核对baseETag并读取服务端当前完整规则，构造内部currentDraft，通过既有prepare(mode=revise,target=projects,feedback=requirements)与真实项目cwd临时Pi读取能力修订，不把客户端正文作为事实，不修改其他项目。未受意见影响的内容应保留；两模式均输出完整规则并沿用原不可变发布、开关保持、取消和失败语义。提交前再次检查归属、项目目录与原ETag，目录变化或ETag过期返回WRITE_CONFLICT，成功发布后状态succeeded与resultRevision，失败记录安全错误且保持旧规则。PATCH {generationId,action:"cancel"}取消该项目对应任务，状态cancelling直至Pi终止后cancelled；已终结时幂等返回当前视图，未知id返回NOT_FOUND。PUT开关保持原契约，可并发更新并导致在途生成发布WRITE_CONFLICT。公开任务DTO不返回requestKey/baseETag、原生路径或句柄，返回id、status、requirements、skillId、时间、progress、resultRevision与error。页面关闭只取消查询；仅显式PATCH取消工作。GET只在活动任务期间每1.5秒查询，终态停止查询；重新进入页面读取持久状态。
