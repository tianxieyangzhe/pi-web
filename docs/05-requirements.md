# 05｜需求文档

> 状态：**产品实现基线。** 本文只定义需求、优先级和验收条件。当前为完整替换，不做旧数据迁移、兼容 API 或双写。

## 1. 产品定义

产品是本地优先的 Pi Coding Agent 工作环境：

~~~
Workspace
└─ Room
   └─ Session
      ├─ Agent?
      ├─ MCP*
      ├─ working Project?
      └─ reference Projects*
~~~

用户可以在一个 Room 中执行单项目独立工作，也可以并行创建多条 Session 处理多个项目，再在同一 Room 内协作、比较和协调。

没有目标不等于没有结构：空 Room 仍然展示工作线、项目、MCP、Agent 的结构化位置。

## 2. 固定范围

### 2.1 核心实体与内容表

只允许：

~~~
workspace
project
mcp
agent
room
session
room_contents
~~~

前六张是核心资源表，`room_contents` 是 Room 的结构内容子表。不允许新增 Runtime、Adapter、Binding、Asset、Message、Transcript 或资源关系表。

### 2.2 核心关系

- Workspace 只关联 Room。
- Room 只关联 Session。
- Session 记录 workspaceId 供查询与一致性校验。
- Project、MCP、Agent 是独立资源，可被任何 Session 使用。
- Agent 是可选 Pi 扩展；没有 Agent 的 Session 直接使用 Pi 基础能力。
- 主工作线和辅助工作线只是 Session.role 的值。

### 2.3 状态

- 未实现：目标代码尚未完成。
- 实现中：正在修改，尚未满足全部验收。
- 已实现：代码完成，尚未通过完整验收。
- 已验证：验收条件全部通过。
- 阻塞：存在外部条件或产品决策阻塞。
- 不做：明确排除。

只有已验证才算完成。

## 3. 基础需求

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| BASE-001 | P0 | 已实现 | 产品界面统一使用会话表示 Room | 用户界面不将 Session 称为会话 |
| BASE-002 | P0 | 已验证 | 数据表边界固定 | Schema 只有六张核心表和 room_contents；rooms 不包含 content_json |
| BASE-003 | P0 | 已验证 | Runtime 不作为产品资源 | 数据库、API、UI 无 Runtime 选择、Registry 或配置实体 |
| BASE-004 | P0 | 已验证 | Session 是唯一运行实体 | 不存在任何第二运行实体、运行记录包装或 Runtime Session 表 |
| BASE-005 | P0 | 已验证 | Session.role 只是属性 | primary/worker 不形成独立表、API 类型或实现分支 |
| BASE-006 | P0 | 已实现 | 只支持固定 Pi Coding Agent Runtime | Pi runtime 是静态代码实现，不可由用户注册或替换 |
| BASE-007 | P0 | 已实现 | 设计文档是实现事实来源 | 所有实现可映射需求 ID，且不与五份文档冲突 |
| BASE-008 | P0 | 已验证 | 前端组件遵循 AI Elements 治理 | 新增组件先评估 AI Elements；例外写入架构文档 |

## 4. Workspace 与 Room

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| WS-001 | P0 | 已实现 | 用户可创建、查看、编辑 Workspace | Workspace 只保存自身元数据；不预置 Agent、MCP、Project |
| WS-002 | P0 | 已实现 | Workspace 只组织 Room | 删除 Workspace 只删除其 Room/Session，不删除独立资源或 Pi 原生文件 |
| ROOM-001 | P0 | 已实现 | 新会话是零表单操作 | 请求只需 workspaceId；不要求目标、Agent、MCP、Project |
| ROOM-002 | P0 | 已实现 | 空 Room 保持结构化展示 | 没有目标、消息、Session 时仍显示目标、方向、输出、工作线与资源结构 |
| ROOM-003 | P0 | 已验证 | Room 关联 Session 和结构内容 | Room 表/API 无 Agent、MCP、Project、Runtime、默认资源字段；目标、方向、输出、总览逐行保存在 room_contents |
| ROOM-004 | P0 | 已实现 | Room 支持多个并行 Session | Room 中可显示多个独立 Session，互不混合 transcript |
| ROOM-005 | P0 | 已实现 | Room 支持生命周期 | active、paused、closed、archived 非法转换被拒绝 |
| ROOM-006 | P1 | 已实现 | 用户可重命名、归档、恢复和删除 Room | 删除只删除 Room/Session 平台记录，不删除独立资源或 Pi 原生文件 |
| ROOM-007 | P0 | 已验证 | Room 可保存可为空的目标 | 没有 active goal 行表示无目标；同一 Room 最多一个 active goal，不要求创建 Room 时填写 |
| ROOM-008 | P1 | 已实现 | Room 可保存方向 | candidate、adopted、dismissed 方向可创建、编辑和变更状态；保留来源 Session 引用 |
| ROOM-009 | P1 | 已实现 | Room 可保存跨 Session 输出 | note、decision、plan、delivery、summary 可保存和发布；不复制完整 transcript |
| ROOM-010 | P1 | 已实现 | Agent 输出先作为 Room 内容候选 | AgentEvent 只产生候选；用户确认或编辑后才创建 room_contents 记录 |
| ROOM-011 | P1 | 已实现 | RoomContent 保留来源与历史 | sourceSessionId 非空时属于当前 Room；已采用/发布内容通过 superseded 或 retracted 保留历史，不直接物理删除 |

## 5. 独立资源

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| PROJ-001 | P0 | 已实现 | Project 是独立本地资源 | 无 workspaceId；同一规范化目录只建立一个 Project |
| PROJ-002 | P0 | 已实现 | Project 支持 code、knowledge、general 与 read/write | 字段校验完整；Session 每次操作重新检查 accessMode |
| PROJ-003 | P0 | 已实现 | 用户可浏览与安全预览 Project 文件 | 路径、symlink、敏感文件、二进制和大小限制均被校验 |
| PROJ-004 | P1 | 已实现 | Project 可被多 Session 复用 | Room 聚合展示哪些 Session 将其作为工作或参考项目 |
| MCP-001 | P0 | 阻塞 | MCP 是独立能力定义 | 无 workspaceId；支持 built_in、stdio、streamable_http |
| MCP-002 | P0 | 阻塞 | MCP 配置不保存凭据明文 | 只保存 secretRef；错误和日志不回显 |
| MCP-003 | P0 | 阻塞 | MCP 支持 read_only、approval、allow | 每次工具调用均由 Session 权限和 MCP policy 共同校验 |
| MCP-004 | P1 | 已实现 | MCP 可被多 Session 复用 | Inspector 显示当前 Room 哪些 Session 使用它 |
| AGENT-001 | P0 | 已验证 | Agent 是独立 Pi 扩展模板 | 无 workspaceId、roomId、sessionId、Project ID、MCP ID |
| AGENT-002 | P0 | 实现中 | Agent 可定义角色与扩展 | instruction、model、tools、extensions、skills、settings、通用 policy 通过校验 |
| AGENT-003 | P0 | 已实现 | Agent 不是创建 Session 的必要条件 | Session.agentId 可为空；空值使用 Pi 基础能力 |
| AGENT-004 | P1 | 已实现 | Agent 可被多 Session 复用 | 修改 revision 只影响之后附加或重配的 Session |
| AGENT-005 | P1 | 已实现 | Agent 可归档 | 历史 Session 保留快照；新配置不能选择 archived Agent |

## 6. Session 与 Pi Runtime

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| SES-001 | P0 | 已实现 | 第一条普通消息懒创建默认 Session | 创建 role=primary、无 Agent/MCP/Project 的基础 Session |
| SES-002 | P0 | 已验证 | 一个 Room 最多一个默认 Session | 并发首条消息后数据库仍只有一个 role=primary Session |
| SES-003 | P0 | 已实现 | 辅助工作线是 role=worker Session | 用户或委派创建的辅助线都使用同一 Session 表和生命周期 |
| SES-004 | P0 | 已实现 | Session 对应 Pi Runtime | 保存 nativeRef；Pi transcript 不复制到平台消息表 |
| SES-005 | P0 | 已实现 | Session 可中断、恢复、结束 | 状态转换准确；恢复不重放旧消息或草稿 |
| SES-006 | P0 | 已实现 | 同一 Session 禁止并发 turn | 第二次消息返回冲突，不重复发给 Pi |
| SES-007 | P1 | 已实现 | 多个 Session 可并行 | 各自拥有独立执行锁、Pi nativeRef、状态与 transcript |
| SES-008 | P1 | 已实现 | 用户可创建辅助 Session | role=worker，purpose 必填，可预选可选资源 |
| SES-009 | P1 | 已实现 | Agent 可委派辅助 Session | 通用 Agent policy 禁止委派时拒绝；parentSessionId 正确记录 |

## 6.1 模型配置

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| MODEL-001 | P0 | 已验证 | 只兼容 OpenAI Chat Completions 格式 | Pi 只注册固定 `workspace-openai` / `openai-completions` provider，不选择其他 Provider |
| MODEL-002 | P0 | 已验证 | 模型信息只来自 `.env.local` | 只读取项目根目录 `.env.local` 中的 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL_ID`；请求、UI、Agent、数据库和宿主环境不能覆盖 |
| MODEL-003 | P0 | 已验证 | 模型凭据保持服务端私有 | API key 不进入数据库、snapshot、nativeRef、浏览器、日志或错误消息 |
| MODEL-004 | P0 | 已验证 | 模型配置失败可诊断 | 缺失字段或非法 URL 返回 `MODEL_CONFIGURATION_ERROR`，不回退到 Pi 默认模型 |
| MODEL-005 | P1 | 已验证 | Agent 不拥有模型选择 | Agent 只可定义可选 thinkingLevel，不保存 provider/base URL/key/model ID |

## 7. Session 配置

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| CFG-001 | P0 | 已实现 | Session 可在创建时选择 Agent、MCP、Project | 选择最终只写入 Session，不写入 Room |
| CFG-002 | P0 | 已实现 | Session 可后附加、替换或移除 Agent | agentId 可为空；当前 turn 配置不被中途改变 |
| CFG-003 | P0 | 阻塞 | Session 可后附加或移除 MCP | MCP 多选；变更从下一 turn 生效 |
| CFG-004 | P0 | 已实现 | Session 记录 Agent/MCP 快照 | 配置变更后 revision 加一；恢复使用 Session 快照 |
| CFG-005 | P0 | 已实现 | 每个 Session 最多一个工作项目 | workingProjectId 是 Pi cwd 和默认写入目标 |
| CFG-006 | P0 | 已验证 | Session 可绑定多个参考项目 | referenceProjectIds 只用于上下文；不自动允许写入 |
| CFG-007 | P0 | 已实现 | 配置失败保持旧配置 | 资源归档、Project 不可访问或 JSON 无效时不产生半成品更新 |

## 8. 单项目与多项目

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| COL-001 | P0 | 已实现 | 单项目独立工作清晰 | 一个 Session 绑定一个 workingProjectId，可在该项目内安全工作 |
| COL-002 | P1 | 已实现 | 多项目协作由 Room 组织 | 一个 Room 可有多个 Session，每个可使用不同 workingProjectId |
| COL-003 | P1 | 已实现 | 协调 Session 支持多项目参考 | 没有 workingProjectId 时可绑定多个 referenceProjectIds，但不自动获得写入目标 |
| COL-004 | P1 | 已实现 | Room 聚合展示资源 | Projects/MCP/Agents 面板按 Session 使用关系聚合，不产生 Room 资源绑定 |
| COL-005 | P1 | 已验证 | 跨项目操作不扩大权限 | reference Project 写入仍被拒绝，除非用户明确调整为 working Project 并通过权限检查 |

## 9. 消息、事件与权限

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| MSG-001 | P0 | 已实现 | 普通 Room 消息路由默认 Session | 只发送到 role=primary Session，不受当前辅助线视图影响 |
| MSG-002 | P0 | 已实现 | 辅助 Session 消息显式发送 | URL 含 sessionId；服务端确认 role=worker 且属于当前 Room |
| MSG-003 | P0 | 已实现 | Pi 文本实时流式显示 | delta 顺序正确；完成后立即回填实际 Session transcript；中文与 Markdown 不丢失、不重复 |
| MSG-004 | P0 | 已实现 | 页面展示统一活动 | Pi 私有事件转换为平台 AgentEvent |
| MSG-005 | P0 | 已实现 | 历史消息从 Pi 原生 Session 恢复 | 刷新后文本与顺序一致；无平台 transcript 表 |
| MSG-006 | P0 | 阻塞 | Agent/MCP 配置变更下一 turn 生效 | active turn 使用冻结配置；下一 turn 重新装配 runtime |
| MSG-007 | P1 | 已实现 | Agent 可提出 Room 内容候选 | 目标、方向、输出候选不自动持久化；用户可采用、编辑或忽略 |
| PERM-001 | P0 | 阻塞 | 每次操作重新计算权限 | Session 项目绑定、Project accessMode、Agent policy、MCP policy、当前授权共同生效 |
| PERM-002 | P0 | 已验证 | Project 访问不能越界 | 篡改路径、跨 root、symlink、敏感文件均被拒绝 |
| PERM-003 | P0 | 阻塞 | MCP 外部写按策略审批 | approval 暂停调用；允许一次只作用于明确请求 |
| PERM-004 | P0 | 已验证 | Pi project trust 不代替平台权限 | 平台禁止的读写仍被拒绝 |
| PERM-005 | P0 | 阻塞 | 敏感信息不进浏览器或日志 | secret、token、认证字段被移除或脱敏 |

## 10. UI

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| UI-001 | P0 | 已实现 | 桌面使用主区加可选右侧列 | 基础布局为左 Workspace + 中央 Room；Inspector 打开形成第三列；文件内容打开时位于 Inspector 左侧并形成独立列 |
| UI-002 | P0 | 已实现 | 空 Room 结构化展示 | 无目标/Session 时仍展示工作线、项目、MCP、Agent 位置 |
| UI-003 | P0 | 已实现 | Session Rail 清晰表达 role | primary 显示主工作线；worker 显示辅助工作线；不是独立实体 |
| UI-004 | P0 | 已实现 | 当前工作线内容独立 | 不混合多个 Session timeline；Composer 目标明确 |
| UI-005 | P0 | 已实现 | Session 配置入口完整 | 可选 Agent、MCP、工作项目、参考项目；运行中显示下一轮生效 |
| UI-006 | P0 | 已实现 | Inspector 聚合 Session 资源 | 不展示 Workspace/Room 资源所有权；按 Session 使用关系显示；内容类别使用单行横向选项卡 |
| UI-007 | P0 | 阻塞 | AI Elements 组件治理落实 | Conversation、Message、Prompt Input、Task、Tool、Confirmation、File Tree 按架构使用 |
| UI-008 | P1 | 已实现 | 多项目协作可扫描 | 项目聚合显示工作/参考绑定和相关 Session |
| UI-009 | P1 | 已实现 | 窄桌面可完成主流程 | 宽度不足时 Inspector/File Content 转为右侧覆盖层或自动隐藏辅助列；Session Timeline 和 Composer 保持可用 |
| UI-010 | P0 | 实现中 | 基础无障碍 | 图标名称、Dialog 焦点、键盘操作、非颜色状态、低干扰流式反馈完整 |
| UI-011 | P0 | 已实现 | RoomContent 可扫描和局部编辑 | Header/Inspector 展示目标、方向、输出、总览；单项保存不覆盖其他记录；空内容有结构化空状态 |
| UI-012 | P0 | 已实现 | Inspector 默认隐藏且可显式开关 | 首次进入 Room 不显示 Inspector；Room 右上角小型图标按钮可切换，左栏资源入口可自动打开对应 Tab |
| UI-013 | P0 | 已实现 | 新增与修改统一使用 Dialog | 除零表单新建 Room 和文件树浏览外，Workspace/Room 标题/Project/MCP/Agent/Session 配置/RoomContent 的新增修改均为弹窗式 |
| UI-014 | P0 | 已实现 | 文件内容使用独立列与标签 | 目录行任意位置可展开；首次展开加载该目录的直接子项且不清空其他树节点；点击文件后在 Inspector 左侧新增 File Content 列并打开或激活文件标签；可同时保留多个标签；关闭最后一个标签时关闭文件列；不使用编辑弹窗展示文件 |
| UI-015 | P1 | 已实现 | 视觉样式统一采用 Tailwind | Feature 与 shared UI 的视觉样式均由 Tailwind utilities 表达；`globals.css` 只保留 Tailwind 入口；重复选择控件复用统一 Select 原语 |

## 11. 非功能需求

| ID | 优先级 | 状态 | 需求 | 验收条件 |
| --- | --- | --- | --- | --- |
| NFR-001 | P0 | 已验证 | TypeScript 严格类型通过 | 不用大范围 any、ignore 或关闭 strict 规避问题 |
| NFR-002 | P0 | 已验证 | 生产构建通过 | Next build 成功；服务端原生依赖不进入客户端 |
| NFR-003 | P0 | 已验证 | 数据库约束完整 | 六张核心表和 room_contents 的外键、唯一 primary/goal/overview、状态与 JSON 校验均覆盖 |
| NFR-004 | P0 | 阻塞 | 主流程端到端可验证 | Workspace → 空 Room → 默认 Session → Pi 流式 → 刷新恢复 |
| NFR-005 | P1 | 已实现 | 多 Session 并发安全 | 执行锁隔离；一个 Session 的中断不影响另一个 |
| NFR-006 | P1 | 已实现 | 配置变更不破坏 active turn | 当前 turn 完整结束；下一 turn 使用新配置 |
| NFR-007 | P0 | 已实现 | 数据损坏不静默吞掉 | 无效 JSON、丢失引用、非法状态返回明确诊断 |
| NFR-008 | P0 | 已验证 | 服务端私有边界 | Pi、SQLite、fs、MCP transport、secret 不进入客户端包 |

## 12. 不做

- Workspace、Room 对 Agent/MCP/Project 的持久绑定。
- Workspace 默认 Agent 或默认 MCP。
- Agent/MCP/Project 的 Workspace 归属。
- Runtime、Driver、Adapter、Binding、Asset、Message、Transcript 实体表。
- 多项目 reference 自动写入。
- 自动 Git 接受、回滚、提交、推送。
- 多用户、组织、登录、云同步或远程多节点。
- 在运行中的 Pi turn 中热替换生效配置。
- 将辅助工作线当作新的实体类型。

## 13. 实现顺序

### Phase 1：六表与独立资源

~~~
BASE-* → NFR-001/002/003/007/008
→ WS-001/002
→ PROJ-001..003
→ MCP-001..003
→ AGENT-001..003
~~~

完成标准：六张核心表、room_contents、独立资源 CRUD、空 Workspace 和空 Room 都在目标边界内运行。

### Phase 2：Room 与基础 Session

~~~
ROOM-001..005
→ SES-001..006
→ CFG-001/004
→ MSG-001/003..005
→ UI-001..007
→ NFR-004
~~~

完成标准：用户能创建空 Room，直接发消息创建无 Agent 的 Pi 基础 Session，并在刷新后恢复历史。

### Phase 3：Session 后配置与单项目工作

~~~
CFG-002/003/005/007
→ PROJ-004
→ MSG-006
→ PERM-001..005
→ COL-001
→ NFR-006
~~~

完成标准：Session 可在创建后安全附加 Agent/MCP/工作项目，配置在下一 turn 生效。

### Phase 4：多 Session 与多项目协作

~~~
SES-007..009
→ CFG-006
→ COL-002..005
→ MSG-002
→ UI-008/009
→ NFR-005
~~~

完成标准：一个 Room 可并行组织多个项目 Session 和协调 Session，不混合权限、消息或写入目标。

## 14. 完成定义

一项需求变为已验证前必须：

1. 满足本文验收条件。
2. 与其余四份文档一致。
3. 正常、空、加载、错误和无权限状态有定义。
4. 有风险相称的自动测试。
5. 删除被完整替换的旧模型与旧 API。
6. 通过类型检查、构建和相关验收。

## 15. 当前阻塞

| 范围 | 阻塞原因 | 解除条件 |
| --- | --- | --- |
| MCP Runtime、MCP policy 与审批 | 官方 v2 包 `@modelcontextprotocol/client` 尚未进入依赖集；当前环境的包安装审批服务不可用 | 安装官方 MCP v2 client 后实现 stdio/streamable HTTP connector、tool 映射、secret resolver 与一次性审批 |
| AI Elements 完整替换 | Conversation、Message、Prompt Input、Task、Tool、Confirmation 所需的 Streamdown、AI SDK 与 shadcn/Radix 依赖当前无法安装 | 依赖可用后只替换已登记的 Wrapper/基础原语，不改变平台 AgentEvent 与 Session 协议 |
| 主流程浏览器 E2E | 当前执行环境禁止监听本地端口，审批服务不可用；无法启动开发服务或连接 localhost | 本地服务权限恢复后执行 Workspace → Room → Pi stream → refresh restore，并完成桌面/窄屏截图验收 |

阻塞项对应 API 不返回假成功：配置了 MCP 的 Session 在执行前返回 `MCP_RUNTIME_UNAVAILABLE`，MCP test API 返回 503；已完成的 Project、Agent 与 Pi 基础流程不依赖 MCP 客户端。
