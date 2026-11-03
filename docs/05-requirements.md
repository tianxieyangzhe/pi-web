# 05｜需求：模型与 API 的完成条件

本文决定做什么、不做什么，以及何时算完成。每项需求使用稳定 ID，并只按两个要点验收：模型事实是否正确，API 是否按契约读写模型并使用规定的 Pi 能力。

页面只验证它是否忠实显示 API 结果。需求不复制 `02` 的字段或 `03` 的完整流程，只引用它们。没有需求 ID 和验收条件的行为不得实现。

测试通过只证明本文件已记录的条件，不替代其他四份文档。默认只运行受影响的函数级或 API 测试。

## 当前规则

### 项目会话正式版 v1.0.0：功能完整

用户已确认本轮项目会话功能基线，并要求提交与标记正式版；Git 标记为 `project-session-v1.0.0`。本版包括项目独立执行、原生身份恢复和句柄复用、服务端订阅与 ping/pong、完整 Pi Session Tree、紧凑节点展示、内联图片/文件/大段文本、候选块光标操作，以及本轮附件归组和可靠原生关联；协调会话共用的订阅与展示改动一并纳入本次提交。

这是项目会话的功能完整版本标记。以下各项历史验证记录继续保留，明确区分已通过的定向测试与未执行的真实模型、浏览器及部署现场验证；版本标记不将未执行检查改记为通过，不扩大到其他模块的需求完成状态。提交未执行历史迁移、用户数据库写入、服务启停或远程发布。

## 1. 产品定义
~~~text
Bot：长期协调 Agent、Project 范围和并发上限
 └─ 协调会话：独立协调 Pi
     ├─ 原始输入：用户提示词只保存一次
     ├─ 项目调用：调用 ID、实际发送内容、状态、transcript 边界
     └─ 项目 Session：同一协调会话和项目只复用一个，并拥有独有 SessionMemory
协调依据：绑定 Agent.md 的职责边界 + 项目调用返回的 assistant 原文
左侧入口：Bot → 协调会话；Project → 独立项目 Session
~~~

核心工作是按项目职责选择 Agent、复用同一项目 Session，并通过项目调用取得证据。不能为每次调用无条件创建 Session，也不能把一次项目失败写成协调会话失败。字段见 `02`“协调会话”，流程见 `03`“协调会话 API”，页面见 `04`“Bot 总对话与多 Session 协作页面”。

## 2. 当前范围
- 本轮新增 Bot 协作设计：Bot 有固定工作目录，包含多个独立总对话；项目会话通过固定父归属关联总对话并由 Bot 调度，Pi 仍为唯一 Runtime。左侧分别按 Bot 和 Project 分类展示入口；独立项目会话保留。字段以 `02`、流程以 `03`、页面以 `04` 为准。
- SessionMemory 相关持久数据只使用 `session_memories` 一张表；`sessions` 是已有独立实体表。不存在 `旧项目关联表`、`旧内容表`、旧条目、旧提案 或其他 SessionMemory 关联表作为本版目标结构。
- SessionMemory 模板的 `projectId` 为空；SessionMemory 的 `projectId` 必填。模板复制后成为独立SessionMemory，不能直接绑定 Session 执行。
- 每个项目 Session 必须绑定一个SessionMemory；同一SessionMemory 只绑定一个 Session，二者 Project 必须一致。
- Agent 就是角色，定义以版本化 Markdown 为准且没有 owner。Bot 配置显式建立运行关系，见 `02`“Agent Markdown 与 Bot 绑定”。项目 Agent.md 只提供功能、职责和边界；实际权限由用户选择与应用支持决定。其他资源另行设计，SessionMemory 不保存资源配置。
- SessionMemory 内容存数据库。Pi transcript、Runtime 句柄、模型上下文和工具执行记录不复制到 SessionMemory。

## 3. SessionMemory 需求
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| SMEM-001 | 待实现 | 项目 Session 与 SessionMemory 一对一 | 创建 Session 与SessionMemory 在同一事务完成；Session.sessionMemoryId 必填且唯一；数据库和应用均拒绝跨 Project、模板 SessionMemory 或重复绑定 |
| SMEM-003 | 待实现 | SessionMemory 单表结构 | contextJson 保存当前结构，历史 draftJson 原样兼容但不参与运行；游标与当前内容事务更新 |
| SMEM-007 | 待实现 | 独立总结互斥 | 同记忆至多一个总结任务，新增回答积累后续处理；历史草稿不阻塞、不自动采用 |
| SMEM-006 | 待实现 | 仅总结展示 | SessionMemory 内容、校正和模板只供展示及独立总结，不注入主 Pi 系统提示词、用户消息或原生 custom message |
| SMEM-008 | 待实现 | SessionMemory 内容边界 | 仅保存摘要、目标、约束、重要事实、决策、下一步和产出摘要；不保存工具/扩展/Agent/MCP/Skill 配置、原始思维链或完整 transcript |
| SMEM-009 | 待实现 | 模板与项目隔离 | 模板无项目执行上下文，复制时清除项目路径和历史内容；模板后续变动不自动更新SessionMemory |

| SMEM-002 | 待实现 | 模板直接初始化 | 创建时预览并复制模板至 contextJson，新 Session 的记忆面板直接展示初始内容，不建立草稿、不影响主请求 |
| SMEM-005 | 待实现 | LLM 直接更新 | 自动和手动总结通过校验后直接写当前记忆和游标；无需确认，过期结果不得覆盖人工修改 |
| UI-016 | 待实现 | 总结状态 | 顶部提供立即总结，完成后刷新当前记忆，无草稿审核区域 |
| UI-017 | 待实现 | 模板初始化入口 | 创建时选择模板并预览，复制后只初始化新会话指导线展示 |
| SEC-003 | 待实现 | 主线隔离 | 主请求使用 Pi 原生上下文、固定应用指导、绑定角色及显式输入；记忆不改变提示词、工具或压缩，历史记录不重写 |

| SMEM-004 | 待实现 | 每次回答实时同步 | 每次完整公开回答后立即用 LLM 增量更新，取消五次周期与 30 秒冷却；单记忆至多一个任务，追加回答继续处理，失败或空结果不推进游标 |
| SMEM-010 | 待实现 | 手动总结 | 立即总结共用自动总结流程，结果直接更新记忆；无新来源时反馈，不调用 LLM |

### 本轮会话区整改验收

| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| PSES-008 | 正式版功能完整；验证范围见记录 | 服务端主导会话订阅 | 项目与协调会话使用独立于消息 POST 的 SSE；打开并订阅后复用 Pi 句柄。服务端发出连接级 ping，页面仅收到后 POST pong，无页面定时保活或 transcript 轮询。应答严格匹配连接、会话及未过期挑战；多页面互不覆盖，断线释放该页面使用权但不伪造执行终态，后台使用权独立。重连重新打开、先订阅后读快照，去重及关联按 `03`，不自动重发输入；异常与未知明确显示。 |
| PSES-011 | 正式版功能完整；定向验证通过 | 本轮附件归组与原生关联 | 参考 custom_message 可可靠关联原生 entry，不残留重复临时块；唯一后继链（允许首轮 system 消息）通向用户消息时附件显示于该用户正文后，只投影一次，完整内容可查看；分叉、无用户子节点或无法确认关联时不猜测、不丢失节点。 |
| PSES-010 | 正式版功能完整；验证范围见记录 | 图片与大段文本粘贴 | 项目与协调输入框支持粘贴 PNG/JPEG/GIF/WebP，缩略图可移除；上传/项目文件及粘贴材料均在输入区光标处内联插入，不在工具栏下方显示；选择/键盘删除同步移除发送材料，弹窗返回恢复插入位置；超过 10 行或 1000 字符仅显示粘贴行数，原文不丢失；短文本原生粘贴，支持附件单独发送；遵守 references 混合限额，校验失败不丢输入、接受前失败保留材料，不污染切换后的草稿。 |
| PSES-009 | 正式版功能完整；定向验收通过 | 恢复会话不重复记录相同配置 | 项目与协调 Runtime 共用初始化适配；仅配置节点的空会话重复恢复不增加相同 model_change/thinking_level_change，不改变叶子或历史字节；实际变化及缺失配置仍记录，按当前分支比较，其他分支不干扰；失败恢复原方法，旧重复节点保留。使用临时目录和受控 SDK 初始化验证，不访问真实模型或用户历史。 |
| UI-041 | 正式版功能完整；验证范围见记录 | 紧凑 Tailwind Pi 对话流 | 两类会话共用全树对话流；正文安全 Markdown、thinking 和完整工具内容可查看，原始节点可展开；分支与活动路径不丢失。采用 `04` 紧凑 Tailwind 间距，无多层大 padding、固定消息高度或内容截断。定向投影测试覆盖消息、分支、未知块及敏感原文；真实浏览器外观仍需单独验收。 |

PSES-011 验证记录：`tests/native-session-subscription.test.cjs` 验证 custom 原生对象关联、通知前已追加时同步发送 entry_link、真实 Pi sendCustomMessage 及普通消息/工具关联；`tests/reference-tree-projection.test.cjs` 验证完整原文保留、唯一归组、不跨分支及无法归组时保留；`tests/session-tree-projection.test.cjs` 复验原始内容；`tests/pi-reference-integration.test.cjs` 使用 Pi 内存 Session 和受控模型流，验证首次 system 节点及恢复后多轮附件归组，并保留模型请求的本轮材料隔离。共 10 项通过，类型检查与 diff 检查通过。未调用真实模型、改写用户历史或操作服务，浏览器体验待验收。

PSES-010 候选块光标修正：`tests/inline-composer-editor.test.cjs` 九项通过，新增验证块前后独立光标边界、插入完成后光标落在块后、左右键整块跨越、连续候选不嵌套或跳过、Backspace/Delete 整块删除，以及光标占位字符不进入发送正文；原有上传、项目文件选择、替换、失败恢复与 IME 用例同时通过。类型检查通过。使用 DOM 测试环境，真实浏览器光标视觉仍待现场验证。

PSES-010 光标内联整改验证：`tests/inline-composer-editor.test.cjs` 使用 jsdom 和 React DOM 验证光标/选区插入、图片与上传的原位置、项目文件弹窗返回、删除与替换时材料同步、失败恢复、会话切换、换行与 IME；jsdom 仅为开发测试依赖。结合 `tests/message-references-composer.test.cjs`、`tests/prompt-input-submit.test.cjs`、`tests/prompt-input-ime.test.cjs`、`tests/clipboard-input.test.cjs` 共 24 项通过，类型检查与 diff 检查通过。旧的工具栏下方附件列表规则已由本轮输入区内联块替代；未启动服务、调用真实模型或操作用户数据库，真实浏览器视觉及系统剪贴板待验收。

PSES-010 定向验证：`tests/clipboard-input.test.cjs` 覆盖短文本原生粘贴、长文本完整字节与行数、图片类型和字节、混合限额；`tests/prompt-input-submit.test.cjs` 覆盖仅粘贴附件发送、失败保留、接受清空、切换草稿隔离及原有恢复；`tests/prompt-input-ime.test.cjs` 复验输入法；`tests/message-references.test.cjs` 复验图片/文本解析及服务端校验。共 21 项通过，类型检查及 diff 检查通过。未进行浏览器剪贴板、缩略图视觉或真实模型验收，未操作服务和用户数据库。\n\nPSES-009 完成记录：`tests/session-configuration-initialization.test.cjs` 四项通过，使用已安装 Pi SDK、临时 Session 文件和受控模型 Runtime，覆盖仅元数据会话连续恢复不写文件、配置变化、当前分支隔离、旧重复节点和已有对话保留、缺失配置及失败恢复原方法；定向复验 `tests/project-session-lifecycle.test.cjs` 与 `tests/coordinator-session-initialization.test.cjs` 各一项通过。类型检查通过，未调用真实模型、操作用户数据库或改写用户历史。

本轮替代 PSES-007 的独立 heartbeat 续租和 PSES-002 的页面周期快照规则；具体 API 仅在 `03` 定义。SessionMemory 和检查面板的独立读取策略不在本轮取消范围。

本轮整改定向验证共 28 项通过：`tests/session-subscription.test.cjs` 覆盖服务端挑战、应答隔离、超时与 SSE 取消；`tests/session-subscription-client.test.cjs` 覆盖被动 pong、重连、不重发消息与 JSON 接受；`tests/session-subscription-execution.test.cjs` 覆盖已接受执行在页面断开后继续；`tests/session-presence.test.cjs` 覆盖多页面、重开取消超时和真实结束前不释放；`tests/native-session-subscription.test.cjs` 覆盖 message_end 后可靠关联及工具调用关联；`tests/coordinator-session-subscription.test.cjs` 覆盖协调并发打开、幂等键和独立使用权；`tests/coordinator-session-initialization.test.cjs` 使用临时目录覆盖空会话身份恢复与损坏不重建；`tests/session-tree-projection.test.cjs` 覆盖全分支、未知块、thinking 与原始工具内容。另定向复验 `tests/project-session-lifecycle.test.cjs`、`tests/project-session-stream.test.cjs`、`tests/project-session-tree.test.cjs`、`tests/coordinator-diagnostics.test.cjs`、`tests/prompt-input-submit.test.cjs`、`tests/prompt-input-ime.test.cjs`。类型检查及 diff 空白检查通过；未运行全量测试、生产构建、真实模型或浏览器验收。未操作运行服务或用户数据库，未执行迁移；不能将上述记录当作整体现场验收完成。

## 4. 项目资源与 Session
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| RES-001 | Agent 目标已修订；资源边界持续约束 | 资源明确归属 | Project是执行边界；Agent 独立无 owner，由 Bot/Session显式关系和版本引用使用，参考项目不自动授权；其他资源复制为项目实例后使用 |
| RES-002 | Agent 旧复制规则被替代 | 模板和角色版本 | Agent 保持独立版本定义、显式采用；其他项目模板复制独立实例后使用，能力不覆盖固定模型或凭据 |
| RES-003 | 待设计 | 资源基础模型独立 | Agent 按 `02`“Agent Markdown 与 Bot 绑定”，其他资源另行设计，不借 SessionMemory JSON 实现 |
| PSES-001 | 修复已接入，用户库触发器已迁移；真实模型待验证 | 项目 Session 独立执行 | Session 固定绑定 Project 和 SessionMemory；项目 Agent 可选且不决定项目读写工具。无角色、历史角色或停用角色可发送；项目文件操作受项目路径保护和用户意图约束。空角色可在目标库创建，旧库不自动迁移。项目消息直接进入 Pi，停止覆盖排队、启动和运行，项目调用 `unknown` 保持待核对。 |
| PSES-007 | 项目会话代码已接入；完整边界待验收，Bot 未改 | 页面打开与 Pi 句柄生命周期 | 选中项目 Session 或协调会话时建立或恢复对应 Pi Session，展示其完整 Session Tree 和活动分支；首次空会话可恢复身份及历史只读恢复须先解决 `03` 的实现闸门；发送复用已打开句柄并调用 prompt，不在发送时创建新 Session。切离后空闲句柄释放；运行中的会话继续，结束后释放，切离且无其他页面使用达五分钟仍运行则请求中止并等待真实结束。重新打开取消待释放；多页面、后台项目调用、事件竞态、断线、重启及失败按 `03` 处理；不删除历史、不重复发送、不伪造完成，测试覆盖这些边界。 |
| PSES-006 | 代码已接入；真实模型和浏览器待验证 | 会话参考文件 | 输入框提供独立的本地上传和文件参考两个入口；参考通过目录浏览选择，不输入路径。项目会话限所属项目；协调会话可选 Bot 自身工作目录和绑定的活动项目，即使目录与项目重叠也可用于本轮显式参考；材料可多选和移除，已选项位于紧邻的两个入口下方，且不与输入框边线重叠；发送后消息下方不标注文件。本次选中的材料仅供该次用户输入发起的运行使用，不随下一次输入自动进入模型请求，不建立持续授权。接受前失败保留输入和选择。 |
| UI-040 | 待实现并验证 | 项目会话等待反馈 | 发起项目消息后，在运行且尚未展示本轮文本、thinking 或工具活动时显示“正在思考”及转圈；展示其中任一内容、结束或失败后不再显示。该提示仅表示等待响应，不表示实际模型 thinking，不进入 transcript。 |
| PSES-005 | 待验证 | 项目消息延迟诊断 | 服务端按一次发送记录阶段耗时，区分 Pi 句柄复用/创建/恢复、prompt、首个 assistant 流事件、首段可见文本、首个工具活动和完成或失败；另以流 turnId 关联服务端首段文字入队及完成事件、浏览器收到对应事件的时间，区分传输与生成延迟。各端耗时各自基于单调时钟，跨端时钟可能不同；不记录消息、思考、工具参数/结果、文件路径或密钥，不影响流和执行结果。 |
| PSES-002 | 项目会话代码已接入；完整边界待验收，Bot 未改 | Pi Session Tree 完整投影 | 项目和协调会话的 messages API 恢复所属 Pi 的全部分支及节点，保留节点身份、父子关系、原生追加顺序和活动叶子；内部节点、thinking、原始工具参数和敏感结果不因类型或内容过滤。活动指针、异常节点、空树、读取错误和重启恢复按 `03` 如实返回；按部署边界校验读取许可和归属、禁止缓存及日志泄露，覆盖事件订阅竞态、临时关联、只读页面快照和重连，运行事件按原生树核对，不伪装为空历史或持久节点；不复制持久对话、不改历史。 |
| PSES-004 | 待实现 | 用户手动原生上下文压缩 | 创建和恢复 Pi Session 都关闭自动压缩，仅用户页面点击调用原生压缩；溢出不自动压缩重试，压缩不计回答、不改变记忆同步游标，历史继续可恢复 |

PSES-002 / PSES-007 项目范围定向验证：`tests/project-session-tree.test.cjs` 覆盖多分支、敏感内容、只读历史及损坏版本；`tests/project-session-lifecycle.test.cjs` 覆盖并发打开、租约、发送复用与逐轮写入许可；`tests/project-session-optional-role.test.cjs` 覆盖独立项目工具的逐轮写入门禁；`tests/project-session-stream.test.cjs` 覆盖原始流、禁缓存、租约传递、UTF-8 解码及断线后继续消费。类型检查通过。未验收真实模型、浏览器、五分钟中止、崩溃恢复及全部竞态；协调会话不在本次范围，不能标记整体完成。

PSES-006 已选文件位置调整验证：`tests/message-references-composer.test.cjs` 覆盖两个入口下方的已选列表、选择与移除，7 项通过；未进行真实浏览器验收。

PSES-006 历史参考范围修正验证（其中不投影文件标注的测试只证明当时行为，不代表当前 Session Tree 投影）：`tests/message-reference-scope.test.cjs` 验证上下文与压缩过滤、Pi 内联扩展加载；`tests/pi-reference-integration.test.cjs` 使用内存 Pi Session 和假模型流验证本轮、下一轮及恢复后请求；`tests/transcript-projection.test.cjs` 验证不投影文件标注；`tests/message-references-composer.test.cjs` 验证输入区间距规则；`tests/message-upload-api.test.cjs`、`tests/bot-reference-files-api.test.cjs` 验证消息旧服务门禁；`tests/message-references.test.cjs` 验证参考范围与内容。上述定向测试、`tests/project-message-stream-acceptance.test.cjs` 与类型检查通过。`tests/coordinator-conversation-api.test.cjs` 因测试配置的临时数据库路径与当前固定路径约束冲突，初始化前失败；未改用用户数据库。真实浏览器及模型未验收；未操作运行服务或用户数据库。

PSES-006 已选文件与消息标注验证：`tests/message-references-composer.test.cjs`、`tests/prompt-input-submit.test.cjs` 覆盖入口布局规则、选择与草稿；`tests/message-references.test.cjs`、`tests/transcript-projection.test.cjs` 覆盖安全文件名、Pi 内存历史关联和失败边界；`tests/message-upload-api.test.cjs`、`tests/bot-reference-files-api.test.cjs` 覆盖接受和旧服务保护，定向测试及类型检查通过。未进行真实浏览器或模型验收，未操作服务或用户数据库；旧关联消息没有文件名时不补写。

PSES-006 Bot 工作目录来源验证：`tests/message-references.test.cjs` 覆盖会话归属、混合快照、工作目录重叠和敏感路径；`tests/bot-reference-files-api.test.cjs` 覆盖目录路由和缓存保护；`tests/message-references-composer.test.cjs` 覆盖默认来源和文件选择；`tests/bot-project-boundary.test.cjs` 覆盖普通浏览边界。23 项通过，类型检查通过；未验收真实浏览器或模型，未操作服务或用户数据库。

PSES-006 双入口验证：`tests/message-references.test.cjs` 覆盖混合限额、项目归属和项目文件安全读取；`tests/message-references-composer.test.cjs` 覆盖上传、目录浏览和失败保留；`tests/message-upload-api.test.cjs`、`tests/bot-reference-files-api.test.cjs`、`tests/project-message-stream-acceptance.test.cjs`、`tests/prompt-input-submit.test.cjs`、`tests/bot-project-boundary.test.cjs` 覆盖消息接口、缓存保护、草稿和目录边界，共 26 项通过，类型检查通过。真实浏览器及模型未验证，未操作服务或数据库。

PSES-006 本地上传验证：`tests/message-references.test.cjs` 覆盖内容校验与 Pi 发送，`tests/message-upload-api.test.cjs`、`tests/bot-reference-files-api.test.cjs` 覆盖消息 API 限额和旧服务保护，`tests/message-references-composer.test.cjs`、`tests/prompt-input-submit.test.cjs` 覆盖上传、移除和失败保留，`tests/project-message-stream-acceptance.test.cjs`、`tests/bot-project-boundary.test.cjs` 覆盖接受语义和普通浏览边界，共 20 项通过，类型检查通过。未调用真实模型或浏览器、未操作服务或数据库；Pi 不可见原生历史保留上传快照。

PSES-006 工作目录重叠修复验证：`tests/message-references.test.cjs` 覆盖工作目录及嵌套目录参考快照和路径保护；`tests/bot-reference-files-api.test.cjs` 覆盖旧消息服务保护；`tests/bot-project-boundary.test.cjs`、`tests/message-references-composer.test.cjs` 覆盖普通预览边界与选择入口，共 19 项通过，类型检查通过。未操作运行服务或数据库，现场待用户验证。

PSES-006 目录不可用修复验证：`tests/bot-reference-files-api.test.cjs` 覆盖缓存旧服务下的列表调用和含参考消息拒绝；`tests/message-references.test.cjs` 覆盖目录错误和参考范围；`tests/bot-project-boundary.test.cjs`、`tests/message-references-composer.test.cjs` 覆盖预览边界和选择入口，18 项通过，类型检查通过。现场错误原因未经服务日志确认。

PSES-006 重叠目录调整验证：`tests/bot-reference-files-api.test.cjs` 覆盖参考列表路由；`tests/message-references.test.cjs` 覆盖会话归属、绑定重叠、未绑定拒绝和消息读取；`tests/bot-project-boundary.test.cjs` 覆盖常规预览边界；`tests/message-references-composer.test.cjs` 覆盖选择入口，共 17 项通过，类型检查通过。居中样式尚未真实浏览器验收。

PSES-006 手动路径调整验证：`tests/message-references-composer.test.cjs` 覆盖弹窗、默认目录、手动跳转及越界拒绝；`tests/message-references.test.cjs` 覆盖服务端目录边界和文件范围，12 项通过；类型检查通过。未进行真实浏览器验收。

PSES-006 工作目录与对话框调整验证：`tests/message-references.test.cjs` 覆盖 Bot 工作目录及绑定项目范围、文件快照与重叠保护；`tests/message-references-composer.test.cjs` 覆盖模态入口、默认来源和请求参数；`tests/prompt-input-submit.test.cjs` 覆盖草稿保护。13 项通过，类型检查通过；未进行真实浏览器或模型验收。

PSES-006 此前代码验证：`tests/message-references.test.cjs` 覆盖选择范围、项目和 Bot 消息、Pi 关联材料及文件安全；`tests/message-references-composer.test.cjs` 覆盖选择保留与 API 参数；`tests/project-message-stream-acceptance.test.cjs`、`tests/prompt-input-submit.test.cjs`、`tests/prompt-input-ime.test.cjs` 覆盖流接受、草稿与输入法。共 15 项通过，类型检查通过；未调用真实模型、服务或用户数据库，真实浏览器和图片模型能力待验证。

UI-040 历史代码验证（未覆盖当前 thinking 展示契约）：`tests/project-session-waiting.test.cjs` 覆盖等待时的状态文字和转圈，以及首段文字、工具活动或结束后隐藏；2 项测试和类型检查通过，真实浏览器待验证。

PSES-005 代码验证：`tests/project-message-timing.test.cjs` 覆盖阶段顺序、去重、失败和日志内容边界；`tests/session-execution-cancel.test.cjs` 覆盖停止链路。5 项测试与类型检查通过。流诊断追加验证：`tests/project-message-stream-timing.test.cjs` 覆盖首段与完成事件的入队、解析、关联及日志隐私；`tests/project-message-stream-acceptance.test.cjs` 覆盖流接收语义，4 项测试通过；真实服务及模型耗时待复验。

此前无角色只读限制已被用户要求撤销；此前测试只证明当时行为，不证明当前验收条件。`tests/project-session-optional-role.test.cjs` 验证目标空库无角色创建、非法绑定拒绝、工具及路径边界；`tests/session-execution-optional-role.test.cjs` 验证无角色、历史及停用角色发送；`tests/session-execution-cancel.test.cjs` 验证停止链路。针对性测试及类型检查通过；未做真实模型验证。用户授权后，`tests/optional-role-migration.test.cjs` 在临时库验证迁移，原库离线替换角色必填触发器并备份；完整性和外键检查通过，4 条 Session 和 4 条 SessionMemory 保留。

## 5. 页面需求
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| UI-001 | Project 新建入口与直接打开已浏览器验收；仅适用于独立 Project Session | 项目导航与历史会话 | Project 是独立项目入口；“新建项目”按钮与 Bot 新建按钮并列在 Project 分区标题行，不放在顶部快捷操作；独立 Session 记录按当前记忆摘要命名、空会话显示“新会话”；Bot 管理的项目 Session 归属与导航以 UI-036 为准。点击独立项目会话收起右侧面板、文件预览及所有浮窗，不自动切成检查。 |
| UI-007 | 待实现 | Session Tree 对话流 | 项目会话和协调会话按 API 返回展示整棵树和所有分支，标明分叉与活动路径，共享节点不重复；内部节点、thinking 和完整工具结果可查看。实时显示不伪造持久节点，重连后与 Pi 树一致；回答安全渲染 Markdown。 |
| UI-011 | 现有实现待复验 | 项目优先布局与文件 | 侧栏浅灰蓝、文字中性、选中浅绿；导航可收缩；文件树非 Git 也可用，文件预览插入主画布和文件/检查共用列之间，路径显示项目绝对根目录，代码预览不用深色背景 |
| UI-013 | 现有实现待复验 | Next 单应用分层 | 页面、Feature、Hook、API Client、领域协议与服务端分层；页面不承载事件解析或业务编排 |
| UI-018 | 待设计 | 项目资源页面 | 项目实例在所属 Project 下管理和调试；项目为空的模板在模板库展示；详细交互随资源基础模型确定 |
| UI-019 | 待实现 | 原生上下文检查与压缩入口 | 检查显示已用/容量/剩余 Token、占比、测量口径与时间、自动压缩关闭状态、最近压缩时间和手动按钮；未知指标不伪造，繁忙禁用，完成刷新，失败可手动重试 |
| UI-025 | 历史导航基线，由 UI-036 替代其 Bot Session 所在层级 | Bot/项目共享选择 | 保留单一 WorkspaceSelection、互斥 active、展开不抢选中、刷新不抢选中、创建后进入对应资源；Bot 项目 Session 的父级与唯一导航入口按 UI-036。 |
| UI-036 | 代码已接入；Session transcript 标签按 UI-037 验收；协调会话直接删除待验收 | Bot→协调会话→项目 Session 三层导航 | Bot 项目 Session 作为唯一子项出现在所属协调会话下，不在 Project 树重复；独立 Project Session 继续出现在 Project 树。单击协调会话后通过 UI-037 标签切换到真实项目 Session transcript，第三层导航进入同一 Session 的完整画布；不维护存根输出副本。选择状态全局唯一，展开不抢选中，切换关闭右侧面板/预览/浮窗；后台工作按 PSES-007 保留及超时处理。每条开放协调会话有危险样式删除按钮；确认后直接删除该总对话及其关联项目 Session，不归档。会话尚未结束时强制删除，不等待结束；失败时保留原页。 |
| UI-037 | 待实现完整 Session Tree 投影 | 协调会话与项目会话同结构展示 | 协调画布与项目会话画布均按 UI-007 展示各自完整 Pi Session Tree，通过 Session 标签切换而不混合会话。每次已发起的项目调用额外有一张默认收起的项目输出卡片。`completed` 显示该次 assistant 原文；无原文或读取失败显示错误。其他状态显示状态错误，不伪装成有效输出。没有项目调用时不显示空卡片。Composer 只进入协调会话。提交后立即显示输入和等待响应；202 后保持处理中。发送失败保留草稿并只在 Composer 显示，不产生未处理异常。同一协调会话在打开期间复用 Pi 句柄，切离后的生命周期按 PSES-007。 |
| UI-039 | 代码已接入；针对性测试及类型检查通过，真实浏览器待验证 | 提交后的输入框 | 项目及协调会话提交时立即清空输入框并在对话中回显，不等待长流结束；发送失败仅在原会话草稿未修改时恢复，不能覆盖其他会话或新输入，也不自动重发。 |
| UI-038 | 代码已接入；键盘回归与 TypeScript 检查通过，真实浏览器输入法验收待做 | 输入法安全的对话发送快捷键 | Project 与 Bot 共用 Composer；Enter 发送、Shift+Enter 换行，点击发送按钮行为不变。IME 候选组合期间 Enter 只确认候选且不调用发送，需兼容 composition 状态、`isComposing` 和旧浏览器 `keyCode=229`。 |
| UI-026 | 修订中 | 对话无额外读写勾选 | 项目及协调会话 Composer 不显示读写模式。独立项目工具权限由项目执行策略确定而非角色，实际操作遵循用户请求；协调会话自身与项目调用边界保持独立。 |

UI-025 代码验证（2026-10-09，历史导航模型）：两侧导航统一读取 WorkspaceSelection，资源加载 Hook 不再存另一份项目选中 ID；Bot 首页/总对话/参与会话与项目/项目会话互斥高亮，父项只展开。该历史实现验证中的 Bot 项目 Session 所在层级现由 UI-036 替代。

UI-026 代码验证（2026-10-09）：项目与 Bot 输入区已移除额外读写勾选，浏览器发送消息不再携带 operation；服务端共用绑定角色能力投影，协调者自身写入与派发修改能力分别限制对应工具。固定运行指导要求实际操作遵循用户请求，讨论、读取与问答不擅自修改；只读角色及既有执行范围保持，steer 默认沿用正在执行的范围。新增两输入区静态渲染和角色能力投影回归，70 项测试、类型检查及独立目录生产构建通过。页面视觉和真实模型操作仍待复验；本轮不改数据库或服务进程。

UI-039 验证：`tests/prompt-input-submit.test.cjs` 覆盖流进行时清空与失败草稿保护，`tests/project-message-stream-acceptance.test.cjs` 覆盖流接受和拒绝边界，`tests/prompt-input-ime.test.cjs` 覆盖输入法回归；8 项通过，类型检查通过。未进行真实浏览器或模型验收。

UI-038 实现验收（2026-10-20）：用户反馈普通 Enter 换行的调整不符合页面交互习惯，恢复 Enter 发送、Shift+Enter 换行；保留 composition 状态、`nativeEvent.isComposing` 与旧浏览器 `keyCode=229` 候选保护。项目与 Bot Composer 共用该实现。键盘逻辑回归 2 项、`npm run typecheck` 与 `git diff --check` 通过；真实浏览器输入法端到端验收待做。

## 6. 安全与非功能需求
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| SEC-001 | 待实现 | 项目隔离 | Session、SessionMemory 和执行资源的 projectId 一致；跨项目资源 ID 或模板不能作为运行实例注入 |
| SEC-002 | 待实现 | SessionMemory 输入安全 | 模型上下文不含原始 thinking、未脱敏工具结果、secret、nativeRef 或项目外路径；固定 JSON 与 Markdown 渲染均有长度预算 |
| NFR-001 | 现有实现待复验 | 类型检查与构建 | TypeScript strict 和单应用生产构建通过，服务端依赖不进入客户端 |
| NFR-003 | 待实现 | Token 与生成预算 | 单次总结输入、输出、时间受限；每次完整回答增量同步，单记忆任务互斥；相同候选可按无变化处理；记录可获得的 Token 用量；默认值以 `03`“默认预算”为准，超时/超长均有可见反馈 |
| NFR-011 | 当前决定 | 固定数据库文件 | 数据库固定为 `.data/ai-workspace-v5.sqlite`。保留项目、Agent、Session 和 SessionMemory。已授权删除 `legacy_v5_*` 与旧 Work、Task、Execution、Message 表，并新建 `project_calls`。不得重建数据库文件，也不得把旧调度记录转换成项目调用。 |

## 7. 本轮不做
- 恢复独立于 Bot 的旧跨项目实体、旧路由、旧执行记录或旧编排实现；
- 迁移、读取、备份、改写、清空或重建旧库；
- Bot 记忆、跨 Bot 自动协作、共享依赖目录授权模型、自动发布及真实设备下发入口；这些能力待后续单独定义，不能借当前 Bot 模型隐式实现；
- SessionMemory 子记录表、关系表、独立内容版本系统；
- SessionMemory 内保存或启用工具、扩展、Agent、MCP、Skill；
- 将完整 Pi transcript、原始 thinking 或工具结果写入 SessionMemory；
- SessionMemory 本地 context 文件、第二套 Runtime 或模型选择控件；
- 旧数据库自动迁移、清空或重建。

## 8. 实现顺序与完成定义

新需求只有在代码实现、与风险相称的函数级或 API 测试，以及本表验收条件全部通过后才能标为已验证。默认不运行全量测试、生产构建或真实模型验收；只有用户明确要求，或目标行为无法用函数级和 API 测试证明时才扩大范围。当前文档更新不代表 Schema 或运行时已经完成。旧库不迁移；新库只从空库初始化。

## 9. SessionMemory 实现阶段与验证矩阵
以下是现有需求的实施细化，状态仍为待实现，不表示本次文档已完成代码验收。

| 阶段 | 对应需求 | 实施产物与退出条件 |
| --- | --- | --- |
| 1：结构与安全边界 | SMEM-001～003、008～009、NFR-002/011 | 领域校验、规范化、Hash、临时库 Schema 和原子 Repository；历史库只读影响报告，不自动改写 |
| 3：记忆纠错线 | SMEM-004/007/010/011、UI-021 | 每回答增量同步、安全来源、LLM 更新、人工修正优先与同步状态 |
| 5：端到端复验 | NFR-004、UI-013、NFR-001 | 以下矩阵全部通过，类型与生产构建通过后才标记对应需求已验证 |

| 场景 | 必须观察到的结果 | 对应需求 |
| --- | --- | --- |
| 生成中人工保存当前内容 | 当前生效内容保留；旧生成结果不能落库或推进游标，之后基于最新内容重查 | SMEM-005、NFR-002 |
| 用户手动原生压缩 | 无用户点击不压缩，包括创建/恢复/超过阈值/溢出/刷新；点击只执行一次，繁忙冲突，草稿待审仍可手动压缩；前后回答序号与游标不变，来源历史可读 | PSES-004 |
| 检查用量与容量不足 | 原生值/估算/未知和新鲜度如实展示；手动压缩后刷新，失败不伪造节省；超限提示手动压缩，不能自动重试旧请求 | UI-019、PSES-004 |
| 模型异常 / 超时 / 超长单请求 | 主回复不受影响；失败不推进游标；可见错误，用户重试或下一次成功回答恢复 | SMEM-004、NFR-003 |
| 停用 Project / ended Session / 历史库 | 按 `03` 的编辑与恢复规则处理，旧库写入被明确阻止，记录不被自动删除 | SEC-001、NFR-011 |

验证分为领域/Repository 的针对性测试、使用受控无工具总结器的应用流程测试和真实页面的端到端验收；真实模型调用另做小规模联调，不能用不稳定模型输出取代事务及冲突测试。部署需满足 `01` 的单个长驻服务进程边界。


## 10. Pi 上下文管理验收（2026-10-08）
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| PCTX-001 | 待实现 | Pi 原生上下文为主 | 原生窗口用量读取 Pi getContextUsage；压缩和取消调用 compact/abortCompaction，SessionMemory 与原生控制端口分离，无第二份 transcript 或数据库窗口 |
| UI-020 | 待实现 | 可操作的 Pi 检查区 | Pi 上下文优先展示，用量与状态真实可辨；支持刷新、手动压缩、取消及已有会话恢复；未知值不补零，操作期间保留输入 |

验收包括：读取/刷新不触发模型或压缩；未启动/不可恢复/只读正确限制；取消压缩不会中止主回答、提前释放锁或自动恢复对话；取消与成功竞态按 Pi 实际结果展示；显示估算或未知且隐藏原生正文；原生操作不改 SessionMemory 内容及总结位置。原有手动策略和 SMEM 自动直接更新要求继续成立。本次不新增自动压缩策略、分支编辑或原生消息编辑功能。

2026-10-08 实现验证：已读取 Pi SDK 原生上下文/取消能力声明，完成上下文端口拆分、原生 getContextUsage 估算读取、取消压缩及优先检查 UI。18 项针对性测试和类型检查通过；包括取消保持锁、只读限制与完成/取消竞态。新功能未修改数据库或原生历史；生产构建通过；当前 3000 仍返回旧版 DTO，实际页面联调待用户重新启动加载新代码后复验。


## 11. 记忆纠错线验收（2026-10-08）
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| SMEM-011 | 待实现 | 指导线校正 | 人工校正只作用于当前展示及后续独立总结；旧输出因基线改变失效，不影响正在运行或后续主 Pi 请求 |
| UI-021 | 待实现 | 真实同步状态 | 每次回答立即调度；面板显示 synced/updating/pending/failed/unavailable 及最近时间；共享自适应读取不覆盖本地编辑，关闭面板仍持续同步 |

验证必须覆盖连续第 1/2/3 次回答无周期等待、同一轮多入口只有一次调用、总结期间新回答完成后追赶、人工修改使旧结果丢弃并重新输入修正、无变更来源不调用 LLM、失败不中断主对话、页面不假报同步、历史草稿不阻塞、下一条主 Pi 请求不携带记忆正文。

历史验证（本次展示阶段调整前）：2026-10-08 记忆纠错线实现验证：23 项测试与类型检查通过，生产构建通过；覆盖每回答同步、多入口互斥、追加回答追赶、下一请求读取人工纠正、旧候选不覆盖修正、历史草稿保留、与主回答并行及失败后不无限重试。未修改数据库或服务进程；当前真实模型输出与页面视觉表现仍需运行服务联调，测试通过不宣称 LLM 一定不会误判事实。


## 12. 固定指导模式与展示阶段（2026-10-08）
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| SMEM-012 | 待实现 | 固定指导模式 | 七个字段问题与提炼边界以 02 为准；总结仅使用固定模式，不造新任务、未表达目标或未采纳决策；事实冲突明确区分 |

验证：人工修改前后主请求 open/restore/reuse 均无 memoryContext 注入；主用户文本不变，运行中更新不修改 Pi 提示词或消息；独立总结仍接收校正并直接更新展示，模板只初始化显示；去除界面生效说明。此前历史验证中的“下一请求注入记忆”只代表当时行为，本阶段撤销，不清理历史 transcript 或数据库内容。

2026-10-08 指导线展示阶段验证：26 项测试、类型检查及生产构建通过。测试验证主 Pi 新建/恢复/复用与运行中更新均不携带记忆正文；独立 LLM 总结仍接收当前指导线和公开来源。尚未进行新固定模式的真实模型和页面联调，不把测试声明为模型事实准确性的保证。本次无数据库迁移、历史清理或服务进程操作。

固定总结模式代码验收补充：输入预算包含模式指令和数据正文，超限在创建临时 Pi 总结 Session 前拒绝；验证返回固定七个字段的模式约束与主线无注入。采用保守字节上界，宁可明确预算超限也不静默截断来源。

2026-10-08 优化验收：同步中记忆最多一条共享 2 秒读取链；已同步关闭面板后停止，打开空闲面板 30 秒重查；重复读取并发合并、隐藏暂停、用户操作立即刷新。检查空闲不刷新 Session 列表。该日期记录的执行总览和轮次展示已不再是当前验收条件。

2026-10-08 优化代码验证：32 项测试与类型检查通过，新增自适应轮询停止条件、并发读取合并、卸载忽略迟到结果与活动总览计数/失败展示测试。旧轮询行为的历史验证不作为当前界面频率要求；真实请求频率与视觉仍待当前服务加载新代码后复验。

## 13. 数据模型可读性约束
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| NFR-012 | 持续约束 | 控制表数量与模型理解成本 | 每次新增、合并、拆分、重命名或退役表先按 `02`“表数量与模型可读性”说明必要性、方案取舍、数量变化、紧凑关系总览与历史映射；仅实现当前已定义需求，不将流程或状态机械拆表，不用任意 JSON 掩盖核心关系；结构调整保留历史并遵守显式迁移决定 |

该约束适用于后续全部持久模型设计。用户最新允许按情况调整现有表，取代此前“不精简、保留七表”的限制；现有七表是实现基线，目标不固定表数。可以评估增表、合并、拆分、重命名或退役，不以减表数为唯一目标；协作事实、历史覆盖和核心约束须保留，迁移执行仍由用户决定。

## 14. 开发服务清单读取稳定性
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| NFR-013 | 已验证（当前版本） | 开发编译清单原子替换 | Webpack 开发输出已知 JSON 清单读者不见写入中空内容；文件提交通过同目录临时文件及原子替换；失败保留原清单并返回原错误，普通输出/生产编译保持原行为，不改数据库或 Pi 历史，不吞掉业务解析错误 |

问题证据：用户报告静态路径生成偶发 JSON 空内容错误、随后恢复；只读接口核对返回 200，开发编译时连续采样捕捉到五种清单的同类解析失败。验收需覆盖实际 Webpack 编译与并发读者、失败场景和普通文件输出；真实 Next 开发服务复验在用户重新启动加载配置后进行。

2026-10-08 修复验证：开发 Webpack 增加已知清单原子替换插件，未修改 node_modules、数据库或 Pi 历史。新增四项测试验证写入期间读到完整旧版、rename 失败保留原清单与原错误、普通/输出目录外文件维持直写，以及实际 Webpack 编译产出；全套 45 项测试通过，类型检查和生产构建通过。运行中的 Next 服务加载新配置后，五类清单实际更新，61,495 次采样读取无解析失败；消息、记忆、模板及 Bot API 均返回 200。助手未操作服务启动/停止。此验证针对已捕捉的编译竞态，不作为所有 JSON 或未来 Next 内部变化的保证。

## 15. Agent Markdown 编辑与 Bot 绑定验收（2026-10-12）
本节取代 Agent owner/template 与 Markdown 确定性导入要求。Agent 内容权威改为版本化 Markdown，DB 仅索引及存关系；上传任意 Markdown 一律 LLM 转换；创建/编辑 UI 为独立对话和只读 Markdown 展示；绑定只在 Bot 配置。

| ID | 状态 | 验收条件 |
| --- | --- | --- |
| AGFILE-001 | Agent 列表及编辑工作区的桌面主次按钮经手工浏览器检查；窄屏与键盘焦点待验收 | Agent 列表是居中弹窗；新增在顶部；每行编辑/删除；编辑器不是弹窗，进入后占据主画布与右侧列且保留左侧导航；中间为 Agent 对话、右侧只读 Agent.md；主要、次要、危险按钮外观易区分，Agent 与 Bot 的表单/管理操作均有明确按钮形状；取消回到列表；小屏纵向布局可读 |
| AGFILE-002 | 代码已接入，待真实模型验收 | 选择 Project/目录、指定文件、上传 Agent Markdown 都通过无工具 LLM 生成/修改；来源内容不被执行，也不授予能力或归属 |
| AGFILE-003 | 代码已接入，待真实浏览器验收 | 用户用自然语言意见反复修订；右侧展示当前保存版本/草稿；取消返回角色列表并丢弃未保存草稿，保存新增不可变文件版本 |
| AGFILE-004 | 代码已接入，自动化验证通过 | Markdown frontmatter 输出经严格校验；能力默认关闭且显式授权；DB 快照仅引用 ID/revision/SHA-256，Pi Runtime 读取准确版本文件 |
| AGFILE-005 | 代码已接入，待真实浏览器验收 | Agent 定义创建时无 Bot/Project owner；新建 Bot 才选择 coordinator、项目集合和每项目的 project Agent；新总对话原子继承绑定快照 |
| AGFILE-006 | 用户库迁移完成，完整性/外键核验通过 | 新增关系 Schema 有离线迁移预览；历史 JSON/owner 引用和 Pi transcript 保留；旧正文不自动激活。临时数据库迁移测试通过；用户库迁移及备份已于 2026-10-13 核验 |

## 16. 协调会话验收

| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| BOT-043 | 模型与 API 已重写；桥梁插件待接入 | 协调会话通过项目调用观测和传递 | 页面只使用创建、读取、协调历史、协调输入与事件订阅、PSES-007 的打开/续租/释放及强制删除。协调输入不带目标项目 Session。桥梁插件只显式加载在协调会话，提供读取 Agent、发起、查询、读取返回、修正和放弃六个工具，并立即返回。相同项目、原始输入和实际发送内容重复发起返回同一调用。每次调用保存调用 ID、项目会话 ID、原始输入、不可变实际发送内容、状态和 transcript 起止条目。同一项目 Session 同时只有一个 `accepted` 或 `working` 调用；不同项目受 Bot 并发上限限制。只有 `completed` 才按调用边界读取 assistant 原文；返回不固定格式。`aborted` 和 `unknown` 不继续传递。重启不能恢复边界时进入 `unknown`，未明确放弃前不释放该项目 Session。修正只对 `working` 调用使用 `steer`；放弃只把 `unknown` 改为 `aborted`。 |
| BOT-045 | 代码已接入；现场待验证 | 协调会话项目调用诊断 | 服务端记录协调运行与桥梁工具阶段，以及项目调用保存、排队、句柄、prompt、订阅、结束和失败的安全诊断；只含可信身份、固定阶段、受限错误码与耗时，不含消息、工具参数/结果、路径、密钥或异常正文；日志失败不影响原流程。真实现场根因须依据运行日志确认。 |
| BOT-044 | 当前实现 | 动态项目存在性工具 | 协调会话按当前项目范围动态注册只读存在性工具。描述明确只用于感知项目存在。返回只包含数据库 `projects` 已保存的信息，不读取或写入项目。没有项目 Agent 的项目仍可感知。工具不接受路径、命令或项目操作；项目 Session 不加载该插件层。 |

BOT-045 代码验证：`tests/coordinator-bridge-plugin.test.cjs` 覆盖项目调用启动、排队、失败及诊断隐私，`tests/coordinator-diagnostics.test.cjs` 使用假 Runtime 覆盖协调运行和工具日志隐私；7 项通过，类型检查通过。未重启服务或使用用户数据库，现场原因待日志确认。
