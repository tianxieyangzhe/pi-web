# 05｜需求：模型与 API 的完成条件

本文范围：独立项目与通用需求验收。Bot 的全部专属设计、模型、API、交互与需求统一见 [06｜Bot](06-bot.md)，本文不定义或复写其规则。

本文决定做什么、不做什么，以及何时算完成。每项需求使用稳定 ID，并只按两个要点验收：模型事实是否正确，API 是否按契约读写模型并使用规定的 Pi 能力。

页面只验证它是否忠实显示 API 结果。需求不复制 `02` 的字段或 `03` 的完整流程，只引用它们。没有需求 ID 和验收条件的行为不得实现。

测试通过只证明本文件已记录的条件，不替代其他设计文档。默认只运行受影响的函数级或 API 测试。

## 当前规则

OPS-003（已实现，定向测试通过）：修复Linux旧glibc/SWC回退下next.config.ts扩展解析失败；配置与插件直接由Node加载，不启动服务，定向验证配置导入、webpack插件挂载及原子manifest行为。无模型/API或数据库变更。实际运行tests/atomic-manifest.test.cjs（5项，直接Node导入配置、开发插件挂载、manifest原子写/失败保留及真实临时Webpack编译）、tests/systemd-scripts.test.cjs（3项），共8项通过；npm run typecheck、git diff --check通过。未启动用户服务，未在CentOS实机验证SWC WASM或系统原生库兼容性。

OPS-002（已实现，定向测试通过）：启动默认绑定localhost，支持显式绑定任意本机IP；生产CLI与systemd支持指定本机IPv4/IPv6地址，应用不新增IP白名单。定向验证默认地址与显式覆盖，不改防火墙或用户服务。实际运行tests/systemd-scripts.test.cjs三项通过，含默认localhost、指定IPv4/IPv6及启动脚本覆盖；Bash/Node语法、git diff --check通过。未启动服务或做真实网络连通验收。

OPS-001（脚本已实现，受控测试通过；Linux实机待验）：提供可审查systemd unit生成/安装脚本及生产启动脚本；支持user/system作用域，固定cwd/INIT_CWD、明确运行用户HOME/Node/PATH、端口/监听地址可配、异常重启及journald。缺依赖/构建失败时明确退出，不自动构建/迁移/启停；安装不自动enable/start，已有不同unit默认不覆盖。验证参数与systemd转义、安装写入边界、启动参数/工作目录和预检，使用临时目录和假命令，不碰用户服务/数据库。实际运行tests/systemd-scripts.test.cjs三项通过（unit参数/转义、启动前置检查/exec与配置根、临时unit安装及覆盖保护）；bash -n scripts/start-systemd.sh、node --check scripts/systemd.cjs、git diff --check通过。未生产构建，未调用真实systemctl、安装unit或启停服务；Linux systemd实机验收留给部署步骤。

SLIST-002（实现中）：两类侧栏时间显示持久lastOpenedAt；实际新开连接成功时记录，刷新/消息/心跳/打开幂等重试不变，失败不记录；历史无记录明确显示。标题只来自最新用户输入，无消息显示新会话，无文本输入有占位，不再回退purpose。SessionOpenHistory事实与文件在02定义，API在03，Workspace映射06；无SQL迁移、不改旧数据。

SETTINGS-001（已实现，定向验收通过）：项目新建/设置与工作区新建/设置采用相同主画布布局、目录选择、保存/取消/关闭和等待/失败反馈。Project复用03现有CRUD契约，Workspace复用06配置API；不增加模型、字段或接口，不调用Pi，不迁移SQL。定向验收覆盖POST不含status、PATCH仅变化字段及If-Match、保存等待/失败保留、取消无写入、晚响应不跳回，以及工作区同类反馈。实际运行tests/settings-layout-behavior.test.cjs、tests/workspace-settings-api.test.cjs、tests/catalog-contract.test.cjs、tests/session-auxiliary-dialog.test.cjs，四文件7项通过；补充未修改不提交后再次运行settings-layout-behavior单文件通过。npm run typecheck、git diff --check通过。只用JSDOM、受控API和临时库，未启动服务、调用模型或写用户数据；未做真实浏览器视觉验收。

SLIST-001（已实现，定向验收通过）：用户消息（原生/待确认/实时）右对齐，正文保持正常左对齐；两类左侧会话显示最新原生用户输入预览，单行省略；当前时间与空历史规则按SLIST-002，读取失败明确标记。派生值来自所属Pi树，不写SQL或替代摘要；测试覆盖整树追加顺序、消息时间、无消息和读取失败。实际验证：tests/session-list-preview.test.cjs（2项，纯派生、两类DTO、purpose/ETag保持）、tests/pi-session-fork-export.test.cjs（5项，扩充真实临时原生历史预览及身份读取失败）、tests/session-tree-presentation.test.cjs（2项，新增原生/待确认/实时用户右对齐）、tests/project-session-model-contract.test.cjs（4项）、tests/session-auxiliary-dialog.test.cjs（1项），五文件14项通过；npm run typecheck、git diff --check通过。无真实模型请求、用户库写入或服务启停。

PSES-019（已实现，定向验收通过）：两类Session设置提供模型对应的Pi思考等级，允许仅改等级；PUT model可选thinkingLevel、严格支持校验、耐久幂等与互斥、同一原生身份持久化，不改默认配置/SQL。验收覆盖只读DTO、支持等级、相同值去重、冷恢复、同键异等级、忙碌/unknown和页面显式应用。实际验证tests/pi-session-fork-export.test.cjs（5项，新增实际Pi思考等级持久化/恢复/不支持值拒绝）、tests/project-operation-recovery.test.cjs（5项，新增项目等级幂等与门禁）、tests/workspace-model-recovery.test.cjs（5项，新增HTTP等级透传与冲突）、tests/session-model-settings.test.cjs（1项，扩充同排控件/等级草稿与显式应用）、tests/session-auxiliary-dialog.test.cjs（1项）；五文件17项通过。npm run typecheck、git diff --check通过；仅临时文件和受控Runtime，无真实模型请求、用户数据库/配置写入或服务启停。

MCFG-002（已实现，定向验收通过）：读取settings.enabledModels并按Pi scope语法过滤模型列表与执行选择；当前型号不存在/被过滤/无认证时在同一Session自动采用配置默认型号，默认也不可用才提示。空闲刷新同规则，显式切换不回退，不重发请求；验收覆盖配置来源、范围匹配、默认失败、历史保真和原生model_change持久化。实际验证tests/model-settings-fallback.test.cjs（4项）、tests/pi-session-fork-export.test.cjs（4项）、tests/workspace-model-recovery.test.cjs（4项）、tests/project-session-lifecycle.test.cjs（1项），四文件13项通过；npm run typecheck和git diff --check通过。仅临时配置/文件、受控Runtime和离线流，无真实模型请求、用户库/配置/原生历史写入或服务启停。

SCONN-001（已实现，定向验收通过）：Session只显示打开/关闭，可关闭后重开同一Pi身份；历史ended_at不再终止使用，DELETE实际删除记录。打开后的状态与进度由事件驱动，无定时轮询；覆盖旧已结束记录重开、连接开闭/租约、订阅初始快照竞态、消息/压缩终态、用户关闭不自动重连、真实删除及跨会话晚事件隔离。只用临时库、受控Runtime及最小DOM验证，不改用户历史库。

SCONN-001验收记录：新增tests/session-connection-contract.test.cjs（4项：两类会话历史记录重开/关闭不写SQL/DELETE、关闭互斥与失败保留租约、SSE初始活动快照与明确关闭）和tests/session-event-state.test.cjs（1项：事件驱动进度、主动关闭不重连、晚事件隔离）。相关tests/project-session-lifecycle.test.cjs、project-session-model-contract.test.cjs、session-subscription.test.cjs、session-subscription-client.test.cjs、session-presence.test.cjs、workspace-model-recovery.test.cjs、pi-context.test.cjs、session-deletion.test.cjs、session-auxiliary-dialog.test.cjs均通过；合计11文件33项。最后关闭门禁及传输容错修改后，重跑connection/event-state/lifecycle/subscription/deletion五文件15项通过。类型检查和git diff --check通过；未执行真实模型或真实浏览器验收。

### 项目会话正式版 v1.0.0：功能完整

用户已确认本轮项目会话功能基线，并要求提交与标记正式版；Git 标记为 `project-session-v1.0.0`。本版包括项目独立执行、原生身份恢复和句柄复用、服务端订阅与 ping/pong、完整 Pi Session Tree、紧凑节点展示、内联图片/文件/大段文本、候选块光标操作，以及本轮附件归组和可靠原生关联。

这是此前项目会话基线的版本标记，不涵盖本文新增的会话检查、Pi 配置整改与 SessionMemory 退役。仍适用的验证记录保留；被替代的界面要求不再作为验收条件，历史版本以 git 追溯。提交未执行历史迁移、用户数据库写入、服务启停或远程发布。

## 2. 当前范围

Session 独占 Pi 原生树，Project、Agent、模型配置、消息、工具、附件、订阅、手动压缩与会话检查按各自契约保留。应用级记忆功能整体退役，不保留后台总结、模板、内容校正或自动摘要命名。历史数据处理与目标表调整见 02/06，本轮已实现通用与独立项目代码，定向验证记录见 §16；不操作用户数据库。

## 3. 会话区整改验收

| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| PSES-008 | 正式版功能完整；验证范围见记录 | 服务端主导会话订阅 | 项目会话使用独立于消息 POST 的 SSE；打开并订阅后复用 Pi 句柄。服务端发出连接级 ping，页面仅收到后 POST pong，无页面定时保活或 transcript 轮询。应答严格匹配连接、会话及未过期挑战；多页面互不覆盖，断线释放该页面使用权但不伪造执行终态，后台使用权独立。重连重新打开、先订阅后读快照，去重及关联按 `03`，不自动重发输入；异常与未知明确显示。 |
| PSES-011 | 正式版功能完整；定向验证通过 | 本轮附件归组与原生关联 | 参考 custom_message 可可靠关联原生 entry，不残留重复临时块；唯一后继链（允许首轮 system 消息）通向用户消息时附件显示于该用户正文后，只投影一次，完整内容可查看；分叉、无用户子节点或无法确认关联时不猜测、不丢失节点。 |
| PSES-010 | 正式版功能完整；验证范围见记录 | 图片与大段文本粘贴 | 项目输入框支持粘贴 PNG/JPEG/GIF/WebP，缩略图可移除；上传/项目文件及粘贴材料均在输入区光标处内联插入，不在工具栏下方显示；选择/键盘删除同步移除发送材料，弹窗返回恢复插入位置；超过 10 行或 1000 字符仅显示粘贴行数，原文不丢失；短文本原生粘贴，支持附件单独发送；遵守 references 混合限额，校验失败不丢输入、接受前失败保留材料，不污染切换后的草稿。 |
| PSES-009 | 正式版功能完整；定向验收通过 | 恢复会话不重复记录相同配置 | 项目 Runtime 使用初始化适配；仅配置节点的空会话重复恢复不增加相同 model_change/thinking_level_change，不改变叶子或历史字节；实际变化及缺失配置仍记录，按当前分支比较，其他分支不干扰；失败恢复原方法，旧重复节点保留。使用临时目录和受控 SDK 初始化验证，不访问真实模型或用户历史。 |
| UI-041 | 正式版功能完整；验证范围见记录 | 紧凑 Tailwind Pi 对话流 | 项目会话使用全树对话流；正文安全 Markdown、thinking 和完整工具内容可查看，原始节点可展开；分支与活动路径不丢失。采用 `04` 紧凑 Tailwind 间距，无多层大 padding、固定消息高度或内容截断。定向投影测试覆盖消息、分支、未知块及敏感原文；真实浏览器外观仍需单独验收。 |

PSES-011 验证记录：`tests/native-session-subscription.test.cjs` 验证 custom 原生对象关联、通知前已追加时同步发送 entry_link、真实 Pi sendCustomMessage 及普通消息/工具关联；`tests/reference-tree-projection.test.cjs` 验证完整原文保留、唯一归组、不跨分支及无法归组时保留；`tests/session-tree-projection.test.cjs` 复验原始内容；`tests/pi-reference-integration.test.cjs` 使用 Pi 内存 Session 和受控模型流，验证首次 system 节点及恢复后多轮附件归组，并保留模型请求的本轮材料隔离。共 10 项通过，类型检查与 diff 检查通过。未调用真实模型、改写用户历史或操作服务，浏览器体验待验收。

PSES-010 候选块光标修正：`tests/inline-composer-editor.test.cjs` 九项通过，新增验证块前后独立光标边界、插入完成后光标落在块后、左右键整块跨越、连续候选不嵌套或跳过、Backspace/Delete 整块删除，以及光标占位字符不进入发送正文；原有上传、项目文件选择、替换、失败恢复与 IME 用例同时通过。类型检查通过。使用 DOM 测试环境，真实浏览器光标视觉仍待现场验证。

PSES-010 光标内联整改验证：`tests/inline-composer-editor.test.cjs` 使用 jsdom 和 React DOM 验证光标/选区插入、图片与上传的原位置、项目文件弹窗返回、删除与替换时材料同步、失败恢复、会话切换、换行与 IME；jsdom 仅为开发测试依赖。结合 `tests/message-references-composer.test.cjs`、`tests/prompt-input-submit.test.cjs`、`tests/prompt-input-ime.test.cjs`、`tests/clipboard-input.test.cjs` 共 24 项通过，类型检查与 diff 检查通过。旧的工具栏下方附件列表规则已由本轮输入区内联块替代；未启动服务、调用真实模型或操作用户数据库，真实浏览器视觉及系统剪贴板待验收。


## 4. 项目资源与 Session
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| RES-001 | Agent 目标已修订；资源边界持续约束 | 资源明确归属 | Project是执行边界；Agent 独立无 owner，由 Session 显式关系和版本引用使用，参考项目不自动授权；其他资源复制为项目实例后使用 |
| RES-002 | Agent 旧复制规则被替代 | 模板和角色版本 | Agent 保持独立版本定义、显式采用；其他项目模板复制独立实例后使用，能力不覆盖会话模型选择或凭据 |
| RES-003 | 待设计 | 资源基础模型独立 | Agent 按 `02`“独立项目 Agent Markdown”，其他资源另行设计，不借会话任意 JSON 实现 |
| PSES-001 | 代码已接入；本轮目标Schema定向通过，历史库未迁移 | 项目 Session 独立执行 | Session 固定绑定 Project；项目 Agent 可选且不决定项目读写工具。无角色、历史角色或停用角色可发送；项目文件操作受项目路径保护和用户意图约束。空角色可在目标库创建，旧库不自动迁移。项目消息直接进入 Pi，停止覆盖排队、启动和运行。 |
| PSES-007 | 项目会话代码已接入；完整边界待验收 | 页面打开与 Pi 句柄生命周期 | 选中项目 Session 时建立或恢复对应 Pi Session，展示其完整 Session Tree 和活动分支；首次空会话可恢复身份及历史只读恢复须满足 `03` §5 的精确身份与只读边界，新增契约按 §15 定向验收；发送复用已打开句柄并调用 prompt，不在发送时创建新 Session。切离后空闲句柄释放；运行中的会话继续，结束后释放，切离且无其他页面使用达五分钟仍运行则请求中止并等待真实结束。重新打开取消待释放；多页面、后台执行、事件竞态、断线、重启及失败按 `03` 处理；不删除历史、不重复发送、不伪造完成，测试覆盖这些边界。 |
| PSES-006 | 代码已接入；真实模型和浏览器待验证 | 会话参考文件 | 输入框提供独立的本地上传和文件参考两个入口；参考通过目录浏览选择，不输入路径。项目会话限所属项目；材料可多选和移除，按 PSES-010 插入输入区光标位置，不在两个入口下方另设已选列表；发送后的参考节点按 PSES-011 归组，完整原文仍可查看。本次选中的材料仅供该次用户输入发起的运行使用，不随下一次输入自动进入模型请求，不建立持续授权。接受前失败保留输入和选择。 |
| UI-040 | 待实现并验证 | 项目会话等待反馈 | 发起项目消息后，在运行且尚未展示本轮文本、thinking 或工具活动时显示“正在思考”及转圈；展示其中任一内容、结束或失败后不再显示。该提示仅表示等待响应，不表示实际模型 thinking，不进入 transcript。 |
| PSES-005 | 待验证 | 项目消息延迟诊断 | 服务端按一次发送记录阶段耗时，区分 Pi 句柄复用/创建/恢复、prompt、首个 assistant 流事件、首段可见文本、首个工具活动和完成或失败；另以流 turnId 关联服务端首段文字入队及完成事件、浏览器收到对应事件的时间，区分传输与生成延迟。各端耗时各自基于单调时钟，跨端时钟可能不同；不记录消息、思考、工具参数/结果、文件路径或密钥，不影响流和执行结果。 |
| PSES-002 | 项目会话代码已接入；完整边界待验收 | Pi Session Tree 完整投影 | 项目会话的 messages API 恢复所属 Pi 的全部分支及节点，保留节点身份、父子关系、原生追加顺序和活动叶子；内部节点、thinking、原始工具参数和敏感结果不因类型或内容过滤。活动指针、异常节点、空树、读取错误和重启恢复按 `03` 如实返回；按部署边界校验读取许可和归属、禁止缓存及日志泄露，覆盖事件订阅竞态、临时关联、只读页面快照和重连，运行事件按原生树核对，不伪装为空历史或持久节点；不复制持久对话、不改历史。 |
| PSES-004 | 代码已实现；压缩/取消API定向通过，真实模型待验 | 用户手动原生上下文压缩 | 创建和恢复 Pi Session 都关闭自动压缩，仅用户页面点击调用原生压缩；溢出不自动压缩重试，压缩只改变 Pi 有效窗口，完整历史继续可恢复 |

PSES-002 / PSES-007 项目范围定向验证：`tests/project-session-tree.test.cjs` 覆盖多分支、敏感内容、只读历史及损坏版本；`tests/project-session-lifecycle.test.cjs` 覆盖并发打开、租约、发送复用与逐轮写入许可；`tests/project-session-optional-role.test.cjs` 覆盖独立项目工具的逐轮写入门禁；`tests/project-session-stream.test.cjs` 覆盖原始流、禁缓存、租约传递、UTF-8 解码及断线后继续消费。类型检查通过。未验收真实模型、浏览器、五分钟中止、崩溃恢复及全部竞态；不能标记整体现场验收完成。

PSES-006 历史位置验证（已被 PSES-010 内联块替代，不作为当前布局验收）：`tests/message-references-composer.test.cjs` 覆盖两个入口下方的已选列表、选择与移除，7 项通过；未进行真实浏览器验收。

PSES-006 历史手动路径验证（独立项目参考选择已不提供路径输入，不作为当前交互验收）：`tests/message-references-composer.test.cjs` 覆盖弹窗、默认目录、手动跳转及越界拒绝；`tests/message-references.test.cjs` 覆盖服务端目录边界和文件范围，12 项通过；类型检查通过。未进行真实浏览器验收。

UI-040 历史代码验证（未覆盖当前 thinking 展示契约）：`tests/project-session-waiting.test.cjs` 覆盖等待时的状态文字和转圈，以及首段文字、工具活动或结束后隐藏；2 项测试和类型检查通过，真实浏览器待验证。

PSES-005 代码验证：`tests/project-message-timing.test.cjs` 覆盖阶段顺序、去重、失败和日志内容边界；`tests/session-execution-cancel.test.cjs` 覆盖停止链路。5 项测试与类型检查通过。流诊断追加验证：`tests/project-message-stream-timing.test.cjs` 覆盖首段与完成事件的入队、解析、关联及日志隐私；`tests/project-message-stream-acceptance.test.cjs` 覆盖流接收语义，4 项测试通过；真实服务及模型耗时待复验。

此前无角色只读限制已被用户要求撤销；此前测试只证明当时行为，不证明当前验收条件。`tests/project-session-optional-role.test.cjs` 验证目标空库无角色创建、非法绑定拒绝、工具及路径边界；`tests/session-execution-optional-role.test.cjs` 验证无角色、历史及停用角色发送；`tests/session-execution-cancel.test.cjs` 验证停止链路。针对性测试及类型检查通过；未做真实模型验证。用户授权后，`tests/optional-role-migration.test.cjs` 在临时库验证迁移，原库离线替换角色必填触发器并备份；完整性和外键检查通过，当时已有会话及其他历史记录保留；旧绑定不是本轮目标模型。

## 5. 页面需求
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| UI-001 | 导航已接入；主动关闭最小DOM通过，真实浏览器待验 | 项目导航与历史会话 | Project 是独立项目入口；“新建项目”按钮在 Project 分区标题行，不放在顶部快捷操作；独立Session侧栏按SLIST-002显示最新用户输入与最后打开时间，空会话显示“新会话”。左侧动作与会话切换按 UI-043 关闭现有弹窗。 |
| UI-007 | 待实现 | Session Tree 对话流 | 项目会话按 API 返回展示整棵树和所有分支，标明分叉与活动路径，共享节点不重复；内部节点、thinking 和完整工具结果可查看。实时显示不伪造持久节点，重连后与 Pi 树一致；回答安全渲染 Markdown。 |
| UI-011 | 代码已实现；文件弹窗最小DOM通过，视觉待验 | 项目优先布局与文件 | 侧栏浅灰蓝、文字中性、选中浅绿；导航可收缩；文件树非 Git 也可用，文件浏览与预览按 UI-042 合并在独立文件弹窗中，路径显示项目绝对根目录，代码预览不用深色背景 |
| UI-013 | 现有实现待复验 | Next 单应用分层 | 页面、Feature、Hook、API Client、领域协议与服务端分层；页面不承载事件解析或业务编排 |
| UI-018 | 待设计 | 项目资源页面 | 项目实例在所属 Project 下管理和调试；项目为空的模板在模板库展示；详细交互随资源基础模型确定 |
| UI-019 | 代码已实现；上下文API定向通过，真实浏览器待验 | 原生上下文检查与压缩入口 | 会话检查的设置页显示已用/容量/剩余 Token、占比、测量口径与时间、自动压缩关闭状态、最近压缩时间和手动按钮；未知指标不伪造，繁忙禁用，完成刷新，失败可手动重试 |
| UI-039 | 代码已接入；针对性测试及类型检查通过，真实浏览器待验证 | 提交后的输入框 | 项目会话提交时立即清空输入框并在对话中回显，不等待长流结束；发送失败仅在原会话草稿未修改时恢复，不能覆盖其他会话或新输入，也不自动重发。 |
| UI-038 | 代码已接入；键盘回归与 TypeScript 检查通过，真实浏览器输入法验收待做 | 输入法安全的对话发送快捷键 | 项目 Composer；Enter 发送、Shift+Enter 换行，点击发送按钮行为不变。IME 候选组合期间 Enter 只确认候选且不调用发送，需兼容 composition 状态、`isComposing` 和旧浏览器 `keyCode=229`。 |
| UI-026 | 修订中 | 对话无额外读写勾选 | 项目会话 Composer 不显示读写模式。独立项目工具权限由项目执行策略确定而非角色，实际操作遵循用户请求。 |

UI-039 验证：`tests/prompt-input-submit.test.cjs` 覆盖流进行时清空与失败草稿保护，`tests/project-message-stream-acceptance.test.cjs` 覆盖流接受和拒绝边界，`tests/prompt-input-ime.test.cjs` 覆盖输入法回归；8 项通过，类型检查通过。未进行真实浏览器或模型验收。

## 6. 安全与非功能需求
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| SEC-001 | 待实现 | 项目隔离 | Session 与执行资源的 projectId 一致；跨项目资源 ID 或资源模板不能作为运行实例注入 |
| NFR-001 | 现有实现待复验 | 类型检查与构建 | TypeScript strict 和单应用生产构建通过，服务端依赖不进入客户端 |
| NFR-011 | 当前决定 | 固定数据库文件 | 数据库固定为 `.data/ai-workspace-v5.sqlite`。保留项目、Agent、Session 和 Pi 原生历史，退役数据处理见 02。不得重建数据库文件或自动迁移；结构变更须遵守单独授权。 |

## 7. 本轮不做
- 迁移、读取、备份、改写、清空或重建旧库；
- 将完整 Pi transcript、原始 thinking 或工具结果复制到业务数据库；
- 第二套 Runtime；
- 旧数据库自动迁移、清空或重建。

## 8. 实现顺序与完成定义

新需求只有在代码实现、与风险相称的函数级或 API 测试，以及本表验收条件全部通过后才能标为已验证。默认不运行全量测试、生产构建或真实模型验收；只有用户明确要求，或目标行为无法用函数级和 API 测试证明时才扩大范围。设计更新与代码验收分别记录，实际证据见 §16。旧库不迁移；新库只从空库初始化。

## 9. Pi 上下文管理验收（2026-10-08）
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| PCTX-001 | 代码已实现；受控Runtime定向通过，真实模型待验 | Pi 原生上下文为主 | 原生窗口用量读取 Pi getContextUsage；压缩和取消调用 compact/abortCompaction，无第二份 transcript 或数据库窗口 |
| UI-020 | 代码已实现；上下文API定向通过，真实浏览器待验 | 可操作的会话设置 | 会话设置展示 Pi 上下文，用量与状态真实可辨；支持刷新、手动压缩、取消及已有会话恢复；未知值不补零，操作期间保留输入 |

验收包括：读取/刷新不触发模型或压缩；未启动/不可恢复/只读正确限制；取消压缩不会中止主回答、提前释放锁或自动恢复对话；取消与成功竞态按 Pi 实际结果展示；设置用量 DTO 不另行返回原生正文，完整树与导出仍保留全部原文；原生操作不改变业务会话归属；保留手动压缩策略。本次不新增自动压缩策略、分支编辑或原生消息编辑功能。

2026-10-08 实现验证：已读取 Pi SDK 原生上下文/取消能力声明，完成上下文端口拆分、原生 getContextUsage 估算读取、取消压缩及优先检查 UI。18 项针对性测试和类型检查通过；包括取消保持锁、只读限制与完成/取消竞态。新功能未修改数据库或原生历史；生产构建通过；当时 3000 返回旧版 DTO，页面联调尚未复验；该历史记录不代表当前服务状态或新弹窗验收。

## 10. 数据模型可读性约束
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| NFR-012 | 持续约束 | 控制表数量与模型理解成本 | 每次新增、合并、拆分、重命名或退役表先按 `02`“表数量与模型可读性”说明必要性、方案取舍、数量变化、紧凑关系总览与历史映射；仅实现当前已定义需求，不将流程或状态机械拆表，不用任意 JSON 掩盖核心关系；结构调整保留历史并遵守显式迁移决定 |

该约束适用于后续全部持久模型设计。用户最新允许按情况调整现有表，取代此前“不精简、保留七表”的限制；现有七表是实现基线，目标不固定表数。可以评估增表、合并、拆分、重命名或退役，不以减表数为唯一目标；协作事实、历史覆盖和核心约束须保留，迁移执行仍由用户决定。

## 11. 开发服务清单读取稳定性
| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| NFR-013 | 已验证（当前版本） | 开发编译清单原子替换 | Webpack 开发输出已知 JSON 清单读者不见写入中空内容；文件提交通过同目录临时文件及原子替换；失败保留原清单并返回原错误，普通输出/生产编译保持原行为，不改数据库或 Pi 历史，不吞掉业务解析错误 |

问题证据：用户报告静态路径生成偶发 JSON 空内容错误、随后恢复；只读接口核对返回 200，开发编译时连续采样捕捉到五种清单的同类解析失败。验收需覆盖实际 Webpack 编译与并发读者、失败场景和普通文件输出；真实 Next 开发服务复验在用户重新启动加载配置后进行。

2026-10-08 修复验证：开发 Webpack 增加已知清单原子替换插件，未修改 node_modules、数据库或 Pi 历史。新增四项测试验证写入期间读到完整旧版、rename 失败保留原清单与原错误、普通/输出目录外文件维持直写，以及实际 Webpack 编译产出；全套 45 项测试通过，类型检查和生产构建通过。运行中的 Next 服务加载新配置后，五类清单实际更新，61,495 次采样读取无解析失败；当时的 API 只读检查返回 200。助手未操作服务启动/停止。此验证针对已捕捉的编译竞态，不作为所有 JSON 或未来 Next 内部变化的保证。

## 12. 独立项目 Agent 编辑验收

| ID | 状态 | 验收条件 |
| --- | --- | --- |
| AGFILE-001 | 历史桌面检查通过；窄屏和键盘待验收 | 独立列表弹窗与编辑工作区、明确主次及危险按钮；中间对话修订，右侧只读 Markdown |
| AGFILE-002 | 代码已接入；真实模型待验收 | 参考项目、文件和上传 Markdown 通过无工具 LLM 生成，不执行来源或授予能力 |
| AGFILE-003 | 代码已接入；浏览器待验收 | 多轮自然语言修订，取消丢弃草稿，保存产生不可变版本 |
| AGFILE-004 | 代码已接入；自动化验证通过 | 严格校验 frontmatter；能力显式授权；运行时按 ID、revision 和摘要加载准确文件 |
| AGFILE-006 | 历史迁移核验通过 | 历史引用和 Pi transcript 保留，旧正文不自动激活；不构成新迁移授权 |

## PSES-012｜删除会话

目标：独立项目每个可见会话都有删除按钮，确认后调用 03 的 DELETE；成功移除条目，删除当前会话时回到所属项目；失败保留条目并显示 API 错误。空会话、空闲及 ended 可删除；运行、压缩、unknown 和被引用者拒绝。事务只删除会话，Pi 文件及项目文件保留。工作区对应要求由 06 WSP-015 定义。状态：既有删除能力由 tests/session-deletion.test.cjs 等临时库定向测试验证；本轮解除绑定、单行删除与旧库门禁已重新定向验证，证据见 §16，不沿用历史结果宣称当前通过。

## PSES-013｜回复文件链接

目标：点击本地源码链接在文件模态弹窗预览而不跳转；所属项目路径经现有文件读取 API 校验，行号定位，切换会话丢弃旧响应，外链正常，失败保留对话并报错。无模型或存储变化。状态：既有文件读取和链接映射由 tests/file-link-preview.test.cjs、tests/markdown-response.test.cjs 共 5 项验证；本次弹窗容器、关闭与失效响应已由最小 DOM 测试验证，见 §16；真实浏览器视觉和原生交互仍待验收。

## 13. 会话检查与应用级 Pi 配置整改

本轮实现 GAP-001～005 的通用与独立项目代码；定向验收记录见 §16，剩余现场验收如实保留。GAP-006按用户要求保留，不宣称全部工作区设计完整。历史 v1.0.0、已退役功能或文件链接测试不构成本轮完成证据；工作区专属验收在 06 WSP-017 中引用。模型事实以 02“会话检查与模型配置投影”“从节点创建独立会话与导出” 为准，API 以 03 §10 为准，配置来源以 01 为准，页面只按 04 投影。

| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| UI-042 | 代码已实现；最小DOM通过，真实浏览器待验 | 两个独立模态入口 | 文件与会话检查互斥打开，不占用会话右侧列或采用抽屉；会话检查只有树与设置，不保留已退役记忆功能的任何入口或后台依赖；文件浏览、预览与源码链接统一进入文件弹窗；窄屏、键盘、Esc、焦点与滚动按 04 验收 |
| UI-043 | 代码已实现；最小DOM通过，真实浏览器待验 | 所有左侧动作主动关闭 | 任意左侧按钮含展开、当前会话、新建、删除、资源与设置，均先关闭现有弹窗再执行原动作；实际会话变化也关闭；过期响应不能重新打开或污染新会话，不中止已接受服务端操作 |
| UI-044 | 代码已实现；最小DOM通过，真实浏览器待验 | 全树标题与正文定位 | 全部分支节点标题可见，不展示正文或原始详情；点击按 entryId 展开必要容器并滚动高亮，树选择与活动叶子区分，不调用 Pi 分支切换；空树、未知类型、附件归组及异常节点仍可定位或明确报错 |
| PCFG-001 | 代码已实现；临时配置与受控Pi定向通过 | npm 启动目录整份优先 | 对 models.json/settings.json 分别验证本地存在只读本地、本地缺失才读对应全局、两个文件来源可不同；不合并字段、不从业务 cwd 查找；损坏、空白、权限和无效配置均报错；删除固定环境模型及备用来源规则 |
| PCFG-002 | 代码已实现；受控Pi定向通过，真实认证待验 | Pi 参数完整支持 | 使用原生解析器，协议、认证引用、headers、compat、reasoning、input、cost 等完整进入 Pi；显式 contextWindow/maxTokens 在新建、恢复、切换、请求和压缩中生效，不受应用写死数值覆盖；验证不同容量/输出上限、缺省及非法参数，未知容量如实呈现；不暴露配置凭据 |
| PCFG-003 | 代码已实现；受控Pi定向通过 | 默认设置与精确恢复 | 采用选中settings文件的defaultProvider/defaultModel/enabledModels，不读另一文件补值；新会话/无原生选择用默认，已有会话优先恢复原生选择；型号不可用按MCFG-002自动回退默认，默认也不可用才提示；默认设置与会话 cwd、工具边界、自动压缩互不混淆 |
| PSES-014 | 代码已实现；受控Pi与API定向通过 | 会话模型切换 | API 核验归属、可用性、空闲和租约；调用 Pi setModel 并原生保存，刷新容量和树；同值不重复追加，跨会话不变，不写配置或 SQL 模型副本；忙碌/unknown/认证失败/持久化不明按契约处理 |
| PSES-015 | 代码已实现；隔离派生与恢复定向通过 | 从节点创建独立会话 | 包含选中节点的祖先路径进入新 Pi 身份，事务只创建新 Session，归属及角色引用合法；不复制旁支，不改源树/叶子；覆盖非用户节点、跨树拒绝、幂等重试、SQL 回滚及原生候选文件的 unknown 恢复 |
| PSES-016 | 代码已实现；导出范围/原文/清理定向通过 | 明确范围导出 | HTML/JSONL 都支持全树或当前分支，完整保留所有选定节点及原文，不把原生 branch 导出标成 tree；不调用模型、不写业务记录或源文件；覆盖分叉、压缩、内部敏感节点、读取失败、断开清理和 ended 只读导出 |

配置、派生、导出与恢复使用临时目录、临时数据库和受控 Pi 验证；弹窗关闭、焦点恢复、节点定位与文件联动采用最小 DOM 交互测试。实际执行范围见 §16，不把服务端或 DOM 结果替代真实浏览器与模型验收。

## 14. 删除 SessionMemory 功能

| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| SREM-001 | 代码已实现；退役路由/创建/删除定向通过 | 整体删除应用记忆 | 删除领域模型、Repository、端口、服务、模板、内容/总结 API、自动触发钩子、调度、轮询、DTO、界面与创建/删除绑定；退役路径 404，旧入参拒绝；新建和删除仅操作会话记录，回答结束无独立总结或模型摘要请求 |
| SREM-002 | 代码已实现；无记忆模型与purpose投影定向通过 | 独立会话与稳定名称 | Project/Workspace 会话只绑定所属范围、可选角色与 Pi 原生身份；DTO 移除记忆 ID 与摘要字段，持久名称保留purpose，侧栏按SLIST-002显示最新用户输入，空历史显示新会话；不创建替代表、影子摘要或占位记忆 |
| SREM-003 | 通用目标定向通过；历史迁移未执行，GAP-006保留 | 旧库退役边界 | 目标表数量减少 1，关系与历史映射以 02/06 为准；全新空库不含退役表/列/约束，旧库不自动 DDL 或删除数据；不兼容写操作 SCHEMA_INCOMPATIBLE，只读原生历史不依赖旧记忆；显式迁移及归档须另行授权 |

原 SMEM、记忆展示/校正需求及其验收记录从当前契约移除，历史仅通过 git 追溯。工作区对应需求见 06 WSP-018。创建/删除、退役路由与旧入参拒绝、purpose 命名、旧库写入门禁及 Pi 历史保留的实际定向验证见 §16。代码移除独立总结与相关调用路径；历史数据仍未迁移。

## 15. 设计完整性整改与验收闸门

按用户范围实现 GAP-001～005 的通用/独立项目代码；GAP-006、06全文保持本轮代码修改开始时的内容，工作区专属缺项保留。下表定向验证不代表历史库已迁移；Workspace专属落地仍受GAP-006限制。MCP/其他资源和06 §9后续计划保持原范围。

| 检查编号 | 关联需求 | 权威位置 | 当前结论与完成条件 |
| --- | --- | --- | --- |
| GAP-001 | PSES-001/007、SREM-003、AGFILE-004 | 02 §11～13 | 代码已实现并通过相关定向验证（见§16）：目标列/约束、ended_at生命周期、state投影、旧列归档和独立项目操作证据明确；Schema落地与历史迁移分别验收，未授权不执行迁移 |
| GAP-002 | PSES-001/007/014、SREM-001/002、AGFILE-001～004、CAT-001 | 02 §12；03 §11～13 | 代码已实现并通过相关定向验证（见§16）：Project/Agent/Session DTO、逐项allowedActions、校验、条件写、生命周期和Agent编辑API有确定路径与事务；型号失效有显式恢复路径 |
| GAP-003 | UI-011/042、PSES-006/013、CAT-002 | 03 §14 | 代码已实现并通过相关定向验证（见§16）：文件列表/预览/Git DTO、截断/错误/路径边界明确；不宣称工作区文件列表已补齐 |
| GAP-004 | PSES-014/015、PSES-004、PSES-018 | 02 §13；03 §13 | 代码已实现并通过相关定向验证（见§16）：作用域/确定ID/载荷摘要/耐久阶段、重启核验、显式承认unknown或提交候选均已定义；不能自动重发或仅凭当前型号认定旧键成功 |
| GAP-005 | PSES-015/016 | 01 §7；02 §10；03 §10.2、§15 | 代码已实现并通过相关定向验证（见§16）：隔离manager、完整label与压缩引用、纯配置落盘、源文件不变、导出范围及惰性HTML有明确规则；不提前宣称SDK原生直接满足全部要求 |
| GAP-006 | WSP-001/003/017/018 | 06 §5～6、WSP-017/018 | WorkspaceProjectDTO、writeETag 的生成和变更范围、recover 的请求/返回与解除门禁条件；共享契约补齐后核对工作区组合外键、单行事务和 journal 身份隔离 |

CAT-001（代码已实现；定向验证见§16）：既有Project/Agent管理能力以03 §11～12为唯一接口契约，验收目标为许可、输入、DTO、条件SQL、不可变版本/失败候选、外键引用与无额外模型/Pi调用，不扩展资源平台。CAT-002（代码已实现；定向验证见§16）：既有独立项目文件浏览/预览/可选Git能力按03 §14验证，非Git/附加状态失败不能阻断目录。PSES-018（代码已实现；定向验证见§16）：独立项目操作证据与显式恢复按02 §13、03 §13验证；证据不进入对话，损坏拒绝、unknown不重放，控制通道取消不死锁。

下表保留最小验收目标；实际创建和运行的文件、已证实行为及未验证边界见 §16。测试只使用临时库、临时Pi/证据文件与受控Runtime；不运行全量测试、真实模型或用户服务。

| 目标 | 定向测试文件（含计划新增） | 必须证明的条件 |
| --- | --- | --- |
| GAP-001 | tests/project-session-model-contract.test.cjs；tests/project-session-optional-role.test.cjs | 新空库目标列/FK/唯一身份、Agent双空、结束不可逆、创建键冲突；旧库只读及SCHEMA_INCOMPATIBLE；不自动迁移/改Pi |
| GAP-002 | tests/catalog-contract.test.cjs；tests/project-session-lifecycle.test.cjs；tests/session-deletion.test.cjs | DTO无退役字段/路径、逐项许可及重新校验、条件写/生命周期/Agent版本采用、文件与SQL两阶段失败、型号恢复lease；取消不中断错误父任务 |
| GAP-003 | tests/project-files-api.test.cjs；tests/file-link-preview.test.cjs | 目录排序/截断、敏感/越界/符号链接、UTF-8/大小/变化、非Git与Git失败不阻断目录、只读且不调用Pi |
| GAP-004 | tests/project-operation-recovery.test.cjs | 同键同载荷/异载荷、重启prepared/observed/completed、fsync前后故障、损坏链、同型号不同操作、候选与SQL单边提交、承认unknown不重放、取消控制通道与父锁、删除后410 |
| GAP-005 | tests/pi-session-fork-export.test.cjs | 源manager身份/叶子/字节不变；全部已知节点含label/compaction、旁支引用拒绝、纯配置恢复；HTML/JSONL树与分支/空树、未知原文、惰性编码、下载中断及临时文件清理 |

本轮实际代码与定向检查记录见 §16；未执行生产构建、真实模型请求、用户数据库迁移或用户服务启停。

## 16. 本轮代码与实际定向验证

GAP-001～005 已落到通用/独立项目模型与 API：目标 Schema 移除应用记忆和持久运行状态，Session 生命周期由 ended_at 表达；Project 条件写在 SQL 事务内再次核验 ETag 与历史引用，Agent 正文以不可变 Markdown 版本保存；Pi 配置按文件独立选择整份来源，在空闲操作边界刷新容量与精确型号；跨原生文件/SQL 的操作用耐久 journal、稳定幂等身份和显式 unknown 恢复；隔离派生与静态导出保留原始内容和源树身份。页面提供互斥的文件/会话检查模态，只使用既有 API 与许可。

按目标分别运行，重复执行不重复计数：21 个定向测试文件、61 项通过；类型检查 npm run typecheck 通过。没有运行全量测试。

| 实际文件 | 已验证目标 |
| --- | --- |
| tests/project-session-model-contract.test.cjs；tests/project-session-optional-role.test.cjs | 目标表/FK/原生身份/创建键/结束事实、独立会话创建与安全DTO、重启unknown不重建、跨Workspace现有身份拒绝、无角色执行与路径边界 |
| tests/catalog-contract.test.cjs；tests/agent-storage.test.cjs | 严格输入与If-Match、Project SQL事务再次核验、引用与根路径冲突、Agent精确版本/摘要/能力、旧文件及失败候选保留、独立无工具生成协议 |
| tests/project-files-api.test.cjs；tests/file-link-preview.test.cjs | 文件realpath/敏感路径/UTF-8/容量、非Git目录、范围和源码行号解析 |
| tests/project-operation-recovery.test.cjs | journal重启/链损坏/载荷冲突、删除后410、SQL失败候选显式提交、消息重试不重发、取消等待真实终结与父锁 |
| tests/pi-session-fork-export.test.cjs | 实际Pi SDK受控模型流、整份配置优先、容量与输出上限更新、同型号不伪造切换、配置节点落盘后继续发送、原始路径/label保留、派生篡改拒绝、惰性HTML/JSONL与下载取消清理 |
| tests/session-memory-retirement.test.cjs；tests/ui-polling-activity.test.cjs | 退役HTTP路由404/no-store且不装配服务、旧结构和缺少约束门禁、UTF-8/空请求、轮询去重与晚响应丢弃 |
| tests/project-session-lifecycle.test.cjs；tests/session-execution-optional-role.test.cjs；tests/project-session-tree.test.cjs；tests/session-deletion.test.cjs；tests/pi-context.test.cjs | 并发打开与租约/句柄复用、历史角色不阻塞独立发送、全分支与敏感原文只读读取、单行删除/引用回滚、压缩取消与成功竞态 |
| tests/session-auxiliary-dialog.test.cjs；tests/agent-ui-flow.test.cjs | 实际Workspace/辅助弹窗最小DOM、互斥入口、Esc取消/焦点返回、丢弃未提交选择、树定位/展开/高亮、左侧动作/会话变化关闭、源码预览同窗及晚响应不能重开；Agent/导航静态投影 |
| tests/agent-markdown-migration.test.cjs；tests/optional-role-migration.test.cjs；tests/memory-storage.test.cjs；tests/workspace-storage-migration.test.cjs | 仅在临时库验证此前离线迁移目标及历史值/约束保留、失败回滚和连接门禁；旧脚本读取scripts/historical-schema冻结快照，不把当前Schema变更带入旧授权 |

验证限制：配置和消息使用受控SDK/Runtime，不调用真实模型或真实认证；jsdom替代原生dialog方法，只验证调用、状态和定位，真实浏览器Tab焦点约束、窄屏视觉与浏览器下载仍待现场验收。未注入每一种文件系统故障、硬断电或多进程崩溃；已列的定向结果不替代这些边界。

用户数据库、配置与原生历史未改写，没有启动/停止用户服务。现有历史库仍只读，写入返回SCHEMA_INCOMPATIBLE，须独立授权并审核本轮目标的迁移方案；本轮没有提供或执行该升级脚本。GAP-006与06内容维持代码修改开始时的版本，Workspace专属完整契约仍未纳入本轮验收。

## 17. 数据库显式升级（DBUP-001）

状态：用户明确要求“直接迁移数据库”后，正式迁移及迁移后只读核验已完成。范围为 02 §11.1；不扩展 GAP-006。脚本 scripts/upgrade-session-schema.cjs 与执行指南 scripts/session-schema-upgrade-guide.md 已提供。tests/session-schema-upgrade.test.cjs 的7项验证只读预检、归档摘要和只读权限、全部同名列保留、原库内事务重建、目标兼容、历史创建键NULL、外键/完整性、冲突/未知结构/活连接拒绝、失败回滚、锁不自动破除、过期摘要/符号链接拒绝及重复执行只读。结合 tests/session-memory-retirement.test.cjs 与 tests/project-session-model-contract.test.cjs，共14项通过，git diff --check通过。仅Schema比较的表名等价规范化发生TS内部调整，类型边界未变，本轮未额外运行类型检查或全量测试。

正式执行前重新预检为 ready、冲突零项并确认无其他打开连接；来源摘要 15f005c7e038263a22e942d0796e552d90b2947a38387aba653b6d10d9e3c5b0，目标摘要 e7bee0c5415d7bd99a769b993b855b2eaa20153b021d2be53c25126c59759889。脚本返回 migrated，后续预检返回 current，实际运行时 matchesTargetSchema=true、integrity_check=ok、foreign_key_check=0。事务中已逐表验证所有保留列值一致；6个项目、5个Agent、8个独立项目会话和1个工作区会话保留，9条记忆记录在只读备份中核验存在。

完整归档位于 .data/ai-workspace-v5.sqlite.session-upgrade-34c046da-4f87-427d-8554-cfcee4766fdc/，包含 before.sqlite 和 manifest.json，备份SHA-256为 25d446b60a71a5616834a4a6ec24e3a5e398987f609f071249a70c7a8e3c4d8e。此次授权仅覆盖本次目标，后续迁移仍须独立确认。未调用Pi或模型，未改写原生历史、Agent Markdown、配置或journal，未操作服务启停；§16中“历史库未迁移”描述为本次执行前的记录。GAP-006与06保持原范围。
