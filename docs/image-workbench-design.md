# 图片工作台设计

本文是图片工作台专属需求、架构、数据模型、API、页面投影和迁移的权威文档，覆盖 IMG-001～IMG-056。IMG-049～IMG-053 已接入代码并经受控 API 验证，本地数据库已完成显式版本升级，浏览器验收待执行；IMG-054 已接入用户消息投影，浏览器待验；既有验证不代表这些需求已验收。IMG-030～IMG-037 已接入并通过定向 API 验证，浏览器与真实供应商待验。现有库的三表升级与备份核验见 [实际验证与迁移记录](#61-实际验证与迁移记录)。

- [需求范围](#1-需求范围)
- [架构与 Pi 归属](#2-架构与-pi-归属)
- [数据模型](#3-数据模型)
- [API 契约](#4-api-契约)
- [页面投影](#5-页面投影)
- [验收与记录](#6-验收与记录)

## 1. 需求范围

| 项目 | 确定行为 |
| --- | --- |
| 入口 | 仅独立“图片”工作台；普通Session的图片入口第一版不做，不增加其路由、关联字段或后台接入 |
| 技术 | Pi承载图片讨论，GPT／Gemini官方图片接口负责生成与内容修改；服务器控制器负责业务 |
| 讨论模型 | 使用应用默认聊天模型，无独立讨论模型选择器，不另外配置辅助LLM |
| 持久化 | 图片业务事实存现有应用SQLite数据库；原生对话历史由Pi管理；图片字节存文件 |
| 文件位置 | 应用配置根目录下的images/，按任务ID分类，不使用客户端路径 |
| 状态 | 服务器维护任务事实、校验意图并推送状态；页面负责发起、订阅、展示及用户主动重拾任务 |
| 订阅 | 页面声明要看的资源，订阅后推送当前状态及后续变化；服务端业务不关注谁订阅、是否有人订阅或订阅人数，订阅不授予任务所有权 |
| 生命周期 | 任务受理后独立于客户端，断开、页面切换及图片讨论关闭不影响执行 |
| 终止 | 用户可按 IMG-036 显式终止当前规划、排队、生成或本地处理 |
| 清理 | 不自动删除任务、原图、失败残留或 Pi 原生树；成果和上传原图按 IMG-053／IMG-056 显式删除，取消参考按 IMG-051 仅解除引用。当前方案／执行／讨论回执仍覆盖，图片版本独立保留 |
| 失败与重新开始 | 失败即结束并保留当前错误，重新开始以新批次覆盖旧状态；页面提供用户主动“重新开始”。服务器不自动重试、重拾、续跑或补成功；Pi及供应商SDK隐式重试关闭 |
| 通用性 | 支持生成、参考图修改与精确输出；网站Logo九尺寸是首个输出预设，不是唯一功能 |

失败策略以用户最新决定为准：失败即结束，页面允许用户明确重新开始，服务器不自行重拾。用户可以保留相同要求和方案，通过专用重新开始API建立新命令／执行、ID和文件目录；任务以新批次ID覆盖最新执行状态，不保存旧方案／执行／命令历史；原图、旧产物及Pi原生历史保留。普通确认、幂等重放、刷新、重连、进程重启和模型回复均不触发重新开始。自动压缩只管理当前正常讨论上下文，不能续发失败请求。

IMG-049～IMG-053 覆盖三个使用场景：单图多阶段精修；多图分别修改后选取个别图片继续精修；纯提示词生成后继续修改。多次上传追加独立原图系列，不替换旧系列；多图分别修改与多图共同参考必须由用户意图及经校验的方案明确区分，不得因上传多张就默认合成。两个入口仍遵循 IMG-048，共用版本、参考和成果能力。本轮不采纳拆分聊天框与独立提示词编辑区的额外建议。

首个验收实例：提供一张Logo，输出16、20、24、32、40、48、64、128、256像素正方形PNG，逻辑文件名为logo-{尺寸}.png。public/images/icons/是用户举出的使用目标；第一版实际保存在images/<taskId>/下，下载后由用户使用，不自动修改任何项目public目录。

## 2. 架构与 Pi 归属

### 2.1 服务职责与代码边界

```text
图片工作台
    │ HTTP意图／SSE快照
    ▼
服务器图片控制器（application）
    ├─ SQLite：对话索引、草稿、任务、方案、授权、执行与资源关系
    ├─ Pi适配：默认模型讨论、无工具结构化规划、原生树读取
    ├─ 图片工作器：数据库取队列，不依赖浏览器／讨论句柄
    │    ├─ OpenAI官方图片适配器
    │    ├─ Google Gemini官方图片适配器
    │    └─ 精确尺寸／格式处理
    └─ 资源存储：images/<taskId>/...
```

page.tsx／route.ts只装配；业务在src/application及其ports，SQL在src/infrastructure/database，Pi SDK在src/infrastructure/pi，图片供应商与文件处理在独立infrastructure适配器。bootstrap统一注入。沿用现有单长驻Node进程＋SQLite部署，不承诺无状态函数或多副本部署。图片服务进程缓存标识包含模型代际，三表实现不复用旧九表实例。

图片API只从控制器授权后的工作器调用，不能由Pi工具直接生成、由浏览器直连供应商或通过bash调用。图片工作器用独立生命周期，不绑定Request.signal、SSE连接或AgentSession.dispose。

当前核实基线为Pi 1.5.0：支持AgentSession、SessionManager、自定义工具及generateImages抽象，已核实的内置图片适配是openrouter-images；不能把它当作GPT／Gemini官方直连。第一版在infrastructure中接官方API，GPT／Gemini仅区分图片接口协议，adapter及其版本决定请求映射，modelId由部署独立配置、不设固定型号白名单。图片模型也复用应用级models.json与Pi ModelRuntime的模型／地址／认证解析，使用显式openai-images-v1或google-generate-content-v1 API标识并从讨论目录排除；配置契约见 [4.1.3 图片接口配置与能力版本](#413-图片接口配置与能力版本)，models.images.example.json仅供合并到models.json，不作为运行时配置来源。Pi继续是唯一讨论Runtime，不引入另一套Agent框架。适配器和工作器负责执行，不使用codemode脚本承载任务队列。

### 2.2 图片对话对应一个独立Pi Session

IMG-032：工作台初始新会话为浏览器本地输入，不调用Pi或持久化；首次发送由application统一受理会话／任务、参考文件和规划请求，入口及事务见 [4.1.1 首次发送才创建会话](#411-首次发送才创建会话img-032)。Pi身份与文件仅在受理后初始化，不能在组件挂载、GET列表或点击新会话时创建。已有空记录不因本设计自动删除。

- 一个图片对话独占一个Pi Session Tree，一个任务的多张图片共享这棵讨论树，不按图片分别创建任务或Pi Session。
- cwd固定为applicationConfigRoot/images，不从项目、客户端参数或某个任务目录推导。
- Session文件目录固定为applicationConfigRoot/.data/image-sessions/<conversationId>/，首次分配后保存精确nativeRef（kind、sessionFile、sessionId、cwd），之后只按该身份恢复，文件损坏或缺失报错，不伪造空历史或替换身份。
- 数据库保存索引和恢复身份，不建立user／assistant消息表。树包含所有分支、thinking、工具输入和结果原文，不另存摘要对话。SQL只保存最新讨论输入及固定操作槽的当前回执，用于受理核对，不能用作模型历史或页面消息来源。
- 每次空闲prompt前按 [应用级 Pi 配置来源](01-architecture.md#3-应用级-pi-配置来源) 的配置根和文件优先规则解析当前默认模型，固定本轮快照；无默认模型或认证时报MODEL_UNAVAILABLE，不任取模型。默认变化在下一轮通过Pi原生模型切换生效，历史选择保留原生记录；不写SQL模型副本、不改全局默认。
- IMG-030：规划Session不注册read_image_task、prepare_image_plan或其他工具，也不挂载bash、任意文件读写、工具搜索、MCP及项目扩展发现。application在调用前一次组装本次任务、用户原始输入、ready参考图、可选硬约束、模型参数schema／默认值／限制与输出规则，通过Pi prompt及原生custom message提供完整上下文。参考图由服务端按资源身份提供，不能由模型传入宿主路径。
- LLM 按 [4.1.2 回复契约](#412-无工具结构化规划img-030) 返回讨论或执行响应，无任务查询或保存工具循环。application 对讨论只终结消息；对执行解析、校验、固定配置快照、保存方案并受理执行；任务身份、归属、授权、幂等和数据库写入由服务端决定。后台执行器继续负责供应商调用、本地处理及文件保存，不能用模型文本替代执行结果。
- 原始用户文本经Pi prompt，参考图以实际支持的图片内容块提供；不支持图片输入的默认模型返回明确错误，不悄悄选择其他聊天模型。结构化规划回复由Pi原生落盘，旧历史的工具调用／结果原样保留，任务结果通过带executionId的原生custom message通知讨论，只通知不自动启动新一轮LLM。SQL事实不以这条通知是否成功为准。
- Pi句柄仅按服务器当前prompt／通知写入活动管理，空闲即释放，不读取客户端观察或订阅人数。Pi prompt已受理后不因HTTP或SSE断开abort；IMG-036允许用户通过任务interrupt API显式终止，application管理任务级终止门禁，infrastructure/pi提供abort／abortCompaction，图片适配器及本地处理提供停止边界。图片执行生命周期独立，但受同一任务显式终止控制；具体竞态及持久结果见 [4.2.2 失败、重启和重新开始](#422-失败重启和重新开始)。
- 关闭Pi agent级retry、provider retry及所选适配器自动重试；不得依赖SDK默认。自动压缩保留正常管理能力，但发生需要重发原失败请求的路径时结束为failed并保留外部不确定性，不透明续发。实现需核实并控制Pi 1.5.0相关恢复路径，不能只关retry.enabled就宣称所有路径已关闭。

### 2.3 跨Pi与数据库的写入边界

讨论先在对话当前discussion中持久受理，再prompt；任务只保留当前plan与execution，不另建方案／执行／命令表或历史集合；先记原生基线entry IDs，使用包含commandId及taskId的custom entry关联，终结记录保存assistantEntryId及结构化规划标记。SQL与Pi文件不能跨介质原子提交。图片服务只在Route Handler实际处理HTTP请求时通过getImageWorkbench惰性创建；导入bootstrap／route模块不得创建服务、清理任务或派发工作，避免Next路由检查的独立短命进程误清理服务进程活动任务。图片服务按启动配置根及模型代际保存在process注册表中，尽量复用同一服务、队列和订阅；同代际模块热更新时将保留实例的原型及无状态讨论适配器更新为当前实现，避免沿用旧 DTO 或旧提示词，不重新启动工作器或清理活动任务；Next可能连process对象也隔离，不能把缓存命中作为清理正确性的前提。启动清理独立使用node:perf_hooks的performance.timeOrigin作为Node进程启动边界，按 [3.3 写入边界](#33-写入边界) 只终结该边界之前创建的当前记录；反复装配也不能中断本进程受理的记录。进程中断后，旧进程尚未终结的命令统一failed／PROCESS_INTERRUPTED，不检查原生证据补成功，也不重新prompt；已持久completed的记录保持原状。IMG-030以本次message命令ID、输入快照和当前revision校验结构化规划结果；重复消费同一响应复用当前回执，不依赖toolCallId，也不重复受理执行。旧工具调用与结果保留在所属原生树，新规划的回执按消息命令身份去重。

执行结果通知记录原生entryId供诊断；写入失败／中断即notification.failed，不再追加或自动核对补成功。页面直接显示SQL结果，通知失败不触发重新生成；只读查看原生树不改变业务结论。

### 2.4 图片工作台组件复核

实施前实际检索官方 [Conversation](https://elements.ai-sdk.dev/components/conversation)、[Prompt Input](https://elements.ai-sdk.dev/components/prompt-input)、[Image](https://elements.ai-sdk.dev/components/image)、[Confirmation](https://elements.ai-sdk.dev/components/confirmation)、[Queue](https://elements.ai-sdk.dev/components/queue)，五页均读取成功。Conversation/Prompt Input 沿用现有 Pi 全树 Conversation 与共用表单包装；官方组件依赖未采用的 AI SDK/shadcn 消息与输入状态，不能直接投影图片草稿版本和全部原生节点。Image 面向 AI SDK 生成图片响应，图片资源通过受控 AssetDTO URL 和原生 img 展示；Confirmation 不能代替 plan hash/taskRevision 的原子授权；Queue 不提供服务端派生任务状态、跨对话分页和独立当前选择。例外位置统一为 web/workspace/images/image-workbench.tsx 与 image-plan-editor.tsx，按钮及表单仍只复用现有公共组件/样式，不引入第二套组件体系。官方组件可直接承载 Pi 全树及资源/授权契约，或全应用接入统一 AI Elements 依赖时复核。

## 3. 数据模型

一次完整图片需求对应一个任务；多张图片、变体、尺寸由一个方案统一描述、一次授权执行，不拆任务。图片对话独占Pi Session，任务不拥有另一份transcript。资源独立保存，覆盖任务状态不删除原图或旧产物。

### 3.1 表数量与模型可读性

图片专属表由9张收敛为3张，通用7表基线下完整目标10表。去掉草稿、命令、方案、执行和两张输入关联表；不使用FOREIGN KEY、REFERENCES或关系检查触发器。对话、任务、资源是 SQL 的三个持久聚合；图片系列及版本按下述类型化列落在资源表，不另建关系树、方案历史表或执行历史表。conversation_id、task_id、execution_id、source_asset_id为普通定位字段，服务端在事务中检查存在性及归属。保留主键、唯一索引、CHECK和资源自身的不可变约束。

| 表 | 事实、字段和约束 |
| --- | --- |
| image_conversations | id PK、title、native_ref_json可空、draft_json可空、discussion_json可空、receipts_json固定操作槽对象、revision≥1、created_at、updated_at。nativeRef首次建立后不可更换。draft为总览草稿；discussion仅最新message；receipts只保存各操作最新回执，不是命令历史 |
| image_tasks | id PK、conversation_id、name、draft_json、plan_json可空、plan_inputs_json有序数组、execution_json可空、receipts_json固定操作槽对象、revision≥1、created_at、updated_at。current_plan_id、execution_id及status从当前JSON生成，支持定位与排队查询，不双写状态。plan只有一个，execution只有一个（图片版本另见3.1.1）；新方案替换旧方案并清空已终结执行；重新开始覆盖最新失败执行。运行／通知中禁止换方案或覆盖执行 |
| image_assets | id PK、task_id、execution_id可空、source_asset_id可空、role(reference/provider_response/master/output)、original_name、relative_path UNIQUE、output_key可空、sealed_at、sha256、mime_type、width、height、byte_size、availability(staging/ready/missing/corrupt)、created_at。execution_id仅为生成批次ID，不要求执行历史存在；同批次output_key唯一，资源身份及封存内容不可变 |

### 3.1.1 图片系列、版本与清理（IMG-049～IMG-053）

表数量仍为三张图片表，通用七表不变。以下3.1表格为既有三表基线，本节列出的列及约束是其增量目标。新增的独立事实是资源所属原图系列、版本号、就绪时间及删除状态；当前问题是旧资源只有批次，无法稳定组织中间成果。采用 image_assets 类型化列，避免新增版本表、父子关系表或把可查询归属藏进任意 JSON。现有 source_asset_id 只服务 SVG／派生来源，不用作版本父节点。

- 对用户可见的图片，image_assets 增加 root_asset_id、version_number、ready_at、deleted_at、cleanup_state（none/pending/done/failed）、cleanup_error（可空）；原图行另存 max_version_number 高水位，初始为 0。版本唯一索引为 (task_id,root_asset_id,version_number)，包括已删除版本；内部 provider_response／master／SVG 派生资源不占可见版本号，相关列为空。root_asset_id 和 version_number 分配后不可变；时间均为服务端 UTC，页面按本地时区显示。
- 原图自身 root_asset_id=id、version_number=0。上传原图的 ready_at 作为上传时间；纯提示词首次生成的每张成果独立成为系列起点，ready_at 作为生成时间。后续成果归属同任务原图，版本号为该原图高水位加一。回到旧版本修改仍追加最大号，不存 parentVersionId、不构建分支树。
- 可见的每张图片都是一个版本资源，不把一批执行或整个任务当成一个版本。多个图片分别修改时分别递增各自系列。一次产生多个尺寸／变体时，每张可见成果都分配独立版本号；新图无原图归属时各建系列。共同参考生成新图不强行归入某张参考图；修改某图时必须明确目标系列。不得按文件名、数组位置猜测系列。
- 方案增加与 outputSpec.targets 等长的 outputRoots 数组，元素仅为定位原图的 rootAssetId 或 null；null 表示新系列。服务端从目标／输入资产验证同任务归属，不能接受模型虚构 ID。LLM 只可引用 planning 中公开的原图身份；直接生成由已明确的分别修改／共同参考意图及参考身份装配，歧义返回 IMAGE_TARGET_AMBIGUOUS，不暗中调用 LLM。这仅记录成果的原图归属，不持久化版本之间的父子链。
- 输出 ready 的同一短事务内检查当前执行身份及终止门禁、推进原图高水位、写入 root_asset_id／version_number／ready_at。每个成果 ID 仅提交一次，不因重复回调增加版本。失败、取消且未 ready 的资源不成为版本；部分成功保留已提交版本。旧当前执行被替换不影响版本查询，版本不依赖旧执行 DTO 存活。
- 默认最新版本是同系列未删除且 ready 的最大 version_number；版本总选择上限取当前可见系列的最大可用版本号。删除不重排、不复用号码，高水位不回退。单张版本选择、统一版本选择、下载勾选均为浏览器展示状态，不持久化；不得混用 task revision、草稿 revision 与图片版本号。
- deleted_at 为逻辑删除时间，保留最小身份及编号事实以维持幂等和高水位，已删除资源不提供内容／下载、不进入版本和参考列表。删除成果仅影响所选版本；上传原图可按 IMG-056 显式删除。取消参考不写删除标记。Pi Session 归属不变，版本不拥有 transcript，删除不改写、过滤或脱敏原生历史。

关系总览仍为 conversation → task → assets；同一 task 内按 root_asset_id 归组、version_number 排序。关系校验沿用服务端事务，不新增外键或关系触发器。删除版本也不删除其原图身份行；纯生成的系列起点若被显式删除，仍保留身份与高水位，其他版本继续可用。

### 3.2 当前状态与类型化JSON

本节的 plan／execution／回执仍为当前操作状态，不是图片版本。图片版本按3.1.1保存；草稿清空与参考选择保留以4.2.4为准。

IMG-036：用户终止沿用当前discussion／execution的failed终态及IMAGE_TASK_INTERRUPTED错误码、finished_at，不新增cancelled状态、表或历史记录。interruptPending及interruptTarget由当前运行控制和活动记录派生，不作为持久模型；原图、ready产物、Pi树及失败文件保留，外部结果不明仍unknown。IMG-037移除历史导航不删除持久会话或原生历史，任务列表显隐只在浏览器本地保存，不新增数据库字段。

IMG-033／IMG-035查看器缩放、旋转角度、矩形选区、画布预览背景色／棋盘格及两侧列显隐为浏览器本地状态，不是持久模型；不新增表、字段、派生图片资产或mask，操作不改写原文件。成果区按 IMG-049 读取当前任务 API 中全部未删除的 ready 图片版本，具体投影见 [5. 页面投影](#5-页面投影)。

IMG-032：未首次发送的“新会话”只是浏览器内存中的输入、File引用及可选参数，不是持久conversation／task／draft，不分配Pi nativeRef、不建立Session文件、不创建服务端上传目录或临时文件。关闭／刷新可丢弃本地内容；只有首次发送受理后才使用现有三表及原生Pi身份。受理后的失败保留记录和文件，不能自动清理掩盖失败。沿用现有表及历史数据。

IMG-031任务列表投影：title派生自所属Pi原生树中可靠关联该taskId的最后一次非空用户文字输入，按原生追加顺序取最新，不能使用assistant回复、LLM摘要、任务name或其他任务的输入替代；只有图片或空白文字的发送不覆盖已有文字标题。无可关联文字时title=null，页面显示“未输入文字”。createdAt直接读取image_tasks.created_at，后续发送、修改方案及执行均不改变。标题不另建SQL字段、摘要或会话副本；新输入从原生image-command的taskId确定归属，旧输入按同一原生父链上image-command与image-input的commandId一致性确认。旧历史无法可靠关联时保留空值，不猜测、不回填用户库。原生树读取失败由API显式报告，不伪造标题。无需数据库迁移。

IMG-030只改变方案获取和应用编排，不新增表、外键或业务历史，不需要本次数据库迁移。LLM原始结构化回复保留在所属Pi transcript；完整规划上下文为本次运行输入，不另建持久对象。应用校验后映射到以下现有当前plan／inputs／来源字段，originCommandId关联本次message，不再依赖toolCallId。

JSON均为明确schemaVersion=1类型，不能接收客户端任意对象代替校验。draft包含id、归属、revision、text、profile_id、parameters_json（explicitParameters、可选operation、inputMode与outputSpec）、referenceIds及时间；每个对话总览／任务各一份，发送只清空该草稿本轮文本及一次性参数，保留当前参考选择，不覆盖其他目标。

plan包含当前id、task_id、conversation_id、operation、intent、preserve_text、prompt、profile_snapshot_json、parameters_json、parameter_sources_json、output_spec_json、plan_hash、created_at；IMG-049 增量增加 output_roots_json（类型化有序数组）及 input_mode（separate/joint），纳入 plan hash 及执行固定快照。inputs是{asset_id,purpose:base/reference,position}的有序数组，position从0连续且不重复。没有version或历史集合。hash覆盖最终意图、公开配置摘要、有序输入与全部输出。提交不同方案生成新id并推进任务revision；A→B→A是三次替换，旧确认不可复用。相同当前内容不重复创建。

execution是最新一次处理快照：id、task_id、plan_id、authorization_command_id、authorization_mode、restart_of_execution_id（仅前次批次标识）、revision、status、phase、provider_outcome、派发和结果证据、response_asset_id、error_code／detail、通知字段及时间。没有执行数组；旧执行被替换后其查询／重新开始返回404。终态在同一执行ID下不可恢复活动；显式重新开始生成新ID、清空旧错误／证据，替换整个对象。旧成果通过图片版本及资源 API 查询／下载，显式删除的版本除外；不要求旧执行仍可查询。

回执为既有CommandDTO对应的最新操作结果；receipts_json只接受固定kind槽（create_conversation、create_task、update_draft、upload、import、prepare_plan、confirm、restart_execution、interrupt、delete_version），同kind写入替换，不按请求ID持续增长。message独占discussion_json，讨论完成或失败后新message覆盖它。草稿／授权相关回执仍定位当前对象；被替换的回执不保证历史幂等查询，旧请求必须经过当前revision、planHash或源executionId检查，不能重新执行。任务创建按conversation.revision，上传／导入当前回执按内容摘要去重；不承诺永久幂等日志。服务端内部将当前字段映射为草稿／方案／执行／回执记录供用例调用，映射不是独立表或历史集合。

OutputSpec={schemaVersion:1,format:png/jpeg/webp,fit:contain/cover,background:transparent或#RRGGBB,targets:[{name,width,height,sourceIndex}],resample:lanczos3,quality?:1..100}。最多32输出、总像素1亿、宽高1..8192，名称单层安全且匹配格式；PNG无quality，JPEG无透明。九尺寸预设展开为9个target。一张或多张母图按固定sourceIndex映射，不按文件名排序。

profile从共用models.json经Pi派生；modelId独立于协议，快照仅服务端包含credentialRef和baseUrl，不保存apiKey或headers，不下发地址。process无profile、无生成参数、不调用图片接口。

### 3.3 写入边界

所有跨对象检查由application／repository在BEGIN IMMEDIATE内完成：任务所属对话存在；草稿归属固定；输入资源ready且类型／容量支持；SVG PNG来源为同任务ready SVG；输出属于本任务当前执行及当前outputSpec；确认固定当前plan id/hash和task revision。活动执行最多一个，因任务只有一个execution；queued／running／processing或通知pending／writing时拒绝替换方案和重新开始。讨论与图片执行可独立运行；规划结果只能由应用写入本次message固定的任务。首次提交回执沿用对话创建固定槽，独立于后续当前讨论回执。

文件仍按images/<taskId>/references与executions/<批次ID>/保存；目录是文件批次，不代表数据库历史。预留staging→写.part并fsync→封存元信息→rename并fsync父目录→ready。staging可无元信息；ready须完整摘要／格式／尺寸／字节数；封存后内容不可改。missing／corrupt不补ready，失败不删除文件。SVG保存原件和PNG参考两项，source_asset_id只由服务端核验来源，不建自外键。

启动清理使用Node原生performance.timeOrigin作为进程启动时间边界，只处理created_at严格早于该边界的当前讨论／执行／staging资源；同进程重复初始化不得修改本进程受理的记录。旧未结束讨论／执行置failed PROCESS_INTERRUPTED；已派发而外部不明的provider_outcome=unknown；未完成通知failed，staging资产missing。不扫描文件／Pi补成功，不自动续跑、重发或清理。状态只更新当前对象；已终结且通知已结束的执行在启动时保持原JSON及revision不变。

### 3.4 历史数据与显式升级（IMG-026）

IMG-049 后续升级边界：上述版本列、唯一索引及原图高水位已实现，本地数据库已按本次授权显式升级，见6.1；其他历史库仍须逐库确认。已有三表不自动 ALTER 或回填，不继承此前三表升级授权。历史上传可按已核实的资源身份建立 v0；历史成果只有可证明唯一原图归属时才能分组，无法可靠判断的成果保留为独立系列或留待用户选择，不按时间／文件名臆造精修关系。旧 created_at 是预留时间，不能伪作生成完成时间；无法恢复 ready_at 时 DTO 返回 null 并显示“时间未知”。所有旧文件、当前任务和 Pi 历史保留。实施前提供只读影响统计及分组预览，用户决定迁移映射和执行时间后再提供可审查脚本；本次实现不授权或执行数据库迁移。新增 scripts/image-version-preflight.cjs 只读输出缺失列及保守的独立系列映射，不包含迁移执行入口；用户已明确要求升级，授权此前预检的保守独立系列映射；执行脚本为 scripts/upgrade-image-versions.cjs，默认只读计划，显式 --execute --plan-sha256 才写入。脚本限定精确旧三表结构，核对无其他打开连接，完整 SQLite backup 并校验原表／原列全行摘要、保存只读备份及 manifest 后，BEGIN EXCLUSIVE 仅重建 image_assets 为目标结构，原列逐值复制；为 ready 的上传原件和历史成果填自身 root_asset_id、version_number=0，ready_at 保持 null。新表、索引与触发器必须完整匹配应用目标，其他表／原列摘要及映射逐项一致后才提交；失败回滚。文件及 Pi 历史不改写，锁、源摘要和目标摘要防止并发或过期计划执行。image-schema-v1.sql 仅用于识别既有三表结构，使通用功能仍可使用；图片 API 对旧结构返回 SCHEMA_INCOMPATIBLE，不能清库兼容。新空库初始化目标结构；历史库版本升级后需重新加载服务以采用完整目标结构，服务启停由用户控制。


用户已要求升级数据库，随后将目标改为上述3表；用户释放服务连接后已完成本次升级；升级契约只允许完整匹配当前通用7表的来源新增这3表、索引及自身约束，目标10表，通用表逐值保留。已有9表或其他未知图片结构拒绝执行，不静默丢弃历史，须另行审查映射。scripts/upgrade-image-schema.cjs默认只读预检；执行固定planSha256，拒绝符号链接／活连接／迁移锁／过期摘要。完整SQLite备份核验、fsync及只读归档后，原文件BEGIN EXCLUSIVE新增DDL，核对目标结构、原7表全行摘要、完整性与外键检查，再COMMIT；失败ROLLBACK并保留备份。不操作用户服务，不改配置、Pi树、资源文件。已是目标则只读current。应用启动仅初始化全新空库，不迁移已有库。

## 4. API 契约

### 4.1 参数、意图与授权

IMG-028：参数和输出在规划阶段一次确定，用户明确参数＞预设＞LLM规划＞服务端默认；未指定字段由LLM结合服务端随本轮输入提供的planning能力（图片模型参数schema／默认值／枚举／限制、默认模型及操作规则）补齐，不要求用户逐项填写，不能覆盖用户硬约束。纯尺寸导出／格式转换／保持原样默认process，有原图且明确精修／重绘才edit，无输入的新图才generate；OpenAI有参考图不能选择generate。方案保存前完成输出名、格式、尺寸、数量及sourceIndex校验；确认后执行固定完整方案，不再进行LLM参数或输出规划、不停下来询问补参；配置变化、资源失效及上游错误仍显式失败而非静默改方案。LLM不覆盖硬约束；generate/edit/process均先校验完整方案，普通发送按本轮有界授权直接执行，显式仅规划及手动方案继续使用确认接口。一次需求只有一个任务，一个方案包含全部母图／变体／尺寸；按IMG-030，Pi不注册图片业务工具，模型只返回结构化方案，不建任务、不写库、不调图片API。

IMG-033：参考区、成果区与图片查看器复用现有资产DTO及content／download API；首次发送前仅用本地File。缩放、旋转、矩形选区及IMG-035画布背景色切换不调用写入API；预览背景不进入规划参数或输出规格，用户需要改变实际导出背景时仍通过既有输出要求明确提交。画布自适应及设备像素比调整不产生业务请求，不生成遮罩或修改输入；只有既有选择参考／发送意图才进入规划上下文。参数选项读取现有capabilities，不另建页面参数接口。对话折叠不改变transcript API，完整原生内容及分支继续返回；最终输出以本次运行原生终结和assistant消息身份关联，过程与最终的展示规则见 [5. 页面投影](#5-页面投影)。此项不授权新增局部编辑或旋转保存接口。

#### 4.1.1 首次发送才创建会话（IMG-032）

打开工作台和“新会话”动作只切换本地空白输入，不调用create_conversation、create_task或上传写入接口。任务列表及capabilities可只读加载。首次发送调用POST P/conversations/submit（可信单用户入口，multipart/form-data，Idempotency-Key必填，无If-Match），payload为JSON {text,mode?:discuss/generate,profileId?,parameters?:{schemaVersion:1,explicitParameters,operation?,outputSpec?}}，files为有序参考图文件；不得由客户端传入conversationId、taskId、角色或授权状态。返回202 {conversationId,taskId,command}，command为当前受理回执，后续继续使用既有任务／SSE接口。单次图片请求与输出边界沿用普通message，不新增确认选项。

读取并校验输入大小、文件内容、格式、输出硬约束和默认讨论配置后才受理；空输入且无参考图返回INVALID_INPUT，缺幂等键400、参数非法400／422、文件容量413、格式415、配置不可用503，均不创建业务记录、Pi身份或落盘文件。按流限制整个multipart请求≤81MiB，JSON payload≤256KiB、最多4个有序files且每张≤20MiB。读取请求文件仅用有界内存，服务器暂存目录在受理前无文件写入。幂等key和规范化文本／参数／有序文件摘要固定请求身份，相同请求返回同一conversation／task／command，异载荷409 IDEMPOTENCY_CONFLICT；实现须以事务内重查和唯一约束防止并发双建，使用现有创建回执固定槽保存首次提交回执，以首次提交幂等键派生的对话主键提供唯一约束；回执保留首次受理身份，不随当前discussion替换，不新增历史命令表。

首次受理事务一次创建image_conversations、image_tasks及其初始草稿／当前discussion／创建回执，预留reference资产；不得持事务等待Pi或文件I/O。事务后初始化精确Pi身份并按 [3.3 写入边界](#33-写入边界) 封存文件，然后启动IMG-030规划。已受理后的Pi／文件失败保持可查的failed及资源证据，不自动清理、不重新提交；202只表示受理，不冒充生成成功。首次受理HTTP断开后仍可通过相同幂等key查询同一受理结果，不新建第二份。尚未发送时本地切换／刷新不调用删除或服务端清理，因为没有持久对象。显式创建接口继续服务既有调用方，参考上传入口用于已受理的任务，已有空会话保留。

#### 4.1.2 无工具结构化规划（IMG-030）

IMG-048 双入口：输入区提供「发送」及「生成」。两者复用首次 submit 与后续 messages API，新增可选 mode=discuss/generate，省略为 discuss；mode 参与幂等身份，服务端保存到当前输入快照。发送由 LLM 讨论、决定细节及是否执行。生成不调用 LLM prompt，不解释或改写用户提示词，依据草稿文本、参数／输出、参考图构造完整方案并直接受理执行。操作显式值优先，省略时有参考图为 edit、无图为 generate；输出省略时默认 PNG、1024×1024、contain 透明补边、lanczos3，按 n（缺省1）输出 image-1.png 等；process 按输入图数量输出，默认参数为空、profileId=null。选定模型优先，否则使用默认图片模型，协议参数由供应商适配器按现有默认规则解析。沿用就绪参考、上限、固定配置、事务与终止规则。生成模式不受默认聊天模型不可用或不支持图片限制。Pi 仅以 SessionManager 记录原始用户输入、图片块和命令关联，不创建 AgentSession 或调用 prompt；执行结果仍以原生 custom message 通知，冷恢复可读。参考选择规则与发送相同，以 IMG-051 的显式选择为准，不自动恢复已取消的参考。直接生成不受讨论分支选择控制，skipConfirmation=false 与 mode=generate 不兼容返回400。两入口各自提交独立幂等身份，传输重试保持原模式，不重复出图。直接生成的新命令即使内容相同，也替换当前方案并受理新执行；这是用户明确的新生成意图，不属于旧方案普通确认或后台重试，旧资源仍保留。


IMG-046 连续对话的自动继承规则由 IMG-051 取代：发送与生成均只使用当前已选参考；显式空数组代表没有参考，禁止从当前方案、最新执行、上传历史或 Pi 历史自动补回。单次最多四图，超过时拒绝并要求用户明确选择，不截断。引用属于本任务连续编辑意图，写入当前 discussion 输入快照并照常校验，不修改原文件、不建立新历史表。planning 提供当前方案的公开 DTO，让模型结合原生历史理解后续颜色、背景、尺寸等要求。发送消息不等于授权生成，先按 IMG-047 区分讨论与执行；只有执行分支获得本轮有界授权，不重放旧命令。页面展开结构化回复中的 reply（兼容旧方案的 intent），完整原文仍可展开；执行状态与成果由 API 展示，不将规划完成声称为出图成功。


```text
用户输入＋参考图＋可选参数
             ↓
服务端组装完整规划上下文
             ↓
LLM 返回结构化回复：讨论或执行
             ↓
讨论仅展示回复；执行校验并保存方案
             ↓
后台生成／修改／精确处理
             ↓
展示图片及结果
```

message路径、Idempotency-Key与If-Match契约继续使用现有接口。服务端受理事务固定任务及本次输入，随后一次提供原始文本、选中的ready参考图、可选显式参数／输出规格、可用图片模型及其公开参数schema／默认值／限制、process/edit/generate规则。地址、凭据、句柄不作为规划上下文。可选operation由capabilities.operations提供枚举，省略时由LLM判定；用户也可全部留空，由LLM补齐；应用校验仍以受理快照为准，不信任模型传回的归属或授权。

IMG-047：模型响应为单个 JSON 对象的联合类型。讨论返回 `{action:"discuss",reply:string}`，不接受 plan 或其他字段；reply 必须非空，可为 Markdown，回答解惑、比较、细节讨论或澄清问题。不因选了模型、上传图片、调整参数、出现图片词语或已有方案就执行；意图不确定时先讨论，用户明确提出生成、修改、导出时才返回 `{action:"execute",reply:string,plan:PlanInput}`。execute 的 reply 同样非空，plan 严格沿用以下字段。兼容历史无 action 的直接方案对象。讨论分支只将当前 message 记 completed，autoExecution 为 not_requested／DISCUSSION_ONLY，resultIds 的 planIds／executionIds 均为空；当前方案、执行、任务 revision 和资产保持不变。回复只保留在原生 Pi 树，不新增回复列或消息表。非法联合类型按 IMAGE_PLAN_INVALID 失败，不执行。

执行方案字段沿用当前 plan 及 OutputSpec 所表达的意图结构：operation、intent、preserve（字符串）、prompt、profileId、parameters、inputs、outputSpec；不生成数据库新 ID、授权或执行状态，不含工具调用。IMG-049 增量为 outputRoots，仅引用上下文已公开的原图身份，定义见3.1.1。应用在内存解析并验证字段类型、协议参数、输入归属与ready、容量、用户硬约束、完整输出及sourceIndex；通过后在短事务内重查当前命令／任务revision及活动执行，保存当前方案、固定配置快照和来源，再按本次发送意图创建queued执行及预留资源。不得持锁等待LLM或供应商；实际文件／生成工作在事务后执行。

非JSON、缺字段、多对象或语义校验失败统一IMAGE_PLAN_INVALID（规划命令终结failed；DTO错误说明具体字段及原因），旧当前方案与执行不变，不创建新输出资源。模型请求失败沿用IMAGE_DISCUSSION_FAILED。规划失败不自动重发、不进入工具纠错循环、不改写用户硬约束。有效方案按普通发送直接执行，无二次确认；供应商失败仍按 [4.2.2](#422-失败重启和重新开始)，结果通知不触发新一轮LLM。验收记录见 [6.1 实际验证与迁移记录](#61-实际验证与迁移记录)。

总览发送无任务时同事务建一个任务，唯一任务时复用，多个任务时400 IMAGE_TASK_REQUIRED并保留草稿；taskId固定在本次discussion输入快照。讨论使用应用当前默认聊天模型。参考图只接受已登记ready资产，SVG使用PNG派生参考；输出与来源顺序遵循 [3.2 当前状态与类型化 JSON](#32-当前状态与类型化json)。

当前方案直接替换，不保留方案版本；图片成果版本独立按 IMG-049 保留。相同当前内容返回200，不同内容201并推进task revision；活动执行或尚未结束的结果通知期间409 IMAGE_TASK_BUSY。替换方案清空已结束执行及其授权回执，旧方案／执行ID不可查询。confirm固定planId、hash、taskRevision；同当前方案已执行则PLAN_ALREADY_EXECUTED，旧确认PLAN_STALE，不提供选回历史方案接口。执行期间仍可保存草稿。

#### 4.1.3 图片接口配置与能力版本

图片模型与讨论模型按 [应用级 Pi 配置来源](01-architecture.md#3-应用级-pi-配置来源) 选择 models.json／settings.json，并复用 Pi ModelRuntime 解析：本地文件各自整份优先于全局文件，不另建图片配置文件、编辑API或认证解析器。不读取旧独立图片配置。IMG-034：没有可用图片模型时capabilities返回defaultProfileId=null，页面直接提示“没有可用图片模型”；process本地处理能力仍独立存在，不伪造图片模型。models.json或settings.json无效时报IMAGE_CONFIG_INVALID，不静默回退。

图片模型沿用providers.<providerId>.models条目，id是部署实际型号，api显式取openai-images-v1（GPT图片协议）或google-generate-content-v1（Gemini图片协议）；providerId可以是自定义供应商名，不代表协议或modelId。api来自Pi解析后的模型，baseUrl、apiKey、headers及其环境变量／命令引用均由Pi原生解析。图片模型从讨论选择目录排除，讨论默认仍按原settings.json。图片模型遵循enabledModels范围；IMG-034：图片模型选择独立于参数／输出。capabilities.defaultProfileId优先取defaultProvider/defaultModel命中的可用图片模型，否则按选中models.json供应商及模型配置顺序取首个已启用且认证可用的图片模型；只有一个时直接选中，不要求用户先手动选。无可用项返回null及明确提示，不自动改配置或切换讨论模型。已有用户选择仍可用时优先保留；已受理方案固定的模型失效仍明确失败，不在执行中换成其他模型。

内部ImageProfile由解析结果派生：id为编码后的providerId/modelId，provider保持协议族openai/google供适配，credentialRef指向实际providerId，modelId、adapter、固定capabilityVersion=v1、timeoutMs=600000、defaults来自samplingParams（仅允许协议参数）、参数定义及限制由协议适配器生成。全局执行并发固定1。baseUrl保存在仅服务端快照中，按所选模型／供应商配置请求，协议分别追加images/generations或images/edits、models/<编码modelId>:generateContent，不把自定义供应商强制绑定到官方地址。地址仅允许HTTP／HTTPS且不得包含用户名、密码、查询或片段。

认证在请求时按实际provider与model身份调用Pi getAuth(model)，复用其apiKey及headers；协议所需Authorization或x-goog-api-key按Pi结果装配。不把聊天OAuth视为图片API认证，不写入密钥或解析后headers。凭据不可用返回IMAGE_PROVIDER_UNAVAILABLE。授权和派发前重新核对派生configHash，模型、协议、地址、默认参数改变则拒绝旧快照，不静默切换；密钥轮换无需改方案。headers的原始引用仅参与服务端指纹，不返回或存储原文。

公开profile快照保留schemaVersion、id、provider、adapter、modelId、capabilityVersion、configHash、timeoutMs、parameters、limits；不暴露baseUrl、credentialRef、密钥、headers或完整配置。配置指纹不包含apiKey值或解析后header值。派生profile是只读投影，不是另一套配置文件。

参数定义为{key,type:string|integer|number|boolean,required,default?,enum?,min?,max?,description}。协议及版本决定参数映射与应用限制，modelId独立配置、无型号白名单；实际模型支持情况由接口返回决定，不按名称推断或替换模型。


#### 4.1.4 本次跳过确认

IMG-029：普通发送先按 IMG-047 判断讨论或执行；讨论不生成图片。仅执行分支由 LLM 填写未指定参数及输出，完整方案通过校验后直接执行，不二次确认。省略skipConfirmation时服务端规范化为true，未传autoExecuteLimits时使用单次范围{maxImageRequests:4,maxGeneratedImages:10,maxOutputs:32}，不是跨轮授权；显式false表示用户仅规划，才等待确认。规划结果字段见 [4.1.2](#412-无工具结构化规划img-030)，IMG-030取代prepare_image_plan工具提交。skip为true时autoExecuteLimits={maxImageRequests,maxGeneratedImages,maxOutputs}，请求／母图额度可为0，输出为正数。完成本轮Pi后仅消费本次唯一结构化方案并校验保存结果，验证taskId、profile、明确参数、全部参考和outputSpec均未改变，再比较额度。同任务只建一个执行；joint 一次供应商请求可返回多张母图，separate 按明确的输入集合各派发一次，不循环补图。合法但超限的方案保留为needs_confirmation。结构化结果无效时按 [4.1.2](#412-无工具结构化规划img-030) 失败，授权状态为not_requested。返回当前已执行的同一方案时复用当前方案，执行授权为not_requested，原因PLAN_ALREADY_EXECUTED。重新开始讨论固定skip=false。

### 4.2 状态和事务

IMG-031：任务列表及详情共享同一TaskDTO的title和createdAt，SSE任务快照沿用相同投影；读取不调用LLM、不写库、不回填旧记录。原生任务关联及文字来源见 [3.2](#32-当前状态与类型化json)，读取失败返回IMAGE_HISTORY_UNAVAILABLE并显式显示资源错误，不以task.name或其他输入兜底。TaskDTO.derivedStage同时用于列表运行状态：按优先级先取当前execution的queued／running／processing；其次当前discussion的受理快照归属该taskId且status为accepted／running时显示planning；其次当前execution为completed／failed时投影终态；无execution且当前discussion归属本任务并失败时显示failed；其余有plan显示awaiting_confirmation，无plan显示awaiting_input。已终结旧execution不遮盖当前planning。TaskDTO.errorCode取该阶段对应当前错误码，否则为null。状态从当前记录派生。列表／详情／SSE使用同一规则，规划或执行变化及时推送，读取错误独立显示、不伪装成任务failed。列表顺序按任务created_at倒序、同时间id稳定排序，后续输入只更新派生标题、不改变创建时间或排序。

#### 4.2.1 当前对象的受理

写入使用Idempotency-Key与资源版本。先输入／归属验证，再读取当前回执；相同key及请求hash返回当前结果，异体409 IDEMPOTENCY_CONFLICT。仅首次受理校验版本并在BEGIN IMMEDIATE内重查。只保留当前固定操作槽回执，不保留命令历史；槽替换后旧命令ID404，旧方案／源执行ID404或PLAN_STALE，旧草稿／任务创建版本412，不保证任意历史上传请求永久幂等。DTO中的命令只是当前受理状态，不是独立持久对象。回执里旧方案ID不能当作可用当前方案；迟到规划响应拒绝PLAN_STALE，不得恢复被替换的方案；讨论回执的planIds也只返回仍为当前的方案ID。

create_conversation先写预留对话及最新创建回执，再在固定位置建Pi空树，成功装配nativeRef和总览草稿；失败保留当前错误和候选文件，不自动重建。message同事务固定任务、当前discussion、草稿输入，清空原草稿文本／参考／参数并推进草稿revision，profile保留；事务后后台prompt，不依赖HTTP/SSE连接。新message只覆盖已终结的旧discussion，不影响任务授权回执；旧输入与工具原文仍存在Pi树，不从SQL展示命令历史。

confirm在事务内核对当前plan id/hash、task revision、无执行／通知活动、输入ready及profile可用，覆盖任务最新execution为queued，为全部输出预留新资产，同事务写授权回执。工作器只扫描任务当前execution；全局并发1；generate/edit最多一次图片请求，process不调用供应商。状态queued→running→processing→completed或任意活动阶段→failed。完成必须逐项输出key、格式、尺寸与ready匹配，不能只数文件。

#### 4.2.2 失败、重启和重新开始

IMG-036终止接口：POST P/tasks/:id/interrupt，可信单用户，Idempotency-Key必填，正文{commandId?:string,executionId?:string}至少一个，身份来自当前TaskDTO的interruptTarget；不接受客户端归属、状态或句柄。服务端核验属于本任务的当前活动规划／执行，先在独立短控制门禁登记终止意图并阻止后续派发，再调用当前Pi AgentSession.abort（若正在压缩同时abortCompaction）、供应商请求AbortController及本地处理协作停止；不得排在被终止工作持有的整轮队列后等待而死锁。排队任务未派发即结束；正在处理的任务在安全边界停止，不宣称已回滚外部请求或文件。

接口等待实际工作结束后返回200 {task:TaskDTO,latestExecution:ExecutionDTO|null}；终止等待期间原活动状态及锁保持，TaskDTO增加interruptPending:boolean和interruptTarget:{commandId?:string,executionId?:string}|null、allowedActions中的interrupt。取消中为服务端运行控制派生值，不新增SQL状态列；页面不得在abort调用返回时自行视为完成。规划及执行终止分别将当前discussion／execution置failed、error_code=IMAGE_TASK_INTERRUPTED并填finished_at，取消规划后不得保存迟到方案或受理新执行；取消执行后不得再将其改completed。先完成提交的终态不被终止改写，竞态返回实际终态。已派发且没有明确结果时provider_outcome=unknown，已取得供应商结果则保留success；已ready文件、原图、原生树及失败残留保留，未完成staging资源按现有失败规则置missing，不删除文件。确认终止后才释放原工作锁，后续通知只记录结果，不触发LLM。

同键重复请求共用结果，异体IDEMPOTENCY_CONFLICT/409；相同目标已终结返回当前事实，不重新abort；目标已替换返回PLAN_STALE/409，不终止新一轮。无目标或格式非法400，不存在／跨任务404，控制句柄或结束结果不可确认IMAGE_INTERRUPT_UNCERTAIN/409并保留运行或unknown事实，禁止伪造已终止；不重发模型、图片请求或中断控制操作。HTTP等待15秒仍无法确认结束时返回IMAGE_INTERRUPT_UNCERTAIN，服务继续等待确认收尾并保持门禁，同目标后续请求可等待同一终止操作。终止后重新开始仍须用户明确操作，沿用现有failed源及unknown确认边界。

IMG-037：移除独立对话历史入口、历史列表分页加载／切换及专用GET P/conversations集合查询路由，退役路径返回NOT_FOUND；任务导航统一用GET P/tasks。保留任务所属对话详情、draft、messages全树及原生历史文件，这是当前任务展示所需内容，不属于被移除的历史导航功能。不删除已有对话／任务／Pi数据，不影响通用项目会话历史。

断线／切换只释放传输，不取消工作。错误／超时明确failed；外部可能受理则unknown，接口明确拒绝则failure；HTTP 408及5xx（包括502／503）不能证明未受理，记IMAGE_PROVIDER_UNCERTAIN及unknown，其他明确4xx记IMAGE_PROVIDER_REJECTED及failure。拒绝及不确定响应均在provider evidence保留HTTP状态，ExecutionDTO.error.message从已有证据显示HTTP状态，不返回地址、密钥或原始响应体，不自动重试；得到供应商图但保存失败保留success。当前执行终态不得变回活动，不自动重试、补文件、续跑或补成功。bootstrap及route导入无服务初始化、清理或派发副作用，仅实际HTTP请求内惰性取得服务。启动清理仅终结created_at早于Node原生performance.timeOrigin边界的当前未完成讨论／执行／通知和staging资源；同进程模块重载即使隔离globalThis及process对象、重复装配服务，也不得修改边界之后受理的任何记录；已终结且无待发通知的执行不写入、不增加revision，细节见 [3.3 写入边界](#33-写入边界)。

restart仅用户主动调用。源必须是任务当前failed执行，planHash与taskRevision仍匹配且通知已经终结；unknown要求acceptUnknownOutcome=true。事务中创建新批次ID、授权回执和staging输出，直接覆盖旧execution状态及错误；旧文件／资源不删，没有后继链查询。最新对象的restart_of_execution_id只用于识别紧接上一次重新开始的重复点击；相同源双击返回当前后继，源更早／当前方案已变则404或PLAN_STALE，不再复原历史。同一方案普通确认不能代替restart。

最新失败discussion可通过command restart使用固定输入新prompt，沿用同Pi身份且skip=false，不覆盖新草稿；新discussion替换旧discussion，重复点击识别当前restart_of_command_id。已被新message替换的旧命令404；Pi损坏IMAGE_HISTORY_UNAVAILABLE，不替换身份。创建对话失败可由用户重新创建新身份，旧文件保留。

#### 4.2.3 结果通知

终结事务固定本次notification payload并置pending；与同对话prompt共用串行门禁，首次写前writing，Pi custom message triggerTurn=false，成功delivered，错误或进程中断failed，不重发／核对。pending/writing期间保留当前方案及执行，不能被新执行覆盖；通知失败不改变图片结果。旧通知回调按当前executionId核验，不能写入后来的任务状态。

### 4.2.4 参考选择、版本下载与删除（IMG-049～IMG-053）

IMG-051：草稿 referenceIds 是当前参考选择的唯一事实，始终为有序数组，[] 明确表示无参考。上传成功追加所上传原图；选择历史版本通过原有 PATCH draft 明确加入；取消参考调用相同接口移除该 ID，首次受理前仅移除本地 File。取消不会删除资产、版本或文件，也不改变已经受理的命令／执行输入快照。发送成功只清空草稿文字及本轮一次性参数，保留 referenceIds，后续请求及刷新不得自动恢复取消项。当前参考与全部原图／版本列表分开投影。旧草稿初始化时保留已持久 referenceIds，不从历史补齐；参考能力上限限制本次选择，不限制任务累计上传的原图数量。总览、任务草稿不得混用归属。此项不调用 Pi。

IMG-049：草稿参数及 PlanInput 增加 inputMode=separate/joint。多图直接生成必须明确选择分别修改或共同参考；单图默认 separate，无图默认 joint。separate 的 edit 按每个输入分别派发，n 为每个输入生成数量，sourceIndex 按输入顺序再按返回顺序编号；joint 使用一次供应商请求，edit 的新图 outputRoots 为 null。process 固定按 sourceIndex 选择输入归属。默认单次授权 maxImageRequests 为4，可覆盖最多四张参考分别修改，其他容量不变；失败停止后续派发，保留已就绪版本，不自动补请求。方案的 outputRoots 在保存前校验，分别修改的每个输出必须明确归属某个输入系列；共同参考的新图使用 null。缺失且无法无歧义装配时返回 IMAGE_TARGET_AMBIGUOUS/422，当前方案／执行不变。映射随当前方案及执行固定，版本 ready 事务只读取它，不调用 LLM、Pi 或供应商补判归属。

IMG-052 下载：单图沿用 GET assets/:id/content?download=1；多选下载使用 POST P/tasks/:id/download，入参 {assetIds:string[]} 为非空去重的版本资产 ID，可跨该任务的多个系列，单张也合法；全选当前展示版本同样提交明确 IDs，不接受含糊的“最新”作为下载时定位。读取事务内一次核对 task 归属、ready、未删除及内容元信息，之后按快照打包 ZIP，逻辑重名以原图身份及版本号消歧，不暴露宿主路径。未知或跨任务项404，已删除项410 IMAGE_VERSION_DELETED，不可用项409 IMAGE_ASSET_UNAVAILABLE；任何项无效则不以部分 ZIP 冒充成功。开始响应前完成文件存在性／摘要核验；流中失败终止传输，不返回假成功。下载只读，不需要幂等键、不写版本或执行，不调用 Pi。文件读取期间持有本进程资源读租约，删除不得并发清除其文件；全部字节校验并进入下载快照后释放租约，随后打包不再读取源文件。单次 ZIP 最多1000个明确版本，所选文件合计最多256MiB，超出返回413 REQUEST_TOO_LARGE，提示分批下载；响应前校验全部文件并固定字节快照，不以部分 ZIP 冒充成功。

IMG-053 删除：DELETE P/tasks/:id/versions/:assetId，调用方为成果或参考图卡片确认后的删除动作，携带 Idempotency-Key 和 If-Match task revision，body={}。可删除同任务、ready 的可见成果版本，以及 IMG-056 定义的上传原图；已删除项可重试清理。接口不删除整个系列或任意资源目录。服务端从资产查原图归属及许可，不接收客户端角色或路径。若资产被当前活动讨论输入、执行输入／待通知结果或进行中的下载占用，返回409 IMAGE_ASSET_IN_USE；需要用户等待或显式终止任务，不能只中止 HTTP。禁止将取消参考当成删除。

删除短事务重查 image_tasks.revision、当前命令／执行占用及 image_assets，写 deleted_at、推进任务 revision，移除该版本在所属 image_conversations.draft_json／image_tasks.draft_json 中的 referenceIds 并推进受影响草稿 revision；不改当前方案、历史输入快照、原图或其他版本，不回退原图 max_version_number。固定 receipts_json 新增 delete_version 槽，记录请求摘要、资产 ID 及结果，按现有当前回执边界幂等；相同 key 异体409。合法重复删除返回同一逻辑结果，不再次推进版本或触发生成。事务成功后返回200 {task,deletedAssetId,cleanup:{state:done|pending|failed}}，通知任务及草稿 SSE。逻辑提交失败则所有可见事实保持原状，文件尚未清除。

文件清除在逻辑提交后执行，仅服务端核验的该成果及专属派生文件可删除；仍被未删除资产引用／共享的文件保留，不改 Pi 文件或原生消息内的内容。文件清除失败保持版本已删除及 cleanup.failed，报告明确错误，不恢复显示、不启动后台自动清理。未完成清理的墓碑保留 cleanup_state／cleanup_error 类型化列；同一 DELETE 显式再调用可重试清理，逻辑删除不重复执行。API 不提供已删除资产 URL，GET content 返回410；原生 Pi 树仍原样可读。删除后若尚有可用版本，页面显示该系列最新版本；没有则移出成果列表。

### 4.3 接口与推送

P=/api/images。入口route仅装配；application负责规则，SQL在database，Pi SDK在pi适配。沿用访问边界，不新增角色；定位与意图由客户端提交，归属／状态均从服务端读取。除所属Pi transcript原文外，不公开地址、密钥、headers和运行句柄。

#### 4.3.1 DTO和错误

沿用{data}或{error:{code,message,details?}}。ConversationDTO包含id/title/revision、discussion{busy,blockingCommandId,error}、latestCommand（仅最新讨论／创建状态）、nativeHistoryAvailable、allowedActions。DraftDTO保留id、conversationId、taskId、revision、text、profileId、parameters、referenceIds、allowedActions。TaskDTO保留当前方案／最新执行ID、derivedStage和许可。PlanDTO无version，包含当前id/hash、operation/intent/prompt/preserve、公开profile、parameters/sources、inputs、outputSpec、outputRoots（IMG-049 增量）及warnings。ExecutionDTO是任务当前执行投影，包含本次状态／阶段／错误／providerOutcome、输出逐项结果、当前方案及输入、通知状态和许可，没有历史分页。CommandDTO保留本次状态、输入白名单、结果ID及autoExecution；ID仅在该当前槽有效。AssetDTO含原图来源和安全预览下载URL；资源目录可包含旧批次文件，独立于执行历史。IMG-049～IMG-053 新增 rootAssetId、versionNumber、readyAt、allowedActions（reference/download/delete）；rootVersionMax 从服务端高水位读取。TaskDetail 增加 images:[{rootAssetId,latestVersionNumber,versions:AssetDTO[]}] 与 maxVersionNumber（当前可见图片最大可用版本号，无图为0），只含未删除且 ready 的可见图片版本，按原图上传／首次生成顺序及版本号排序；内部母图不重复展示。referenceAssets 仅投影草稿 referenceIds 对应的资源，不再表示上传历史。版本删除许可由服务端当前占用派生，页面不自行猜测。

缺幂等键400、缺If-Match428、版本冲突412，PLAN_STALE／PLAN_ALREADY_EXECUTED／IMAGE_TASK_BUSY／IMAGE_DISCUSSION_BUSY为409，资源不存在404、未知参数400、图片参数422、配置／认证／存储／结构不可用503。无当前命令或执行返回404；不存在的历史和current-plan接口404。上传／导入以当前回执重放不再读源文件；回执被新上传覆盖后不提供永久去重承诺。

#### 4.3.2 接口

| 方法／路径 | 入参、返回、事务及Pi |
| --- | --- |
| GET P/capabilities | 解析共用配置／认证返回能力，不真实探测 |
| GET P/conversations | IMG-037退役会话历史集合查询；NOT_FOUND/404，任务导航改用GET P/tasks |
| GET P/conversations/:id | 当前会话、任务及各任务当前方案；任务标题按IMG-031从Pi树派生 |
| GET P/conversations/:id/draft | taskId可选→当前目标草稿，只读 |
| GET P/conversations/:id/messages | 所属完整Pi全树，只读，不过滤内部节点 |
| GET P/tasks | filter=active/all、conversationId可选、cursor/limit→任务分页；IMG-031默认all，列表及任务详情中的TaskDTO返回title:string\|null、createdAt（规则见 [3.2](#32-当前状态与类型化json)），title为最后一次用户文字原文而非LLM摘要；active仅queued／running／processing，已终结且等待通知的任务只在all可见 |
| GET P/tasks/:id | →task/currentPlan/latestExecution/assets/referenceAssets/images/maxVersionNumber，版本及参考语义见4.3.1。SSE task:<id> 返回相同 DTO。上传原图与全部版本在 images 中保留；referenceAssets 仅当前选中参考，SVG 原件与派生 PNG 不重复展示。只读 SQLite，不调用 Pi |
| GET P/commands/:id | 当前回执DTO，被替换后404 |
| GET P/executions/:id | 当前任务执行DTO，被替换后404 |
| GET P/assets | taskId可选、cursor/limit→未删除持久资源分页；图片版本展示按任务 images 投影，不能把内部资源冒充可见版本 |
| GET P/tasks/:id/import-candidates | cursor/limit→显式扫描安全未登记候选，签名ID／摘要，无宿主路径 |
| GET P/assets/:id/content | download=1可选→核对hash后图片字节，安全SVG惰性预览 |
| GET P/executions/:id/download | 当前执行ready输出流式ZIP；旧批次单图从资源目录下载 |
| POST P/conversations/submit | 有序multipart files及payload、Idempotency-Key→202{conversationId,taskId,command}，见 [4.1.1](#411-首次发送才创建会话img-032) |
| POST P/conversations | {title?}→201对话／总览草稿及回执；预留当前对象→Pi→固定nativeRef |
| POST P/conversations/:id/tasks | {name}、If-Match对话revision→201任务／空草稿，事务内创建及回执，不调用Pi |
| PATCH P/conversations/:id/draft | {draftId,text,profileId,parameters,referenceIds}、If-Match草稿revision→更新所属对象草稿及最新回执，不调用Pi |
| POST P/conversations/:id/messages | {draftId,mode?,skipConfirmation?,autoExecuteLimits?}、If-Match草稿revision→202当前discussion；固定任务／输入，按 IMG-051 保留参考选择；discuss 调用 LLM，generate 跳过 LLM |
| POST P/tasks/:id/references | multipart file→201{command,asset,sourceAsset}；先预留资产后保存，SVG原件＋PNG；不调用Pi |
| POST P/tasks/:id/import | {candidateId,expectedSha256}→201同上传；候选变化409，不覆盖源 |
| POST P/tasks/:id/plans | 类型化PlanInput、If-Match任务revision→{plan,taskRevision,selected,existingExecutionId,created}；事务替换当前方案及inputs，清空已终结执行，不调用图片API |
| POST P/tasks/:id/interrupt | {commandId?,executionId?}、Idempotency-Key→200{task,latestExecution}，见 [4.2.2](#422-失败重启和重新开始) |
| POST P/tasks/:id/confirm | {planId,hash,taskRevision}→202{command,execution}；事务写当前执行及全部预留输出，再独立工作器 |
| POST P/executions/:id/restart | {planHash,taskRevision,acceptUnknownOutcome?}→202当前新执行及回执；覆盖旧执行，不建历史 |
| POST P/commands/:id/restart | {}、If-Match源revision→202新当前discussion／创建回执；仅最新failed，讨论skip=false |

新增目标接口：POST P/tasks/:id/download 和 DELETE P/tasks/:id/versions/:assetId，完整契约、错误、事务、文件清理及 Pi 边界见4.2.4；旧执行 ZIP 仅作兼容，不承载跨版本多选下载。

#### 4.3.3 推送与文件处理

GET P/events?conversations=<JSON数组>&filter=active|all&taskId=<可选>&cursor=<可选>&limit=<1..100>。单页一连接；最多16个对话，task归属必须匹配。连接有效立即发送当前快照，此后SQL／Pi变化触发重读、相同内容去重；首次初始化且未取得Pi身份时，订阅树暂为空，ConversationDTO.nativeHistoryAvailable为false。终结后缺失或历史读取失败通过resource_error报告；草稿和附件聚合读取错误同样隔离；某个资源失败不得中断其他资源快照或抛出未处理异常。resource固定tasks、conversation:<id>、tree:<id>、draft:<id>、task:<id>，task 包含当前方案、当前执行、当前参考及持久图片版本；不增加方案／执行历史集合。断开／背压只释放该传输，不取消／重拾，业务不维护订阅者身份／在线状态／计数，不轮询。

参考支持PNG/JPEG/WebP、安全SVG，单图20MiB／4096万像素、最多4图并受协议限制。导入递归列出任务目录安全未登记图，排除staging、已登记和symlink，分页签名候选；显式导入核对hash。SVG原字节保留、PNG派生用于讨论和供应商。精确处理保持比例／contain透明补边或cover，lanczos3；小图放大提示，不保证AI编辑文字形状完全不变。输出保存封存、rename、失败保留规则见 [3.3 写入边界](#33-写入边界)，不自动清理或续跑。

## 5. 页面投影

IMG-036：输入框发送按钮旁增加共享Button的“终止”按钮，当前任务API允许interrupt时可用，空白本地新会话及无活动任务时禁用。可终止规划、排队、图片生成及本地处理；点击携带API返回的精确interruptTarget，不从前端猜测目标。API等待期间显示“正在终止…”并禁用重复终止／发送，保留草稿，不先隐藏运行状态；完成后以API及SSE终态为准，显示“已终止”及已有产物。终止失败显示明确错误，不能把连接断开当作成功；已发出供应商请求可能仍产生外部结果或计费，unknown按API如实提示。切换、隐藏列及关闭页面不自动终止。

IMG-032：每次从导航打开图片工作台默认显示本地空白新会话及可用输入区，不要求先点“新建对话”；新会话动作同样只清空本地上下文。输入文字、选图、预览及可选参数在首次发送前仅浏览器内存保存，不调用创建或上传接口。发送时按 [4.1.1 首次提交 API](#411-首次发送才创建会话img-032)一次受理，返回conversationId／taskId后切换到持久任务并订阅进度；提交中防止重复点击，传输重试复用同一幂等key。未发送离开／刷新不产生服务端数据，也不执行服务端清理。受理前失败保留本地输入，受理后失败显示对应任务错误，不伪装为未创建。右侧仍可读取并选择已有任务。

IMG-030投影：输入区只承载用户要求、参考图与可选参数；发送后展示API返回的规划／执行进度及最终图片和错误。不再用新工具调用卡片充当规划步骤，也不要求用户确认方案或逐项补参数；规划成功不冒充生成成功。完整Pi树及旧工具记录仍按原契约原样可查看，不过滤、删除或改写历史。布局见IMG-033。

IMG-029：移除“规划后直接执行／仅规划”开关及请求／母图／输出限额表单。用户可提前设置参数与输出，也可不设置而交给LLM；普通发送按 IMG-047 先回答或澄清，明确要求操作图片时才按 [4.1.4 默认单次授权](#414-本次跳过确认) 执行，不二次确认。已持久化对话的发送仅提交draftId，不发送页面自定的确认模式或额度。主对话移除当前方案编辑、执行确认和保存草稿按钮；方案与显式确认 API 仅保留兼容。普通消息先讨论和理解，明确的图片操作意图才规划并执行，失败或授权超限明确显示原因。

“图片工作台”入口位于左侧导航顶部快捷操作区，在“新建项目会话”按钮下方独立一行；两个按钮均使用共享Button的primary绿色变体和标准尺寸，各自占满侧栏快捷操作区的可用宽度。底部不重复放置图片入口。点击沿用既有图片工作台打开动作，不自动新建项目会话或图片任务。

IMG-033：使用现有左导航之外的全部右侧空间：主工作台＋最右可收起任务列表（IMG-031／IMG-037）。主工作台输入框上方为三行布局：第一行参考图缩略图带；第二行三列，左列参数／输出要求、中列对话、右列图片查看；第三行成果缩略图带。输入框在三行下方持续可用。第二行第一列、第三列均可隐藏，隐藏后中列扩展；最右任务列表独立存在，不是第二行第三列。参数／输出按钮在输入框工具栏控制左列显隐，左列展开时使用共享 Button 的选中样式；右列图片查看区默认展开，有参考图时默认打开有序参考列表中的第一张；没有参考图时仍保持展开并显示空画布，不因无图片自动关闭。用户手动隐藏后，点击第一行参考图或第三行成果图重新打开右列并选中对应图片；「关闭查看」隐藏整列，不保留占位或「打开查看」按钮。关闭和打开均不改变任务或输入。

IMG-034：图片模型选择保持当前独立入口和布局，不放入参数／输出列，不随该列隐藏。按capabilities.defaultProfileId默认选中配置中的可用模型；有模型即可直接使用，不要求先手动选择。无可用项时在独立入口直接显示“没有可用图片模型”，不展示伪造默认模型或重复要求用户选择。具体默认及失效规则见 [4.1.3](#413-图片接口配置与能力版本)。

参数／输出列允许全部留空交给LLM。常用选项参考主流图片产品的组织方式，包括生成／修改／精确处理、宽高比／尺寸、图片数量、质量、背景／透明度、输出格式及多尺寸预设；仅呈现`capabilities`已支持的项目，枚举与限制读取API，不因热门产品存在某选项就新增协议参数或伪造可用能力。参数分组对照 OpenAI SDK 7.60.0 的 Images 类型（尺寸、质量、数量和背景）及 Google Gen AI SDK 3.6.1 的 ImageConfig 类型（比例和尺寸）。当前 OpenAI 适配器按 capabilities 显示其协议参数，Gemini 当前未公开比例或尺寸协议参数，统一输出宽高与格式仍可由本地处理指定。复用共享表单样式，参数与输出设置通过下一次对话发送生效。

IMG-054：中列对话中的用户消息只展示提示词文字，不内嵌图片、附件缩略图或图片占位；输入框也不重复展示图片附件预览，待发送及当前选中图片统一在第一行参考图栏展示。只有图片而无文字的用户消息不伪造提示词或留下空消息气泡。取消参考后不在对话气泡中恢复展示，旧图片仍可从原图／版本列表找到。此规则仅作用于图片工作台的常规对话投影，不影响其他会话。所属 Pi 原生树及 API 返回继续完整保留图片内容块，展开原始记录仍可检查，不删除、过滤或脱敏 transcript，不改变实际发送给 LLM／供应商的参考快照，不新增模型字段、API 或数据库迁移。

IMG-055：打开或切换图片任务时，对话默认定位到最新消息。停留在底部时随消息更新滚动，向上查看历史时保留当前位置，回到底部后恢复跟随。对话底部在思考、排队、生成、处理及终止等待期间展示当前阶段和进度条。仅当当前执行进入处理且有明确输出总数时，按 API `outputResults` 的 ready 项数／总数显示「成果已就绪」进度；其他活动阶段显示不定进度。任务结束后收起进度条，保留已有结果和错误反馈。图片对话隐藏耗时和 Token 统计，其他会话继续使用既有投影。不新增状态字段、API 或 Pi 调用。

中列对话默认展开用户提交的文字和LLM最终输出；thinking、中间说明、规划JSON、原生custom节点以及旧工具过程默认折叠为可展开过程记录。折叠只改变投影，不过滤、删除或脱敏Pi树；展开仍可查看全部原文及各分支。最终输出依据原生轮次终结及消息身份确定，不按文案猜测、不另存对话；正在运行时以API状态反馈进度，最终消息无正文时不伪造回答。

IMG-035：右列图片查看复用同一个画布组件，右列默认展示第一张参考图，点击成果图可切换到该成果。画布容器随所在列的可用宽高自适应伸缩，撑满可用区域，不以固定px宽高或原图像素决定组件尺寸；图片初次打开保持比例，最大使用原始尺寸（1 个源像素对应 1 个 CSS 像素），超出画布才缩小。工具栏显示相对原图的实际缩放百分比。手动放大超过原始尺寸时按像素渲染，保留像素边缘。容器尺寸变化时更新画布渲染尺寸并考虑设备像素比，不拉伸图片。支持放大／缩小、旋转及矩形局部选择，显示来源、文件名和原始像素。背景可选透明棋盘格、白色、黑色及自定义颜色；背景设置只影响画布预览，不写入图片像素、不修改输出要求，不因切换背景重新请求生成。画布背景对参考图和成果图使用相同规则，图片本身不透明区域保持原样。用户已选定react-konva配套Konva作为画布实现：背景层负责棋盘格／颜色，图片层负责展示及变换，选区层负责矩形选择；容器尺寸由ResizeObserver读取，统一变换矩阵将选区映射回原图坐标。依赖和实现已接入，现场验收待执行。组件治理登记：评估对象为AI Elements Image及react-konva；需要自适应画布、交互变换与局部选区，采用用户明确选择的react-konva作为图片查看区替代位置。官方Image当前能力及版本、依赖兼容性和许可证须在实施前实际核验；若官方组件能完整覆盖上述交互，或Konva兼容性／性能不能满足需求时复核。实施核验：官方 AI Elements Image 接收 base64/mediaType 并显示图片，未提供自适应交互画布。采用 react-konva 19.2.2（React 和 React DOM ^19.2，Konva ^10 兼容）与 Konva 10.9.1，两者为 MIT；工作台使用已安装的 React 19.2.8。替代位置为 web/workspace/images/image-canvas.tsx。旋转和选区仅是本地查看状态，不覆盖原图、不裁切保存、不自动用于修改或发送；区域编辑、遮罩提交和另存旋转结果不在本项范围。跨图片／任务切换重置旋转和选区，取消选区不改变文件，关闭列不取消后台任务。查看成果不自动将其加入参考。

第一行参考图和第三行成果图在有可用图片时必须直接展示实际缩略图预览，不能只显示文件名、图标或点击后才加载的占位入口；隐藏右侧画布不隐藏这两行的缩略图。第一行参考图在首次发送前来源于浏览器 File 预览（IMG-032），受理后先显示当前选中的参考图，随后在同一栏显示未选用的上传原图。SVG 原件和用于处理的 PNG 合并为一张缩略图。参考缩略图右上角的「删除图片」按 IMG-056 删除图片。已选持久参考另有「取消参考」操作；未选用原图标为「未选用」并可再次加入参考。本地 File 移除后从待上传选择中消失。发送后参考选择保留，取消后不从历史自动补回。第一行显示输入图片的缩略图、文件名、尺寸及加载错误。点击缩略图在查看列展示该参考图，查看列关闭时重新展开。上传入口位于对话输入框下方。可直接将一个或多个支持格式的本地图片文件拖入图片工作台，经相同的数量、大小与文件校验添加到当前输入。首次发送前仅保留本地 File，拖入不触发发送。缩略图等比缩小，低分辨率图片按原尺寸显示；第三行成果只投影 API 返回的 ready 产物，预览加载失败显示明确错误及重试入口；未完成／失败显示执行反馈，不用missing占位伪装成已有图片。点击缩略图不触发图片生成或重新执行。

```text
现有左导航 │ 主工作台                                      │ 任务列表
           │ 第一行：参考图缩略图                           │ 标题
           │───────────────────────────────────────────────│ 创建时间 · 状态
           │ 第二行                                        │
           │ 参数／输出（可隐藏）│ 对话 │ 图片查看（可隐藏）│ 标题
           │ 尺寸、格式、质量等  │ 用户 │ 缩放／旋转／选区  │ 创建时间 · 状态
           │                     │ 最终输出／折叠过程      │
           │───────────────────────────────────────────────│
           │ 第三行：成果图 [成果1][成果2]           │
           │ [下载成果] [统一版本选择]                     │
           │ 单图：[下载] [版本]                           │
           │       [删除] [用作参考]                       │
           │───────────────────────────────────────────────│
           │ 「生成」直接出图，「发送」与助手讨论。         │
           │ [图片模型 ▾] [参考图] [参数／输出] [终止][生成][发送]│
```

输入工具栏中，「发送」使用绿色主按钮样式，「生成」使用次要按钮样式。

“新建对话”只开启本地空白输入；首次有效发送或生成才按IMG-032创建持久会话及任务；发送由无工具 LLM 按 IMG-047 返回讨论答复或执行方案，生成则按 IMG-048 跳过 LLM，执行分支校验保存后自动执行。工作台只通过右侧任务列表切换已受理任务；选中任务后可查看其所属 Pi 对话树。一次需求只展示一个任务，其全部图片、尺寸和变体作为该任务的产物列表。原对话总览草稿及 API 路径供既有调用方兼容；选择任务时显示该任务当前方案、最新执行和图片资源，其他任务更新不抢占。IMG-037：移除“对话历史”按钮及其列表、分页、加载、切换状态和专用会话集合查询功能；原按钮位置替换为“收起任务列表／展开任务列表”按钮。任务列表默认展开，可完全收起释放主工作台宽度，再次展开保留当前选择及分页位置；此按钮不缩放图片，图片缩放仍由画布控制。不删除当前任务的完整对话内容或任何历史文件。

参考区保持比例、显示文件名和像素，透明图用棋盘格；多张输入图并列展示。受理后选图、将产物作为参考使用资源ID；受理前选图遵循IMG-032本地File规则，不提前上传。放大查看使用第二行第三列，保留输入。当前执行显示固定输入快照；后续消息只携带当前参考选择，选择变化不改已受理快照，取消项不自动加回，源文件不删除。旧批次文件仍可从既有资源 API 读取。

IMG-031：右侧为纵向任务列表，使用紧凑列表行，不做任务跟踪卡片。每行主标题投影TaskDTO.title，即该任务最后一次用户文字输入；副行显示TaskDTO.createdAt，即任务创建时间，并显示API返回的当前运行状态；状态使用TaskDTO.derivedStage，不从标题、模型回复或客户端等待推断。状态覆盖规划中、排队中、生成中／处理中、已完成、失败；尚无执行时按API事实展示待输入或方案状态，具体派生规则见 [4.2 状态和事务](#42-状态和事务)。长标题只在列表视觉省略，完整原文由API保留；无文字显示“未输入文字”。默认显示全部任务并分页，按创建时间倒序，不因新输入／完成／失败改变顺序。当前选中行高亮，不额外置顶复制；点击切换中间所属任务，后台更新不抢占选择。空列表显示空状态。每任务只显示当前事实，不展示方案或执行历史；标题和时间不从页面本地状态、模型回复或updatedAt推断。任务来源仅为图片工作台。

宽度不足时，展开的任务列表保持右置并可缩窄，用户可用顶部按钮完全收起；第二行左右列通过显隐释放对话空间，页面必要时横向滚动，不将任务列表或图片查看改为隐藏抽屉。按钮统一Button，表单沿用共用样式；组件检索与复用记录见 [2.4 图片工作台组件复核](#24-图片工作台组件复核)。

一次多图需求在右侧只占一条任务列表项；全部ready成果统一在第三行展示并提供下载，第二行第三列负责查看。明确图片操作请求按 IMG-030 执行，讨论仅显示答复，不新增确认卡片。

右列顶部显示标题。标题下方的工具行放置缩放、旋转，以及同排的「选区」「坐标系」，「关闭查看」靠工具行最右侧；背景设置单独占一行，仅包含背景颜色。选用「自定义颜色」时显示取色控件。坐标系默认开启，仅在底部显示指针坐标读数，背景不绘制数字、刻度或线条。预览图片四周绘制淡灰色边界线，随图片缩放和旋转，线宽保持 1 个 CSS 像素，仅用于预览。坐标系开启时，四条边界线延伸至画布边缘，在顶部标注左右边界 X 坐标、左侧标注上下边界 Y 坐标；数值为画布 CSS 像素，不显示其他网格或刻度。原点在画布左上角，X 向右、Y 向下，指针位置使用画布 CSS 像素。图片缩放、旋转或切换时，画布坐标系保持固定。矩形选区的尺寸和位置仍以原图像素显示。坐标系显隐为本地查看状态，不调用写入 API。

### 5.1 图片版本、选择、下载与删除（IMG-049～IMG-053）

成果区只展示生成或处理就绪的成果版本，每个有成果的系列显示一张卡片，默认展示最新可用成果。上传原图在参考图区查看和选用。成果被选用为参考时，也在参考图区显示当前引用。卡片从缩略图开始，实际版本号由版本选择器显示，生成时间在缩略图下方；单张下载和版本选择在第一行，删除和用作参考在第二行，每行最多两个控件，四个控件等宽等高。删除许可读取 API。成果区标题、下载成果、统一版本选择和全选也保持同行，宽度不足时可横向滚动。单图和统一版本选择器右侧均显示下拉箭头。单图版本菜单只显示该系列可用的成果版本号。v0 仅在它是初始生成成果时出现在菜单中。删除按钮仅按成果版本的 API 许可开放。

“下载成果”旁放紧凑的统一版本选择器，宽度以容纳“最新版本”为准，高度与“下载成果”按钮一致，选项为“最新版本”和 v1 至 API maxVersionNumber。选择 vN 时，每张图有该版本则显示它，没有则显示该图最新可用版本，卡片始终标明实际版本号；例如 A最新v5、B最新v3、C最新v1，统一选v4分别显示v4、v3、v1。全局编号中有空洞也按相同缺失规则回退。选择最新则逐图取最新，不强行统一编号。全局选择后允许单图再调整，统一控件显示“自定义”以免声称所有卡片遵循同一选择；再次统一选择覆盖各单图展示选择。查看器同步当前展示版本；展示版本切换不自动添加／取消参考，也不产生执行或持久写入。

点击成果缩略图在查看器中打开对应图片，当前展示项以紧贴图片外缘的绿色框和 aria-current 标示，绿框不覆盖画面。缩略图外圈区域或右上角按钮可单独切换下载选中状态，按钮以 aria-pressed 标示；已选下载项以有间距的蓝色外圈标示，允许多选或使用全选操作。两种状态各自更新，可同时显示。“下载成果”下载选中项各自当前展示的版本，无选择时按钮禁用。单张快捷下载可直接使用。版本切换保留按系列的选中状态，并更新实际待下载资产 ID；下载开始后固定明确 ID 快照，不随随后切换改变。多张按4.2.4打包ZIP，单张快捷入口下载图片文件。

删除确认明确图片、版本及将删除的成果，不默认扩大成整组删除。成功后移除该版本：还有可用版本则显示该图最新版本，没有则移出成果列表并清除勾选／查看选择；原图身份、高水位及其他版本不受影响。统一版本选择按剩余可用版本重算上限。API 已同步移除删除项的参考选择，页面不再显示失效缩略图；清理失败明确显示“版本已删除，文件清理失败”及显式重试，不把逻辑删除成功伪装成文件已清除。取消参考无删除确认，删除成果需确认；两者文案与动作不同。所有新增控件复用 Button 及共用表单样式，不引入原生裸按钮或第二套外观。

组件复用沿用2.4已评估的原生资源投影例外位置：没有新增独立可见组件，版本选择复用共享 settingsSelect，下载／删除／取消参考复用 Button 和 buttonStyles，成果多选复用右上角图标 Button 的按下状态。图片显示仍复用既有 Thumbnail 与 ImageCanvas；官方 Image 不承载业务版本归属、删除或下载许可。

IMG-056：右上角 × 对待上传图片直接移除浏览器 File，并释放预览 URL。对持久图片先确认，再用 IMG-053 的 DELETE 接口删除缩略图对应的资产。上传 SVG 删除原件及同任务专属 PNG 派生文件。正在写入或被讨论、执行、下载占用的图片返回 409。删除事务复用 image_assets、任务 revision、草稿 referenceIds 和 delete_version 回执。现有 SQL 只允许成果写 deleted_at，上传原图及其 SVG 派生项通过既有 cleanup_state 从 none 转到 pending 标记删除，pending／failed／done 均拒绝读取和引用。删除保留原图身份及版本高水位，成果、其他文件和 Pi 原生历史保留。不新增列、表或迁移。DELETE 响应在既有 DTO 增加 deletedAssetIds（包含本次删除的原件与派生项 ID），cleanup.state 汇总全部文件的清理结果。逻辑删除后可显式重试失败的清理。

## 6. 验收与记录

| 需求 ID | 验收条件与状态 |
| --- | --- |
| IMG-056 | 参考图右上角 × 删除已保存图片及其专属派生文件，删除后从列表和草稿同步移除，内容返回 410，之前生成的版本仍可读取；取消参考仍可单独使用。状态：`tests/image-workbench-api.test.cjs` 两项定向 API 验证通过，覆盖原图与派生文件删除、草稿同步、已有成果保留及清理重试；浏览器待验 |
| IMG-055 | 打开或切换任务定位最新消息，停留底部随更新滚动，向上查看历史时不抢占滚动位置；活动阶段有进度条，只有已知的成果就绪数量显示确定进度；图片对话隐藏耗时与 Token 统计。状态：代码接入，浏览器待验 |
| IMG-054 | 图片工作台用户消息仅显示文字，图片及附件预览统一放参考图栏，不在对话气泡或输入框重复展示；纯图片消息不显示空气泡。首次本地选图、发送后、任务切换及历史恢复遵循同一投影，取消参考不删原图／版本；Pi原生树、API及LLM实际图片输入完整保留，其他会话不受影响。状态：代码已接入，类型及差异检查通过，浏览器验收待执行 |
| IMG-049 | 三个场景均按原图归属＋版本号保留中间成果；多次上传追加系列，旧版本修改追加最大号，无父子／分支关系；输出归属不明确时拒绝而非猜测；部分成功仅保留 ready 版本，替换当前执行后仍可读取历史图片版本。状态：代码已接入，受控 API 验证通过，本地库已升级，浏览器待验 |
| IMG-050 | 逐版本保存不可变生成／上传时间，历史不明时间显示未知；默认展示各图最新版本；单图可切版本，统一选择为最新及v1至最大可用版本号，缺失版本回退该图最新并显示实际号；浏览器刷新后从服务端版本事实恢复默认最新。状态：代码已接入，API 验证通过，浏览器待验 |
| IMG-051 | 当前参考与上传／版本历史分离；取消仅解除引用，不删原图／版本／文件，发送、生成、刷新后不自动加回；可重新添加，执行快照不被取消改写，多次上传不受累计四图限制但当前选中最多四图。状态：代码已接入，API 验证通过，浏览器待验 |
| IMG-052 | 单张快捷下载及勾选单／多张下载均使用各图当前展示版本；统一版本切换后下载一致；多选ZIP明确ID且全项校验，跨任务／已删除／缺失文件返回明确错误，下载不触发生成。状态：代码已接入，API 验证通过，浏览器待验 |
| IMG-053 | 成果删除需确认图片及版本，只删当前展示版本；其他版本及原图保留，删除后回退最新或移出空系列，编号不复用；参考同步取消、占用中拒绝、幂等删除及文件清除失败可显式重试，Pi原生历史原样保留。状态：代码已接入，API 验证通过，浏览器待验 |
| IMG-048 | 「发送」由 LLM 讨论并决定是否执行；「生成」依据当前提示词、参数／输出、参考图直接执行，零 LLM prompt，原始用户输入保留 Pi 树。校验首次及后续生成、幂等与模式冲突、process、默认输出及明确参数不被改写。状态：代码已接入，直接生成、process、原文及原生历史、幂等与模式冲突通过受控 API 验证，浏览器及真实供应商待验 |
| IMG-047 | 对话默认可解释、比较及澄清，讨论不保存方案、不请求图片、不处理输出；仅明确图片操作意图进入执行分支。结构化 reply 直接可读，完整原文可展开。验证讨论前后方案及执行不变、零供应商调用、讨论后可执行与执行后继续讨论、非法混合响应零执行。状态：代码已接入，讨论／执行分流及零输出副作用经受控 API 验证，真实模型判断和浏览器待验 |
| IMG-046 | 用户通过连续对话生成和修改图片，不操作方案或保存草稿。当前参考保留、自动继承及取消行为已由 IMG-051 取代（已接入，浏览器待验），不允许自动补回取消项；回复可读，执行进度及失败明确。验证接口自动上下文、显式引用优先、输入上限及零隐式重试。状态：代码已接入，连续生成／修改及显式引用优先通过受控 API 验证，浏览器和真实供应商待验 |
| IMG-044 | 第一行标题显示「参考图」及实际缩略图；展示集合与排序由 IMG-051 当前参考选择取代，上传历史移至原图／版本列表。首发前的本地图片按添加顺序显示。状态：代码已接入，浏览器待验 |
| IMG-045 | 「选区」「坐标系」「关闭查看」同排放在缩放、旋转所在的工具行，「关闭查看」靠最右侧，背景设置独立一行。背景不显示坐标数字或线条，指针读数显示画布坐标，空画布亦可读取。换图、缩放和旋转不改变画布坐标系，选区保留原图坐标。状态：代码已接入，浏览器待验 |
| IMG-041 | 第一行展示用户输入图片及加载反馈，点击缩略图打开查看，不提供其他操作按钮。上传入口保留在输入框下方，工作台移除资源目录与导入入口。状态：代码已接入，浏览器待验 |
| IMG-042 | 可将 PNG、JPEG、WebP 或 SVG 拖入图片工作台（含输入框），也可在输入框粘贴剪贴板中的图片文件。三种入口（选择文件、拖入、粘贴）共用数量、格式和大小校验，成功后在参考图栏显示缩略图，不自动发送。纯文字粘贴和文本拖放沿用浏览器行为。状态：代码已接入，浏览器待验 |
| IMG-043 | 参数／输出展开时按钮显示共享选中样式，收起时恢复。状态：代码已接入，浏览器待验 |
| IMG-038 | 移除工作台对话总览模式，页面只进入本地新对话或已选任务；选择任务后仍可查看所属 Pi 树并继续对话。状态：代码已接入，浏览器待验 |
| IMG-039 | 参考缩略图可预览且按资产去重；当前参考集合、同任务归属及发送后保留规则由 IMG-051 取代，历史上传不自动加回。状态：任务详情、SSE 与预览内容 API 已验证，浏览器待验 |
| IMG-040 | 第二行预览默认按原尺寸显示小图，大图按比例缩入画布；依次打开 16～256 px 九张成果图时不会自动拉伸到同一尺寸。手动放大保留像素边缘，工具栏显示实际缩放比例。状态：代码已接入，浏览器待验 |

下列为修正后的验收目标；单任务多图边界及接口调整已实现并通过受控 API 验证，页面效果和真实供应商能力仍待实际验收。仅按项目规范新增／运行对应API接口测试，临时数据库、临时images和受控Pi／供应商；不操作用户库或启停服务，不常规运行组件／源码断言测试。真实图片API和浏览器验收另行明确执行。

| ID | 必须满足的验收 |
| --- | --- |
| IMG-001 | 仅图片导航入口；普通Session无图片入口；讨论采用配置默认模型，模型不可用明确失败 |
| IMG-002 | 一对话独占Pi原生身份，一个任务的多张图片共享讨论历史，不按图复制任务或消息；冷恢复全树原文，损坏不换身份，不挂载bash及任意读写工具 |
| IMG-003 | 手动方案及显式仅规划缺确认时零图片调用，普通发送的单次授权见IMG-029；改方案拒绝旧确认；同方案普通确认多次点击／不同幂等键最多一个首次执行；只有用户restart可建立后继，跳过仅本次生效 |
| IMG-004 | 一次图片需求只建一个任务；多张图片、变体及多尺寸由同任务完整方案描述，按IMG-029普通发送直接执行；IMG-030由服务端提供上下文、无工具LLM返回方案，应用校验保存后执行；缺必要参考不可执行，不能复用已失效输入 |
| IMG-005 | 所有事实SQL持久；客户端断开不取消当前正常运行；进程重启后旧queued／running／processing均failed，零自动派发／续跑；新受理才启动工作 |
| IMG-006 | 终止按 IMG-036 执行，成果版本显式删除按 IMG-053（已接入，本地库已升级，浏览器待验）；供应商503、超时、下载失败、Pi错误后无隐式重试；刷新／SSE／重启不增加请求数，只有用户显式restart产生新请求 |
| IMG-007 | GPT／Gemini受控适配分别验证生成与参考图修改、参数拒绝、能力版本变化和认证缺失，不偷偷换供应商 |
| IMG-008 | 文件均归images/taskId；跨任务可引用不可变资源；拒绝路径越界／符号链接／SVG外链；原图与失败部分产物不自动清理 |
| IMG-009 | 单母图输出九个精确尺寸PNG及正确命名、比例和透明补边；成功必须九图ready，保存失败保留真实阶段 |
| IMG-010 | 页面负责发起／订阅／用户重拾，服务器对有效订阅推送初始及变化状态；任务栏active/all及分页、当前选中、当前方案和最新执行忠实投影，无业务轮询或隐式任务取消 |
| IMG-011 | 同时编辑版本冲突；当前固定槽回执可按原If-Match幂等重放，不重复执行；回执被替换后不保存历史，旧草稿版本／方案hash／源执行ID继续拒绝旧请求；进程中断记失败不补成功 |
| IMG-012 | A／B任务及对话总览各有独立持久草稿；切换、保存失败、多客户端冲突、发送清空和迟到结果不串输入／参考图 |
| IMG-013 | 讨论失败保留原始输入和树；页面重新开始产生新command且skip=false，不覆盖新草稿，不自动续旧轮；历史损坏明确报错，可由用户新建对话 |
| IMG-014 | 同对话通知与prompt串行；通知错误／中断直接failed，不补发、不核对补delivered；页面仍显示SQL产物，不因通知失败重新生成 |
| IMG-015 | skip限额随当前命令存储。超调用数／母图数／输出数时保留有效方案并停止自动执行。缺必要信息或LLM改写硬约束则规划失败 |
| IMG-016 | 不建图片外键／关联表，服务端事务校验归属；staging可缺元信息而ready不可；failed必填finished_at，外部不明保留provider_outcome=unknown；同执行ID的失败不改成功，新执行覆盖旧状态 |
| IMG-017 | GPT／Gemini仅标识图片接口协议，modelId独立配置且无固定型号白名单；自定义modelId按协议原样传递，协议及版本决定参数映射。图片配置复用models.json与Pi原生模型／地址／认证解析，不再读取独立图片配置；本地整份优先全局，损坏配置／认证方式不符明确不可用，图片协议条目从讨论目录排除；process无图片profile仍可用；配置改变不让queued执行偷偷切模型 |
| IMG-018 | Pi已结束但受理SQL未提交就中断：命令failed、旧skip不执行；已提交但未结束的执行也failed；无论文件是否完整，重启均不自动发起／补成功 |
| IMG-019 | 当前方案替换A→B→A时不保留旧版本，旧taskRevision确认拒绝；无历史选择接口，当前已执行方案不能普通确认重做，失败后用户restart生成新批次并覆盖状态 |
| IMG-020 | 封存前后／rename后但ready提交前中断均保留残留、旧staging记missing，不扫描补ready或补执行成功；用户重新开始使用新asset／目录，不覆盖旧文件 |
| IMG-021 | API完整传递inputs的用途／顺序，process源图与sourceIndex对应；输出键缺失、重复、计划外键、尺寸／格式错误均不能completed，九尺寸逐项对应正确文件 |
| IMG-022 | DTO及推送投影失败、输入快照、部分产物与notification.failed；不提供inspect／acknowledge；用户restart返回明确后继身份，旧执行被覆盖后404，旧资源继续查看 |
| IMG-023 | 用户restart允许同要求／同plan，不自动改参数；新execution ID覆盖旧failed状态，文件独立；紧接的同源双击返回当前后继，更早的源ID不可复用 |
| IMG-024 | 外部结果不明仍显示本地failed及未知副作用；restart需用户明确接受可能再次生成／计费，不后台查询或等待解除门禁；源未失败、任务忙、参数版本冲突拒绝 |
| IMG-036 | 发送旁增加终止任务按钮，按API许可终止当前规划／排队／生成／处理；精确目标、控制门禁、Pi及供应商abort、实际settled及竞态见 [4.2.2](#422-失败重启和重新开始)。验收：排队零派发、规划迟到结果不保存／不执行、生成终止外部不明为unknown、本地停止保留ready及文件、无活动禁用、重复请求不终止后续任务、完成竞态不覆盖成功、控制失败不伪造终止、不自动重试。持久终态沿用failed＋IMAGE_TASK_INTERRUPTED，无Schema迁移。状态为代码接入，定向 API 验证通过，真实浏览器和供应商待验 |
| IMG-037 | 任务列表默认展开且可完全收起，原对话历史按钮替换为列表展开／收起按钮；移除对话历史入口、列表、分页加载／切换及专用会话集合查询，保留任务导航和当前任务全树，不删数据。验收：收起释放宽度、展开保留选择／分页位置，图片缩放独立；源码／入口／历史集合路由退役，任务详情及完整Pi历史可读，切换显隐不停止任务。状态为代码接入，旧集合路由404及任务路由经定向 API 验证，列表显隐的浏览器待验 |
| IMG-035 | 用户选定react-konva＋Konva，图片查看区使用复用画布组件，容器按可用宽高自适应，不固定px尺寸；图片保持比例适配，支持缩放／旋转／矩形选区。预览背景支持透明棋盘格、白、黑及自定义颜色。验收：参考／成果共用画布，查看区默认展开并打开第一张参考图，无图也保持空画布展开；参考区及成果区有图片时必须直接显示实际缩略图，隐藏查看列不影响两行预览，加载失败显式报错且可重试；调整窗口或列显隐后尺寸适配、不拉伸，设备像素比及选区坐标正确；背景切换不改变原图、不修改导出规格、不触发生成或写入；原图不透明区域不被背景覆盖。实施前核验依赖兼容性、许可证及04组件治理记录。状态为已核验并安装依赖，画布已接入，浏览器待验 |
| IMG-034 | 图片模型选择为独立入口，保持现有位置，不属于参数／输出列；有可用配置时API默认选中一个，优先显式默认否则配置顺序首个可用项；无可用模型直接提示“没有可用图片模型”。验收：单／多模型无需手动先选；用户有效选择保留；参数列显隐不影响模型入口；未配置／全部不可用时默认null且提示明确；讨论模型不被切换，运行中不更换已固定模型。状态为代码接入，默认模型与不可用配置通过定向 API 验证，浏览器待验 |
| IMG-033 | 主工作台输入框上方三行：参考图；参数／输出（可隐藏）＋对话＋图片查看（可隐藏）三列；成果区。输入框参数／输出按钮控制左列，点击成果打开右列；右列支持缩放、旋转（“选软”暂按旋转理解）、矩形局部选择。对话默认展开用户文字及LLM最终输出，用户图片统一在参考图栏展示（IMG-054），其他过程折叠可展开，完整Pi原文和分支保留。常用参数组织参考主流图片产品，但选项只来自已支持API；右侧任务列表独立于图片查看列。验收：三行三列及双侧显隐、参考／成果共用查看器、未发送选图无服务端写入、局部选择／旋转不改图不自动提交、用户及最终回复展开／过程可查看、ready成果展示及下载、显隐及查看不取消任务；常用选项评估在实施前记录。状态为代码接入，浏览器待验 |
| IMG-032 | 打开图片工作台默认进入本地空白新会话，可直接输入、选图和设置可选参数；首次发送前不创建数据库对象、Pi身份／文件或服务端上传文件。首次发送才受理创建对话和任务并进入IMG-030流程；重复发送不重复创建；未发送离开／刷新不产生服务端垃圾数据。验收：只打开、输入、选图、切换或关闭时数据库与服务端文件无新增；空提交不创建；首次有效发送创建一个对话及一个任务，网络重复提交幂等；受理前校验失败无新增，受理后的失败按契约保留可见记录。状态为代码接入，首次受理、拒绝和重复提交通过定向 API 验证，浏览器本地操作待验 |
| IMG-031 | 右侧为任务列表：每行标题为该任务最后一次非空用户文字输入，副行显示固定创建时间及当前运行状态（规划／排队／生成或处理／完成／失败，来源及优先级见 [4.2](#42-状态和事务)）；默认all、创建时间倒序分页，选中高亮不另置顶，点击切换中间任务。模型、API及页面分别见 [第3节](#3-数据模型)、[第4节](#4-api-契约) 和 [第5节](#5-页面投影)。验收：多轮文字更新标题而createdAt不变；纯图片输入不覆盖已有文字；多任务不串标题；无关联文字使用空值占位；无LLM摘要或SQL标题副本；列表／详情／SSE标题、时间和运行状态一致；状态随规划及执行变化推送，不从模型文字推断，不新增持久状态；原生读取失败显式报错；不增加表或执行迁移。状态为代码接入，标题、固定创建时间、分页及SSE通过定向 API 验证，浏览器待验 |
| IMG-030 | 用户输入＋参考图＋可选参数→服务端组装完整规划上下文→无工具LLM返回唯一结构化方案→应用校验并保存→后台生成／修改／精确处理→展示图片及结果。取消read_image_task、prepare_image_plan及其他工具注册；复用当前Pi身份和三表，不迁移历史。验收：实际Pi规划无工具；完整上下文含模型能力及用户约束而无凭据；参数留空可生成完整方案，显式值不被覆盖；不传二次确认选项即可产出；无效JSON／字段／输入映射返回IMAGE_PLAN_INVALID且旧方案不变、零执行／零新输出资源；重复消费不重复执行；断线不取消，失败不自动重试；旧Pi工具历史及文件保留。状态为代码接入，受控实际Pi及定向 API 验证通过，真实供应商与浏览器待验 |
| IMG-029 | 普通发送默认LLM补齐参数及完整输出并直接执行，不二次确认；页面移除直接执行／仅规划开关和限额控件，用户只选择提前设置参数输出或留空由LLM决定，发送仅draftId。底层显式skipConfirmation=false只保留既有API兼容，不作为页面功能。缺省单次授权范围1请求／10母图／32输出。原工具实现曾声明完整plan schema，现由IMG-030的结构化响应契约取代，preserve字符串、outputSpec及inputs类型明确。验收：不传确认参数的消息完成9个ready输出、无二次confirm；显式false仍不执行；真实Pi装配含完整工具schema。状态：tests/image-workbench-api.test.cjs 30项通过，类型及差异检查通过；真实LLM与浏览器待验 |
| IMG-028 | 确认方式由IMG-029取代为默认直接执行。参数与完整输出前置规划：用户可省略参数／尺寸／格式／文件名，LLM读取planning能力并自行补齐，合法默认由服务端解析；用户硬约束优先。原图多尺寸导出默认process，仅明确AI改画才edit；确认后按冻结方案执行，不在执行中向用户补参或补输出。保持供应商错误、失效输入和配置变更的显式失败及无自动重试。验收：受控讨论工具读到可用模型参数schema／默认值／限制和操作规则，不泄露凭据；完整九尺寸process方案可保存并执行且供应商调用为0。状态：实现完成，tests/image-workbench-api.test.cjs 29项通过，类型及差异检查通过；工具读取规划能力与9尺寸process零供应商调用均由受控API验证，未调用真实模型；真实LLM与浏览器待验 |
| IMG-027 | 整改为image_conversations、image_tasks、image_assets三表；无图片FK及关联表；任务仅当前plan／execution，无方案／执行历史数组；图片版本由 IMG-049 在资源表扩展（已接入，本地库已升级），最新讨论及固定槽回执覆盖，旧ID404；事务验证归属、活动执行冻结方案、旧确认拒绝；旧资源及Pi历史保留。状态：代码已整改，29项受控API测试通过，类型检查通过；真实供应商和浏览器待验 |
| IMG-026 | 显式升级仅从兼容通用7表新增当前3表至10表，完整备份与摘要／原行保留／事务回滚／活连接门禁见 [3.4 历史数据与显式升级](#34-历史数据与显式升级img-026)；用户释放连接后已正式执行并核验为current，原记录保留，详见下方完成记录 |
| IMG-025 | 同任务零订阅、单页及多页订阅下执行结果与Pi句柄策略一致；建立有效订阅立即取得当前状态，断开／切换／背压只清理对应传输连接，不触发取消或重拾；服务器业务不维护订阅者身份／在线状态／计数 |

开发交接依次核对需求 ID、表与约束及迁移映射、API 与事务、Pi 与基础设施归属、页面投影和定向接口验收。建表目标需提供完整DDL及迁移预检供审查；历史库迁移由用户另行决定，不在应用启动中自动执行。

仍需在开发环境核实的是具体供应商模型的真实能力、Pi禁止隐式重发路径和组件适配结果；这些属于实现验证，不允许开发者因此自行改变上述用户行为。生产凭据及准确modelId由部署提供，缺配置明确不可用，不为填满文档虚构可用配置。

### 6.1 实际验证与迁移记录

IMG-049 本地版本升级已完成：用户明确要求“数据库未升级，升级一下”，授权前述保守独立系列映射。新增 `scripts/upgrade-image-versions.cjs`，先在数据库副本演练，验证原列逐值保留、目标结构及再次执行只读返回 current；正式执行前与事务提交前均核对无其他打开连接。计划摘要 `f9fd9d6d7aacc54a41bd8c4afc702ac0a9c8eacbe9b0b2f0f6642953a8e0d327`，完成时间 `2026-11-19T07:20:09.984Z`。完整备份位于 `.data/ai-workspace-v5.sqlite.image-version-upgrade-16e9dc4d-5672-406d-8bf8-ce2586293782/before.sqlite`，权限0400，SHA256=`e42576828018b0458d1c08a19131a6a3d9db59740cea96e3c966dc05580797af`，独立重读与 manifest 核验一致；同目录保存 manifest.json 和 result.json。原10张表的原列全行摘要保持一致，保留69条图片资源、2个图片对话、2个图片任务、4个助手、6个项目、10个独立会话、2个工作区、14条成员关系、8个工作区会话，MCP为0。6张上传原图及9张历史成果映射为各自v0，ready_at保持null；其他54条资源原样保留。正式执行后只读计划返回current，integrity_check=ok、foreign_key_check=0；未改图片文件或Pi历史，未启停用户服务。该授权仅覆盖本次映射与结构，未来迁移仍须另行授权。

IMG-054 已修改 web/workspace/conversation/project-session/conversation.tsx：图片工作台持久及实时用户消息只渲染文字、无正文时不显示空气泡，附件不重复预览，原始节点及实时事件仍可展开检查；其他会话沿用原显示规则。输入框既有实现没有独立图片预览，参考图栏保留。npm run typecheck 与 git diff --check 通过；本次无 API 契约变化，未新增／运行测试，无数据库迁移，浏览器待验。

IMG-049～IMG-053 代码对齐记录：图片版本列、原图归组、完成时间、高水位及逻辑删除写入三表实现；当前参考来自持久草稿，空数组不自动继承；发送与生成保留参考选择，上传追加原图系列。服务端提供版本 DTO、分别修改／共同参考、指定版本 ZIP 下载、删除及清理重试。页面接入单图／统一版本选择、实际版本和时间、多选下载、删除及取消参考。`tests/image-workbench-api.test.cjs` 41项通过，使用临时数据库／受控供应商及 Pi；覆盖多图分别修改、旧版本追加、取消后讨论零引用、多选ZIP、删除占用／幂等／清理失败重试、编号不复用、部分失败保留版本及旧结构拒绝写入。类型和差异检查通过；未运行生产构建、浏览器或真实供应商验收，未迁移用户库。只读预检 `/tmp/image-version-preflight.json`：现库69条资源，缺少7个新增列；保守映射候选为6张上传原图与9张历史成果，各自独立系列，不推测历史关系。其余54条内部或非ready资源保留，不冒充可见版本。用户随后授权按该映射升级，本地执行及复核结果见以下记录。以下既有测试与迁移记录仅证明当时已实现的契约。此前“无版本”结论仅保留当前方案／执行无历史的边界，图片成果版本由3.1.1取代；IMG-038～IMG-044 的全上传参考展示及 IMG-046 的自动引用规则由 IMG-051 取代。

IMG-048 验证记录：`tests/image-workbench-api.test.cjs` 38 项通过。新场景通过真实 Pi SessionManager 记录直接生成输入及结果，在聊天配置不可用时零 AgentSession／prompt，核对供应商提示词原文、默认 PNG 1024 输出、并发同键复用与跨模式冲突、随后直接 process 输出九尺寸；类型及差异检查通过。仅临时数据库与受控供应商，浏览器和真实图片供应商待验。

IMG-047 验证记录：`tests/image-workbench-api.test.cjs` 37 项通过。新增讨论→执行→追问场景，讨论零供应商调用、不保存方案、保留已有方案／执行／资产及 task revision；非法 action、空 reply、讨论夹带 plan、执行缺 plan 均失败且零新执行。类型及差异检查通过，使用临时库和受控 Runtime；真实模型意图判断与浏览器待验。

IMG-046 验证记录：`tests/image-workbench-api.test.cjs` 36 项通过。新增接口场景连续三轮：生成标志、仅发文字改色自动引用当前母图、上传新图覆盖默认参考；同一任务自动执行，无二次确认，多轮无额外供应商调用。类型检查与差异检查通过。使用临时数据库与受控供应商／Pi，真实供应商和浏览器待验。

IMG-044 热更新修正：`tests/image-workbench-api.test.cjs` 35 项通过，新增 HTTP 验证旧缓存实例缺少 referenceAssets 时，模块更新后同一实例返回参考图和 createdAt，且不重新启动工作器。页面兼容旧快照缺少 referenceAssets 的情况，读取已有资产中的上传原图。类型及差异检查通过，用户现场显示仍待复核。

IMG-044 时间排序修正：`tests/image-workbench-api.test.cjs` 35 项通过，补充验证追加上传后旧图保留、参考列表按 createdAt／ID 升序；类型检查及差异检查通过。仅临时库与受控 Runtime，浏览器待验。

IMG-045 布局修正验证。画布 TSX 的 SWC 语法检查及 `git diff --check` 通过。浏览器中的背景坐标系与工具栏行布局待验。

IMG-044～IMG-045 验证记录。类型检查、图片工作台和画布的 TSX 语法检查、`git diff --check` 通过。复用原参考图片 URL 和原图变换；浏览器中的缩略图、窄栏布局、取色与坐标对齐待验。

IMG-041～IMG-043 验证记录。图片工作台 TSX 的 SWC 语法检查和 `git diff --check` 通过。本轮复用既有上传与提交接口，浏览器拖放、只读缩略图及按钮选中态待验。

IMG-038～IMG-040 验证记录。`node --test tests/image-workbench-api.test.cjs` 的 35 项通过，覆盖首次发送后任务详情与 SSE 返回一致的参考资产、预览 URL 返回 PNG、跨任务引用及当前方案回退。类型检查与差异检查通过。浏览器中的入口、首行缩略图和画布缩放比例待验。

IMG-030～IMG-037 验证记录。运行 `node --test tests/image-workbench-api.test.cjs`，35项通过。使用临时 SQLite、临时资源目录和受控 Pi／供应商。覆盖实际 Pi 无工具请求、冷恢复及原生终止、单一方案校验和九尺寸自动执行、非法方案零输出资源、首次 multipart 的受理前验证与并发去重、任务标题与创建时间在列表、详情及SSE中的一致性、默认图片模型和不可用回退、退役对话集合路由、排队／规划／供应商生成／本地处理终止及部分产物保留。`npm run typecheck` 和 `git diff --check` 通过。真实供应商和浏览器验收待执行。未执行生产构建、迁移或用户库写入。

IMG-027整改验证及残留复核：实际运行 `node --test tests/image-workbench-api.test.cjs`，29项通过；`npx tsc --noEmit`及`git diff --check`通过。使用临时内存数据库、临时图片目录与受控Pi／HTTP；验证实际仅3张图片表且均无FK、当前方案替换及旧确认拒绝、无历史字段／分页／选回接口、重新开始覆盖旧执行且旧ID404、最新讨论覆盖旧命令且无commands历史数组、运行和通知期间禁止覆盖而草稿可编辑、旧资源继续下载、多图同任务、精确9尺寸、SVG及导入、幂等与并发、SSE断线／重连不触发执行、启动中断不续跑、Pi身份／工具及无隐式重发、共用models.json和自定义协议modelId；补充验证启动不改已终态执行的JSON／revision、草稿聚合SSE异常隔离及排队刷新后取消、URL大小写／默认端口规范化、通知未结束的终态不出现在active列表、迟到旧工具调用不恢复被替换方案。热更新服务缓存改为三表代际标识；后续修复将globalThis缓存改为按配置根定位的Node process共享注册表，避免Next另一个global重载时启动清理误置活动讨论PROCESS_INTERRUPTED、工具随后报“工具命令上下文无效”。真实运行仍出现误中断后继续修复：确认请求创建于当前Node进程启动后，Next隔离process对象使缓存仍不可靠。清理改为Node原生performance.timeOrigin边界，只终结created_at严格早于进程启动的记录；不依赖缓存命中。application API回归使用临时库及受控Runtime，同时隔离global及process对象重载装配，验证当前命令仍running、随后工具成功保存9尺寸方案且不调用供应商；另验证当前processing执行／资源及writing通知在重复start后逐字不变，旧进程遗留记录仍按显式模拟启动边界结束。仍在真实链路复现后，以临时启动诊断确认Next另有短命进程导入路由：该进程起始时间晚于服务进程当前请求，单靠时间边界依然会误清理。最终改为getImageWorkbench在实际HTTP Handler内惰性初始化；bootstrap及route模块导入不创建服务、不执行清理。临时诊断代码已移除。回归直接加载实际route及bootstrap：验证导入时start调用为0，实际GET后初始化，运行讨论期间另一个隔离上下文只导入路由不清理，实际GET再初始化也保留当前讨论，随后提交9尺寸方案成功。29项图片API测试、类型及差异检查通过；真实上游重试尚待验证。未改写用户失败记录或自动重发。旧表／历史查询可执行引用审计无残留。

IMG-027供应商错误复核：真实用户方案已保存为edit，执行证据记录HTTP 502，未返回母图；不将其归因于上下文中断或断言为模型不支持。修复原先所有非2xx一律明确拒绝的错误：408及5xx按IMAGE_PROVIDER_UNCERTAIN／unknown，明确4xx按IMAGE_PROVIDER_REJECTED／failure，均保留HTTP状态证据，ExecutionDTO.error.message投影HTTP状态。原有失败记录不回写，且不自动重试。实际运行tests/image-workbench-api.test.cjs，29项通过，扩充受控502／503／408／400接口验证，覆盖分类、HTTP状态显示和单次请求；类型与差异检查通过。未向真实供应商再发请求；真实502的上游原因因旧实现未保留响应正文而尚不能确认。

IMG-026操作演练：仅在临时7表数据库使用显式升级CLI，保留一条种子Project，核验备份manifest／result、原记录保留、10表目标、integrity_check=ok、foreign_key_check=0及重复执行只读current；没有新增或运行非API测试文件。此前用户库只读预检为7表→10表且结构和数据完整，曾因服务连接阻挡而暂缓；用户释放连接后的正式执行以下段完成记录为准。真实供应商、浏览器和生产构建未执行。

IMG-026正式升级完成：用户明确通知占用已退出后，升级脚本确认无其他打开连接，按planSha256=a7002d6a9e3aa9779356a05f8f6fb00db647351febc36448058722b711f092c7执行，来源全行／结构摘要63c7afc5b9d73174cc2b61ab123a0a28fe5fd99d73ec1d254646ba86557d625a。完整只读备份位于.data/ai-workspace-v5.sqlite.image-upgrade-534e1d55-bad1-458e-9f51-4cab3fe6e1d9/，before.sqlite的SHA256=8e2de0e9726f871d1d05deca3866e73fb7175785f7d0ce21a757fadda146246c、权限0400，重新读取核验与manifest一致，result.json记录提交结果。原文件事务新增3张图片表及配套索引／自身约束，原7表结构及全行摘要一致；保留6个Project、4个Agent、10个独立Session、2个Workspace、14条成员关系、7个Workspace Session，MCP为0。再次只读预检current、目标10表，3张图片表均0行且FK为0，integrity_check=ok、foreign_key_check=0。没有启停服务、调用Pi或真实模型，没有修改配置、原生会话或图片文件。此次授权只覆盖本次目标，后续迁移需另行授权。
