# 图片工作台设计

状态：第一版目标设计，未实施。本次只补全文档，不改代码、不建表、不迁移用户数据库、不启停服务、不调用真实模型。本文件是独立设计入口；实施时按项目契约将对应章节分别落到01架构、02模型、03 API、04投影、05验收，并改为引用，不能保留两套完整权威契约。以下新增字段、表和路径是目标设计，不表示现有系统已经具备。

## 1. 第一版确定范围

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
| 取消 | 不提供用户取消，服务端不接受取消已受理执行 |
| 清理 | 不自动清理任务、历史、原图、失败残留或产物；显式删除不属于第一版范围，不将“不自动清理”等同于用户永久禁止删除 |
| 失败与重新开始 | 失败即结束并保留记录；页面提供用户主动“重新开始”。服务器不自动重试、重拾、续跑或补成功；Pi及供应商SDK隐式重试关闭 |
| 通用性 | 支持生成、参考图修改与精确输出；网站Logo九尺寸是首个输出预设，不是唯一功能 |

失败策略以用户最新决定为准：失败即结束，页面允许用户明确重新开始，服务器不自行重拾。用户可以保留相同要求和方案，通过专用重新开始API建立新命令／执行、ID和文件目录；旧记录始终保留failed，不改回queued或completed。普通确认、幂等重放、刷新、重连、进程重启和LLM工具调用不能触发重新开始。自动压缩只管理当前正常讨论上下文，不能续发失败请求。

首个验收实例：提供一张Logo，输出16、20、24、32、40、48、64、128、256像素正方形PNG，逻辑文件名为logo-{尺寸}.png。public/images/icons/是用户举出的使用目标；第一版实际保存在images/<taskId>/下，下载后由用户使用，不自动修改任何项目public目录。

## 2. 架构与Pi归属

### 2.1 服务职责与代码边界

```text
图片工作台
    │ HTTP意图／SSE快照
    ▼
服务器图片控制器（application）
    ├─ SQLite：对话索引、草稿、任务、方案、授权、执行与资源关系
    ├─ Pi适配：默认模型讨论、结构化方案工具、原生树读取
    ├─ 图片工作器：数据库取队列，不依赖浏览器／讨论句柄
    │    ├─ OpenAI官方图片适配器
    │    ├─ Google Gemini官方图片适配器
    │    └─ 精确尺寸／格式处理
    └─ 资源存储：images/<taskId>/...
```

page.tsx／route.ts只装配；业务在src/application及其ports，SQL在src/infrastructure/database，Pi SDK在src/infrastructure/pi，图片供应商与文件处理在独立infrastructure适配器。bootstrap统一注入。沿用现有单长驻Node进程＋SQLite部署，不承诺无状态函数或多副本部署。

图片API只从控制器授权后的工作器调用，不能由Pi工具直接生成、由浏览器直连供应商或通过bash调用。图片工作器用独立生命周期，不绑定Request.signal、SSE连接或AgentSession.dispose。

当前核实基线为Pi 1.5.0：支持AgentSession、SessionManager、自定义工具及generateImages抽象，已核实的内置图片适配是openrouter-images；不能把它当作GPT／Gemini官方直连。第一版在infrastructure中接官方API，Pi继续是唯一讨论Runtime，不引入另一套Agent框架。适配器和工作器负责执行，不使用codemode脚本承载任务队列。

### 2.2 图片对话对应一个独立Pi Session

- 一个图片对话独占一个Pi Session Tree，多任务共享这棵讨论树，不为每个任务另建Pi Session。
- cwd固定为applicationConfigRoot/images，不从项目、客户端参数或某个任务目录推导。
- Session文件目录固定为applicationConfigRoot/.data/image-sessions/<conversationId>/，首次分配后保存精确nativeRef（kind、sessionFile、sessionId、cwd），之后只按该身份恢复，文件损坏或缺失报错，不伪造空历史或替换身份。
- 数据库保存索引和恢复身份，不建立user／assistant消息表。树包含所有分支、thinking、工具输入和结果原文，不另存摘要对话。SQL中为幂等保留的命令输入仅用于受理核对，不能用作模型历史或页面消息来源。
- 每次空闲prompt前按01既有应用配置根和文件优先规则解析当前默认模型，固定本轮快照；无默认模型或认证时报MODEL_UNAVAILABLE，不任取模型。默认变化在下一轮通过Pi原生模型切换生效，历史选择保留原生记录；不写SQL模型副本、不改全局默认。
- 仅挂载固定图片业务工具：读取当前任务事实、准备结构化方案、提出新任务。不挂载bash、任意文件read／write／edit、工具搜索、MCP或项目扩展发现。参考图由服务端按资源身份提供，不能由模型传入宿主路径。
- 自定义工具只调用application，控制器校验同一对话／任务归属、输入版本和命令上下文。LLM不能自行确认，也不能设置用户授权标志。跳过确认授权来自本次用户命令，控制器校验后执行，不以模型声称“已同意”为依据。
- 原始用户文本经Pi prompt，参考图以实际支持的图片内容块提供；不支持图片输入的默认模型返回明确错误，不悄悄选择其他聊天模型。工具调用／结果由Pi原生落盘，任务结果通过带executionId的原生custom message通知讨论，只通知不自动启动新一轮LLM。SQL事实不以这条通知是否成功为准。
- Pi句柄仅按服务器当前prompt／工具／通知写入活动管理，空闲即释放，不读取客户端观察或订阅人数。Pi prompt已受理后服务器完成当前轮，不因HTTP或SSE断开abort，不接用户取消；图片执行独立继续。
- 关闭Pi agent级retry、provider retry及所选适配器自动重试；不得依赖SDK默认。自动压缩保留正常管理能力，但发生需要重发原失败请求的路径时结束为failed并保留外部不确定性，不透明续发。实现需核实并控制Pi 1.5.0相关恢复路径，不能只关retry.enabled就宣称所有路径已关闭。

### 2.3 跨Pi与数据库的写入边界

讨论命令先在数据库持久受理，再prompt；先记原生基线entry IDs，使用包含commandId的custom entry关联。SQL与Pi文件不能跨介质原子提交。进程中断后，旧进程尚未终结的命令统一failed／PROCESS_INTERRUPTED，不检查原生证据补成功，也不重新prompt；已持久completed的记录保持原状。模型工具重复调用时用commandId＋toolCallId去重，避免创建重复任务／方案。

执行结果通知记录原生entryId供诊断；写入失败／中断即notification.failed，不再追加或自动核对补成功。页面直接显示SQL结果，通知失败不触发重新生成；只读查看原生树不改变业务结论。

## 3. 对话、任务、方案、执行与产物

| 对象 | 职责 |
| --- | --- |
| 图片对话 | 一段讨论，初期可没有任务，后续可包含一个或多个任务 |
| 任务 | 一个持续目标，例如网站Logo；一个对话可只有一个任务，不强制拆分 |
| 方案 | 任务的一次拟执行输入，版本化且不可变，包含意图、模型、参数、参考图和输出要求 |
| 执行 | 已授权方案的一次处理，独立排队、阶段、结果；普通确认同一方案最多一次；失败后仅用户重新开始可创建后继执行 |
| 资源／产物 | 参考图、母图、派生文件；一次执行可输出多张图 |

“把Logo背景改白”默认继续原任务，产生新方案及执行，不覆盖历史；“另做一张登录页插画”可新建任务。归属有歧义先询问。九尺寸是一个执行的九个输出，不拆成九个任务。

每任务最多一项queued／running／processing执行；期间可保存下一版草稿，但不能提交第二个执行。任务行状态为服务器派生：活动执行优先，其次current_plan_id所指未受理方案的待补充／待确认，最后为最新执行结果。任务不保存另一份模糊running状态。

## 4. 工作台布局与操作

使用现有左导航之外的全部右侧空间：中间随任务变化的工作台＋最右固定跟踪栏。所有操作集中在对话，参考图独立预览；参数、确认和大图均在工作台内展开，不弹窗、不抽屉。

```text
┌──────────┬────────────────────────────────────────────────┬──────────────────┐
│          │ 图片工作台                       [＋新建对话]  │ 任务跟踪         │
│ 现有导航 │ 品牌讨论 › 网站Logo           [对话总览]       │ 当前选中         │
│          │────────────────────────────────────────────────│ ▌网站Logo        │
│          │ 参考图片                                       │ ▌待确认          │
│          │ ┌────────────────┐ logo.png · 1024×1024        │──────────────────│
│          │ │    图片预览    │ [图1] [图2] [＋]             │ [进行中]  全部   │
│          │ └────────────────┘ [上传] [资源目录]            │                  │
│          │────────────────────────────────────────────────│ 登录页插画       │
│          │ 对话与结果                                     │ 正在生成         │
│          │ 你：输出九种网站图标尺寸。                     │                  │
│          │ 助手：保留图形和颜色，输出16…256像素PNG。     │ 商品背景图       │
│          │       [展开参数] [确认生成]                    │ 排队中           │
│          │                                                │                  │
│          │              ↕ 对话和图片结果                  │  ↕ 任务列表      │
│          │────────────────────────────────────────────────│                  │
│          │ 描述要求，或继续补充修改……                     │                  │
│          │ 图片模型 ▾   ☐ 本次跳过确认             [发送]  │                  │
└──────────┴────────────────────────────────────────────────┴──────────────────┘
```

“新建对话”只开启讨论；输入新目标可由Pi准备任务，不自动开始图片调用。“对话总览”查看同一讨论下所有任务；选择任务时显示对应参考图、版本和结果，其他任务更新不抢占。顶部提供内联对话历史列表，避免无任务的讨论在切换后无法找回。

参考区保持比例、显示文件名和像素，透明图用棋盘格；多图缩略图切换明确本次引用。选图、上传、将产物作为参考都提交资源ID；放大占用中间区域，返回保留输入。查看历史执行时显示固定参考并只读；编辑下一版时可移除引用，源文件不删除。

跟踪栏默认“进行中”只显示queued／running／processing；“全部”可分页查看所有任务，不限最新一页。待确认、待选图、失败和已完成在全部及对话总览可见。当前选中独立置顶且不重复列出，完成后不跳走；空列表保留。每任务展示最新状态，可展开历史执行。第一版没有普通Session来源任务。

宽度不足时保持任务栏右置并缩窄，中间参考区与对话纵向排列，页面必要时横向滚动，不将任务栏改为隐藏抽屉。按钮统一Button，表单沿用共用样式；实施前检索AI Elements Conversation、Prompt Input、Image、Confirmation、Queue等实际组件，登记复用／例外，本文不声称已完成组件评估。

## 5. 参数、意图与授权

### 5.1 参数来源

用户直接填写＞明确预设＞服务端默认。LLM只补充需要理解的描述或建议，不能覆盖明确值或虚构支持参数。每个最终字段携带来源user／preset／default／llm；参数面板直接可编辑。

图片profile是服务端image-profiles.json解析后的只读能力项，具体配置见5.4；讨论模型继续使用Pi既有模型配置和默认值，图片凭据引用Pi认证解析能力。第一版不新增配置编辑页面或写配置API。讨论模型仍使用Pi当前默认。图片profile提供provider、modelId、能力版本、允许的参数与组合。GPT／Gemini参数不强行统一，非法或不支持项返回字段错误；修改草稿profile只改变草稿；提交新方案并切换current_plan_id后旧确认才失效，确认区始终显示方案固定的模型。方案持久化生效参数、公开配置快照和版本；不存密钥正文。执行前凭据引用必须仍可解析，配置变化不得静默换模型／地址。

第一版profile由服务器安装配置提供准确官方modelId和适配器标识，不硬编码未经核实的型号名称。OpenAI采用官方Images生成／编辑接口；Gemini采用官方支持图片输出的generateContent接口。具体型号、输入限制和参数映射通过适配器能力契约及受控接口测试固定，未配置供应商返回不可用，不因缺配置回退到OpenRouter。不能把自然语言描述当作不受校验的API参数。

精确后处理独立于图片模型尺寸：一张母图生成九种尺寸。网站图标预设固定PNG、保持比例、透明补边、九尺寸、logo-{size}.png；需要其他背景／裁剪须明确覆盖并展示。缩小使用高质量重采样，不拉伸；小图放大提示不保证细节，需要AI修复时先展示改动意图。模型编辑不保证原图文字／图形绝对一致，严格原样缩放使用process模式而非重新生成。

### 5.2 先展示方案

默认发送→Pi／规则整理→持久方案→展示修改与保持内容、参考、模型和输出→确认→创建执行。generate／edit／process三种操作都遵循确认。LLM不能只输出一段摘要后另传不同参数；页面展示方案DTO及其版本hash。

plan_hash由operation、prompt、明确修改／保留意图、profile公开快照（process为null）、最终参数、固定参考、依赖及输出规范规范化计算，不含版本／时间／请求ID。同任务完全相同输入返回已有方案，不复制方案；失败后用户可通过重新开始复用该不可变方案建立新执行。任务通过current_plan_id明确指向当前拟执行方案，不能用最大version代替当前选择；version只表示首次创建顺序。相同输入命中尚未执行的历史方案时，可在版本校验通过后选回该方案，不复制内容或提高其version。已经存在execution的方案只返回历史结果，不重新选择为可执行方案。

确认指定planId＋hash＋taskRevision，数据库原子核验其等于current_plan_id、task.revision匹配、引用完整、任务无活动执行；generate／edit还需profile可用，process不要求图片profile。创建或切换当前方案都推进task.revision；A→B→A后，旧A确认也因taskRevision失配返回PLAN_STALE。选回尚未执行的A后，用户按新的taskRevision确认；普通确认不重复执行已有方案；用户重新开始按8.4创建新的后继执行。

“本次跳过确认”默认关闭，只作用于本次消息、该命令确定的任务及方案；缺少必要信息或依赖输入未绑定时仍等待补充，不自动将授权延伸到下一条消息。命令携带用户明确参数和选择的参考，控制器验证LLM方案没有改写这些硬约束后方可授权。

不提供用户取消或删除API。确认前可以不提交或继续改方案；受理后不可取消、改写或删除。单项／批量确认均固定输入版本；不同幂等键的普通确认不构成重新开始授权。失败后用户可明确重新开始，允许沿用同一方案。

### 5.3 一个或多个任务与依赖

独立目标可以批量整理，单任务直接展示，多个才出清单。批量确认采用全有或全无短事务，一项无效则不创建任何执行；可改为逐项确认。每个执行保存同一受理commandId，便于响应丢失后查询。

后续图片依赖前置产物时，依赖先固定为源任务／执行身份，方案显示等待选图。第一版不预授权尚不存在的参考图：前置完成后用户选定assetId，形成新方案版本并重新确认。前置failed时后续保持等待，不自动换图或重跑。这里等待的是方案，不占正在生成名额。独立的、参考完整的任务可先确认执行。

### 5.4 图片接口配置与能力版本

讨论使用01既有models.json／settings.json及认证规则，不增加第二份聊天模型配置。官方图片适配的应用配置独立放在<applicationConfigRoot>/image-profiles.json，schemaVersion=1；不是让Pi原生解析它不支持的图片字段，也不改写用户的models.json。文件缺失时只保留process能力，生成／编辑明确不可用；文件存在但损坏、重复ID或未知字段时报IMAGE_CONFIG_INVALID，不回退掩盖。启动及新方案／受理边界读取，执行使用已固定快照。

配置类型：{schemaVersion:1,defaultProfileId:string|null,concurrency:正整数(默认1),profiles:ImageProfile[]}。每个ImageProfile包含：id、provider(openai/google)、adapter(openai-images-v1/google-generate-content-v1)、modelId（部署实际型号）、credentialRef（Pi认证provider引用）、capabilityVersion（非空字符串）、timeoutMs（60000..1800000，默认600000）、defaults（适配器校验的图片参数）。provider与adapter必须对应，官方endpoint由适配器固定；第一版不支持自定义baseUrl、代理供应商或任意header。defaultProfileId须指向已登记项，缺默认且有多个profile时要求用户选，不任取首项。

credentialRef在服务端交给既有Pi认证解析，得到请求时凭据；配置和DB只保存引用，不保存密钥。不同图片provider的凭据引用必须匹配适配器认可的认证方式，不把聊天OAuth能用等同于图片接口能用。凭据不可解析则IMAGE_PROVIDER_UNAVAILABLE，不能从其他供应商借用。重启／密钥轮换不改变任务模型；已确认配置项被移除或能力版本改变，queued执行在发出请求前明确failed／configuration，不偷偷采用新配置。

公开profile快照为{schemaVersion:1,id,provider,adapter,modelId,capabilityVersion,configHash,timeoutMs,parameters,limits}，其中parameters为参数定义，limits为参考图／生成图／像素限制。credentialRef作为同一已校验快照的服务端字段存储，不放入公开DTO和plan_hash；configHash包含其引用标识和所有影响执行的配置，不包含密钥字节。公开快照按白名单生成，不直接返回整个文件。

参数定义为{key,type:string|integer|number|boolean,required,default?,enum?,min?,max?,description}，外加由适配器实现的跨字段校验。每个adapter＋modelId＋capabilityVersion必须对应已登记能力，未知组合不可用，不能凭配置任意宣称支持透明背景／数量等能力。没有比例、质量等选项的模型不展示该字段。模型ID及认证属于部署值，不在文档捏造；能力映射与受控供应商接口测试一起交付。

### 5.5 跳过确认的有界授权

普通确认以最终方案为边界。skipConfirmation=true必须同时提交autoExecuteLimits={maxTasks,maxImageRequests,maxGeneratedImages,maxOutputs}，maxTasks、maxOutputs为正整数，maxImageRequests、maxGeneratedImages为非负整数；maxTasks上限10，其他上限取服务端与实际供应商更严格限制。页面明确显示本次范围，不隐藏在模型上下文。缺limits拒绝400，不让LLM补授权。

默认页面显示1任务、1次图片请求、1张生成母图、1个输出；选择九尺寸预设时明确显示1任务、至多1次图片请求、1张母图、9个输出；纯process为0次图片请求及0张生成图，因此maxImageRequests和maxGeneratedImages允许0。修改范围也是用户意图，服务端记录到message命令；用户自然语言只表达目标，不能被模型解析成无限额度授权。参考图IDs及明确参数属于本次硬约束。

等本轮Pi可靠settled、所有方案完整后，控制器聚合校验任务数、API调用次数、生成图数量和输出数量，再一次性受理。尚有歧义、缺图、任务忙、超出限额或与用户硬约束冲突时，本轮均不自动执行，返回待确认方案及原因，不能先跑一部分再要求补授权。LLM／工具准备阶段不调图片API。讨论failed时不使用本次skip授权执行已准备的方案；重新开始讨论默认关闭skip，不继承旧授权。讨论完成与自动执行受理分开记录，崩溃窗口按8.4处理，不以command.completed暗示图片执行已创建。

每次执行最多一次图片生成／编辑请求；供应商原生一次支持多图时计入maxGeneratedImages，不支持时不能偷偷循环多次补图。输出数量为母图之外明确交付的派生文件数量，保存母图用于查看与后续新工作不重复计作输出；没有后处理时原生成图片即交付输出。受理记录固定参与的planId／hash，之后新增任务、追加方案或重选参考必须重新授权。相同message幂等重放不能扩大范围。

## 6. 数据库目标模型

### 6.1 表数量与可读性

新增专用表10张，不合并进projects／sessions，也不复活旧Bot／通用任务平台。现有表数量以实施时02／06实际基线为准，目标为基线＋10；本稿不假定历史库仍是某个旧表数。

独立事实：讨论归属、目标任务、不可变执行方案、资源、关系、执行证据与受理幂等。用一张任意JSON任务表无法约束归属、唯一执行和资源关系；逐状态拆表又无必要。草稿按对话总览／任务分别保存，不放在一份会被切换覆盖的conversation字段中；配置继续使用服务端文件，不为其另建任务配置表。

关系：image_conversations→image_tasks→image_plans→image_executions→image_assets；方案经image_plan_inputs引用资源，经image_plan_dependencies引用前置任务／执行；image_commands保存受理与授权范围；image_drafts保存各编辑目标的草稿，image_draft_inputs关联草稿参考。所有业务表仅服务图片能力，不接普通Session。

以下ID均TEXT UUID，时间为服务端UTC ISO；FK默认RESTRICT，不级联删除。json列必须校验为明确的版本化类型，不能藏归属ID、可查询关系或权限。二进制、密钥、完整对话不进SQL。

| 表 | 关键列与约束 |
| --- | --- |
| image_conversations | id PK、title、native_ref_json可空、revision≥1、created_at、updated_at。nativeRef首次建立后不可替换；讨论模型从Pi原生记录读取，不在此表放可覆盖的多任务草稿 |
| image_drafts | id PK、conversation_id FK、task_id可空、revision≥1、text、profile_id可空、parameters_json、created_at、updated_at；task_id为空表示对话总览草稿，否则复合FK(task_id,conversation_id)。部分唯一索引conversation_id WHERE task_id IS NULL；UNIQUE(task_id) WHERE task_id IS NOT NULL。目标归属不可变，创建时revision=1，空text和空参考合法 |
| image_tasks | id PK、conversation_id FK、name、current_plan_id可空、revision≥1、created_at、updated_at；UNIQUE(id,conversation_id)，复合FK(current_plan_id,id)→image_plans(id,task_id)。先插空指针task再插plan，最后条件更新指针。无持久task_status，列表从执行及当前方案派生 |
| image_commands | id PK、conversation_id FK可空（创建对话前允许）、kind(create_conversation/message/update_draft/create_task/upload/import/prepare_plan/select_plan/confirm/restart_execution)、scope_key、idempotency_key、request_hash、request_json（类型化意图／授权对象及显式输入）、status(accepted/running/completed/failed)、auto_execution_state(not_requested/pending/admitted/needs_confirmation)、auto_execution_reason可空、result_json（IDs及安全结果）、error_code、revision≥1、dispatch_started_at可空、pi_baseline_json、pi_entry_ids_json、attempt_ended_at可空、restart_of_command_id自引用可空且UNIQUE、created_at、finished_at。UNIQUE(kind,scope_key,idempotency_key)，scope_key非空规范资源标识；request_json不是对话来源；更新草稿操作也必须可重放受理结果 |
| image_plans | id PK、task_id、conversation_id、version≥1、command_id FK、operation(generate/edit/process)、intent、preserve_text、prompt、profile_snapshot_json、parameters_json、parameter_sources_json、output_spec_json、plan_hash、created_at；UNIQUE(task_id,version)，UNIQUE(task_id,plan_hash)，UNIQUE(id,task_id)，复合FK(task_id,conversation_id)。内容全不可变，不持久待确认副本状态 |
| image_executions | id PK、task_id、plan_id FK、restart_of_execution_id自引用可空且UNIQUE、authorization_command_id FK、authorization_mode(confirm/skip_once/restart)、revision≥1、status(queued/running/processing/completed/failed)、phase、dispatch_started_at可空、provider_response_id可空、provider_outcome(none/success/failure/unknown)、provider_evidence_json、response_asset_id可空、started_at、finished_at、error_code、error_detail_json、created_at、attempt_ended_at可空、notification_state(none/pending/writing/delivered/failed)、notification_baseline_json可空、notification_dispatch_started_at可空、notification_entry_id可空、notified_at可空、notification_payload_json可空；UNIQUE(id,task_id)，复合FK(plan_id,task_id)；部分唯一索引task_id WHERE status IN(queued,running,processing)。UNIQUE(authorization_command_id,plan_id)，部分唯一索引plan_id WHERE restart_of_execution_id IS NULL，约束首次普通受理；固定授权与方案不可改，后继关系见8.4；通知字段只服务本执行的一次结果通知，详见8.5 |
| image_assets | id PK、task_id FK、execution_id FK可空、role(reference/provider_response/master/output)、original_name、relative_path NOT NULL UNIQUE、output_key可空、sealed_at可空、sha256可空、mime_type可空、width／height可空、byte_size可空且非空时≥0、availability(staging/ready/missing/corrupt)、created_at；UNIQUE(id,task_id)、UNIQUE(id,execution_id,task_id)，部分唯一索引(execution_id,output_key) WHERE role='output'。role=output必须有execution_id及output_key，其他role的output_key必须为空。staging允许尚未知的元信息为空；ready必须有sha256、mime_type、byte_size及正width／height。归属、路径与output_key不可变；首次写入完成后、rename之前持久hash／尺寸／字节数并设置sealed_at，此后内容元信息不可改；ready要求sealed_at非空；缺失／hash变化只改变availability，不能就地替换内容 |
| image_plan_inputs | plan_id FK、asset_id FK、position≥0、purpose(reference/base)；PK(plan_id,position)，UNIQUE(plan_id,asset_id)。资产可来自其他任务，控制器校验本应用图片资源可读、已ready；固定asset版本，不传路径 |
| image_plan_dependencies | plan_id FK、source_task_id FK、source_execution_id FK可空、selected_asset_id FK可空、purpose；PK(plan_id,source_task_id,purpose)。核验源执行／资源归属、禁止自身与环；关系不可原地变更，绑定产物生成新plan版本 |
| image_draft_inputs | draft_id FK、asset_id FK、position≥0；PK(draft_id,position)，UNIQUE(draft_id,asset_id)。改参考与image_drafts.revision同事务；跨任务可引用ready资源，不是历史消息副本 |

同一对话只允许一个accepted／running的message命令，通过部分唯一索引约束。failed不阻塞以后讨论或用户重新开始；终结前须保证旧本地Runtime已停止，迟到回调不能写入新运行。外部结果不明记录provider_outcome=unknown，页面明确提示，不创建业务unknown门禁或核对流程。SQL CHECK枚举、数值和时间语义见6.3及8.1；auto_execution_state仅message且本次skip可为pending／admitted／needs_confirmation，admitted必须有关联execution且授权命令为本message，needs_confirmation必须有原因；数据库归属约束见6.3，不依赖页面。

image_commands.revision每次状态／证据变化递增，基线与已写entry IDs不可覆盖丢失。通知基线独立存于execution，不混用讨论命令字段。

### 6.2 初始化与历史数据

原系统没有这些对象，无需把旧Session／Project映射成图片任务；不改旧nativeRef、不回填历史。全新空库可按批准目标初始化。已有库需显式Schema升级，说明新增10表及索引／触发器的影响，用户决定迁移时间后再提供可审查脚本；启动不隐式迁移。此次文档授权不等于迁移授权。结构不兼容时禁止图片写入，其他旧功能按现有兼容策略处理，不清库重建。

### 6.3 数据库关系、空值与不可变边界

所有复合FK的被引用列必须建立对应UNIQUE，不只在Repository中比较：

- plans(task_id,conversation_id)→tasks(id,conversation_id)；drafts(task_id,conversation_id)同理，task_id可空仅用于总览。
- executions(plan_id,task_id)→plans(id,task_id)；assets(execution_id,task_id)→executions(id,task_id)，只有reference允许execution_id为空。
- executions增加UNIQUE(id,task_id)，assets增加UNIQUE(id,execution_id,task_id)。response_asset_id非空时，使用复合FK(response_asset_id,id,task_id)→assets(id,execution_id,task_id)，并以触发器限制role=provider_response且availability=ready；先建execution，后插asset，再关联响应，避免循环插入。
- dependencies(source_execution_id,source_task_id)→executions(id,task_id)；若selected_asset_id非空，source_execution_id也必须非空，复合FK(selected_asset_id,source_execution_id,source_task_id)→assets(id,execution_id,task_id)，触发器限制ready且role为master／output。未选图可空，禁止依赖同一任务；按拟选方案与其他任务current_plan_id所指方案计算有向图；创建新方案或选回历史方案都在更新current_plan_id的同一事务内拒绝环。
- commands.restart_of_command_id→commands(id)：只能由用户重新开始入口写入，源命令必须failed，源与后继kind必须相同，且每个源命令最多一个后继；message后继保持同conversation，create_conversation后继预留全新conversation及Pi身份。executions.restart_of_execution_id→executions(id)：源执行必须failed、同task及plan，mode=restart且授权命令kind=restart_execution；每个源执行最多一个后继。首次执行该列为空且mode=confirm／skip_once，授权命令分别kind=confirm／message。所有授权command必须属于该任务对话。
- plans和inputs／dependencies只允许创建事务内完整插入，提交后禁止UPDATE／DELETE；以command成功封存作为边界，不能靠更新关系悄悄改变plan_hash。hash规范化包含有序inputs、dependencies、输出和公开profile配置摘要。

资源availability规则：staging且sealed_at为空表示本次首次写入尚未完成，内容元信息可空；sealed_at非空表示预期内容已持久封存，hash／mime／字节数／宽高必须完整有效，即使尚未ready也不可修改；ready要求全部图片元信息有效；missing／corrupt保留既有hash及尺寸，如从staging失败则允许为空。未知残留字节不伪造sha256。staging→ready、staging→missing／corrupt及ready→missing／corrupt可用；missing／corrupt保持失败事实，不自动补ready；用户重新开始创建新资源，不改写原记录。asset引用失败不删除方案或文件。

image_executions与image_commands的completed／failed均为终态且finished_at必填；failed表示本次本地工作结束，不等同于供应商明确失败。外部是否已受理／计费不明时保留provider_outcome=unknown及错误证据，不伪造外部结论。旧终态不可转回活动态或改成功。queued／accepted未开始时dispatch字段为空；process无图片profile且provider_outcome=none。

### 6.4 草稿归属与切换

创建conversation时同事务建立总览空draft；创建task时同事务建立该task空draft。每个目标一份共享持久草稿，多个客户端编辑同一draft按revision乐观并发，旧版本返回412，不能后写覆盖。

切换任务前发送当前草稿保存；成功后读取目标draft。保存失败可以继续查看别的任务，但明确保留未保存输入并标注原归属，不把它带入目标输入框；本地缓冲不宣称已保存。每个客户端切换不会改变其他客户端当前选中项。

发送message以draftId＋If-Match取得服务端已保存快照，在同事务建立command、清空text／本次参考／本次显式参数并递增draft.revision；profile选择保留。新的用户输入写入更新后的草稿，不被迟到的message结果回填覆盖。skip开关只属于本次发送，不持久继承。failed命令可只读查看原始输入；只有用户点击“重新开始”才使用其快照受理新命令，不能自动复制或覆盖新草稿。

### 6.5 版本化JSON类型

全部类型schemaVersion=1，拒绝未知业务字段、NaN、重复输出名及任意可执行代码；providers参数对象只接受对应capabilityVersion定义的键。JSON对象规范化按键排序，数组保持明确顺序，hash使用SHA-256 UTF-8规范串。

| 列／字段 | 类型契约 |
| --- | --- |
| draft.parameters_json | {schemaVersion:1,explicitParameters:字段值对象,outputSpec?:OutputSpec}；不包含taskId或授权 |
| plan.parameters_json | {schemaVersion:1,values:适配器校验的最终参数}；process为{}值集 |
| plan.parameter_sources_json | {schemaVersion:1,fields:{字段路径:{source:user/preset/default/llm,originCommandId?}}}；覆盖每个生效生成／输出字段，origin仅用于核对，归属以列和FK为准 |
| plan.output_spec_json | OutputSpec={schemaVersion:1,format:png/jpeg/webp,fit:contain/cover,background:transparent或#RRGGBB,targets:[{name,width,height,sourceIndex}],resample:lanczos3,quality?:1..100}；target至少1，宽高1..8192且受输出总像素上限约束；sourceIndex为本次固定母图序号，从0开始；generate／edit按供应商响应证据中sourceAssetIds顺序，process按inputs中purpose=base的位置顺序，不能按文件名或随机ID重排；name为单层安全文件名，不含斜杠／..，扩展名匹配format。PNG不接受quality，透明不适用于jpeg。九尺寸预设以九个target显式展开，不只存预设名 |
| plan.profile_snapshot_json | 5.4定义的schemaVersion=1快照＋credentialRef（仅服务端）；process为NULL，不虚构图片模型 |
| execution.provider_evidence_json | {schemaVersion:1,attempt:{preparedAt,dispatchMarkedAt?,requestHash,adapterVersion},observations:[{observedAt,outcome:not_sent/rejected/success/uncertain,httpStatus?,providerErrorCode?,responseId?,sourceAssetIds:[]}]}；追加证据，不覆盖，图片字节存assets，不存凭据／完整headers |
| command.request_json | 由kind区分的封闭联合，字段与9.3输入对应，额外含服务端固定的输入／授权快照及受理revision；create_conversation含预留conversationId／native文件候选；消息含draftSnapshot和autoExecuteLimits，不能用作聊天回放 |
| command.result_json | {schemaVersion:1,conversationId?,taskIds:[],planIds:[],executionIds:[],assetIds:[],selection?:{taskRevision,selected}}；为受理结果索引与本次选择结果，不复制完整DTO或消息。方案创建／选回的taskRevision及selected持久固定，幂等命中返回原值，不拿当前task版本冒充当时响应 |
| command.pi_baseline_json／execution.notification_baseline_json | {schemaVersion:1,nativeSessionId,leafId,entryIds:[]}；内部证据，不随页面DTO下发原生路径 |
| command.pi_entry_ids_json | {schemaVersion:1,startEntryId?,userEntryId?,completionEntryId?,toolCallIds:[],resultEntryIds:[]}；同一nativeSessionId核对，不按文本相似度识别 |
| execution.error_detail_json | {schemaVersion:1,phase,reason,fieldErrors?:[{field,code}],partialAssetIds:[]}；不含密钥、系统路径；页面输出经固定DTO适配 |
| execution.notification_payload_json | {schemaVersion:1,executionId,taskId,status:completed/failed,assetIds:[],errorCode?}；结果索引用于原生custom message，正文不复制完整SQL结果或图片base64 |

OutputSpec总输出像素默认不超过1亿，输出文件最多32，生成母图数及API请求数另受5.5限制；超限422，不静默减少。image_executions补notification_payload_json可空，为首次确定结果时固定的通知快照；其他通知列语义见8.5。

### 6.6 输入用途与输出项的确定对应

方案API及PlanDTO统一使用inputs:[{assetId,purpose:reference/base,position}]，position从0连续且唯一，同一assetId不重复。直接对应image_plan_inputs，不再以referenceIds推测用途。草稿referenceIds仅表示本次用户选择的附件；准备方案时赋予明确用途并展示，不能偷换或增加本次用户未授权资源。generate允许适配器支持的reference、禁止base；edit至少一张base，可带reference；process至少一张base且不带reference，profileId=null、prompt为空、生成参数为空。超出能力或含无效用途422 IMAGE_PARAMETERS_INVALID。

outputSpec.targets中的name同时是稳定output_key，在本执行中唯一；不另设随机输出身份。确认事务为每个target建立一条role=output、output_key=name的staging资产，relative_path固定为该执行outputs/<name>。数据库触发器按execution.plan_id读取不可变outputSpec（SQLite json_each），校验output_key确实存在；禁止新增计划外输出键。所有输出路径由服务器生成，不能接受客户端路径。

完成判定逐项匹配目标集合与output资产集合，要求无缺项、无多项，每个键恰好一项且ready，mime及像素与该target和format一致。sourceIndex按6.5固定输入顺序读取；工作器只能以匹配键的target处理对应源图，封存前校验输出元信息，不能靠文件数量判成功。额外的provider_response／master不计作交付输出。部分成功通过output_key展示明确缺失项；ZIP仅导出ready输出，并保留各target逻辑名。

## 7. 文件布局与一致性

资源根为<applicationConfigRoot>/images，配置根按01现有npm启动目录捕获，不依赖process后续cwd。根路径固定，不给页面随意改路径。按稳定taskId分类，名称修改不搬目录。

```text
images/
  <taskId>/
    references/<assetId>/original.<ext>
    executions/<executionId>/
      response/<assetId>.<ext>        # 已得到的供应商响应／图片字节
      master/<assetId>.<ext>
      outputs/logo-16.png
      outputs/.../                  # 其他任务的输出规范
      outputs/logo-256.png
      staging/<assetId>.part
```

尚无任务时采用显式两步：先调用创建任务API，再以返回taskId上传。只保证每一步自身事务，不宣称创建任务与上传跨请求原子；上传失败保留空任务，既不删除也不开始生成。不引入对话级散落上传目录。跨任务复用以assetId引用原文件，不复制到每个任务，不改变归属。

第一版参考支持PNG／JPEG／WebP及安全解析的SVG：供应商不支持SVG时由服务端禁外链／脚本栅格化后生成独立参考资源，先展示栅格图和来源。文件扩展名不作为类型证明；拒绝路径穿越、符号链接、SVG外部资源与任意URL抓取。默认单文件20MiB、解码后4096万像素、每方案最多4张参考，实际还取供应商更严格上限；超限明确拒绝，不静默裁切／压缩。

保存顺序固定：先预留staging资源及唯一最终路径→首次写入唯一.part，完成解码校验并flush文件→短SQL事务持久sha256、mime_type、byte_size、width／height及sealed_at→在同一文件系统内原子rename到预留最终路径并flush源／目标父目录→短事务核验封存信息后设ready。sealed_at提交失败时不rename，ready提交失败时也不重写文件；保留残留与失败证据，文件状态用missing／corrupt，所属命令／执行用failed，不给asset写不存在的failed枚举。

进程中断后的旧staging资源统一记missing并保留文件／封存元信息，不扫描文件补ready，不rename／重新下载／生成／处理，也不依据完整产物把旧执行补成completed。已持久ready的资源保留原状、可查看下载；访问时发现缺失或损坏才标missing／corrupt。用户重新开始使用新execution／asset及目录，旧文件不覆盖。预留输出即使从未开始写，也不能导致旧queued任务在重启后自动执行。

选择原文件时创建不可变受管副本或引用已有ready资产，不仅保存可变外部路径。第一版只浏览登记资源，服务端images中手工放入文件需通过“导入资源”显式校验登记，不后台扫描或自动删除未知文件。源路径从服务端列出的任务内候选选择，不接受任意绝对路径。

默认全部产物写入本次执行目录，不覆盖同名历史；输出逻辑名在同执行内唯一。首次九尺寸预设可直接下载单图或ZIP，ZIP为流式导出，不成为额外持久任务。第一版不提供向项目目录保存、覆盖文件或删除资源；目录耗尽／不可写时明确失败，不自动清理。部分成功产物保留可查看，但预期文件未全部ready不能宣告整次completed。

## 8. 状态与控制器时序

### 8.1 执行状态

| 状态／转换 | 条件与写入 |
| --- | --- |
| 无执行→queued | 方案为current_plan_id且taskRevision匹配、依赖绑定、引用ready、generate／edit的profile及认证可用（process不要求图片profile）、任务无活动执行；短事务写command授权与执行，首次受理唯一索引与授权幂等防重复；用户restart按8.4建立后继 |
| queued→running | 工作器用条件UPDATE认领，记dispatch_started_at前先核验输入；事务提交后才发唯一一次图片API请求 |
| running→processing | 供应商明确成功且响应证据／可用源图已保存；process模式不调图片API，按同样认领直接processing |
| processing→completed | 按6.6逐项核对output_key、格式／尺寸／源图映射及ready，全部符合后SQL写完成时间及结果；数据库提交后推送 |
| 任意活动态→failed | 有明确未调用／拒绝／已返回失败证据，或已知文件处理失败；保存真实阶段及部分产物，无自动重试 |
| running→failed | 超时／断连／进程退出等无法继续完成时，记本地失败；外部结果不明保留provider_outcome=unknown，不重发 |

phase记录具体generation／response_save／resize／output_save，不与status形成两份真假；phase必须属于该status允许的集合。process执行的provider_outcome始终none。图片API成功、后处理失败时保留provider_outcome=success及phase，不误报供应商失败。

任务行“待确认／待补充／等待依赖”由当前方案与引用、执行存在性派生，不制造未授权执行。不编造百分比；开始及结束时间来自数据库，页面本地计时只用于展示。

### 8.2 确认、批量与执行

1. 控制器读取plan及资源，核验配置和凭据可解析，不通过真实探测请求验证。
2. BEGIN IMMEDIATE重读版本、授权、依赖、任务门禁；任一冲突回滚，所有关联业务记录保持不变。
3. 显式确认时原子写受理command；skip_once使用既有message命令，不再伪造第二次用户授权。事务内写一个或多个execution、固定授权模式，并为每项outputSpec.target预留staging输出asset。skip路径同时把message的auto_execution_state置admitted、记录全部executionIds并完成命令；任一失败全部回滚，不留下部分执行或输出预留。不改其他任务／旧plan／既有资产。
4. COMMIT后发通知并唤醒工作器。HTTP返回前后断线都不影响数据库队列。
5. 工作器按created_at、id FIFO取ready执行。全局默认并发1，可由服务端部署配置调整正整数；Pi讨论同对话串行，图片执行与讨论分开限流。
6. 失败不重新进入队列。用户“重新开始”通过8.4新建后继执行，允许同方案／同要求；工作器、LLM和客户端自动逻辑不能调用该入口。

准备方案工具按commandId＋toolCallId在同事务去重；参数JSON允许供应商嵌套结构，但由版本化适配器验证，禁止在JSON中附加任意执行代码。

### 8.3 断线、超时与进程中断

客户端断开、关闭页面或讨论不算失败：当前服务器进程仍正常时，已受理工作继续一次执行。SSE重连只读当前SQL／原生树；同幂等键重放只返回旧受理结果。不会因观察者变化abort，也不会因为重连重新启动工作。

图片调用默认硬截止10分钟，按profile可设置1～30分钟。超时／网络错误／生成、下载、后处理或保存失败后立即结束本次工作并置failed；可能已调用供应商时保留provider_outcome=unknown，不能声称未生成或未计费。讨论错误同样failed，无agent／provider隐式重发。停止旧本地等待／工具调用后才释放门禁；迟到结果只能追加诊断证据，不能触发后续处理或改写终态。

服务器重启时，在确认旧进程已结束且Schema兼容后先用短事务将旧accepted／running命令、queued／running／processing执行统一置failed／PROCESS_INTERRUPTED并填写finished_at／attempt_ended_at；generate／edit已有dispatch标记且无明确外部结果的保留provider_outcome=unknown，未派发的为none。旧auto_execution_state=pending改needs_confirmation，reason=PROCESS_INTERRUPTED。旧staging资源记missing，未完成通知记failed；已持久completed／failed／ready／delivered保持原状。不扫描Pi文件或产物补成功，不继续旧队列，不启动旧prompt、生成、下载、后处理或通知。

重启后工作器只接收本次进程中新受理的工作；启动终结事务完成前禁止图片写入，避免把旧队列认领为新工作。没有进程中断且尚在正常队列中的首次执行不受此规则影响。服务端不提供执行／命令／通知inspect、知悉解除门禁或自动恢复流程。

### 8.4 页面主动重新开始

失败区域在工作台内显示失败阶段、已保存部分产物及“重新开始”。按钮由allowedActions提供；仅用户显式点击可发起，失败事件、SSE重连、页面挂载、LLM或工作器均不得代发。旧失败记录和已ready文件保留可查看。用户可沿用原要求，不必为了重做而修改提示词或伪造新方案。

图片执行使用POST executions/:id/restart：用户指定失败源执行、原plan hash及当前taskRevision，服务端重新验证归属、同任务无活动执行、源为最新失败执行、资源ready及原profile仍可用。重新开始使用原方案快照，不静默替换模型／参数；配置或参考不可用时拒绝，用户可编辑新方案后另行确认。授权来自当前这次点击，不沿用skip标志。

BEGIN IMMEDIATE内重新校验并写restart_execution命令、新execution及全部新staging输出，设置authorization_mode=restart、restart_of_execution_id为源执行，必要时把current_plan_id明确选回源方案并推进task.revision；提交后仅首次派发这个新execution。旧执行始终failed。UNIQUE(restart_of_execution_id)和幂等键共同防止双击／不同请求键创建两个后继；源已有后继则返回该后继，不再次执行。后继再失败时，页面对最新失败后继提供重新开始，形成可追溯链。同方案可有多次用户授权的执行，首次普通确认仍仅一次。

外部结果未知时，页面内联说明“上次请求可能已生成或计费，重新开始会发起新请求”；按钮标为“重新开始（可能再次计费）”，用户点击即提交acceptUnknownOutcome=true，不再增加确认弹窗。该说明只陈述真实供应商不确定性，不等待后台核对、不自动查询供应商、不把原记录改成功。

普通message错误明确结束后即可发起新讨论，不需要inspect或知悉解除门禁。失败的讨论使用POST commands/:id/restart：源kind=message时，以已固定inputSnapshot创建新message命令、restart_of_command_id指向源，使用同一健康Pi身份进行新一轮prompt。skipConfirmation固定false，新的方案仍需确认；不覆盖当前草稿。原有未完成原生entry保留，恢复句柄只用于接收这次新的用户意图，不自动补齐旧工具或继续旧轮。若Pi无法在该历史上安全开始新轮或文件损坏，返回IMAGE_HISTORY_UNAVAILABLE，用户可新建对话，不替换旧身份。

源kind=create_conversation时，同一接口预留全新conversation ID、总览draft及Pi身份，作为一次用户主动的新建；原失败创建命令及候选文件保留。源命令各自最多一个后继，重复点击返回已创建后继。源尚在accepted／running时返回IMAGE_DISCUSSION_BUSY，不能以重新开始取消正在运行的工作。

上传／导入／SVG转换失败后，页面保留重新选择文件或再次显式提交的入口，创建新的命令／资产；失败的旧请求相同幂等键只返回原失败。不能自行重新读浏览器文件、后台重传或自动转换旧残留。

自动受理事实仍与讨论完成分开：skip消息受理时auto_execution_state=pending，正常成功时在8.2同一事务创建全部execution并置admitted，或因缺信息／超限置needs_confirmation；纯讨论置not_requested。Pi结束而SQL完成／受理事务未提交就发生进程中断时，源message直接failed／PROCESS_INTERRUPTED，不读取原生完成标记补成功；已有方案保留可供用户查看、确认或重新讨论。已提交execution则由自身记录判断是否已完成，未终结者按8.3失败。

### 8.5 结果通知失败即停止

执行完成／失败事务同时固定notification_payload_json并置pending。当前进程中，通知与prompt、模型切换、压缩共用同对话串行门禁；Pi忙时只排队首次通知，不干扰当前轮。通知通过原生custom message写入，triggerTurn=false，不调用LLM。

取门禁后持久writing及诊断基线→尝试写一次→成功记录entryId、notified_at并置delivered；写入错误或不能确认成功时置failed，绝不再次写入。服务器重启把旧pending／writing置failed，不扫描原生树补delivered。通知失败不改变图片执行结果，也不提供自动重发或核对入口。

ExecutionDTO展示notification.state=failed及“讨论通知失败”；任务产物仍直接从SQL展示。后续用户正常讨论可通过固定工具读取任务事实，不伪造已通知历史，也不因为通知失败重新生成图片。

## 9. API目标契约

以下为拟实现契约，路径前缀P=/api/images。调用方为图片页面／其API客户端；Pi工具仅调用相同application用例，不绕HTTP许可。沿用应用现有访问边界，不新增角色系统。服务器从DB读取归属、状态、权限与配置，客户端不提交角色或执行状态。除原生树原文外不下发绝对路径、密钥、供应商句柄或完整请求头。

### 9.1 通用规则与DTO

写操作必须Idempotency-Key。检查顺序固定：先验证现有访问资格、资源归属和输入格式→规范化请求hash／scope→查询同scope＋kind＋key的受理记录→同体返回原受理状态／结果，不再校验当前If-Match、不重跑；异体409 IDEMPOTENCY_CONFLICT→仅首次受理时核验If-Match、当前状态、参数及许可→事务内重查幂等与版本后写入。并发插入唯一冲突按同样规则读取原结果，不能让第二请求继续执行。PATCH draft、POST messages需If-Match对比对应image_drafts.revision；POST tasks需If-Match对比conversation.revision；POST plans需If-Match对比task.revision，创建新版本或选回未执行方案时原子更新current_plan_id并推进task.revision；重复选择当前未执行方案不推进revision；确认按plans中的hash＋taskRevision校验，不再要求对话ETag；选择当前方案同POST plans要求task.revision的If-Match；图片restart以body中的taskRevision及planHash校验；命令restart需If-Match对比源image_commands.revision。用户restart在归属校验后先查源是否已有后继，有则只返回该后继，再处理首次受理的版本／忙闲校验，避免双击因任务版本推进误判为可再建一次。创建对话、上传和导入新资源无需If-Match，上传以文件内容hash纳入request_hash；导入以候选定位及预期hash校验。缺键400，缺版本428，版本冲突412。非法／未知字段400，跨对话ID组合404，不通过猜客户端归属放行。

统一{data}或{error:{code,message,details?}}；错误细节只含安全字段名及可执行动作。异步受理202返回CommandDTO（id即commandId）及已创建executionIds；message受理时可为空，完成后通过命令／推送取得plan及execution IDs。幂等命中accepted／running返回202和当前命令；completed返回原成功结果，failed返回已记录错误及commandId，均不重新执行。写操作失败不得让页面先改事实。成功后服务端推送是最终状态来源，响应也可投影相同DTO。

- ConversationDTO：id、title、revision、discussion{busy,blockingCommandId,error}、nativeHistoryAvailable、allowedActions。
- DraftDTO：id、conversationId、taskId可空、revision、text、profileId可空、parameters、referenceIds、allowedActions；跨任务切换读取独立草稿，不覆盖。
- CommandDTO：id、kind、revision、status、autoExecution{state,reason}、resultIds、error、attemptEndedAt、finishedAt、restartOfCommandId、inputSnapshot可空、allowedActions。message的inputSnapshot={text,taskId可空,profileId可空,explicitParameters,outputSpec可空,referenceIds,skipConfirmation,autoExecuteLimits可空}，从已固定request_json白名单投影，供只读查看本次输入；其他kind为null。不返回内部原生路径／完整请求配置，不将快照插成一条聊天消息或自动回填草稿。
- TaskDTO：id、conversationId、name、revision、currentPlanId、latestExecutionId、derivedStage、allowedActions；最高版本的历史方案不冒充当前选择；选回操作返回新revision，重复选择当前未执行方案不增加revision。
- PlanDTO：id、taskId、version、hash、operation、intent、preserve、prompt、profile{provider,modelId,capabilityVersion,configHash}可空（process）、parameters、sources、inputs[]、dependencies[]、outputSpec、validationErrors[]、allowedActions。
- ExecutionDTO：id、revision、taskId、planId、authorizationMode、restartOfExecutionId可空、status、providerOutcome(none/success/failure/unknown)、phase、timestamps、assets[]、outputResults[{outputKey,assetId,availability,expected:{name,width,height,mimeType}}]、notification{state,notifiedAt,allowedActions}、error{code,message}、allowedActions；notification不返回原生路径／entryId／baseline，不单独暴露provider_response_id。通知证据变化也推进execution.revision并推送，即使执行本身已终态。
- AssetDTO：id、taskId、executionId可空、role、outputKey可空、name、mimeType、width、height、bytes、availability、previewUrl、downloadUrl；未ready不提供可下载URL。
- CapabilityDTO：可用GPT／Gemini profile及其版本化字段定义、默认值、范围、组合限制、输入数量／像素限制、输出能力；不可用原因安全展示，不暴露密钥。

request_hash仅由规范化客户端意图、原始If-Match值及上传／导入内容标识计算，不把当前DB revision或当前配置重新混入，否则同请求重放会随状态变化失配。scope_key由服务端按目标确定：创建对话为images，message／task创建／confirm为conversation:<id>，draft更新为draft:<id>，plan／选择当前方案／上传／导入为task:<id>，图片重新开始为execution:<源id>且kind=restart_execution；讨论／新建对话重新开始为command:<源id>，kind保持message／create_conversation。Pi工具用父commandId＋toolCallId作为内部幂等键，不能让模型提供任意用户请求键。

所有分页使用cursor＋limit（默认30、最大100）、稳定created_at/id排序，返回nextCursor；全部任务必须可翻页。资源不存在404，MODEL_UNAVAILABLE／IMAGE_PROVIDER_UNAVAILABLE为503；非法参数422 IMAGE_PARAMETERS_INVALID（逐字段），任务有活动执行409 IMAGE_TASK_BUSY，当前方案／taskRevision失配409 PLAN_STALE，已执行方案不可重选409 PLAN_ALREADY_EXECUTED，依赖未齐409 IMAGE_DEPENDENCY_UNRESOLVED，资源损坏409 IMAGE_RESOURCE_UNAVAILABLE，存储失败503 IMAGE_STORAGE_FAILED，库不兼容503 SCHEMA_INCOMPATIBLE；讨论忙409 IMAGE_DISCUSSION_BUSY，历史不可用409 IMAGE_HISTORY_UNAVAILABLE，配置损坏503 IMAGE_CONFIG_INVALID，源尚未失败或不是允许重新开始的执行409 IMAGE_RESTART_NOT_ALLOWED，外部结果不明而缺少用户本次重新开始意图422 IMAGE_RESTART_ACK_REQUIRED，跳过授权范围不完整／超限时方案保留待确认并给出AUTO_EXECUTE_LIMIT，不作为一次已开始的图片失败。调用可能产生外部副作用时记录execution后在其DTO显示failed，不把一次HTTP 500当作无副作用失败。

### 9.2 读取与页面入口

| 方法／路径 | 输入与返回 | 副作用／Pi |
| --- | --- | --- |
| GET P/capabilities | 无意图参数→CapabilityDTO及默认讨论模型显示信息 | 读取配置与认证可用性，不真实探测，不调用LLM |
| GET P/conversations | cursor,limit→Conversation摘要分页 | DB只读，不打开Pi |
| GET P/conversations/:id | →ConversationDTO及对话总览 | DB只读，不打开Pi |
| GET P/conversations/:id/draft | taskId可选，缺省总览→DraftDTO | 创建总览时、创建任务时已同事务建立各自空草稿；GET只读，不在读取时写库 |
| GET P/tasks | filter=active/all,conversationId可选,cursor,limit→Task分页 | 服务器派生阶段，不读每个Pi历史 |
| GET P/tasks/:id | →Task＋当前Plan＋方案历史分页＋执行分页 | DB只读 |
| GET P/executions/:id | →ExecutionDTO | DB只读 |
| GET P/commands/:id | →CommandDTO | 只读，用于响应丢失核对及查看本次原始输入快照 |
| GET P/assets | taskId可选,cursor,limit→Asset分页 | 已登记资源；不隐式扫描／导入 |
| GET P/tasks/:id/import-candidates | cursor,limit→任务目录内未登记安全图片候选{candidateId,name,sha256,bytes} | 用户明确打开导入时列举；candidateId为服务端签名定位，不返回绝对路径、不登记资产；拒绝符号链接及staging残留 |
| GET P/assets/:id/content | →图片字节／受控预览，download=1下载 | 核验ready及hash；SVG惰性展示／安全预览，禁止执行脚本 |
| GET P/executions/:id/download | →该执行ready输出ZIP | 流式导出，不创建任务、不调用模型 |
| GET P/conversations/:id/messages | →完整Pi全树DTO | 只读SessionManager，不创建执行、lease或第二份消息 |

### 9.3 写入、讨论与确认

| 方法／路径 | 定位与意图输入 | 返回及事务／Pi边界 |
| --- | --- | --- |
| POST P/conversations | {title?} | 201 Conversation及总览DraftDTO；幂等预留ID→准备独立Pi空树→SQL提交nativeRef／索引／总览草稿；失败返回commandId并保留候选文件；自动流程不创建第二身份，用户主动重新开始按8.4新建 |
| PATCH P/conversations/:id/draft | {draftId,text,profileId,parameters,referenceIds} | DraftDTO；校验归属后同事务更新image_drafts及image_draft_inputs、draft.revision；不调用Pi；taskId由draft读取而非更换 |
| POST P/conversations/:id/messages | {draftId,skipConfirmation:boolean,autoExecuteLimits?} | 202 CommandDTO；同事务按draft.revision读取文本／目标／参考／显式参数为命令快照，更新草稿为空并推进revision，再独立Pi prompt；失败不自动回填旧草稿覆盖新编辑，可从命令打开原始输入。skip范围在命令固定，无图片API直调；失联继续处理，不自动重发 |
| POST P/conversations/:id/tasks | {name} | 201 Task及空DraftDTO；同事务task＋草稿＋命令并推进conversation.revision，供上传前明确目标；无Pi |
| POST P/tasks/:id/references | multipart file＋安全原名 | 201 AssetDTO；任务已存在，先staging再落盘ready，失败保留不覆盖；不调用Pi |
| POST P/tasks/:id/import | {candidateId,expectedSha256} | 201 AssetDTO；重新验证任务范围及文件hash，按不可变reference保存；同上传事务，不覆盖源文件；候选变化409 IMAGE_RESOURCE_CHANGED，无Pi |
| POST P/tasks/:id/plans | 类型化{operation,intent,preserve,prompt,profileId可空,parameters,inputs:[{assetId,purpose,position}],dependencies,outputSpec} | 新建201、命中已有200，返回{plan:PlanDTO,taskRevision,selected:boolean,existingExecutionId可空}；If-Match校验后事务插不可变版本／inputs／dependencies及命令，更新current_plan_id。命中尚未执行历史方案则选回；命中已执行方案selected=false，不改当前指针，返回历史执行ID。LLM调用此用例但不能传授权 |
| POST P/tasks/:id/current-plan | {planId,hash} | 200 {plan:PlanDTO,taskRevision}；同事务核验同任务、hash、无该plan执行，更新current_plan_id／task.revision及select_plan命令；已执行409 PLAN_ALREADY_EXECUTED。用于显式选回未执行历史方案，不复制方案或内容 |
| POST P/conversations/:id/confirm | {plans:[{id,hash,taskRevision}]} | 202 command及executionIds；单项／批量同事务全有或全无。授权模式confirm只能来自用户入口；skip_once只由message命令可信上下文触发内部同一用例 |
| POST P/executions/:id/restart | {planHash,taskRevision,acceptUnknownOutcome?:boolean} | 202 {command:CommandDTO,execution:ExecutionDTO}；源必须failed，按8.4短事务创建用户授权的后继执行；无Pi prompt，提交后工作器首次执行，generate／edit各一次图片API调用、process不调用 |
| POST P/commands/:id/restart | {} | 202 CommandDTO；源kind为message／create_conversation且failed，按8.4建立一次新命令；message的skip固定false；创建对话使用新身份；相同源已有后继则返回已有命令 |

上传前没有任务时，页面先用创建任务接口建立“未命名图片任务”，再上传；这是显式两步API，不把文件请求偷偷变成执行。失败保留目标任务，不自动回滚删除。prepare_plan固定工具复用plans用例；新建／读取任务工具只调用所列application边界，不能由LLM伪装HTTP请求获得授权。图片API明确成功但保存失败时保留provider_outcome=success及failed／response_save，不能无文件宣告completed。用户重新开始是独立新执行，可再次产生费用；不同普通幂等键不能代替显式重新开始授权。

第一版提供上述用户restart入口，不提供旧记录原地retry、自动恢复、inspect／acknowledge、cancel、delete、覆盖、项目文件写入及普通Session图片API。不存在端点返回404，不能实现隐藏后门。

### 9.4 页面订阅与服务器推送

页面负责通过写API发起工作，通过SSE声明当前要看的对话／任务，并在用户操作时调用restart重拾失败任务。页面切换、断开和重新订阅只改变展示范围；同一任务可以被零个、一个或多个页面订阅，服务器一律按同一执行规则处理。页面不以轮询或本地推断维护另一份任务状态。

服务器业务控制器／工作器不保存订阅者身份、页面身份、在线状态、观察者计数、最后订阅时间或订阅lease，不把发起页面当作任务所有者；任务受理、排队、执行、终结、通知及Pi句柄释放均不读取订阅信息。既有访问资格及资源归属校验保留，不因“不关注谁订阅”取消访问边界。

仅传输层为每条活跃连接暂存已获准的资源过滤条件、发送队列和清理函数，用于把状态送到正确连接；这些是可释放的内存传输资源，不是业务模型或任务许可。连接建立且订阅有效即推送完整当前快照，之后推送相应状态变化；已结束／失败任务也可随时订阅查看。没有订阅时只提交任务事实，无需缓存给某个页面的事件；以后订阅直接推送当前事实。

GET P/events?conversations=<JSON ID数组>&filter=active|all&taskId=<可选ID>&cursor=<可选游标>&limit=<1..100>：单页一条SSE，conversation订阅上限16，服务端校验所有ID；taskId必须属于已订阅对话。conversations缺省[]，filter缺省active，limit缺省30；重复键、未知键、非法JSON或游标400。返回全局任务列表所选分页快照、所订阅对话DTO及全树／总览Draft、选中taskId的Task／专属Draft／当前Plan／最新Execution及其Asset。所属对话命令进展也随conversation快照返回，不要求客户端轮询commands。动态选择用受控订阅参数重建连接，首次及重连发送完整当前事实，不依赖持久事件回放。读取更多页采用明确用户动作，不轮询。

快照帧含resource、revision、data；单对象使用其持久revision，包含多对象的聚合资源使用服务端对规范化DTO计算的内容hash作为快照标识，不冒用conversation.revision代表所有子对象。对话树使用原生树当前内容hash，不假设Pi额外提供单调版本。command状态变化也须触发conversation聚合快照，选中draft变化触发draft快照；不依赖重写conversation行伪造版本。SQL成功提交后通知重读，Pi原生落盘后通知树更新；内容相同去重，突发变更合并串行读取。合法资源失败以resource_error隔离，保留旧显示并标不可用；连接心跳只保活，不触发业务查询。背压超限仅关闭该连接，页面负责重连并重新声明订阅；取消订阅仅释放本连接的监听和队列，不向控制器发送停止、重拾或恢复意图，也不改变其他连接。

查看方案／执行历史使用GET P/tasks/:id?planCursor=<可选>&planLimit=<1..100>&executionCursor=<可选>&executionLimit=<1..100>，两组分页各自默认30并返回独立nextCursor；单个执行由GET P/executions/:id读取，旧执行终态不再运行，用户重新开始建立独立后继执行。所选分页订阅由taskId跟踪最新执行，历史执行不混入最新结果。SSE资源名固定为tasks、conversation:<id>、tree:<id>、draft:<id>、task:<id>，task快照含当前方案／最新执行／资产，不重复发送二进制。分页快照因排序变化可能移动任务，当前选中仍独立保留；翻页重建订阅取得新页，不扩大为全库轮询。不得让页面为每个节点再GET消息或参考图。任务API与推送是同一控制器投影，不能分别计算一套状态。

## 10. 验收条件与实施交接

全部状态为设计待实施；完成必须有实际验证，不以本文代替。仅按项目规范新增／运行对应API接口测试，临时数据库、临时images和受控Pi／供应商；不操作用户库或启停服务，不常规运行组件／源码断言测试。真实图片API和浏览器验收另行明确执行。

| ID | 必须满足的验收 |
| --- | --- |
| IMG-001 | 仅图片导航入口；普通Session无图片入口；讨论采用配置默认模型，模型不可用明确失败 |
| IMG-002 | 一对话独占Pi原生身份，多任务不复制消息；冷恢复全树原文，损坏不换身份，不挂载bash及任意读写工具 |
| IMG-003 | 无确认零图片调用；改方案拒绝旧确认；同方案普通确认多次点击／不同幂等键最多一个首次执行；只有用户restart可建立后继，跳过仅本次生效 |
| IMG-004 | 一任务／多任务／一执行多产物均可；批量确认一项错误全部不受理；依赖缺图不能执行，选图后新版本重确认 |
| IMG-005 | 所有事实SQL持久；客户端断开不取消当前正常运行；进程重启后旧queued／running／processing均failed，零自动派发／续跑；新受理才启动工作 |
| IMG-006 | 用户取消／删除不可用；供应商503、超时、下载失败、Pi错误后无隐式重试；刷新／SSE／重启不增加请求数，只有用户显式restart产生新请求 |
| IMG-007 | GPT／Gemini受控适配分别验证生成与参考图修改、参数拒绝、能力版本变化和认证缺失，不偷偷换供应商 |
| IMG-008 | 文件均归images/taskId；跨任务可引用不可变资源；拒绝路径越界／符号链接／SVG外链；原图与失败部分产物不自动清理 |
| IMG-009 | 单母图输出九个精确尺寸PNG及正确命名、比例和透明补边；成功必须九图ready，保存失败保留真实阶段 |
| IMG-010 | 页面负责发起／订阅／用户重拾，服务器对有效订阅推送初始及变化状态；任务栏active/all及分页、当前选中、执行历史忠实投影，无业务轮询或隐式任务取消 |
| IMG-011 | 同时编辑版本冲突、命令响应丢失保持幂等，无重复执行／伪成功；进程中断记失败不补成功；成功后带原If-Match重放返回原结果，不被当前版本误拒绝 |
| IMG-012 | A／B任务及对话总览各有独立持久草稿；切换、保存失败、多客户端冲突、发送清空和迟到结果不串输入／参考图 |
| IMG-013 | 讨论失败保留原始输入和树；页面重新开始产生新command且skip=false，不覆盖新草稿，不自动续旧轮；历史损坏明确报错，可由用户新建对话 |
| IMG-014 | 同对话通知与prompt串行；通知错误／中断直接failed，不补发、不核对补delivered；页面仍显示SQL产物，不因通知失败重新生成 |
| IMG-015 | skip限额在页面明确展示并存命令，超任务数／调用数／母图数／输出数或LLM改写硬约束时零自动图片调用；缺必要信息等待确认 |
| IMG-016 | DB复合FK拒绝错归属；staging可缺元信息而ready不可；failed必填finished_at，外部不明保留provider_outcome=unknown；旧失败不改成功 |
| IMG-017 | image-profiles.json损坏／未知能力／认证方式不符明确不可用；process无图片profile仍可用；配置改变不让queued执行偷偷切模型 |
| IMG-018 | Pi已结束但受理SQL未提交就中断：命令failed、旧skip不执行；已提交但未结束的执行也failed；无论文件是否完整，重启均不自动发起／补成功 |
| IMG-019 | 未执行方案A→B→A可选回，旧taskRevision确认拒绝；已执行方案不能借普通选择／确认重做，但失败后用户restart可复用相同plan建立新execution |
| IMG-020 | 封存前后／rename后但ready提交前中断均保留残留、旧staging记missing，不扫描补ready或补执行成功；用户重新开始使用新asset／目录，不覆盖旧文件 |
| IMG-021 | API完整传递inputs的用途／顺序，process源图与sourceIndex对应；输出键缺失、重复、计划外键、尺寸／格式错误均不能completed，九尺寸逐项对应正确文件 |
| IMG-022 | DTO及推送投影失败、输入快照、部分产物与notification.failed；不提供inspect／acknowledge；用户restart返回明确后继身份，旧失败可继续查看 |
| IMG-023 | 用户restart允许同要求／同plan，不自动改参数；旧failed保持终态，新execution／文件独立；同源双击／不同幂等键最多一个后继，连续失败可逐项重新开始 |
| IMG-024 | 外部结果不明仍显示本地failed及未知副作用；restart需用户明确接受可能再次生成／计费，不后台查询或等待解除门禁；源未失败、任务忙、参数版本冲突拒绝 |
| IMG-025 | 同任务零订阅、单页及多页订阅下执行结果与Pi句柄策略一致；建立有效订阅立即取得当前状态，断开／切换／背压只清理对应传输连接，不触发取消或重拾；服务器业务不维护订阅者身份／在线状态／计数 |

正式开发交接顺序：需求ID→02表与约束／迁移映射→03 API及事务→01 Pi与基础设施归属→04布局投影→定向接口验收。建表目标需提供完整DDL及迁移预检供审查；历史库迁移由用户另行决定，不在应用启动中自动执行。

仍需在开发环境核实的是具体供应商模型的真实能力、Pi禁止隐式重发路径和组件适配结果；这些属于实现验证，不允许开发者因此自行改变上述用户行为。生产凭据及准确modelId由部署提供，缺配置明确不可用，不为填满文档虚构可用配置。
