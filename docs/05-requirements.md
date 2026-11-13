# 05｜需求：模型与 API 的完成条件

## FILE-004｜项目 Git diff 与代码预览

工作区链路修复：此前列表固定isGitRepository=false且没有changes适配，导致diff常禁用；现在成员项目目录和Git读取统一复用根路径读取器，专属API与验收记录见06 FILE-004。tests/workspace-project-git-api.test.cjs、类型检查及差异检查通过；已有长驻服务需重载新装配，浏览器待验。

验收：项目文件标题栏显示diff按钮；使用03 §14返回的仓库事实与gitState禁用无Git/非仓库/读取不可用情况；点击读取既有changes API并显示工作区及暂存区原文差异、红绿增删、空状态、未跟踪文件说明、截断和可重试错误，项目切换不串响应。共享代码预览默认显示行号与语法颜色，保留正文、缩进、复制与链接行号定位，未知语言/高亮失败保留原文。模型/API契约不变，无SQL/Pi或历史迁移。状态：代码已接入；npm run typecheck与git diff --check通过。复用既有API，未新增或运行API/非API测试，未执行生产构建或浏览器验收；浏览器视觉及交互待验收。

## HOVER-001｜悬停触发范围

验收：带提示的共享按钮与项目文字容器整块触发，包含省略号及行内留白；禁用按钮提示可触发且不能执行操作，独立子提示保持自身文案。发送按钮旁的快捷键/状态文字整段触发完整提示，提示内容与文字同步；输入正文区、发送和停止按钮不设置提示。全局HoverHints接管现有文本title，移入即显示，无等待定时器；覆盖动态节点及键盘聚焦，提示保留完整文本，popover顶层显示不挡操作，点击/滚动/移出/失焦关闭；iframe的可访问title不接管。复用Button与既有元素，仅改投影，无模型/API变化；状态：代码已调整，类型检查及差异检查通过；未新增或运行非API测试，浏览器验收待做。

## CHANGE-001｜Session最新一轮原生编辑差异

“文件检查”旁的“本轮变更”仅投影Pi Session已记录的成功edit差异，项目和Workspace一致。只显示最新根请求，steer归原轮；同文件多次编辑依次展示，改后还原也保留原生证据，不承诺整轮文件净变化，不补算write/bash，不调用模型、Git或项目文件采集。面板只显示差异，不显示全文和字节大小对比。

验收：原生diff逐字保持、正确关联工具路径及分支祖先、同文件多次编辑和还原顺序、排除失败edit及没有原生diff的工具、steer与根边界、运行中/停止/失败后读取、冷打开恢复、下一轮替换与旧轮409、归属拒绝、边界缺失明确不可确认、读取无副作用。删除文件快照端口/存储/执行包装及直接diff依赖；停止读写旧快照/正文目录；本次按用户明确清理要求删除本地退役.data/session-file-changes目录。新增验收：列表按完整项目根路径分组、标题显示目录名且title保留完整项目路径，不同项目同名相对文件分开且可独立选择，组内仅相对路径、单行省略及完整title，文件检查路径横向滚动不占额外高度，长短路径切换对齐。状态：代码已实现；`tests/session-file-changes-api.test.cjs` 两项Project/Workspace接口场景通过，覆盖原生diff原文、工具祖先匹配、steer/多次编辑及还原、失败/停止记录保留、边界与旧轮拒绝、归属、冷打开及项目目录不可访问仍能读取。`tests/session-run-metrics-api.test.cjs` 六项既有统计接口回归通过。`npm run typecheck`及`git diff --check`通过；浏览器及真实模型验收待做。本次按用户授权删除本地退役快照目录，共1个文件35,545,453字节；未操作用户服务、数据库或Pi原生历史。相对路径、绝对/相对路径归并、项目根路径返回及跨项目同名文件独立选择已由`tests/session-file-changes-api.test.cjs`两项场景验证，类型检查及差异检查通过；项目路径分组、列表省略与路径栏滚动条占位的浏览器视觉验收待做。

MODEL-SWITCH-001：修复模型／思考等级应用成功后被重新打开覆盖默认型号的问题。成功保持同一lease、订阅及Pi身份，仅刷新树／上下文／列表；当前型号不可用时显式目标切换成功也直接恢复原lease发送投影。独立项目PUT响应在切换事务证据完成及互斥释放后计算许可，连续应用不误报自身SESSION_BUSY。验收：原lease切换返回目标及canSwitch=true，无不可用原因；相同lease可继续切换、发送，历史与身份保留；页面成功流程不重开，主动重开仍遵循MCFG-003。Workspace共用页面修复，专属映射见06。状态：代码已修复；`tests/model-request-failure-api.test.cjs` 4项API测试通过，覆盖原lease切换返回目标型号及canSwitch=true、同键重放、连续调整思考等级、继续发送，以及已知失败／unknown恢复边界。`npm run typecheck`与`git diff --check`通过。仅使用临时内存SQLite及受控Pi，不调用真实供应商、不改用户数据或服务；两类页面的浏览器验收仍待做。

## UI-054／UI-055／UI-056｜导航运行投影与通知布局

仅投影现有模型/API，不新增持久事实或接口。UI-054验收：多个项目会话同时执行时分别显示转圈及运行中，选中背景独立保留；项目名称显示所属运行数量，收起仍显示，完成／停止后3秒刷新收敛；隐藏暂停、恢复立即刷新，失败显示不可用、不伪造0。运行取既有列表allowedActions.interrupt.allowed，Workspace专属映射及验收见06。UI-055验收：除助手目录／编辑页外，操作提示和错误在视口顶部居中，保留完整文字、关闭／既定重试；长内容滚动、窄屏不越界。UI-056验收：快捷键提示单行显示，窄宽度省略，不挤压发送／停止按钮。复用现有侧栏、lucide LoaderCircle及ErrorToast，不新增可见组件。状态：代码已接入，`npm run typecheck`与`git diff --check`通过；浏览器多会话与视觉验收待做，尚不标记整体验收完成。无API契约变化，未新增或运行测试文件；未执行生产构建、真实模型或数据库操作。

## BASELINE-001｜当前版本定版

用户确认当前版本除 MCP 外可用，按此范围定版并提交源码。MCP 保留为未验收项，不宣称可用或验收完成；各需求已有的自动验证与未验证记录继续保留，不以本次定版替代测试证据。范围包含统一助手、项目规则生成、两类 Session、持续参考文件、运行中纠正、最后一轮 Token/耗时与 Session 累计及现有页面调整。参考文件作为需求主体的优先级、冲突处理与版本更新优化仅完成讨论，未作为本次新增实现。提交不包含本地运行数据、配置与 release-new 发布产物，不执行数据库迁移或服务启停。
UI-053（本轮修复，npm run typecheck、改动TSX语法及git diff --check通过；真实浏览器待验）：会话树只提取text导致纯工具调用assistant误显示no content。验收：纯bash等toolCall标题显示工具类型/名称，thinking和其他非text内容显示对应类型，真实空节点才标无正文；中止/错误保留，混合正文优先显示text。两类会话共用，不改模型/API/历史，无新增或运行非API测试。

UI-052（本轮修复，改动TSX语法及git diff --check通过；真实浏览器待验）：空assistant流式开始占位不显示；内容/工具/thinking/错误到达即展示，终态与历史实际空节点保留原文可查看。验收：仅空且未结束的assistant不产生空标头，不影响等待时间、工具调用或中途文字；不改模型/API/Pi历史，不新增或运行非API测试。

UI-051（本轮修复，改动TS语法及git diff --check通过）：修复UI-050移除服务端计时后session_state启动/运行分支未返回的回归。验收：starting/running/interrupting仅更新等待显示，idle等仅清除等待；全部session_state不进入临时对话，不产生伪“未确认持久化”，真实Pi内容仍原样保留。两类页面复用同一hook，无模型/API变化，不新增测试文件或运行非API测试；真实浏览器待验。

## UI-049｜连续工具调用折叠

状态：代码已接入，类型/TSX语法及差异检查通过，真实浏览器待验收；纯页面分组不新增或运行非API测试。验收：两类会话连续至少两个工具调用合并默认折叠，调用次数按toolCallId去重、名称及失败/执行中可见，展开保留完整assistant/工具/思考与原始结果；用户/任何含非空正文或错误的assistant（包括中途进度且含toolCall）/其他节点/分支断开分组；中途说明和最终回复均保持可见，同消息工具仍独立折叠，实时与历史规则一致；历史同步保持手动选择，树定位可展开组内节点。仅投影已有Pi树和事件，无SQL或历史迁移。

## UI-050｜等待提示独立计时

UI-050最终计时由RUN-001替代，等待期间仍复用本地计时器。

## RUN-003｜耗时与本轮Token独立展示

仅变更现有统计投影：耗时、本轮Token、会话累计各自显示，缺失项单独标不可用，不影响其余项。运行中不使用上一轮用量；空闲时快照无Token仍可使用messages.latestRunUsage。无模型/API/持久化变化，复用WaitingIndicator。状态：代码已接入，改动TSX的SWC语法检查及git diff --check通过；仅耗时、仅Token、两者缺失及累计独立显示的浏览器验收待做。无API/类型边界变化，未新增或运行测试文件、类型检查或生产构建。

## RUN-002｜切换会话恢复本轮统计

替代RUN-001的重开不补发限制：服务进程globalThis共享最新轮快照，切换/重订阅由SSE ready.runMetrics直接恢复耗时及已报告Token，事件服务实例重建不清除；新根请求替换、steer不重置、结束/关闭保留内存、删除清除。按用户要求取消统计持久化：Token从Pi原生usage及既有请求journal的entryIds范围派生，重启后通过messages.latestRunUsage恢复；耗时不持久化，重启后不可用。没有可信边界的旧记录返回null，不猜测轮次、不改写历史。Workspace仅在新请求的既有journal记录执行前后边界，不保存统计计数或新增文件/表。状态：代码已接入，tests/session-run-metrics-api.test.cjs六项API测试及tests/session-entry-link-api.test.cjs两项API测试共八项通过，验证两类冷读取、轮次/纠正输入归属、范围外调用排除、缺失证据不伪报、实时重订阅与最终统计、受控真实Pi三次模型调用和冷读取；类型及差异检查通过。仅临时库/文件及受控Runtime，无用户库/历史改写、迁移或真实供应商请求。补充修复验证：再次运行tests/session-run-metrics-api.test.cjs六项通过，新增ready直接返回运行耗时及Token、服务实例重建后ready恢复最终统计的断言；类型检查及差异检查通过。未执行浏览器或真实供应商验收。

## RUN-001｜最近单轮Token与耗时

状态：代码已接入，定向API与类型检查通过；真实浏览器/供应商待验收。验收：独立项目/Workspace累加本次根输入的所有模型调用及工具循环，steer不重置、下一根输入清空；完成/停止/失败只发一份统计，缺失用量不补0并标不完整。末尾仅一处展示最后一轮Token与耗时，以及messages API返回的Session全树累计Token；不逐历史轮次展示。累计包括缓存及有usage的压缩/分支摘要/工具结果，空树为0，缺失/非法用量标不完整，不额外增加reasoning。切换/重开/刷新恢复累计，最后一轮仍不回算。累计补充状态：已接入，两类messages接口的范围隔离、全树口径和冷恢复定向验证通过，浏览器待验。验证：tests/session-run-metrics-api.test.cjs四项通过，覆盖两类application/SSE接口的多调用/缓存累计、重复事件去重、工具结果排除、thinking不重复、steer归原轮、下一轮隔离、interrupt与失败、缺失/非法/失败零占位、重开不补发和Workspace幂等重放；tests/session-entry-link-api.test.cjs两项通过，受控模型驱动真实Pi执行write/edit并验证三次模型响应只形成一份完整统计，messages累计与Pi getSessionStats().tokens.total相同，关闭句柄后的冷读取仍一致。累计场景另覆盖非活动分支、有usage的压缩/分支摘要/原生usage/工具结果、空树、缺失及非法用量、重复读取不重复加、单次树读取及归属拒绝；两文件合计六项通过。npm run typecheck与git diff --check通过。仅临时数据库/目录与受控Runtime/模型流，不新增或运行非API测试，无迁移、模型网络、浏览器或生产构建。


## FILE-003 会话目录文件链接修复

状态：已实现，API定向验收通过。实际Word链接指向应用.data/session-files内所属Pi会话目录，被项目路径解析误拒绝；新增两类会话文件预览/下载API，通过数据库nativeRef限定目录。点击文件链接先打开预览，下载按钮固定预览左上角；当前会话文件可读，其他会话/目录越界拒绝。

实际验证：tests/session-file-api.test.cjs新增4项，直接验证两类Session API的绝对回复路径预览→返回相对路径下载、原件字节/中文名、跨会话/任意宿主路径/符号链接/敏感路径拒绝、归属/缺失/无nativeRef错误；结合tests/file-download-api.test.cjs的9项共13项通过。npm run typecheck、git diff --check通过。另只读核验用户所述实际0024oceanbase数据库适配.docx存在、17274字节，路径位于其原生Session ID派生目录；不改文件或历史。未编写或运行非API测试、全量测试、生产构建或浏览器验收，未启停用户服务或改数据库。


## FILE-002 Excel、PPT与PDF预览

状态：已实现，API定向验收通过。独立项目与Workspace复用FILE-001 API与文件浮窗，Excel(.xlsx)按工作表展示单元格、PPT(.pptx)按幻灯片展示文字与表格，PDF浏览器原生页预览；原件下载保留。旧.xls/.ppt明确提示转换或下载。Excel不重算公式、日期保留存储值，PPT不保证图片/动画/主题版式；PDF浏览器支持情况需现场确认。

实际验证：仅修改tests/file-download-api.test.cjs，9项API接口测试通过（既有5项、新增4项）。两类API覆盖工作表/幻灯片关系顺序、共享/内联字符串及转义名称、单元格位置和缓存/无缓存公式、PPT文本/表格、PDF元数据/签名/下载MIME和字节、损坏/实体定义/旧格式/投影上限回退，兼验Word与原路径/容量限制。npm run typecheck及git diff --check通过。未新增或运行组件/函数/页面测试，未运行全量测试、生产构建或浏览器验收；使用临时文件与受控服务，无用户文档/数据库修改、Pi调用、第三方上传或服务启停。


## FILE-001 生成文件下载与预览

状态：已实现，API定向验收通过。两类会话中的真实项目文件链接打开现有文件浮窗；DOCX可预览标题、表格、段落及代码内容并下载原件；其他不支持预览的文件仍可下载且明确提示。下载中文名/字节完整；不存在、跨归属、敏感路径、越界符号链接拒绝；失败不伪造成功。

实际验证：tests/file-download-api.test.cjs共5项通过，直接调用Project Route Handler及Workspace API，临时文件验证中文名/MIME/长度/no-store,no-transform/nosniff、下载字节不变、Word标题与7个表格和代码块、HTML仅作为数据、纯文本/损坏Word/二进制回退、路径/归属/目录拒绝及512KiB预览和50MB下载边界。npm run typecheck、git diff --check通过。仅新增API接口测试；未写页面/组件/函数测试，未运行全量测试、生产构建或浏览器验收。测试文档为临时夹具，不代表已检查用户所述实际文件；不修改用户文档、不迁移数据库、不调用模型或启停服务。


本文范围：独立项目与通用需求验收。Workspace的专属设计、模型、API、交互与需求统一见 [06｜Workspace](06-workspace.md)，本文不定义或复写其规则。

本文决定做什么、不做什么，以及何时算完成。每项需求使用稳定 ID，并只按两个要点验收：模型事实是否正确，API 是否按契约读写模型并使用规定的 Pi 能力。

页面只验证它是否忠实显示 API 结果。需求不复制 `02` 的字段或 `03` 的完整流程，只引用它们。没有需求 ID 和验收条件的行为不得实现。

测试通过只证明本文件已记录的条件，不替代其他设计文档。默认只运行受影响的函数级或 API 测试。

## 当前规则

SETTINGS-002（已实现，定向验证通过）：单击左侧独立项目名称或展开箭头仅切换会话列表展开状态，不改变当前选择、中间会话栏或设置页，不触发打开/关闭会话。齿轮按钮打开项目设置，单击会话条目才进入对应会话。左侧单击关闭辅助浮窗仍沿用04规则。不新增模型或API；此前名称点击打开设置的投影被本规则替代。tests/settings-layout-behavior.test.cjs和tests/session-auxiliary-dialog.test.cjs合计3项通过，覆盖名称连续点击只触发展开、箭头/齿轮/会话动作分离及浮窗关闭和设置回归；npm run typecheck、git diff --check通过。只用受控API及DOM，不启停用户服务或写用户数据库，真实浏览器待验。

MODEL-FAIL-001（已修复，API定向验证通过；浏览器待验）：已确认终结并持久化的模型请求失败或明确调用前模型校验拒绝，不应伪装为未决操作，保留同一会话与lease供显式切型号；错误、原生历史及failed journal保留，不重发失败键。未证明终结、持久化/回执失败仍unknown。历史prepared只通过现有recover显式承认未知，模型设置提供核对入口与再次确认，不自动改历史或解除门禁。验收：消息/模型/恢复application接口用临时库与受控Pi覆盖供应商拒绝→failed/idle→原lease切换、旧键不重发、调用前模型拒绝、真实未知继续阻塞和历史recover许可/确认。不新增SQL或迁移。实际验证：tests/model-request-failure-api.test.cjs共4项通过（临时SQLite/真实Pi SDK受控流，含供应商404、调用前模型拒绝与restore失败、缺失回执、历史显式ack及原lease切型号）；tests/project-operation-recovery.test.cjs仅运行image rejection/message retries两项API回归，均通过。类型和差异检查通过。用户报告会话的供应商404与prepared记录已只读核对，原生文件复核未变；未调用真实供应商、未修改用户数据库/journal、未构建或重启服务，不宣称浏览器流程已验收。

IMG-FAIL-001（已实现，消息application接口定向验证通过；真实供应商拒图待验）：图片能力拒绝为已知失败，已确认终结的请求不进入unknown或导致连接不可用；保留具体提示和原生历史，不自动重试，不隐去真实未决操作。验收：独立项目消息API记录failed且新键可继续、旧键返回原错误；其他异常仍unknown，Workspace沿用已知失败收尾。无SQL迁移，不自动解除旧unknown。实际验证：tests/project-operation-recovery.test.cjs共9项通过，新增内存SQLite及受控Runtime的message接口验证，覆盖图片拒绝→observed/failed、idle、同键不重发、新键可继续及其他错误保持unknown/unavailable；git diff --check通过。未新增或运行非API测试，未运行全量测试、生产构建或真实模型，未操作用户数据库或历史。

OPS-007（已实现，自动清理、真实生产构建与已有包替换通过；失败恢复分支待验）：修复重复发布仍保留旧包的问题。验收：npm run release 使用独立 .next-release 构建，构建及暂存打包全部成功后才更新默认 release；每次取得锁后先校验并清空旧 .next-release（含缓存），拒绝符号链接、非目录及含运行数据/配置的构建目录。原纯发布包只在切换时临时保留，新包成功后自动删除，失败恢复原包；清理失败报告残留路径，不扫描删除其他历史备份。开发目录 .next 不参与发布或清理。已有自定义目标、包含运行数据/配置的默认目录、符号链接及并发发布须拒绝；成功明确输出路径和 Build ID，包内保留生成时间。无模型/API/SQL/Pi 变化，不启停用户服务、不迁移历史库。底层直接打包仍不编译、不覆盖。实际检查：node --check scripts/release.cjs、node --check scripts/package-release.cjs、git diff --check 通过。用户明确要求删除旧产物并重新生成后，确认无Next运行进程及发布目录无运行数据/配置，删除.next、.next-validation、release，执行npm run release -- --without-node-modules成功（含Next TypeScript检查）。新包Build ID为vpKOE8Wh70YBZmQBqPusq；生产目录、发布目录、release.json三者一致，59个入口/静态资源/锁文件/SQL文件逐一SHA-256一致，无node_modules或用户数据/配置，发布锁已释放。Next自动增加tsconfig.json的.next-release类型目录并更新next-env.d.ts引用。无API契约变化，未新增或运行测试，未启动产物服务、未启停用户服务或改写数据库；首次从空发布目录生成。随后按用户要求加入自动清理并再次执行同一release命令：日志确认自动删除旧.next-release及替换后临时旧包，新Build ID为Mz3RUQ_UlKhpHbopZ0XWS，与前次不同；三处Build ID一致，59文件SHA-256一致，无临时发布目录、旧包或锁残留。Next TypeScript、脚本语法及git diff --check通过；未新增或运行测试，未启停用户服务或修改数据库。失败恢复及清理失败分支未做运行验收。

OPS-006发布说明补充（默认输出更新规则已由OPS-007取代）：README明确直接执行package-release只复制已有构建、不编译或检查源码新鲜度；自定义release-new目录时构建/压缩-C/上传文件必须一致，服务器解压后对比release.json的buildId，并通过pm2 describe核对script path与exec cwd，重启后刷新页面。Build ID只标识产物，不证明运行进程已加载；保留数据及原生历史。此次仅文档修改，人工对照package.json和打包脚本、git diff --check验证，不新增模型/API、不运行构建或服务，也不改已有release目录。

OPS-006依赖下载选项（已实现，打包定向通过；服务器安装待验）：发布脚本支持 --without-node-modules，包内不含依赖目录，包含与构建一致的package.json/package-lock.json，服务器只安装生产依赖即可启动，无应用源码或构建。tests/standalone-release.test.cjs共5项通过，新增排除依赖目录、清单及锁文件原样保留、缺锁文件拒绝和包内安装提示；脚本语法及git diff --check通过。默认随包依赖的方式保留，未执行服务器npm安装或启停用户服务。

OPS-006（已实现，本机独立产物验证通过；Ubuntu实机待验）：npm run release 生成可独立部署的 standalone 发布目录；运行端仅需兼容 Node 和系统运行依赖，使用 node server.js 或随包 systemd 脚本。tests/standalone-release.test.cjs 四项验证包内容、静态资源/SQL、无应用源码及用户数据、覆盖保护、缺失构建拒绝、构建阶段内存库且不打开/创建用户库、systemd产物入口；与tests/next-dev-origins.test.cjs及tests/systemd-scripts.test.cjs合计9项通过。临时完整副本npm run release真实构建（含Next类型检查）通过，构建不创建.data；移出产物并删除副本src/web/node_modules后启动独立server.js，首页/静态JS及projects/agents/mcps/workspaces四API均200，Pi SDK从产物导入成功。全部使用临时库、隔离HOME和配置，仅启停临时测试进程，无真实模型调用或用户服务/数据库改写；脚本语法及git diff --check通过。原生依赖跨系统/架构不可直接复用，Linux产物须在兼容环境构建，未宣称Ubuntu真实模型验收。

OPS-005（已实现，配置静态核验通过，真实HMR待现场验收）：开发资源及HMR默认允许任意IPv4地址、多段域名、本机主机名和本机IPv6地址，不要求逐个登记访问IP。AI_WORKSPACE_ALLOWED_DEV_ORIGINS 追加额外来源，支持多个IP/域名与Next子域名模式，去掉空白和空项；空值仍保留默认来源。验收直接加载配置并用当前Next来源匹配器核对默认来源与追加来源，修改后重启生效。不启动服务或操作数据库。

OPS-004（已实现，函数与客户端定向验证通过；真实浏览器待验）：公网 HTTP 访问时，浏览器缺少 crypto.randomUUID 不得阻断创建表单、附件及 API 提交；统一使用安全随机 UUID，原生方法缺失时以 getRandomValues 生成 UUID v4，不使用 Math.random。既有 API 幂等键的作用域、重试复用、权限、模型及 Pi 归属不变，无数据库迁移。tests/browser-random-uuid.test.cjs（4项）验证原生与回退路径、UUID 格式与安全随机来源、项目/工作区/消息/历史Bot客户端实际提交、显式幂等键保留，以及无安全随机源时阻止提交；tests/session-subscription-client.test.cjs（3项）验证订阅/心跳/重连与发送，合计7项通过。git diff --check通过，web中无直接crypto.randomUUID调用；未启动服务、操作用户库或调用真实模型，公网浏览器现场待验。

OPS-003（已实现，定向测试通过）：修复Linux旧glibc/SWC回退下next.config.ts扩展解析失败；配置与插件直接由Node加载，不启动服务，定向验证配置导入、webpack插件挂载及原子manifest行为。无模型/API或数据库变更。实际运行tests/atomic-manifest.test.cjs（5项，直接Node导入配置、开发插件挂载、manifest原子写/失败保留及真实临时Webpack编译）、tests/systemd-scripts.test.cjs（3项），共8项通过；npm run typecheck、git diff --check通过。未启动用户服务，未在CentOS实机验证SWC WASM或系统原生库兼容性。

OPS-002（已实现，启动配置静态核验通过，网络连通待现场验收）：开发、生产CLI与systemd默认绑定0.0.0.0:3000，PM2执行npm脚本时继承相同默认值，不设来源IP白名单；保留显式本机IPv4/IPv6地址覆盖。验收核对npm脚本、systemd生成结果与启动脚本默认值，不改防火墙、用户服务或数据库。未启动服务或做真实网络连通验收。

OPS-001（脚本已实现，受控测试通过；Linux实机待验）：提供可审查systemd unit生成/安装脚本及生产启动脚本；支持user/system作用域，固定cwd/INIT_CWD、明确运行用户HOME/Node/PATH、端口/监听地址可配、异常重启及journald。缺依赖/构建失败时明确退出，不自动构建/迁移/启停；安装不自动enable/start，已有不同unit默认不覆盖。验证参数与systemd转义、安装写入边界、启动参数/工作目录和预检，使用临时目录和假命令，不碰用户服务/数据库。实际运行tests/systemd-scripts.test.cjs三项通过（unit参数/转义、启动前置检查/exec与配置根、临时unit安装及覆盖保护）；bash -n scripts/start-systemd.sh、node --check scripts/systemd.cjs、git diff --check通过。未生产构建，未调用真实systemctl、安装unit或启停服务；Linux systemd实机验收留给部署步骤。

SLIST-002（实现中）：两类侧栏时间显示持久lastOpenedAt；实际新开连接成功时记录，刷新/消息/心跳/打开幂等重试不变，失败不记录；历史无记录明确显示。标题只来自最新用户输入，无消息显示新会话，无文本输入有占位，不再回退purpose。SessionOpenHistory事实与文件在02定义，API在03，Workspace映射06；无SQL迁移、不改旧数据。

SETTINGS-001创建后投影调整（已实现，定向验证通过）：新建Project成功后进入该项目设置页，以创建API返回的字段和writeETag初始化，未修改不提交；后续编辑仍调用该Project的PATCH并携带返回ETag。创建失败保留草稿，用户已切换页面时迟到的创建响应不抢回设置页；不新增模型、API或自动创建会话。tests/settings-layout-behavior.test.cjs一项通过，覆盖新建成功后的设置字段/未改禁用/后续PATCH身份与ETag、创建失败草稿和迟到响应，以及原有编辑/删除/Workspace反馈；git diff --check通过。只用受控API及JSDOM，不启动服务、不写用户数据库；真实浏览器待验。

SETTINGS-001（已实现，定向验收通过）：项目新建/设置与工作区新建/设置采用相同主画布布局、目录选择、保存/取消/关闭和等待/失败反馈。Project复用03现有CRUD契约，Workspace复用06配置API；不增加模型、字段或接口，不调用Pi，不迁移SQL。定向验收覆盖POST不含status、PATCH仅变化字段及If-Match、保存等待/失败保留、取消无写入、晚响应不跳回，以及工作区同类反馈。实际运行tests/settings-layout-behavior.test.cjs、tests/workspace-settings-api.test.cjs、tests/catalog-contract.test.cjs、tests/session-auxiliary-dialog.test.cjs，四文件7项通过；补充未修改不提交后再次运行settings-layout-behavior单文件通过。npm run typecheck、git diff --check通过。只用JSDOM、受控API和临时库，未启动服务、调用模型或写用户数据；未做真实浏览器视觉验收。

SLIST-001（已实现，定向验收通过）：用户消息（原生/待确认/实时）右对齐，正文保持正常左对齐；两类左侧会话显示最新原生用户输入预览，单行省略；当前时间与空历史规则按SLIST-002，读取失败明确标记。派生值来自所属Pi树，不写SQL或替代摘要；测试覆盖整树追加顺序、消息时间、无消息和读取失败。实际验证：tests/session-list-preview.test.cjs（2项，纯派生、两类DTO、purpose/ETag保持）、tests/pi-session-fork-export.test.cjs（5项，扩充真实临时原生历史预览及身份读取失败）、tests/session-tree-presentation.test.cjs（2项，新增原生/待确认/实时用户右对齐）、tests/project-session-model-contract.test.cjs（4项）、tests/session-auxiliary-dialog.test.cjs（1项），五文件14项通过；npm run typecheck、git diff --check通过。无真实模型请求、用户库写入或服务启停。

PSES-019（已实现，定向验收通过）：两类Session设置提供模型对应的Pi思考等级，允许仅改等级；PUT model可选thinkingLevel、严格支持校验、耐久幂等与互斥、同一原生身份持久化，不改默认配置/SQL。验收覆盖只读DTO、支持等级、相同值去重、冷恢复、同键异等级、忙碌/unknown和页面显式应用。实际验证tests/pi-session-fork-export.test.cjs（5项，新增实际Pi思考等级持久化/恢复/不支持值拒绝）、tests/project-operation-recovery.test.cjs（5项，新增项目等级幂等与门禁）、tests/workspace-model-recovery.test.cjs（5项，新增HTTP等级透传与冲突）、tests/session-model-settings.test.cjs（1项，扩充同排控件/等级草稿与显式应用）、tests/session-auxiliary-dialog.test.cjs（1项）；五文件17项通过。npm run typecheck、git diff --check通过；仅临时文件和受控Runtime，无真实模型请求、用户数据库/配置写入或服务启停。

MCFG-003（代码已接入，定向API验证通过；浏览器待验收）：新会话首次初始化且Pi当前分支无model_change时使用当前默认；已有会话打开、刷新、重连、冷恢复及派生沿用分支最后保存模型和思考等级。默认配置变化不覆盖已有模型，无需保存旧默认或来源标记。验收覆盖两类会话的首次初始化、默认变更后的冷／热打开、重复打开不追加、思考等级保持、原生身份和历史保真；已有模型可用时默认不可用不影响打开。仅临时库与受控Runtime验证，不迁移用户数据。

MCFG-002（代码已接入，定向API验证通过；浏览器待验收）：settings.enabledModels沿用Pi scope语法；当前型号不存在、被过滤或认证不可用时返回MODEL_UNAVAILABLE，不自动回退默认、不改模型／思考等级或历史、不发送。已有身份的open可取得unavailable恢复lease，models只读返回实际选择及可用列表，显式切换后原lease可继续。验收覆盖两类open、messages、model及compact相关入口的许可与副作用；配置解析错误仍MODEL_CONFIGURATION_ERROR。旧自动回退验收已被本规则取代。

MCFG-002／003本次验证：`tests/session-open-default-model-api.test.cjs` 4项application API测试通过，覆盖两类首次初始化、默认变化与默认无效时冷／热重开、metadata-only思考等级保持、当前型号被过滤／移除时unavailable与历史不变。`tests/model-request-failure-api.test.cjs` 5项API测试通过，含当前型号不可用而默认仍有效时不prompt／不改模型或历史，显式原lease切型号后恢复发送，以及既有失败／unknown边界。`tests/workspace-model-recovery.test.cjs`仅按名称运行HTTP model recovery、uncertain switch、prevalidation failure、Workspace HTTP四项API场景，均通过；整文件初次运行因既有互斥／删除等待场景超时，未将该场景计为通过。类型检查与差异检查通过；仅临时目录、内存SQLite及受控Pi，未调用真实供应商、修改用户历史／数据库、启停服务或生产构建。浏览器、真实模型及压缩端到端仍待验收。

SCONN-001（已实现，定向验收通过）：Session只显示打开/关闭，可关闭后重开同一Pi身份；历史ended_at不再终止使用，DELETE实际删除记录。打开后的状态与进度由事件驱动，无定时轮询；覆盖旧已结束记录重开、连接开闭/租约、订阅初始快照竞态、消息/压缩终态、用户关闭不自动重连、真实删除及跨会话晚事件隔离。只用临时库、受控Runtime及最小DOM验证，不改用户历史库。

SCONN-001验收记录：新增tests/session-connection-contract.test.cjs（4项：两类会话历史记录重开/关闭不写SQL/DELETE、关闭互斥与失败保留租约、SSE初始活动快照与明确关闭）和tests/session-event-state.test.cjs（1项：事件驱动进度、主动关闭不重连、晚事件隔离）。相关tests/project-session-lifecycle.test.cjs、project-session-model-contract.test.cjs、session-subscription.test.cjs、session-subscription-client.test.cjs、session-presence.test.cjs、workspace-model-recovery.test.cjs、pi-context.test.cjs、session-deletion.test.cjs、session-auxiliary-dialog.test.cjs均通过；合计11文件33项。最后关闭门禁及传输容错修改后，重跑connection/event-state/lifecycle/subscription/deletion五文件15项通过。类型检查和git diff --check通过；未执行真实模型或真实浏览器验收。

### 项目会话正式版 v1.0.0：功能完整

用户已确认本轮项目会话功能基线，并要求提交与标记正式版；Git 标记为 `project-session-v1.0.0`。本版包括项目独立执行、原生身份恢复和句柄复用、服务端订阅与 ping/pong、完整 Pi Session Tree、紧凑节点展示、内联图片/文件/大段文本、候选块光标操作，以及本轮附件归组和可靠原生关联。

这是此前项目会话基线的版本标记，不涵盖本文新增的会话检查、Pi 配置整改与 SessionMemory 退役。仍适用的验证记录保留；被替代的界面要求不再作为验收条件，历史版本以 git 追溯。提交未执行历史迁移、用户数据库写入、服务启停或远程发布。

## 2. 当前范围

Session 独占 Pi 原生树，Project、Agent、模型配置、消息、工具、附件、订阅、手动压缩与会话检查按各自契约保留。应用级记忆功能整体退役，不保留后台总结、模板、内容校正或自动摘要命名。历史数据处理与目标表调整见 02/06，本轮已实现通用与独立项目代码，定向验证记录见 §16；不操作用户数据库。

## DBUP-002 当前7表迁移

状态：已完成正式迁移及只读核验。验收：只读预检固定来源/目标及数据摘要，拒绝打开连接和版本冲突；完整旧库及Markdown归档；7表迁移保留全部现存项目/会话/Workspace、nativeRef及创建身份；只映射项目Agent新版本与会话引用，不重放退役调用；单事务失败回滚，目标完整性/外键/逐行值核验及幂等重复执行。模型映射唯一见02 §11.2。脚本为scripts/migrate-current-schema.cjs，指南为scripts/current-schema-migration-guide.md；tests/current-schema-migration.test.cjs三项通过（只读预检/全量归档及身份与版本映射/重复执行、冲突与连接拒绝、提交前失败回滚）。正式执行前无其他数据库连接，planSha256=8957d83c45ba6930044d90110b641b0da5a6489d6be6bccef365d0e71a39ecde，执行返回migrated，再次预检current；matchesTargetSchema=true、integrity_check=ok、foreign_key_check=0，4个Agent及8个独立Session加载通过。保留6个Project、0个MCP、4个项目Agent、8个Session、1个Workspace、5个WorkspaceProject、1个WorkspaceSession；原生引用逐字不变，4个项目Agent从v2映射v3，旧文件不变。完整旧库及10份旧Markdown归档在.data/ai-workspace-v5.sqlite.current-schema-60130881-c8d2-498d-a100-75a277d4b41a/，before.sqlite SHA256=60f6c8a11b2e1330b32cb73f1c4df1be61482db73ab5ac0aa047d017ca488c50，权限0400；含退役表和协调Agent、unknown调用原文。未操作用户服务、Pi transcript、journal或配置。本文其他历史阶段“尚未迁移”记录以本节最新事实为准，不扩大后续迁移授权。

## ROUTE-CLEAN-001 退役入口与死代码清理

状态：已完成。删除5个固定404的记忆/模板路由、旧记忆迁移脚本及指南、未接入的NDJSON链路/轮询器/旧会话投影/旧角色版本与选择器、死DTO/状态端口/样式及专用旧测试；清理源码空目录。仅供受控SDK测试的Pi初始化辅助移到tests/support，生产初始化路径不变。验收当前消息POST为202且SSE可用、退役路由无注册、未知Workspace路径404、类型边界完整；不修改用户数据库、备份或发布产物。

实际验证14个定向测试文件共45项通过：tests/session-memory-retirement.test.cjs（无退役路由、只读Schema门禁/JSON解析）；tests/workspace-session-api.test.cjs（消息接受、租约、未知路径404和恢复）；tests/session-subscription.test.cjs与tests/session-subscription-client.test.cjs（SSE、连接关闭和独立JSON提交）；tests/message-references-composer.test.cjs（输入保留、附件与当前JSON提交）；tests/agent-ui-flow.test.cjs（保留的Agent目录入口）；tests/project-message-timing.test.cjs（现行打开/关闭生命周期与执行计时）；tests/project-session-model-contract.test.cjs（模型/创建API）；tests/pi-auto-compaction.test.cjs、tests/pi-native-snapshot.test.cjs、tests/project-native-tools.test.cjs、tests/server-web-search.test.cjs、tests/tool-search.test.cjs、tests/workspace-runtime.test.cjs（测试辅助移动后真实SDK受控流、原生工具、搜索、历史和恢复）。初次执行的计时旧夹具缺少现行open/close，修正后该文件3项单独复验通过；45项为各文件最终通过数，不重复计数。npm run typecheck与git diff --check通过。未运行全量测试、生产构建或真实供应商模型。

## 3. 会话区整改验收

| ID | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| PSES-008 | 正式版功能完整；验证范围见记录 | 服务端主导会话订阅 | 项目会话使用独立于消息 POST 的 SSE；打开并订阅后复用 Pi 句柄。服务端发出连接级 ping，页面仅收到后 POST pong，无页面定时保活或 transcript 轮询。应答严格匹配连接、会话及未过期挑战；多页面互不覆盖，断线释放该页面使用权但不伪造执行终态，后台使用权独立。重连重新打开、先订阅后读快照，去重及关联按 `03`，不自动重发输入；异常与未知明确显示。 |
| BOT-REMOVE-001 | 已完成（源码及定向验收；迁移见DBUP-002） | 旧Coordinator/Task/Bot整体退役 | 删除旧Coordinator/Task/Bot的模型、API/服务/Runtime/工具/启动恢复/类型/客户端/SQL访问/专属Schema/旧迁移及测试，无兼容入口或未来接入计划；删除旧调度能力模型与Task引用查询，历史会话仅保留不可执行的Agent引用标识；Agent仅project用途和文件读写能力；目标14表减为7表，旧库不自动迁移、不删除历史文件；独立项目与Workspace原生执行、附件、恢复和全树正常。模型及历史归档边界见02，专属退役见06。 |
| PSES-028 | 已实现；定向验证通过，真实模型待验 | 独立项目Pi原生工具 | 独立项目会话使用read/bash/edit/write，不注册project_*或Bot协作工具；cwd为所属项目，角色不限制工具；原生bash可执行已有Python，原生文件工具可读取会话附件；内部read轮次仅启用read，完成/失败/中止恢复；搜索开关可组合；精确恢复与历史project_*原文保留，API参考/预览检查不变，无SQL或历史迁移。工具服从宿主权限，不宣称cwd为沙箱。 |
| PSES-027 | 已实现；定向验证通过，真实浏览器待验 | 拖入文件 | 共享Composer接受本机单个/多个文件与图片拖入，保留原名和字节，沿用现有上传references契约、数量/字节限制、内联块和失败保留；目录/读取失败/超限整批拒绝，不改变草稿和已有附件；运行/提交/阻塞时拒绝拖入；只拦截文件并防止浏览器打开，不拦截普通文本，不自动发送；服务器项目参考仍不复制。验证：tests/message-references-composer.test.cjs、tests/prompt-input-submit.test.cjs、tests/prompt-input-ime.test.cjs共20项通过，npm run typecheck通过；受控事件验证混合文件字节、失败保留、仅附件、files回退、目录/读取错误/单个与合计超限/混合数量限制、忙碌禁用和文本拖放；未启动服务或调用真实模型。 |
| PSES-026 | 已完成 | 附件提交连接恢复 | 消息接受前租约失效/句柄缺失明确报RUNTIME_NOT_OPEN，不准备message journal、不写附件/Pi；客户端按错误码重建连接，保留输入和文件，不自动重发；普通校验不重连，旧请求迟到错误不破坏新连接或其他会话。验收：tests/session-message-reconnect.test.cjs、tests/session-subscription-client.test.cjs、tests/session-event-state.test.cjs、tests/project-operation-recovery.test.cjs、tests/message-upload-api.test.cjs、tests/message-references-composer.test.cjs，共24项通过；npm run typecheck通过。模拟网络/Runtime及临时journal，无真实浏览器、服务重启或真实模型验证。 |
| PSES-025 | 已实现；定向验证通过，真实模型与浏览器待验 | 非图片附件工具读取 | 上传/粘贴的Word、Excel、PPT、MD、TXT等非图片文件统一存于应用按Pi会话隔离目录；不按2MB分流，不将正文/base64直接送模型；模型按位置通过工具读取，常见OpenXML/OpenDocument提供文本副本，旧格式/加密/损坏/超限提取明确报告；图片仍image输入。跨轮与恢复不丢文件，应用存储原件不变、去重不覆盖、存储校验拒绝跨会话与符号链接；独立项目原生工具权限按PSES-028，不将存储校验宣称为工具沙箱；不新增SQL或改写历史。 |
| PSES-024 | 已实现；定向验证通过，真实模型与浏览器待验 | 项目参考按需读取 | 上传/粘贴图片发送内容快照，非图片按PSES-025落盘；项目参考仅发送服务端校验的位置，不预读正文、不占快照字节额度，仍与上传共用10项数量；项目归属、路径/敏感文件/符号链接/普通文件校验不放松；模型通过已有read/bash读取执行时最新内容，不因选择而获得新权限。定位和工具历史归原Pi，不新增SQL或附件存储；服务器已有项目文件一律引用原位置，不复制原件；旧工作目录文件入口按BOT-REMOVE-001整体删除；旧快照不改写。 |
| PSES-023 | 已实现；定向验证通过，真实供应商待验 | 参考文件容量 | 上传/粘贴快照单个<50,000,000字节、合计≤50,000,000字节；前后端共享额度，项目引用按PSES-024改为位置不计字节，消息JSON容纳base64与正文元数据；超限413且不调用Pi，预览额度不变；大于旧2MiB/8MiB的有效材料可通过，精确边界和混合来源合计纳入验证。OpenAI依据及实际上下文限制见03 §5。 |
| PSES-022 | 已实现；定向验证通过，真实模型待验 | 附件跨轮追问 | 同一 Session 活动分支内的图片、上传文件和长文本快照，以及PSES-024项目位置，在第二轮未附材料时仍进入模型请求；精确恢复后继续可用，不混入其他分支；压缩由 Pi 原生处理，不额外过滤附件，不保证压缩后原图细节；不新增 SQL、摘要或附件存储。 |
| PSES-011 | 正式版功能完整；定向验证通过 | 本轮附件归组与原生关联 | 参考 custom_message 可可靠关联原生 entry，不残留重复临时块；唯一后继链（允许首轮 system 消息）通向用户消息时附件显示于该用户正文后，只投影一次，完整内容可查看；分叉、无用户子节点或无法确认关联时不猜测、不丢失节点。 |
| PSES-010 | 文件粘贴修复及定向验证通过；真实浏览器与供应商识别待验 | 图片、文件与大段文本粘贴 | 项目输入框支持粘贴 PNG/JPEG/GIF/WebP，缩略图可移除；剪贴板普通文件、混合图片/文件及仅 files 可读时均保留全部材料、文件名和字节，读取失败明确报错，不忽略文件或发送文件名代替内容；实际供应商请求包含本轮文本和原生图片内容；实际模型仅支持文本时，所有图片来源统一明确报告 MODEL_IMAGE_UNSUPPORTED，不追加参考节点、不调用 prompt，不以图片占位文字继续回答；上传/项目文件及粘贴材料均在输入区光标处内联插入，不在工具栏下方显示；选择/键盘删除同步移除发送材料，弹窗返回恢复插入位置；无文件项时粘贴文字随content发送，超过10行显示“已粘贴 N 行”折叠正文块，支持展开编辑、移除、完整原文复制与发送；10行及以内直接显示，字符数量不触发折叠。不转附件、不占附件额度，保留换行；历史长文本附件不改写。支持真实附件单独发送；遵守 references 混合限额，校验失败不丢输入、接受前失败保留材料，不污染切换后的草稿。 |
| PSES-009 | 正式版功能完整；定向验收通过 | 恢复会话不重复记录相同配置 | 项目 Runtime 使用初始化适配；仅配置节点的空会话重复恢复不增加相同 model_change/thinking_level_change，不改变叶子或历史字节；实际变化及缺失配置仍记录，按当前分支比较，其他分支不干扰；失败恢复原方法，旧重复节点保留。使用临时目录和受控 SDK 初始化验证，不访问真实模型或用户历史。 |
| UI-041 | 正式版功能完整；验证范围见记录 | 紧凑 Tailwind Pi 对话流 | 项目会话使用全树对话流；正文安全 Markdown、thinking 和完整工具内容可查看，原始节点可展开；分支与活动路径不丢失。采用 `04` 紧凑 Tailwind 间距，无多层大 padding、固定消息高度或内容截断。定向投影测试覆盖消息、分支、未知块及敏感原文；真实浏览器外观仍需单独验收。 |

BOT-REMOVE-001验收：最新一轮12个目标文件41项全部通过：tests/retired-model-boundaries.test.cjs、tests/current-schema.test.cjs、tests/agent-definition.test.cjs、tests/agent-storage.test.cjs、tests/catalog-contract.test.cjs、tests/project-session-model-contract.test.cjs、tests/session-execution-optional-role.test.cjs、tests/session-deletion.test.cjs验证模型/协议、旧调度配置不访问、MCP仅查询Session、7表目标、旧库只读且字节不变、Agent版本与删除事务；tests/project-native-tools.test.cjs、tests/workspace-runtime.test.cjs、tests/project-session-tree.test.cjs、tests/session-file-storage.test.cjs验证原生工具/Python、附件、精确身份恢复与历史全树。此前本项另有tests/standalone-release.test.cjs、tests/project-session-optional-role.test.cjs、tests/session-memory-retirement.test.cjs、tests/session-files-pi.test.cjs、tests/message-references.test.cjs、tests/project-operation-recovery.test.cjs、tests/session-connection-contract.test.cjs、tests/browser-random-uuid.test.cjs、tests/session-execution-cancel.test.cjs、tests/transcript-projection.test.cjs定向通过。npm run typecheck和git diff --check通过。旧协调/Task/Bot源码、SQL查询/表、工具/入口、旧迁移脚本和参考快照已清理；文档改为06-workspace.md，旧模型仅保留本项退役边界说明。未运行全量测试、生产构建或真实模型/浏览器，未操作用户服务、数据库或Pi历史。

PSES-011 本轮接口核对：tests/session-entry-link-api.test.cjs两项application/SSE接口测试通过，使用临时内存数据库、临时Pi历史及受控模型流，实际调用原生write/edit后核验两类会话的三条流式assistant消息、两条工具结果均获得同runId/temporaryId的唯一entry_link，且目标存在于最终原生树，文件内容为修改后结果。未复现运行结束后消息无法关联；生成中尚无entryId时显示“未确认持久化”是既有投影，不代表项目文件保存失败。未运行真实模型或浏览器，未改写用户项目、数据库或历史。

PSES-011 验证记录：`tests/native-session-subscription.test.cjs` 验证 custom 原生对象关联、通知前已追加时同步发送 entry_link、真实 Pi sendCustomMessage 及普通消息/工具关联；`tests/reference-tree-projection.test.cjs` 验证完整原文保留、唯一归组、不跨分支及无法归组时保留；`tests/session-tree-projection.test.cjs` 复验原始内容；`tests/pi-reference-integration.test.cjs` 使用 Pi 内存 Session 和受控模型流，验证首次 system 节点及恢复后多轮附件归组，当时验证模型请求的本轮材料隔离；该隔离规则已由 PSES-022 替代。共 10 项通过，类型检查与 diff 检查通过。未调用真实模型、改写用户历史或操作服务，浏览器体验待验收。

PSES-010 候选块光标修正：`tests/inline-composer-editor.test.cjs` 九项通过，新增验证块前后独立光标边界、插入完成后光标落在块后、左右键整块跨越、连续候选不嵌套或跳过、Backspace/Delete 整块删除，以及光标占位字符不进入发送正文；原有上传、项目文件选择、替换、失败恢复与 IME 用例同时通过。类型检查通过。使用 DOM 测试环境，真实浏览器光标视觉仍待现场验证。

PSES-028 验证记录：tests/project-native-tools.test.cjs以实际Pi SDK和受控流验证独立项目原生read/bash/edit/write、临时Python脚本执行及cwd、附件绝对路径读取、无角色/能力全关不限制工具、内部read轮次仅read且不可调用bash/edit/write、成功/异常/中止后恢复、精确冷恢复及历史project_read调用和原文前缀不变。tests/tool-search.test.cjs额外验证只读轮次与web_fetch组合及失败恢复；tests/session-files-pi.test.cjs改为原生read读取并恢复附件；旧包装及其测试已由BOT-REMOVE-001整体删除。结合tests/project-session-optional-role.test.cjs、tests/session-file-storage.test.cjs、tests/session-execution-optional-role.test.cjs、tests/project-session-lifecycle.test.cjs、tests/workspace-runtime.test.cjs、tests/pi-native-snapshot.test.cjs、tests/pi-auto-compaction.test.cjs，共10文件28项通过；npm run typecheck及git diff --check通过。早期独立项目project_*路径及逐轮包装验收由本项取代，不改旧历史。仅临时文件/内存数据库与受控SDK，无真实模型、用户服务启停、数据库迁移或用户历史改写；未安装Office库或新增下载API。

PSES-025 验证记录：`tests/session-file-storage.test.cjs` 验证小于/超过2MiB的非图片都保留内部file材料、图片仍为image、Office/OLE/PDF格式校验、原件字节与0400权限、会话隔离/同名去重/重开及损坏拒绝、DOCX/XLSX/PPTX/ODT文本副本、损坏与ZIP展开超限明确报告、Pi参考消息不含正文/base64、符号链接/跨会话拒绝；当前工具策略与原生执行验证见PSES-028及BOT-REMOVE-001。`tests/session-files-pi.test.cjs` 使用实际Pi会话和受控流，验证首请求只有位置，原生read后才获得正文，重建会话后的第二轮仍可读取附件。结合`tests/message-references.test.cjs`、`tests/message-upload-api.test.cjs`、`tests/message-reference-scope.test.cjs`、`tests/project-reference-locations.test.cjs`、`tests/pi-reference-integration.test.cjs`、`tests/project-session-optional-role.test.cjs`共8文件29项通过；npm run typecheck及git diff --check通过。新增小型ZIP依赖fflate；不调用网络模型、不启动或停止用户服务、不写用户库和原生历史，测试只用临时目录/内存库。PDF及旧DOC/XLS/PPT仅保存原件，额外解析器是否可用由部署环境决定，不宣称已完成这些格式的文本提取。此前上传文本直接进入上下文的验收由本条替代。

PSES-024 验证记录：`tests/project-reference-locations.test.cjs` 用临时内存库验证Workspace消息API同时保留上传快照和项目位置、跨工作区/敏感路径拒绝；实际Pi会话+受控模型流先只接收位置，再调用原生read，模型下一次请求才收到选择后修改的最新文件内容。`tests/message-references.test.cjs` 验证独立项目应用端口传递位置、普通/超过50MB项目文件均不读字节、越界符号链接/敏感目录/目录/缺失文件拒绝、禁止客户端注入absolutePath、数量与重复校验、项目位置不占快照额度；结合`tests/message-references-composer.test.cjs`、`tests/message-upload-api.test.cjs`共4文件23项通过，npm run typecheck及git diff --check通过。未调用真实模型、启停用户服务、写用户数据库或改写原生历史，无迁移。额外运行既有tests/workspace-session-api.test.cjs时，旧memory端点预期200但当前退役接口404，造成1项失败；该文件的其他3项通过，此既有测试未按退役契约更新，不作为本项通过证据。

PSES-023 验证记录：新增共享 message-reference-limits，统一浏览器、服务端解析、Project/Workspace参考读取及消息HTTP上限。`tests/clipboard-input.test.cjs` 验证单个49,999,999字节通过/50,000,000拒绝、合计50,000,000通过/+1拒绝；`tests/message-references.test.cjs` 验证超过旧单个/合计限制的有效内容、50MB精确总量、当时上传与项目引用快照混合超限（项目引用现由PSES-024改为位置）、单文件50MB拒绝及临时项目文件读取门禁；`tests/message-upload-api.test.cjs` 验证Project/Workspace对超过旧12MiB请求返回202、非法材料400、Content-Length及无该头流读取超限413，base64/正文/元数据预算充足；结合`tests/message-references-composer.test.cjs`共4文件25项通过，类型检查和git diff --check通过。只用临时目录与受控API，无真实模型、用户服务和数据库操作。资料核对为OpenAI当前图片/文件输入文档；统一50MB为应用选择，不宣称模型必定接收同样大小文本或已支持PDF。

PSES-022 验证记录：删除 referenceTurnId 的跨轮有效期过滤，模型上下文与压缩都直接遵循所属 Pi 活动分支及有效窗口。`tests/pi-reference-integration.test.cjs` 使用真实 Pi 内存 Session 和受控模型流，在 Chat Completions/Responses 实际供应商请求中检查第一轮图片和文本、第二轮无新附件追问、重建 AgentSession 后第三轮都包含原始材料；切到材料节点之前的独立分支后，两种请求均不包含这些材料。`tests/message-reference-scope.test.cjs` 验证来源标识不再注册上下文/压缩过滤，图片能力检查仍有效；结合 `tests/reference-tree-projection.test.cjs` 和 `tests/message-references.test.cjs` 共17项通过，git diff --check通过。无类型边界变化，未重复类型检查；未调用网络或真实模型、未启停用户服务、未改写用户库与原生历史。旧的“只保留本轮附件”验收由本条替代；原生压缩后不保证保留原图细节。

PSES-010 图片能力与入口一致性补验：只读核对现场 Pi 历史发现原生参考节点已含完整 JPEG；对应型号未配置 input，Pi 实际解析为仅 text，供应商转换会用占位文字替换图片。应用在追加参考前新增 MODEL_IMAGE_UNSUPPORTED 检查，不覆盖 Pi 配置；现场只修正 krill-openai/gpt-6.1-sol-fast 的图片声明，离线解析确认 text/image。`tests/inline-composer-editor.test.cjs` 新增真实 DOM 粘贴与上传按钮提交同一图片/文件的字节一致性验证；`tests/message-reference-scope.test.cjs` 验证仅文本/缺模型时拒绝图片且不写参考节点、普通文本仍可发送。与 `tests/clipboard-input.test.cjs`、`tests/message-references-composer.test.cjs`、`tests/message-references.test.cjs`、`tests/pi-reference-integration.test.cjs` 共37项通过，类型检查与 diff 检查通过。未发送真实模型请求、启停服务、改写数据库或原生历史；真实系统剪贴板及供应商视觉结果仍待验，不将现场配置缺项当作已证明所有粘贴故障的唯一原因。

PSES-010 文件粘贴修复验证：`tests/clipboard-input.test.cjs` 覆盖普通文件、图片/文件混合、files 回退、原名与完整字节、读取失败及限额；`tests/message-references-composer.test.cjs` 覆盖混合粘贴到 references 实际提交和失败保留；`tests/pi-reference-integration.test.cjs` 使用真实 Pi 内存会话及受控模型流，离线截获 Chat Completions/Responses 供应商请求，验证本轮文本及 image 数据完整、当时后续轮次按旧契约隔离（现由 PSES-022 替代）；结合 `tests/message-reference-scope.test.cjs` 共15项通过，类型检查与 diff 检查通过。未调用网络或真实模型、未启动用户服务或改写历史；不证明真实浏览器剪贴板与供应商视觉识别成功。

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
| UI-040 | 已实现；定向验证通过，真实浏览器待验 | 会话等待反馈 | 项目和工作区会话在 running=true 的整轮执行期间，于全部历史/实时节点之后只显示一处“正在等待”及转圈，统一替代“正在思考”；出现文本、thinking、工具活动/结果或实时节点持久化后均保留，直到服务端事件确认完成、失败或中止，running=false 后隐藏；不依据内容推断完成，不新增状态或 transcript。 |
| PSES-005 | 待验证 | 项目消息延迟诊断 | 服务端按一次发送记录阶段耗时，区分 Pi 句柄复用/创建/恢复、prompt、首个 assistant 流事件、首段可见文本、首个工具活动和完成或失败；另以流 turnId 关联服务端首段文字入队及完成事件、浏览器收到对应事件的时间，区分传输与生成延迟。各端耗时各自基于单调时钟，跨端时钟可能不同；不记录消息、思考、工具参数/结果、文件路径或密钥，不影响流和执行结果。 |
| PSES-002 | 项目会话代码已接入；完整边界待验收 | Pi Session Tree 完整投影 | 项目会话的 messages API 恢复所属 Pi 的全部分支及节点，保留节点身份、父子关系、原生追加顺序和活动叶子；内部节点、thinking、原始工具参数和敏感结果不因类型或内容过滤。活动指针、异常节点、空树、读取错误和重启恢复按 `03` 如实返回；按部署边界校验读取许可和归属、禁止缓存及日志泄露，覆盖事件订阅竞态、临时关联、只读页面快照和重连，运行事件按原生树核对，不伪装为空历史或持久节点；不复制持久对话、不改历史。 |
| PSES-004 | 代码已实现；压缩/取消API定向通过，真实模型待验 | 用户手动原生上下文压缩 | 按PSES-021开启Pi默认自动压缩并保留手动入口；压缩只改变Pi有效窗口，完整历史继续可恢复 |

PSES-002 / PSES-007 项目范围定向验证：`tests/project-session-tree.test.cjs` 覆盖多分支、敏感内容、只读历史及损坏版本；`tests/project-session-lifecycle.test.cjs` 覆盖并发打开、租约、发送复用与逐轮写入许可；`tests/project-session-optional-role.test.cjs` 覆盖独立项目工具的逐轮写入门禁；`tests/project-session-stream.test.cjs` 覆盖原始流、禁缓存、租约传递、UTF-8 解码及断线后继续消费。类型检查通过。未验收真实模型、浏览器、五分钟中止、崩溃恢复及全部竞态；不能标记整体现场验收完成。

PSES-006 历史位置验证（已被 PSES-010 内联块替代，不作为当前布局验收）：`tests/message-references-composer.test.cjs` 覆盖两个入口下方的已选列表、选择与移除，7 项通过；未进行真实浏览器验收。

PSES-006 历史手动路径验证（独立项目参考选择已不提供路径输入，不作为当前交互验收）：`tests/message-references-composer.test.cjs` 覆盖弹窗、默认目录、手动跳转及越界拒绝；`tests/message-references.test.cjs` 覆盖服务端目录边界和文件范围，12 项通过；类型检查通过。未进行真实浏览器验收。

UI-040 统一等待验收：`tests/project-session-waiting.test.cjs` 验证空响应、thinking、文本、工具执行/更新/返回、实时节点被历史接替时始终只在末尾显示一处带转圈的“正在等待”，running=false 时隐藏；`tests/session-event-state.test.cjs` 验证消息/工具/turn_end/agent_end 不提前结束等待，complete/error/agent_settled 终结、中止保持等待及旧会话事件隔离；结合 `tests/session-tree-presentation.test.cjs` 共3文件5项通过，git diff --check通过。只使用受控事件和最小DOM，不启动服务、不调用模型、不操作数据库；无类型边界变化，未运行类型检查或生产构建，真实浏览器视觉待验。原“正在思考”首段后隐藏规则由本条取代。

UI-040 旧规则验证（被本次整轮等待替代，不作为当前验收）：`tests/project-session-waiting.test.cjs` 覆盖等待时的状态文字和转圈，以及首段文字、工具活动或结束后隐藏；2 项测试和类型检查通过，真实浏览器待验证。

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
| UI-019 | 代码已实现；上下文API定向通过，真实浏览器待验 | 原生上下文检查与压缩入口 | 会话检查的设置页显示已用/容量/剩余 Token、占比、测量口径与时间、Pi默认自动压缩开启状态、最近压缩时间和手动按钮；未知指标不伪造，繁忙禁用，完成刷新，失败可手动重试 |
| UI-039 | 代码已接入；针对性测试及类型检查通过，真实浏览器待验证 | 提交后的输入框 | 项目会话提交时立即清空输入框并在对话中回显，不等待长流结束；发送失败仅在原会话草稿未修改时恢复，不能覆盖其他会话或新输入，也不自动重发。 |
| DEL-001 | 已实现；删除接口12项通过，真实浏览器待验 | 删除最高优先级与同步屏障 | 两类会话在打开、运行、压缩、模型不可用及unknown时均可删除；先阻止新操作、取消并等待旧操作终结，再释放句柄和删除目标行。并发删除复用结果，完成后重复404；DELETE成功前不提前返回，页面全局屏障直到结束。停止/SQL失败保留记录并明确报错；原生历史及项目文件不删除。API验收覆盖抢占、并发、新操作阻断、失败释放和数据保留。 |
| UI-047 | 修复已接入；真实浏览器待验 | thinking空正文投影 | 有思考正文时完整显示；无可读正文时明确提示，支持展开完整原始thinking块，不丢签名及未知字段，不伪造或解密正文。历史/实时与两类会话共用，API及原生历史不变。 |
| UI-046 | 已接入共享输入框；类型检查通过，真实浏览器待验 | 方向键切换用户输入 | 复用当前会话messages全树快照，仅按追加顺序回填用户文本；↑向前、↓向后并恢复原草稿及附件，保留重复输入，不重发历史附件。首次仅第一逻辑行的折叠光标↑进入；浏览期间连续切换，边界不循环。输入法、修饰键、选区及忙碌/阻塞时不拦截；编辑、提交和切换会话退出浏览。两类会话同步，不新增API或持久历史。 |
| UI-038 | 代码已接入；键盘回归与 TypeScript 检查通过，真实浏览器输入法验收待做 | 输入法安全的对话发送快捷键 | 项目 Composer；Enter 发送、Shift+Enter 换行，点击发送按钮行为不变。IME 候选组合期间 Enter 只确认候选且不调用发送，需兼容 composition 状态、`isComposing` 和旧浏览器 `keyCode=229`。 |
| UI-026 | 修订中 | 对话无额外读写勾选 | 项目会话 Composer 不显示读写模式。独立项目工具权限由项目执行策略确定而非角色，实际操作遵循用户请求。 |

DEL-001 验证：`tests/session-deletion.test.cjs` 12项通过，使用临时SQLite与受控Runtime验证两类DELETE的归属及DTO、运行中止、压缩与初始化等待、损坏journal及unavailable删除、并发删除复用、新操作阻断、等待期间句柄替换、停止/释放失败后的记录及重试、外键回滚和原生/项目文件保留。`npm run typecheck`、`git diff --check`通过。未启动或停止用户服务，未改用户数据库/历史，未执行生产构建；页面inert及进度屏障待真实浏览器验收。

UI-047 核查：只读检查本地项目/Workspace Pi历史，发现10个thinking空正文块，均保留含encrypted_content的签名且无summary条目；仅统计结构与数量，不改历史或输出原文。修复共享渲染空面板与完整原始块查看入口，`git diff --check`通过。无API或类型边界变化，未新增/运行非API测试、生产构建或浏览器验收。

UI-046 验证：`npm run typecheck` 和 `git diff --check` 通过。复用已有全树快照及共享输入框，没有API契约变化；按项目规则未新增或运行组件、函数及其他非API测试，未启动服务或执行浏览器验收。真实键盘、输入法、附件恢复与多行光标行为待现场验证。

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

验收包括：读取/刷新不触发模型或压缩；未启动/不可恢复/只读正确限制；取消压缩不会中止主回答、提前释放锁或自动恢复对话；取消与成功竞态按 Pi 实际结果展示；设置用量 DTO 不另行返回原生正文，完整树与导出仍保留全部原文；原生操作不改变业务会话归属；保留手动压缩入口，自动压缩按PSES-021采用Pi默认策略。本次不新增应用级自动压缩算法、分支编辑或原生消息编辑功能。

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

目标：独立项目每个可见会话都有删除按钮，确认后调用 03 的 DELETE；成功移除条目，删除当前会话时回到所属项目；失败保留条目并显示 API 错误。按DEL-001，空会话、空闲、ended、运行、压缩及unknown均可删除；实际外键引用导致的SQL失败仍回滚并报错。事务只删除会话，Pi 文件及项目文件保留。工作区对应要求由 06 WSP-015 定义。状态：既有删除能力由 tests/session-deletion.test.cjs 等临时库定向测试验证；本轮解除绑定、单行删除与旧库门禁已重新定向验证，证据见 §16，不沿用历史结果宣称当前通过。

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
| PCFG-003 | 代码已实现；受控Pi定向通过 | 默认设置与精确恢复 | 采用选中settings文件的defaultProvider/defaultModel/enabledModels，不读另一文件补值；新会话首次初始化按MCFG-003使用默认；已有会话及派生沿用原生模型／思考等级；空闲操作按MCFG-002校验当前型号，失效返回unavailable，不自动回退默认；默认设置与会话 cwd、工具边界、自动压缩互不混淆 |
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
| tests/session-memory-retirement.test.cjs | 退役HTTP路由不再注册、旧结构和缺少约束门禁、UTF-8/空请求；旧轮询实现及其测试由ROUTE-CLEAN-001删除 |
| tests/project-session-lifecycle.test.cjs；tests/session-execution-optional-role.test.cjs；tests/project-session-tree.test.cjs；tests/session-deletion.test.cjs；tests/pi-context.test.cjs | 并发打开与租约/句柄复用、历史角色不阻塞独立发送、全分支与敏感原文只读读取、单行删除/引用回滚、压缩取消与成功竞态 |
| tests/session-auxiliary-dialog.test.cjs；tests/agent-ui-flow.test.cjs | 实际Workspace/辅助弹窗最小DOM、互斥入口、Esc取消/焦点返回、丢弃未提交选择、树定位/展开/高亮、左侧动作/会话变化关闭、源码预览同窗及晚响应不能重开；Agent/导航静态投影 |
| 旧离线迁移验收（已退役） | 当时目标的临时库验证及历史保留记录以git历史为准；相关Bot依赖、旧脚本、冻结Schema和测试已由BOT-REMOVE-001移除，旧授权不适用于当前7表目标 |

验证限制：配置和消息使用受控SDK/Runtime，不调用真实模型或真实认证；jsdom替代原生dialog方法，只验证调用、状态和定位，真实浏览器Tab焦点约束、窄屏视觉与浏览器下载仍待现场验收。未注入每一种文件系统故障、硬断电或多进程崩溃；已列的定向结果不替代这些边界。

用户数据库、配置与原生历史未改写，没有启动/停止用户服务。现有历史库仍只读，写入返回SCHEMA_INCOMPATIBLE，须独立授权并审核本轮目标的迁移方案；本轮没有提供或执行该升级脚本。GAP-006与06内容维持代码修改开始时的版本，Workspace专属完整契约仍未纳入本轮验收。

## 17. 数据库显式升级（DBUP-001）

历史记录：用户当时明确要求“直接迁移数据库”后，旧目标迁移及只读核验已完成。以下不代表当前7表目标已迁移；本节旧脚本、指南及测试已由BOT-REMOVE-001退役，追溯以git历史为准。范围为 02 §11.1；不扩展 GAP-006。脚本 scripts/upgrade-session-schema.cjs 与执行指南 scripts/session-schema-upgrade-guide.md 已提供。tests/session-schema-upgrade.test.cjs 的7项验证只读预检、归档摘要和只读权限、全部同名列保留、原库内事务重建、目标兼容、历史创建键NULL、外键/完整性、冲突/未知结构/活连接拒绝、失败回滚、锁不自动破除、过期摘要/符号链接拒绝及重复执行只读。结合 tests/session-memory-retirement.test.cjs 与 tests/project-session-model-contract.test.cjs，共14项通过，git diff --check通过。仅Schema比较的表名等价规范化发生TS内部调整，类型边界未变，本轮未额外运行类型检查或全量测试。

正式执行前重新预检为 ready、冲突零项并确认无其他打开连接；来源摘要 15f005c7e038263a22e942d0796e552d90b2947a38387aba653b6d10d9e3c5b0，目标摘要 e7bee0c5415d7bd99a769b993b855b2eaa20153b021d2be53c25126c59759889。脚本返回 migrated，后续预检返回 current，实际运行时 matchesTargetSchema=true、integrity_check=ok、foreign_key_check=0。事务中已逐表验证所有保留列值一致；6个项目、5个Agent、8个独立项目会话和1个工作区会话保留，9条记忆记录在只读备份中核验存在。

完整归档位于 .data/ai-workspace-v5.sqlite.session-upgrade-34c046da-4f87-427d-8554-cfcee4766fdc/，包含 before.sqlite 和 manifest.json，备份SHA-256为 25d446b60a71a5616834a4a6ec24e3a5e398987f609f071249a70c7a8e3c4d8e。此次授权仅覆盖本次目标，后续迁移仍须独立确认。未调用Pi或模型，未改写原生历史、Agent Markdown、配置或journal，未操作服务启停；§16中“历史库未迁移”描述为本次执行前的记录。GAP-006与06保持原范围。

## 本批提交文档核对与最终验证

本批未提交改动均有对应记录：SEARCH-001内置搜索、SEARCH-002本机Bing/网页工具和紧凑单选及焦点恢复、SEARCH-003单一input参数、PSES-020原生快照409修复、PSES-021默认自动压缩及UI-045滚动。架构、模型、API、页面分别更新01～04；工作区及历史Bot Runtime适用范围见06。README补齐联网/代理、input示例、会话滚动和自动压缩及重新发布说明。新增运行依赖为Undici、linkedom、Mozilla Readability；随package/lock发布，不要求搜索Key或服务，不迁移数据库。

提交前最终验证：15个定向文件共59项通过，npm run typecheck及git diff --check通过。实际文件：tests/inline-composer-editor.test.cjs、tests/project-operation-recovery.test.cjs、tests/prompt-input-submit.test.cjs、tests/workspace-runtime.test.cjs、tests/pi-auto-compaction.test.cjs、tests/pi-native-snapshot.test.cjs、tests/server-web-search.test.cjs、tests/session-conversation-scroll.test.cjs、tests/tool-search.test.cjs、tests/workspace-web-search.test.cjs、tests/workspace-context.test.cjs、tests/pi-session-fork-export.test.cjs、tests/message-references-composer.test.cjs、tests/session-auxiliary-dialog.test.cjs、tests/pi-context.test.cjs。覆盖本批模型/API/工具循环/幂等/压缩/快照/输入与滚动及关联边界；全部用临时库/目录、受控网络/模型流或模拟DOM。未做真实Bing/模型/代理/Ubuntu出网或浏览器视觉验收、生产构建、用户服务启停或历史迁移。以下各需求中的测试计数为对应阶段记录，以本段作为本批最终验证依据。

## PSES-021 / UI-045｜Pi默认自动压缩与会话滚动

状态：已实现，定向验证通过；真实模型与浏览器视觉待验。PSES-021：所有业务Session开启Pi原生自动压缩，无关闭入口，压缩参数使用Pi默认值；创建/恢复/发送/手动压缩/句柄复用不得关闭。验收实际Pi默认配置、热/冷恢复、受控自动压缩及事件/记录、手动入口后仍开启。UI-045：单击会话（含当前会话）在所属历史载入后滚至底部；提交提示词立即滚至底部，底部跟随实时内容，上翻阅读或树定位时不抢滚动，重新发送/点击恢复跟随。两类会话共享实现，无新持久模型或API。实际验证：tests/pi-auto-compaction.test.cjs（项目与Workspace真实SDK默认参数、阈值压缩/事件/原生记录、settled顺序、手动调用后保持开启及冷恢复）、tests/pi-context.test.cjs（只读/取消互斥/成功竞态）、tests/session-conversation-scroll.test.cjs（共享视图选择/迟到快照/发送/增高跟随/上翻暂停）、tests/session-auxiliary-dialog.test.cjs（实际Workspace导航/树定位/非模态浮窗），共7项通过；npm run typecheck、git diff --check通过。全部使用临时会话/受控流和模拟DOM，不调用真实模型、不启停服务、不改用户数据库或历史，不执行生产构建。

## PSES-020｜原生快照JSON语义一致性

状态：已修复，定向验证通过；用户报告会话的线上原生文件未读取，不能确认其具体差异。活动Pi manager与原生文件按JSON持久化语义比较，避免工具参数/结果的undefined可选字段引发虚假409；实际内容、节点数量/顺序/关系或身份变化仍拒绝快照。无SQL/历史迁移或Pi身份改变；只读校验不得重写历史、重载句柄或重发请求。验收：真实Pi SessionManager临时会话复现旧错误、修复后热/冷树一致且字节不变，内存内容修改及外部追加继续REQUEST_UNKNOWN并保留文件。实际验证：tests/pi-native-snapshot.test.cjs、tests/pi-session-fork-export.test.cjs、tests/tool-search.test.cjs共12项通过，git diff --check通过；使用临时目录及受控依赖，无真实模型/Bing/用户服务操作或历史迁移。

## SEARCH-003｜网页工具调用参数修复

状态：已实现，定向验证通过。web_fetch改为单一必填input，HTTP(S)地址直接读取，文本查询Bing；旧url/query在prepareArguments归一化，旧两字段并存时URL优先。空参数不得联网，参数说明和schema保持一致，避免可选互斥参数导致模型反复重试。验收包括schema必填、网址/查询路由、旧格式和空白归一化、实际Pi工具循环与工具参数持久记录，不修改用户历史。实际验证：tests/tool-search.test.cjs共6项通过（受控fetch/模型流、临时目录）；npm run typecheck、git diff --check通过。未调用真实模型或Bing，用户报告的四次调用缺少原始toolCall.arguments，不能确认每次的具体参数。

## SEARCH-002｜内置搜索与工具搜索

状态：已整改，定向验证通过；真实Bing/Ubuntu出网与浏览器待验。输入框使用一个select选择内置搜索/工具搜索/无搜索，默认内置搜索，选项标注执行方；单一web_fetch直接访问Bing搜索或目标网页，适用于支持Pi工具调用的模型。选择固定本轮、工具结果原生持久化；API严格布尔校验、配置预检、摘要包含开启意图，未开启不能调用，不自动降级。验收包含Bing结果解析与直接网页读取、正文提取、代理/取消/限额/失败，实际Pi工具装配/循环/清理，两范围API和输入选择器。真实供应商验证须另行记录，不改写用户配置或历史。

SEARCH-002本轮验收：tests/tool-search.test.cjs（5项）、tests/server-web-search.test.cjs（2项）、tests/project-operation-recovery.test.cjs（7项）、tests/workspace-web-search.test.cjs（3项）、tests/prompt-input-submit.test.cjs（7项）、tests/inline-composer-editor.test.cjs（10项），合计34项通过；npm run typecheck、git diff --check通过。覆盖单一web_fetch无Key/服务依赖、无URL请求Bing与编码查询/来源跳转解析、已知URL直接正文提取/不执行脚本、错误/响应上限/取消/公开地址及重定向/DNS校验、代理配置及dispatcher、每轮限额/隔离/工具恢复、实际Pi项目与工作区调用结果落盘；保留内置搜索、API幂等、三种选择与光标恢复。使用临时目录/内存库及受控fetch/模型流；未访问真实Bing/网页、未验证Ubuntu出网/真实代理或浏览器、不启停服务/迁移用户库/生产构建。Bing验证码、限流和格式变化明确失败，无自动服务降级。

## SEARCH-001｜输入框服务端联网搜索

状态：OpenAI原适配定向验证通过；本次Google GenerateContent/Vertex协议适配已接入；tests/google-web-search-api.test.cjs共3项通过，使用临时内存数据库和受控Runtime，经Workspace消息/中止API验证OpenAI与两类Google的请求分派、SDK参数保留、不重复注入、grounding原始证据、幂等、成功/上游失败/停止后清理，以及不支持协议在journal前拒绝。该测试不调用真实Google SDK网络或模型，不证明网关支持、来源质量或Search Suggestions展示合规。类型及差异检查通过；真实供应商与浏览器待验。项目/工作区输入框增加默认开启且标明服务端搜索的按钮，按当前Pi model.api透传OpenAI Responses web_search或Google GenerateContent/Vertex googleSearch；Google SDK config及原编程工具不变，携带groundingMetadata的原始流证据完整保存，其他协议明确拒绝，不按模型名改协议；保留编程工具、仅本轮生效，非法参数和不支持协议拒绝，幂等区分搜索意图，失败无静默降级。搜索调用和来源原文保留所属Pi树，未执行不得声称已搜索。验收覆盖请求payload/隔离/清理、两类消息API、按钮及参数传递；不调用真实模型或迁移用户库。

SEARCH-001验证：tests/server-web-search.test.cjs、tests/prompt-input-submit.test.cjs共9项；tests/project-operation-recovery.test.cjs、tests/workspace-web-search.test.cjs、tests/message-references-composer.test.cjs共15项，合计24项通过。覆盖按钮默认/关闭/切换重置、HTTP透传、项目/工作区参数和幂等/预检拒绝、实际Pi Runtime扩展装配、工具循环、原生搜索证据落盘与成功/失败清理；npm run typecheck及git diff --check通过。使用临时目录/内存库/受控Pi流，无真实模型、服务启停、用户库改写、迁移或生产构建。仅协议预检，不保证所有Responses型号或中转支持搜索；上游失败按现有错误返回。

## UI-048｜工具结果展示稳定

工具结果的实时事件、实时消息与持久节点统一使用04定义的折叠投影；默认不闪现正文，用户展开/收起跨结果更新及历史同步保持，同名不同调用独立，切换会话重置。复用已有API及原生toolCallId，不改变模型或调用能力。状态：代码已接入，npm run typecheck及git diff --check通过；本次为页面投影修复，不新增或运行非API测试，浏览器视觉待验收。

## PSES-029｜接入Pi steer

目标：独立项目运行中使用同一Composer向原Pi Session发送文字纠正，Workspace同步见06 WSP-020。验收：有效lease与归属、空内容/容量/未知字段校验、空闲/停止/删除/压缩拒绝、同键并发复用及异载荷冲突、原请求保持运行且调用steer而非prompt、停止/终态清空队列、错误不自动重放、正文及Pi树归属不变。模型02、API03、装配01、投影04。状态：代码已接入，API定向验证通过；浏览器与真实Pi运行时队列消费/清除仍待验证，不标记整体验收完成。tests/session-steer-api.test.cjs共8项通过，覆盖两类HTTP校验、并发幂等、未知结果不重放、删除等待与SSE重连队列；联合tests/session-deletion.test.cjs、tests/project-operation-recovery.test.cjs、tests/workspace-session-api.test.cjs共33项通过。npm run typecheck与git diff --check通过，仅使用临时数据库/目录及受控Runtime，未启动服务或改写用户数据。

## CTX-001｜Session持续参考文件

状态：代码已接入；tests/session-context-files-api.test.cjs的5项API测试通过，类型检查与git diff --check通过，浏览器/真实模型待验。仅参考项目文件：两类Session添加/读取/显式删除、归属/lease/ETag/忙碌门禁、快照重读；列表在按钮下方，不进正文；发送及历史输入不清除；每轮Pi完整正文；隔离会话；不删原件/历史；拒绝不可读/超限/上传输入。实际API验证含连续Pi请求、冷恢复、移除后不再注入及原生图片上传通道，使用临时库/目录与受控模型，无网络调用。上传和粘贴保持原内联、随消息发送及发送成功后清空；UI行为未做浏览器验收。不迁移旧历史，不启动用户服务。

## AGENT-002｜助手完整规则落地

状态：模型/API及页面已接入，定向API验证通过；浏览器操作和真实模型生成质量待验收，不标记整体验收完成。替代AGFILE旧frontmatter/能力、强制Markdown转换及仅项目可用条目。验收：两个创建入口、三种明确分析范围；项目为基本单元、固定XML复用；从项目生成保留Pi默认且规则仅注入固定XML、自定义系统提示词完整替换；未显式修订的原文和空白完全保留，无额外标题/frontmatter/空占位；生成可对话修订，保存不可变AGENTS.md；整页目录和编辑；Session精确选择/切换/移除；workspace级拒绝项目使用、项目级可被workspace使用；作用范围服务端校验、旧版本兼容、并发与失败保留。用临时库/文件和受控LLM/Pi验证API；不运行真实模型、浏览器或构建，未验证项明确记录。

AGENT-002验证记录：tests/assistant-api.test.cjs与tests/catalog-contract.test.cjs共9项API测试通过，覆盖原文空白保存、无应用包装、不可变版本与旧格式读取、严格输入、来源子集、指定正文修订、两类Session的范围/lease/ETag/运行门禁、精确版本与移除、真实Pi适配器的受控主提示词替换/默认恢复/禁用隐式SYSTEM.md，以及工作区XML单份和项目规则注入。tests/session-context-files-api.test.cjs、tests/session-steer-api.test.cjs、tests/session-deletion.test.cjs、tests/workspace-session-api.test.cjs共29项共享API回归通过。类型检查与git diff --check通过。全部仅使用临时库/目录和受控生成/模型流，无网络模型调用、不执行生产构建、不启停用户服务、不迁移历史库。项目材料采集为有界范围，返回来源及未覆盖项；不是自主全仓代码探索。


## ASSIST-013｜直接粘贴润色与原始生成错误

状态：代码已接入，定向API验证通过；真实模型与浏览器待验。统一助手无需上传文件，直接输入/粘贴完整材料并点击润色即可生成；沿用prepare generate的inputText和revise的feedback、原有额度，成功才替换草稿与提示词模式。提交即清空输入框，该内容进入对话并滚到最底部；失败/取消不把输入填回输入框，保留消息列表中的该条内容、旧草稿与作用范围。模型在JSON前后附加说明、使用代码块，或在提示词正文中包含示例花括号时，服务端选择唯一合格JSON对象；没有合格对象、多个合格对象或字段非法仍返回ROLE_GENERATION_INVALID且不改变草稿；message逐字符返回模型原始回复，不改写为“未找到JSON对象”“模型未返回有效草稿”或其他说明。Pi提供的assistant.errorMessage或SDK抛出的Error.message逐字符作为生成错误原因返回，保留换行/JSON，不改写为“模型未生成有效助手内容”、不截断或添加请求地址；无原始原因才使用兜底文案。成功但文字为空或仅含空白时返回该助手消息的原始text，完全没有text才使用“模型返回空内容”。错误显示为纯文本且可滚动，不执行HTML；仍不返回模型配置、请求头、句柄或新增日志。验收：prepare HTTP/NDJSON接口验证无上传材料传递、无工具、范围及失败草稿不变，原始模型/SDK错误完整返回，取消及缺失原因兜底。无模型或SQL变更，不自动重试或更换默认模型。实际验证：tests/assistant-polish-api.test.cjs共3项通过，覆盖直接粘贴大于4000字符的初次材料、三类范围/继承转replace、HTTP/NDJSON与客户端原始错误完整传递、SDK/模型失败草稿保持、取消/缺失原因/空文字兜底；tests/agent-preparation-api.test.cjs仅定向运行prepare API uses real Pi一项，验证共享生成器项目读取流程未回归。类型、两份改动TS/TSX语法及差异检查通过。使用临时内存库和受控Pi流，未调用真实模型、未启停服务、未生产构建或修改用户数据。

## AGENT-009｜自定义输入统一润色

状态：代码与定向API验证完成，浏览器和真实模型润色质量待验收。首次对话输入及文件上传均经prepare调用LLM润色，成功才替换草稿；原文只作为材料，失败/取消保留输入及旧草稿，系统提示词仍完整替换，作用范围不变，无补充指令。tests/assistant-api.test.cjs与tests/catalog-contract.test.cjs共16项通过，验证完整材料传递、范围保持、失败与取消不产生正式结果；类型检查及差异检查通过。

## AGENT-008｜自定义助手作用范围

状态：代码及定向API验证完成，浏览器未验收。自定义保留项目/工作区范围选择与工作区项目子集，系统提示词仍只有上传/对话原文；不恢复补充指令，不读取范围项目材料用于修订。保存和选择核验范围，工作区范围限制到来源工作区，项目移出后拒绝采用。tests/assistant-api.test.cjs与tests/catalog-contract.test.cjs共15项通过，使用临时库及受控生成器验证范围持久化、修订原文、资料零采集、作用域拒绝。类型检查及差异检查通过；无历史数据迁移。

## AGENT-007｜两种互斥助手正文

状态：实现与定向API验证完成，浏览器与真实模型效果待验收；替代此前补充指令及主提示词称谓。自定义助手只保存完整系统提示词，通过Pi systemPrompt替换；从项目生成只保存所选项目规则，运行时只能填入固定XML，保留Pi默认。没有补充指令字段、按钮、生成目标或新存储位置。新definition.format=3/存储format=4，旧版本只读兼容；编辑旧版本时有附加正文的内容合并为完整自定义系统提示词，需显式保存新版本，不迁移数据库或旧文件。tests/assistant-api.test.cjs与tests/catalog-contract.test.cjs共14项通过，覆盖字段/目标拒绝、两种正文互斥、空正文拒绝、原文保存、自动修订以及受控Pi请求的替换/XML装配，旧两种布局和原始版本读取/更新不改原件。npm run typecheck及git diff --check通过；无数据库或旧文件迁移。

## AGENT-006｜技能独立行与自动修订

状态：代码接入及定向API验证完成；浏览器和真实模型效果待验收。生成技能在来源表单内独占一整行，编辑页保持两列，移除修改内容选择；对话省略target时依据实际草稿和意见自动调整一段或多段，未涉及内容原样保留。类型化changes经过服务端字段、项目ID、范围及generated主提示词约束校验，不修改持久模型及权限。tests/assistant-api.test.cjs与tests/catalog-contract.test.cjs共14项通过，受控生成API覆盖多段修订、局部保留、自定义无项目正文及非法结果拒绝；npm run typecheck、git diff --check通过。

## AGENT-005｜Markdown正文与运行时组织分离

状态：实现及定向API验证完成。生成返回、保存文件及预览不添加XML组织标签、不转义正文字符；项目身份及正文范围记录于definition.json，运行时按项目关系装配固定XML。领域format不变，新文件元信息存储format=3，旧XML布局format=2只读兼容且保留原文件/摘要。tests/assistant-api.test.cjs共9项通过，使用临时目录和受控生成/Pi流验证项目、工作区原文及分段往返、旧文件兼容和运行时XML。npm run typecheck及git diff --check通过；未运行浏览器、真实模型或历史迁移。

## AGENT-004｜统一助手目录

状态：实现及定向API验证完成。新助手版本默认写入agents/<id>/<revision>/AGENTS.md及definition.json，默认读取逐版本兼容.data/agents，损坏不得被旧版本覆盖；显式AI_WORKSPACE_AGENT_DIR继续生效。同一历史版本不得在新目录重写。旧版本、数据库、Session引用及开发契约AGENTS.md保持原位。tests/assistant-api.test.cjs共7项通过，使用临时库和临时目录验证默认保存、旧两种格式读取、跨目录更新、摘要及损坏拒绝，不迁移用户历史文件。发布目录/构建目录清理遇到agents时拒绝删除；脚本语法检查与git diff --check通过。

## AGENT-003｜项目生成默认技能

状态：代码接入与定向API验证完成，浏览器操作和真实模型生成质量待验收。验收：项目内skills目录保留上游create-agentsmd/SKILL.md原文与来源；后续相同结构技能可被发现；编辑页默认选中create-agentsmd；服务端省略参数同样默认加载全文并返回摘要；显式null不加载；无效/丢失/损坏技能在模型调用前报错；技能不增加工具、不执行命令、不将模板占位或无依据内容写入助手；独立项目与工作区共用流程，不迁移历史数据。使用受控生成器和临时目录验证技能列表及prepare API。

验证记录：tests/assistant-api.test.cjs、tests/catalog-contract.test.cjs共10项通过，覆盖技能列表不泄露正文/路径、后续技能发现、默认技能全文和摘要、工作区生成、显式切换/停用、自定义主提示词修订不加载技能，以及非法路径、缺失、格式损坏、符号链接、超限均不调用模型。npm run typecheck、git diff --check通过。上游文件按b13e55f85ffdf451d40d09839cb1e337bf3eda98固定版本下载并逐字节核对；未运行浏览器或真实模型。


工作区助手的项目独立文件、工作区自身AGENTS.md、自定义单选及存储format=5由06 WAGENT-010统一定义，取代本文先前的工作区合并正文与自定义多选描述；通用独立项目行为不变。

修复要求 WAGENT-010：项目生成在目标cwd使用完整读取工具执行技能，按项目串行并反馈进度；generated不含工作区自身规则，custom工作区仅自身一份文件。最新模型/API/验收统一见06 WAGENT-010，替代此前工作区生成入口及预采集规则。


## REF-ASSIST-001｜消息引用助手与Skill

会话输入工具栏按“引用助手 → 引用 Skill → 上传文件”排列，独立项目与工作区复用。助手从候选API及GET /api/agents/:id读取正式精确版本，选择后通过既有GET/PUT S/assistant写入会话助手选择（精确agentId/revision/contentSha256、If-Match和当前lease），下一轮按ASSIST-011装配系统提示词。只允许active正式版本；继承默认提示词的助手同样可选。助手不转换为附件、不写messages.references、不占附件额度、不在输入框或对话中显示合成文件。选择持续生效至显式更换或移除，在Composer引用入口查看名称与更换；会话检查不再展示助手分区，既有移除API保留但不新增移除入口；不隐藏既有Pi历史或用户上传文件。Skill列表复用GET /api/agents/skills，新增GET /api/agents/skills/:skillId返回{id,name,description,sha256,content}完整技能文本，受控技能目录读取与错误沿用AGENT-003，无Pi调用、数据库写入或新增持久模型。技能只作为本次消息材料，不自动安装或授予能力。客户端不提供路径，响应不含绝对路径。

选择器复用现有弹窗；助手使用既有会话选择模型，失败保留旧选择，运行/压缩/停止/提交或无有效lease时禁用选择；读取失败可重试，切换会话取消本地请求，不自动重放PUT。Skill继续使用上传附件模型，原子加入，遵循总计10项及附件字节限制，重复选择按所引用文件处理；可在输入内删除，发送成功清空，失败保留。加载/读取失败可重试，关闭或切换会话取消未完成选择；运行/停止/阻塞及提交中禁用，避免转成steer附件。API验收完整Skill正文/摘要及不存在与非法ID错误，页面检查按钮顺序和共用附件发送逻辑。

REF-ASSIST-001验证：此前tests/agent-preparation-api.test.cjs四项通过，含Skill正文/摘要、无绝对路径、404及非法ID。助手入口现已改为GET/PUT会话助手配置，不生成File或调用附件加入；应用期间阻止发送，支持继承默认提示词的助手。此次定向运行tests/unified-assistant-api.test.cjs中的“session APIs use scoped project rules only with assistants and reuse prompt configuration across turns”1项通过，验证两类会话精确助手选择与系统提示词装配、跨轮复用；使用临时数据及受控Pi。类型、4个变更TS/TSX语法及差异检查通过。未执行浏览器交互或真实模型验收。


## ASSIST-011｜统一助手和项目AGENTS.md
状态：代码及定向API验证完成，浏览器与真实模型未验收。验收：唯一助手模式，继承默认或替换提示词；四种范围；新增助手不生成AGENTS.md；独立及工作区成员项目设置生成/开关；agents内按项目存放；仅明确选助手装配范围和启用规则；无助手逻辑不变；同配置跨轮次不重复填充；切换/移除/规则版本变化后更新；历史兼容不迁移；API测试临时目录与受控Pi验证，真实模型与浏览器未验收。

ASSIST-011验证记录见06末尾；实际运行tests/unified-assistant-api.test.cjs和tests/agent-preparation-api.test.cjs，共9项通过。


ASSIST-012｜通用型助手与引用优先级。状态：代码及定向API验证完成，浏览器未验收。验收：Tailwind重构新增页；没有项目/工作区也能创建、润色、保存通用型助手；两类会话均可采用，无额外项目规则；引用API验证当前范围并按项目适用→通用型返回，不混入其他项目；无query目录兼容；旧版本不改写；定向API验证创建/更新/生成/选择/候选排序及错误边界。


RULEGEN-001｜项目规则异步生成与预览。状态：代码及定向API验证完成，浏览器与真实模型未验收。本次润色与按钮布局调整验证：tests/project-rule-generations-api.test.cjs共10项通过，新增3项API用例覆盖无正文/空意见/非法mode拒绝、两类项目服务端完整旧正文修订与不可变发布、mode幂等冲突、取消/失败/并发修改保留旧版；并验证历史无mode任务按generate读取与幂等返回、不改写旧文件。使用临时目录及受控模型；类型、设置组件JSX和差异检查通过，未运行浏览器、真实模型或生产构建。验收：项目设置右侧常驻正文；支持选技能及不选技能生成，生成按钮与技能同行；补充要求通过“润色”修改服务端已有完整AGENTS.md，缺正文/空意见拒绝，mode参与幂等，原版本与开关在失败/取消时保留；POST立即返回202，断开请求/切换页面不取消；状态查询和重新进入可恢复；同项目并发拒绝、同键幂等；成功才发布，失败/取消/并发修改保留旧版；服务重启未完成任务明确中断不自动重放；两类项目归属隔离，API验证使用临时文件和受控Runtime。


BUTTON-001｜全应用按钮统一。状态：实现完成，浏览器视觉待验收。验收：所有React按钮迁入共享入口，contentEditable内原生附件删除按钮复用buttonStyles，上传入口使用共享Button；12px字体、32px标准高度、统一普通/主操作/危险/透明及选中/禁用/焦点状态；导航与文件行保留布局和可访问名称；移除局部按钮外观定义和旧覆盖，表单type、事件、许可与模型/API保持原契约。验证：97处React Button及1处原生DOM按钮接入，清理186组旧按钮选择器的外观声明；JSX解析与71项共享Tailwind工具类、应用CSS编译通过，类型检查与git diff --check通过。未新增或运行API/非API测试，未执行浏览器验收或生产构建。


NAV-002｜侧栏会话宽度和底部入口对齐。验收：Project/Workspace会话选择列在固定删除按钮旁正常收缩，长标题不撑宽；双行会话项固定32px高，标题11px、时间10px，移除多余行间距，删除使用灰色ghost图标；助手和MCP图标文字靠左；所有按钮继续复用BUTTON-001。状态：实现完成；类型、变更JSX、布局Tailwind类编译与git diff --check通过。未新增或运行测试；浏览器待验收。
