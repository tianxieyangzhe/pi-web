# 02｜模型：持久事实与 SQL

本文范围：独立项目与通用资源模型。Workspace 的专属设计、模型、API、交互与需求统一见 [06｜Workspace](06-workspace.md)，本文不定义或复写其规则。

本文是独立项目与通用持久模型的唯一来源。每项改动先在这里定位对象、表、约束和关系，再允许 `03` 定义 API 如何改变这些事实。

每个模型写清职责、身份、归属、生命周期、不可变字段、关系、对应 SQL 表和关键约束。运行句柄、页面打开使用权及其租约、后台使用权、关闭计时器、锁、订阅、流式文本、页面草稿和 UI 阶段不是持久模型，不新增表或持久状态。派生状态必须标明来源，不能另建含糊状态。

需要新增、合并、拆分、重命名或退役表时，先完成本节要求的事实、问题、取舍、数量、关系和历史映射。未获用户明确授权，不把映射写成可执行迁移。

## 1. 持久化边界与关系

~~~text
Project ── Session * ── 独占 Pi Session Tree
Agent Markdown ── 可选的 Session 精确版本引用
~~~

Session 是独立持续会话，不需要应用级记忆、总结对象或模板。一个 Project 可拥有多个独立 Session；它们的原生身份和树分别独立。运行句柄、锁、租约、订阅、浏览选择、草稿及用量均不是 SQL 持久对象。工作区关系只在 06 定义。

## 2. 基础类型
~~~ts
type EntityId = string;
type ISODateTime = string;
type JsonObject = Record<string, unknown>;
type ResourceStatus = "active" | "disabled" | "archived";
type SessionState =
  | "not_started" | "starting" | "idle" | "running"
  | "interrupting" | "ended" | "unavailable"; // 仅兼容原生检查/活动 DTO，不是 Session 持久状态
~~~

SessionState 只是原生检查和活动投影，可以实时表达准备、运行、取消中或不可用，不是持久执行结果。

Project 继续保存独立的 `id`、`name`、`description`、`kind`、`rootPath`、`status`、`createdAt` 和 `updatedAt`。`rootPath` 是存在且可访问的规范化绝对路径；项目文件权限由执行策略决定，不在 Project 上设置通用读写模式。

## 3. Session 与项目资源

SLIST-002：两类SessionDTO额外返回lastOpenedAt:string|null，来自应用级SessionOpenHistory，不由消息/createdAt/updatedAt推导。独立持久事实仅为(scope=project|workspace,ownerId,sessionId,openedAt)，唯一键为该三元组；一份版本化JSON文件原子覆盖最近值，位于.data/session-opened/SHA256(三元组).json，不保存正文或任意扩展，不新增SQL表/列及历史迁移，不属于Pi transcript。读取须核对版本、完整身份及ISO时间；无文件为null，损坏明确报错。原记录只在新连接成功创建前更新；打开失败、幂等重放、心跳、消息及列表读取不写；重启仍保留，删除会话后文件保留为无引用历史，不复用ID或回填旧记录。runtime handle建立后文件写入失败不发lease，报可重试错误，已建立身份/句柄保留。文件存取属于infrastructure，application只通过端口读写，不调用Pi。lastOpenedAt不进入writeETag。

SLIST-001：SessionDTO增加lastUserInput:string|null、lastActivityAt:string|null、previewUnavailable:boolean，均从所属Pi整棵树的原生追加顺序派生。lastUserInput取最后message.role=user的文本块拼接原文（无文本返回空字符串，缺用户消息为null）；lastActivityAt取最后具有有效timestamp的message节点时间（含assistant/tool），无消息时用createdAt。非消息配置变化不算对话活动。不写SQL/purpose，不调用模型；读取失败返回null/null及previewUnavailable=true，不伪造空历史。上述派生值不纳入writeETag。

### 当前连接契约（SCONN-001，替代旧不可逆结束语义）

Session记录的存在性由数据库决定，只有DELETE移除记录；用户所见会话状态只有open（打开）和closed（关闭），来源为本进程有效连接租约，不持久化。关闭只释放连接使用权，可重新打开相同会话和Pi身份；打开后运行进度、忙碌、错误、上下文变化均由所属SSE事件驱动，不作为第三种会话状态或依赖定时轮询。

ended_at保留为历史字段，只读、不清空，不再表示当前生命周期或限制打开、发送、型号切换、压缩和Agent采用；新关闭不写该列。原数据库约束和迁移快照保持原样，因此无需新结构迁移。内部SessionState仅作为Runtime活动类型供执行协调与原生检查使用，不在SessionDTO/WorkspaceSessionDTO暴露；公共DTO仅status=open|closed，不返回state/endedAt。ETag只包含持久事实，不能随连接开闭变化。


项目 Session 的 Project 必填且不可变，Agent 引用及快照可同时为空；非空时保留精确版本与历史引用，Agent 不是执行权限事实。Session 保存 id、projectId、可空 agentId/agentSnapshot、nativeRef、purpose、endedAt、createdAt 和 updatedAt 等业务事实；安全DTO的status仅投影连接开闭，Runtime活动不作为会话状态返回。ended_at仅保留历史事实；旧 state/status 列的目标移除、历史映射及约束按 §11 执行，不能将进程退出前的 running 直接视为当前仍在运行。

purpose 是已有的用户意图/会话说明；类型为 string，持久值非 NULL，省略时为空串、最多500字符，API 规范见 03 §2；客户端标题使用 trim 后的 purpose，空值显示“新会话”，不另建 title/summary 列、不调用模型生成名称。API 直接返回 purpose，不返回记忆 ID 或摘要字段。

nativeRef 含 kind、sessionFile、sessionId、cwd，首次建立后不可替换或清空，只在服务端用于精确恢复。每个 Session 对应独立 Pi Session Tree，节点 ID、父子关系、内容及活动叶子由 Pi SessionManager 管理。单独切换叶子不保证跨重启持久化，恢复以 Pi 原生结果为准；历史分支不因不活动而消失。对话与树预览均是该树的投影，不新增持久副本。

项目资源定义分别保存，不把角色正文、工具配置或其他资源关系写成会话任意 JSON。Agent 的完整规则见 §7。

PSES-024：项目文件参考只是所属Pi参考消息中的位置描述，不形成持久文件授权或内容快照；模型读取内容时由Pi原生工具调用/结果持有当时证据。上传/粘贴图片仍为Pi内容快照。非图片上传/粘贴按PSES-025落盘并以位置进入Pi。项目位置不新增持久对象；已有Pi快照保持原样，不迁移或改写历史。

PSES-025：新增应用管理的不可变附件文件，不新增SQL表或业务列。文件归所属Pi原生sessionId，目录为<applicationConfigRoot>/.data/session-files/<SHA256(sessionId)>/<SHA256(原文件名+NUL+原始字节)>/；该身份与Pi恢复一致，不使用cwd或客户端路径决定归属。目录中original.<安全扩展名>保存完整原始字节；content.txt为可选、由原件确定生成的UTF-8读取副本。Pi参考消息记录原名、原件位置、读取位置及提取结果，文件不拥有独立transcript。存储按不同会话分目录、同会话同名同字节去重，同名不同内容创建新身份；文件已存在须校验字节，不覆盖损坏或被替换文件。目录0700，文件0400；应用只操作自己创建的目录，拒绝符号链接。会话关闭、进程重启、压缩及业务记录删除不自动删除附件，以免已有Pi分支引用失效；无自动GC或迁移，旧快照不转存。失败前已落盘的不可变文件可保留，Pi写入不承诺与磁盘跨介质原子性；不得重用其他会话文件或从损坏文件静默重建。文件存储不影响上传额度和已有SQL结构。PSES-028使用Pi原生工具后，分目录和0400仍是存储约束，不声明宿主同用户进程具备跨会话文件系统隔离；原生bash不受附件存储服务的路径检查约束。会话归属、Pi身份、原件不可变的应用存储策略不变，不新增SQL或迁移。

BOT-REMOVE-001：Bot整体退役，只保留Project、Agent、Session及Workspace模型。目标Schema从14张表减为7张：projects、mcps、agents、sessions、workspaces、workspace_projects、workspace_sessions；退役bots、bot_conversations、project_calls及四张Bot项目/Agent关系表，移除agents.bot_id和sessions的bot_conversation_id/participant_name/assignment/collaboration_state/bot_joined_at及依赖索引、外键、触发器。旧Coordinator、Task、Bot及派发/协作模型整体退役，不保留模型、API、旧Schema副本或未来接入计划；Agent用途仅project，能力仅readFiles/writeFiles；旧AgentPolicy/PiAgentExtension及maxParallelTasks一并移除，历史会话仅提取旧引用的agentId/revision/name作为不可执行标识，不加载旧能力或调度配置，原始JSON在数据库中保持不变；MCP引用检查仅查询现存Session，不查询退役Task；Agent仍为独立版本化Markdown，不拥有transcript。Session仍独占原Pi身份，不再有Bot父级或协调来源派生。舍弃保留空表/隐藏JSON兼容方案，避免无功能的持久关系继续控制独立会话。历史映射：退役表、列、协调Agent和旧Markdown须在用户另行决定迁移时完整归档；源码退役阶段只实施目标Schema与代码删除；其后用户另行授权的DBUP-002已按§11.2完成迁移，不清库、不删除原Pi文件。已有旧库由通用Schema校验阻止写入并报告SCHEMA_INCOMPATIBLE；读取现存Project/Session及Pi全树不调用Bot兼容逻辑。旧目标迁移脚本、Schema副本及旧OpenCode协调/子代理参考快照退役，不保留旧模型设计副本；追溯使用git历史。

## 4. 表数量与模型可读性：退役应用记忆

SessionMemory 功能整体删除。目标 Schema 退役 session_memories 一张表，删除 sessions.session_memory_id 及其外键、唯一键、组合键和相关触发器；工作区对应字段及约束在 06 定义。表数量减少 1，不引入替代表、影子摘要或兼容记忆对象。当前独立事实只有 Session 与 Pi 树归属；原有七字段总结、草稿、模板来源和审阅游标不再有运行职责，保留空表或自动创建占位记录会继续制造无效依赖，因此不采用。

创建会话只插入 sessions；删除只删除 sessions。项目、Agent、会话 ID、purpose、时间、原生引用及 Pi 历史保持原值。旧 session_memories 内容不映射到 purpose、提示词或 Pi transcript，也不自动复制成新摘要。

历史库处理由用户单独决定：可以先保留原库与完整备份，暂缓结构迁移；也可以在独立授权后，先把退役表和会话旧关联导出为只读归档，再执行删除目标表/列/约束的显式迁移。默认不提供或执行改写脚本，不删除记录、不重建数据库，也不为兼容旧库继续启动记忆能力。归档不进入应用模型或 API。

现有库含强制旧绑定时无法直接按目标写入，创建、更新、派生及删除返回 SCHEMA_INCOMPATIBLE，明确说明需要用户决定结构升级。已有会话元数据和 Pi 历史可按只读兼容读取，但不得依赖退役内容或因损坏记忆阻断原生历史读取。应用启动只初始化全新空库，不隐式迁移历史。所有后续表调整仍须说明独立事实、数量、关系与历史映射。

数据库固定为 .data/ai-workspace-v5.sqlite。结构设计和代码删除不等于旧记录物理删除授权；此前已完成的迁移只覆盖当时目标。新模型的实现与验收状态见 05。

## 5. 原生上下文使用情况（运行时 DTO）
下列指标属于 Pi Session 的安全运行时读取结果，不写入业务表，不新增指标快照或压缩历史表。Pi 原生压缩结果与压缩记录由原生 SessionManager 保存，数据库继续只保留 nativeRef。

~~~ts
type NativeContextUsage = {
  usedTokens: number | null;
  contextWindowTokens: number | null;
  remainingTokens: number | null;
  usageRatio: number | null; // used / contextWindow；可超过 1，不静默钳制
  measurement: "native" | "estimated" | "unavailable";
  measuredAt: ISODateTime | null;
  freshness: "current" | "last_known" | "unavailable";
};

type NativeContextInspection = {
  sessionState: SessionState;
  runtimeReady: boolean;
  canCancelCompaction: boolean;
  usage: NativeContextUsage;
  autoCompactionEnabled: boolean; // PSES-021：活动会话实际值true；未连接返回默认策略true
  compactionState: "idle" | "running" | "cancelled" | "failed";
  canCompact: boolean;
  unavailableReason: string | null;
  lastCompactedAt: ISODateTime | null;
  error: { code: string; message: string; recoverable: boolean } | null;
};
~~~


容量来自当前会话模型经 Pi 解析后的 contextWindow，模型配置来源见 `01`“应用级 Pi 配置来源”；显式配置优先于 Pi 内置同名模型元数据，不由浏览器设置。maxTokens 只表示最大输出，不替代上下文容量。容量未知时 remainingTokens / usageRatio 为 null；否则 remainingTokens=max(0,window-used)。指标数值必须有限且 Token 非负整数，null 表示未知，不能显示为 0。输出预留和下一条尚未提交的用户文本不属于已用输入，不能将“剩余”解释为可安全发送的保证。

运行中的状态、错误及实时指标不承诺进程重启恢复；最近压缩时间仅在 Pi 原生历史可验证时恢复，否则为 null。手动压缩只通过 Pi 保存原生结果，不写业务对话副本。


应用启动不自动改写数据库或恢复退役实体。

## 6. Pi 检查投影边界
`NativeContextInspection` 字段以“原生上下文使用情况”为准，属于非持久化运行时 DTO；sessionState 是所属 Session 的运行投影，runtimeReady 表示原生 Runtime 可检查，canCancelCompaction 表示用户可取消当前原生压缩。取消进行中仍表示 running，保持 Session 互斥直到 Pi 操作结束；取消不能撤销已保存的原生压缩结果。

用量改为直接读取 Pi `AgentSession.getContextUsage()` 的估算 Token。该 API 返回的估计窗口占用标记 estimated，并以读取时刻为采样时间；压缩后 Pi 返回 null 时显示 unavailable，不从旧输入 Token 或数据库正文补成假实时值。容量来自当前已解析模型；Pi 提供的缺省值与显式配置按原生规则区分，不能确认容量时为未知，不由应用补写常数。切换模型或重新解析其配置后，旧指标标记 last_known 并重新测量，不把旧模型容量套到新模型上。UI 不把剩余数值解释为下次请求必然可用的配额。

原生上下文 DTO 在 `domain/native-context.ts` 与浏览器 `domain/native-context.ts` 独立定义，独立于会话业务字段。完整历史始终由 Pi 原生存储维护；不新增上下文快照表。


## 7. 独立项目 Agent Markdown

独立项目会话沿用应用管理的 Agent 定义。Markdown 按 Agent ID 和不可变 revision 存为 `.data/agents/<agentId>/<revision>.md`；数据库只保存目录索引、状态、摘要和引用。参考项目和上传材料不建立 owner 或工具授权。

```ts
type AgentSnapshotRef = {
  agentId: EntityId;
  revision: number;
  kind: "project";
  contentSha256: string;
  name: string;
  description: string | null;
};
```

Session 的持久字段与运行投影只按 §3 定义。Agent 引用和快照同时为空或同时存在；Project 绑定与原生身份不可替换。nativeRef 含 kind、sessionFile、sessionId、cwd，仅服务端恢复使用，原生绝对路径不单独下发。字段去除及历史约束映射见 §4。

保存 Agent 新版本不自动改变已有 Session 引用。明确采用时校验用途、摘要、可用性与空闲条件，保留历史版本和原生历史。正式角色的能力选择不覆盖会话模型选择、工具上限或项目路径保护。

## 8. 用户删除独立项目会话（PSES-012）

用户确认后，在事务中只 DELETE sessions 的指定 id/project_id 行；Project、Agent、其他会话和 Pi 文件不变。外键引用返回 SESSION_REFERENCED 并回滚，不推导Bot父级或专属删除许可。运行、打开、压缩或结果未知时不删除。源 nativeRef 不改写；只释放空闲句柄，不删除原生历史。旧库结构未兼容时按 §4 阻止写入，不暗中删改退役数据。

## 9. 会话检查与模型配置投影

树标题、选中节点、弹窗开关和浏览位置属于派生或客户端临时状态。节点身份、parentId、label 和 activeLeafId 来自原生树，不建标题表。

Session 安全 DTO 的 allowedActions 扩展 switchModel、fork、export 及各自不可用原因，均由服务端从归属、生命周期、执行互斥、原生证据和恢复状态派生，不新增持久状态。fork 许可表示可进入节点创建流程，具体 entryId 仍在提交时校验；export 只要求历史可读，switchModel要求有效运行租约与空闲句柄；当前型号失效先按MCFG-002回退默认，默认也不可用时的显式恢复见03 §13。

会话模型身份来自 Pi 当前分支的 model_change 及实际 Runtime；完整参数来自应用级 Pi 配置，SQL 不保存 provider、modelId、容量、凭据或配置副本。配置来源标记仅为 local/global/native，不下发配置绝对路径。

运行时 DTO 定义如下，仅包含非敏感投影；完整配置保留在 Pi Runtime，DTO 的字段集合不得反向限制配置参数支持范围。

~~~ts
type SessionThinkingLevel = 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
type SessionModelView = {
  thinkingLevel: SessionThinkingLevel | null; // Runtime优先，否则当前原生分支最后thinking_level_change；无记录为null
  current: { provider: string; modelId: string; available: boolean; unavailableReason: string | null } | null;
  defaults: { provider: string | null; modelId: string | null };
  sources: { models: "local" | "global" | "native"; settings: "local" | "global" | "native" };
  models: Array<{
    provider: string; modelId: string; name: string;
    contextWindow: number | null; maxTokens: number | null;
    reasoning: boolean; input: string[]; thinkingLevels: SessionThinkingLevel[]; // Pi getSupportedThinkingLevels
    available: boolean; unavailableReason: string | null;
  }>;
  canSwitch: boolean;
  unavailableReason: string | null;
};
~~~

contextWindow 与 maxTokens 是 Pi 解析结果中的正整数，无法确认时为 null；模型列表不包含 apiKey、baseUrl、headers 或认证详情。可用性根据 Pi 注册表和认证检查派生，不通过真实模型探测；未知可用性不伪装请求必然成功。

## 10. 从节点创建独立会话与导出

派生会话是新的 Session，沿用来源 Project 归属及可选精确 Agent 引用；来源 Session、nativeRef、活动叶子和已有内容均不可改写。新会话拥有新 ID、新 Pi sessionId 与文件；原生历史仅继承根到选定 entryId 的完整祖先路径，包含该节点，不复制旁支或节点后的历史。节点 ID 可在两个不同 Pi Session 内保留，其身份始终以所属 Session 为边界。新会话模型取继承路径的最后模型选择，无选择时采用默认模型。工作区专属关系见 06。

数据库事务只插入一行 sessions，保持 Project、可选 Agent 引用及首次 nativeRef 约束；不修改源记录。Pi 文件准备与 SQL 事务不是跨存储原子提交，恢复与幂等规则在 03 定义。派生本身不新增表；全局退役导致的旧库处理见 §4，现有库不兼容时报告 SCHEMA_INCOMPATIBLE，不绕过约束。

导出是所属 Pi 树一致快照的下载，不产生业务记录或模型调用。scope=tree 表示全部分支、所有原始节点及原生追加顺序；scope=branch 表示读取时活动节点的完整祖先路径。两者均保留完整原文及节点身份。格式为 html 或 jsonl；JSONL 含原生 header 及选定范围的完整 entries，HTML 提供可阅读内容和完整原始节点。下载自身可能包含原生路径和工具敏感原文，按完整 transcript 规则处理，不另加路径 DTO 或过滤节点。HTML 将全部原文作为惰性数据或转义文本输出，消息中的 HTML、脚本及工具字符串不得在打开导出文件时执行；安全编码不得删除或截断原文。导出临时文件不成为会话或数据库附件，响应结束后清理应用自己创建的临时文件。

## 11. 通用持久模型与 SQL 约束（GAP-001）

本节是当前目标，替换含糊的“等已有事实”。结构调整在原表内完成，除 §4 退役一张表外不新增或删除 SQL 表；新增 Session 创建键列与索引，移除 sessions.state/status，保留 ended_at 历史值，均属于待单独授权的历史迁移。不得在启动时执行。工作区模型与 GAP-006 本轮不调整。

| 对象 / SQL 表 | 字段到列、类型与默认值 | 身份、关系与生命周期 |
| --- | --- | --- |
| Project / projects | id→id TEXT PK；name→name TEXT NOT NULL（1..120 字符）；description→description TEXT NULL（≤2000 字符）；kind→kind TEXT NOT NULL（code/knowledge/general，创建默认 code）；rootPath→root_path TEXT NOT NULL；status→status TEXT NOT NULL（active/disabled/archived，创建 active）；createdAt/updatedAt→created_at/updated_at TEXT NOT NULL UTC ISO | id/created_at 不可变；root_path 为可访问的规范真实绝对目录，同独立项目表内 UNIQUE；与 Workspace 不比较。存在 Session 或其他 FK 引用时不可改 root_path 或删除；状态变化不改变 Pi 身份。只 active 接受新会话与执行；disabled/archived 仍可读历史和删除符合条件的会话 |
| Session / sessions | id→id TEXT PK；projectId→project_id TEXT NOT NULL FK projects.id RESTRICT；purpose→purpose TEXT NOT NULL DEFAULT ''（≤500 字符）；agentId→agent_id TEXT NULL FK agents.id RESTRICT；agentSnapshot→agent_snapshot_json TEXT NULL（合法引用对象）；nativeRef→native_ref_json TEXT NULL（合法对象）；createdAt/updatedAt→created_at/updated_at TEXT NOT NULL；endedAt→ended_at TEXT NULL；createRequestKeyHash/createRequestSha256→create_request_key_hash/create_request_sha256 TEXT NULL | id/project_id/created_at 不可变；Agent 引用与快照同空或同有且身份一致，agent_id 创建后不可替换，快照仅显式采用同一Agent版本可更新；nativeRef 首次 NULL→值后不可修改；ended_at 仅 NULL→时间且不可清空。创建键两列同空或同有、64 位小写十六进制；新建必有，历史未知键保持 NULL，UNIQUE(project_id,create_request_key_hash) 仅约束非空键 |
| Agent / agents | id TEXT PK；name TEXT NOT NULL（1..120）；description TEXT NULL（≤2000）；kind TEXT NULL（正式仅为project）；revision INTEGER NOT NULL ≥1；content_sha256 TEXT NULL（正式为64位小写十六进制）；status TEXT NOT NULL（active/disabled/archived）；created_at/updated_at TEXT NOT NULL | 新定义 id/created_at/kind 不可变，初始 revision=1；正文变化新建 revision+1 的不可变文件，更新目录索引；仅状态变化不产生正文版本。旧无 kind/hash 的记录只读待转换，不作为正式指导。无引用可物理删除目录记录，有引用只能归档；所有已有版本文件保留 |

本轮持久化取舍：保留旧state/status并双写会继续制造进程退出后虚假running及两份生命周期，因此移除；ended_at只保留迁移时的历史结束事实，不参与当前执行许可。创建键采用原Session表的两个有约束列承载，与Session存在性同事务，不增建幂等SQL表；文件journal只承载跨Pi/SQL边界的操作证据，不能替代归属/FK或保存对话。关系总览仍为Project→Session→唯一Pi树、Session→可空Agent精确版本；单个未决操作的证据附属于该独立项目Session（create准备时附属于确定的新Session ID），SQL表净变化仍为§4的-1。

Session的存在性由记录存在决定。ended_at只记录历史结束时间，新关闭不写入。安全DTO.status由连接租约派生open/closed，不再写sessions.status；sessions.state不再承载运行事实。两列在目标新空库移除；历史迁移须先校验 closed/ended_at 一致，旧 ended 且缺 ended_at、closed 且无时间或相互冲突的行阻止迁移并列出记录，由用户决定修复，不伪造时间。历史 state 中 starting/running/interrupting/unavailable 不自动转为执行结果，迁移前原值随归档保留，原生证据不明仍进入 unknown。旧 status=open 但有 ended_at 也须核对，不静默纠正。

native_ref_json 只允许 kind='pi'、sessionId/sessionFile/cwd 非空字符串；cwd 必须等于绑定 Project 的规范 root_path。对非空引用分别创建 JSON 提取表达式 UNIQUE(sessionId)、UNIQUE(sessionFile) 索引，阻止两个独立项目 Session 共用原生身份/文件；同一身份与 Workspace 冲突时应用在创建/绑定前检查并拒绝，本轮不修改 Workspace Schema。JSON 中单个字段不允许后续补写改变恢复身份。首次打开使用条件 UPDATE native_ref_json IS NULL，影响行数必须为 1 或核验已存在的同一引用。

Agent 的新正文只在 .data/agents/<id>/<revision>.md。frontmatter 精确包含 agent_id、revision、kind、name、description、capabilities；正文为 instructions（非空、≤16000 字符），UTF-8 文件≤64KiB，sha256 按完整文件原始字节计算。capabilities精确包含readFiles/writeFiles两个布尔键，默认全false；Bot协作能力字段整体退役，旧Markdown版本由用户后续决定归档/转换，不原地改写。用户明确提交的能力是唯一选择来源，LLM 不输出授权。能力不覆盖独立项目执行策略或模型配置。

Agent的project_id/source_template_id/definition_json/extension_json/policy_json为旧独立资源兼容列，新记录owner/source/definition为NULL、extension/policy为{}；不保存新正文或借旧owner授权。Bot专属表列按BOT-REMOVE-001从目标Schema移除，旧库实际数据仍保留至独立迁移决定。sessions的mcp_*、native_metadata_json、last_activity_at不作为当前执行配置。所有未列出的旧触发器须逐一核对，目标只保留 Project/Agent FK、Agent 双空检查、原生身份/归属不可变、ended_at 单向及创建键不可变检查，不保留依赖退役列、强制 Agent 或旧运行状态的写入规则。

### 11.1 显式离线升级与历史归档（DBUP-001）

DBUP-001记录的是此前记忆退役目标的已完成迁移，不涵盖BOT-REMOVE-001。旧升级脚本、执行指南及冻结Schema副本随Bot代码退役，追溯以git历史为准；当前目标只有core/role/workspace三份SQL。新目标不复用此前授权，既有库保持原样且拒绝写入，是否归档及迁移由用户另行决定；本轮源码退役阶段不生成或执行迁移脚本；后续明确授权见§11.2。

### 11.2 当前7表迁移（DBUP-002）

用户在BOT-REMOVE-001完成后明确要求“迁移数据库”，授权本节目标的离线迁移。只接受只读预检固定的来源结构、完整数据摘要及目标SQL摘要；出现其他打开连接、未知表、原生身份冲突、文件摘要不符或新版本路径已占用时拒绝。支持当前14表来源；在原SQLite文件内单事务重建为7表，不自动启动/停止服务。

先备份全部旧表及全部列为只读SQLite归档，并保存原始Agent版本文件副本、来源/目标摘要和映射manifest。七张退役表及coordinator Agent仅从活动库移除；未决调用保留在归档，不重放、不伪造完成。所有Project/MCP/Workspace/WorkspaceProject/WorkspaceSession列值和行保留，所有Session保留除退役列及明确版本映射外的列值，native_ref_json/归属/时间/创建幂等键逐字不变。项目Agent保留ID、名称、描述、状态、指导正文及旧文件，为每个使用中的旧版本新建不可变Markdown版本，能力仅保留原readFiles/writeFiles两个布尔值；目录revision/hash和对应Session引用映射到新版本，不修改原Pi历史。若会话绑定被退役Agent，或存在无法确定的版本引用，则预检拒绝，不能自行解绑。额外新版本文件先持久化后提交SQL，失败保留归档及候选，不自动覆盖或删除任何历史。

预检在只读源库和内存目标库完成全行投影、约束、外键和完整性验证。执行须固定预检plan摘要，再次检查连接和摘要；完整备份经重新读取核验、fsync、只读保护后，BEGIN EXCLUSIVE重读来源，关闭外键仅用于事务内DDL，恢复目标触发器后执行完整性、外键及所有目标行逐值比较，成功才COMMIT。失败ROLLBACK，原库和归档保留。已为目标的重复执行只读返回current。迁移不调用Pi、不改transcript、journal、配置或用户服务。脚本独立于启动流程，不恢复旧模型运行能力。

## 12. 安全 DTO 与派生许可（GAP-002）

所有字符串长度按 Unicode code point 计算；时间为 UTC ISO 字符串。ProjectDTO 为 §11 Project 字段加 writeETag；AgentDTO 为 id/name/description/kind/revision/contentSha256/status/createdAt/updatedAt/writeETag、markdown（string|null）、definition（{instructions,capabilities}|null）、legacy（boolean），正文从精确 Markdown 版本读取，不从 SQL 新正文列返回。缺失或摘要不符返回 ROLE_VERSION_MISSING/409，不伪造空正文；旧资料只读为 legacy=true、markdown/definition=null。

SessionDTO 精确为 {id,projectId,purpose,agentId,agentSnapshot,status,createdAt,updatedAt,lastUserInput,lastActivityAt,lastOpenedAt,previewUnavailable,writeETag,allowedActions,pendingOperations}，agentSnapshot 为 §7 的 AgentSnapshotRef、null 或旧引用的 {agentId:string,revision:number,legacy:true} 安全标识投影（不带原生路径/旧配置），status='open'|'closed'，来源为连接租约；pendingOperations 为 {operationId:string,operation:string,status:"running"|"unknown"}[]，只投影当前未决/活动记录，供重连后定位恢复；不返回载荷/键/证据原文。不返回 nativeRef、nativeMetadata、创建键或操作证据文件。writeETag 是对该对象持久可写事实的规范 JSON SHA-256，加双引号；不含连接status/运行活动/许可/采样，业务持久字段变化即变化。Project/Agent 同理，以其本对象持久字段计算；Agent 内容使用 revision/hash，不把运行状态写入 ETag。

allowedActions 是 Record<'send'|'interrupt'|'end'|'restore'|'delete'|'compact'|'cancelCompaction'|'switchModel'|'fork'|'export'|'adoptAgent', {allowed:boolean,reason:string|null}>；允许时 reason=null，拒绝为 03 的稳定错误码。它是读取时快照，提交必须再次核验；无调用方运行 lease 时 send/switchModel=false。动作优先按归属/许可、结构兼容、unknown、忙碌、模型/原生条件计算原因。只读 export 不要求结构可写、lease、默认模型可用或请求已确定；fork允许从有历史ended_at的源派生，但所属 Project 必须 active、源历史可读且无 unknown/执行操作，entryId 提交时另验。

Runtime活动派生优先级：操作证据未决/损坏、原生身份无效或配置不可用→unavailable；正在打开/初始化→starting；正在中止主回复→interrupting；正在 prompt/工具循环→running；已有合法 nativeRef→idle；其他→not_started。无句柄不代表 not_started；当前模型不存在、被enabledModels过滤或认证不可用时按01/03自动回退配置默认模型，保留Pi身份和历史，仅追加实际model_change；默认也不可用才报告模型不可用。压缩通过 compactionState 单独表达，期间 Session busy，不写运行 state 到 SQL。

send：active、未结束、有当前 lease/空闲句柄、模型可用、无 unknown；interrupt：本进程有可取消的主请求（不含压缩）；end：未结束且空闲、无 unknown；restore：未结束、无活任务、需要恢复或核对；delete：无打开/运行/压缩/修改任务、无 unknown 与外键引用，Project 无需 active；compact：send 的运行条件且有可压缩历史；cancelCompaction：有当前压缩任务（Project 状态变化不阻止取消）；switchModel：active、未结束、无 unknown/任务且有 lease，型号失效的恢复例外见 03 §13；adoptAgent：active、未结束、无 unknown/任务，目标同 Agent 的正式可用版本。只读权限与真实归属始终先于动作许可，不能以 lease 替代身份校验。

## 13. 独立项目会话操作证据（GAP-004）

ProjectSessionOperationJournal 是应用的耐久副作用证据文件，不是对话、模型上下文或通用任务平台；仅覆盖独立项目 Session 的 create/open/restore、message、switch-model、compact/compact-cancel、interrupt、end、adopt-agent、fork 与显式 recover 修改动作。它不拥有 Pi Session，不调用 Pi，不进入系统提示词或树，不影响 06 的 WorkspaceRequestJournal 或 GAP-006。SQL 表数量不增加。

每个 operationId 的文件位于 .data/project-session-operations/<projectId的SHA256>/<operationId>.jsonl，路径只在服务端构造。operationId=SHA256(UTF8(JSON.stringify(['project-session-operation-v1',projectId,sessionId或空串,operation,Idempotency-Key])))；新建/派生 Session ID 分别为 's_'+SHA256(UTF8(JSON.stringify(['session-create-v1',projectId,key]))) 和 's_'+SHA256(UTF8(JSON.stringify(['session-fork-v1',projectId,sourceSessionId,key])))，使用完整64位摘要，不截短。普通创建与 fork 的 create_request_key_hash 均等于各自 operationId，create_request_sha256 为规范化用户载荷摘要；journal.keyHash=SHA256(UTF8(key))，不保存原始键。operationId 中 create 的 sessionId 使用空串、fork 使用源 Session ID；journal.sessionId 对 create 是确定的新 ID、对 fork 是源 ID，候选新 ID 存 evidence.resultSessionId。entryId 属于载荷，不属于键作用域，因此同源同键换节点必定409，不能与普通 create 共用结果。

journal 每行包含 version=1、sequence、previousHash、recordHash、timestamp、operationId、projectId、sessionId（create 准备时为确定的新 ID）、operation、keyHash、payloadSha256、phase，以及 evidence。phase 为 prepared/observed/completed/failed/acknowledged；evidence 仅存原生身份、基线字节数/文件摘要、叶子、候选身份/摘要、目标型号或 Agent 引用、结果 DTO 所需业务 ID 与安全错误码，不存用户消息、参考文件、thinking、工具结果、认证或配置全文。哈希对除 recordHash 外本行规范 JSON 计算，序号及前链必须连续；首行 previousHash=null。新操作先独占创建文件，逐行 append+fsync，文件创建/候选发布同时 fsync 父目录，再进行副作用；completed/failed 不能重复执行。部分行、冲突记录、身份不符或坏哈希为 unknown，不截尾、重建或猜测成功。

同一作用域键永久绑定载荷摘要；规范 JSON 使用递归对象键按 Unicode 字典序排序、数组原序、UTF-8、JSON 标准编码，缺省值先按 API 规则填充；不规范化正文/附件字节。key 是 1..128 个可见 ASCII 字符，缺失/非法返回 INVALID_IDEMPOTENCY_KEY/400。完成证据在业务行删除后仍保留为只读 tombstone；同键请求目标已删除返回 RESULT_GONE/410，不重建。历史无 journal 的会话可只读及精确打开；新操作前验证原生版本/身份，历史遗留未决调用无法证明完成时为 unknown，不能因 journal 缺失而认定安全。

运行锁、lease、句柄与订阅仍仅在内存；journal 只证明已准备/已观察/已确认的边界，不把 prepared 当成模型已执行，不提供自动重放。恢复流程与客户端安全 DTO 见 03 §13。

## SEARCH-002｜工具搜索意图

toolSearch:boolean为本轮用户意图，API省略等价false，不持久化至SQL或配置；与webSearch独立，组合均允许。作用域持有本轮配置、计数、取消与原工具集，均为运行时对象。工具返回的搜索来源、URL、正文和失败只保存在该会话Pi原生toolCall/toolResult中（返回结构以03为准，不另存上游HTTP响应副本），不保存第二份对话，不新增表/字段/迁移。

## SEARCH-001｜请求级搜索意图

webSearch为单次发送意图，默认false，不是Session字段，不写SQL、配置或持久偏好。搜索调用与来源引用的原始provider output item只作为该Session唯一Pi树的server_web_search custom entry保存，数据为{type:provider事件类型,item:完整原始output item}，不复制至业务表或摘要；无搜索调用不得伪造搜索成功。开关无历史迁移。

FILE-003：Pi在所属session-files目录生成的文件仍是普通宿主文件，不因位于项目根外而变成Project文件。会话文件读取目录由数据库nativeRef.sessionId派生，目录与当前会话精确绑定；不新增记录/目录授权，不改Pi原生历史或上传快照的不可变策略。模型生成的其他文件不自动标记为不可变上传快照。

## FILE-001 生成文件读取

生成的Word、Excel、PPT、PDF及其他文件是项目目录中的普通文件，不新增附件表、下载记录或持久预览副本。FilePreview扩展由03定义的只读格式与内容块；下载每次读取当前文件原始字节，不转换、不修改源文件，不调用Pi或模型。上传快照仍按原契约独立存储。本项无SQL变更或历史迁移。
