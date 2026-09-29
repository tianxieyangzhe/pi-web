# 02｜数据模型

> 状态：**单项目 Room 目标模型，尚未按本版改表。** 本文件定义持久事实；跨项目 Room、Router、RoomRun、Task 的下一版结构留待后续设计。现有数据库仍包含旧模型，不能因本文件更新而自动清理历史数据。

## 1. 持久化边界和关系

~~~text
Project 1 ── * Session
                 └─ 1 Project Room
Room 模板 ──复制──> Project Room
~~~

一个项目 Session 必须且只能绑定一个项目 Room；一个项目 Room 只能绑定一个 Session。模板 Room 的 Project 为空且不绑定 Session。Project 可拥有多个独立的 Session/Room 对。

本版 Room 数据只用 `rooms` 表：当前生效上下文和一份待确认草稿均为该行的固定 JSON 字段。`sessions` 是独立实体表，通过 `room_id` 直接关联，不新增 Room 内容子表或多对多关联表。Pi 原生 transcript 保留在 Pi Session 文件中，数据库仅保存恢复引用。

## 2. 基础类型

~~~ts
type EntityId = string;
type ISODateTime = string;
type JsonObject = Record<string, unknown>;
type ResourceStatus = "active" | "disabled" | "archived";
type SessionState =
  | "not_started" | "starting" | "idle" | "running"
  | "interrupting" | "ended" | "unavailable";
~~~

Project 继续保存独立的 `id`、`name`、`description`、`kind`、`rootPath`、`status`、`createdAt` 和 `updatedAt`。`rootPath` 是存在且可访问的规范化绝对路径；项目文件权限由执行策略决定，不在 Project 上设置通用读写模式。

## 3. Room 当前上下文

`contextJson` 必须严格符合下列结构，不接受额外字段或任意嵌套的模型输出：

~~~ts
type RoomOutput = {
  title: string;
  summary: string;
  path: string | null; // 有值时是当前 Project 内经校验的相对路径
};

type RoomContext = {
  summary: string;
  goal: string;
  constraints: string[];
  facts: string[];
  decisions: string[];
  nextActions: string[];
  outputs: RoomOutput[];
};
~~~

`summary` 是对当前工作状态的简短概括；`goal` 表达用户当前目标；`constraints` 是用户确认的项目约束；`facts` 是对后续任务有用且可核验的事实；`decisions` 是已作出的决定；`nextActions` 是待办；`outputs` 是产出摘要及可选项目相对路径。空 Room 使用全部字符串为空、数组为空的完整结构。

`summary`、`goal`、`constraints`、`facts`、`decisions`、`nextActions` 会按固定顺序渲染为本轮 Pi 系统提示词中的 Markdown 上下文。`outputs` 默认只在 Room 面板展示；如果某项产出需要影响后续对话，应由用户提炼进上述字段。Room 不保存工具、扩展、Agent、MCP、Skill 的 ID、配置、凭据、快照或启用选择。

## 4. Room 待确认草稿

~~~ts
type RoomDraft = {
  context: RoomContext; // 候选的完整上下文，便于整体预览、编辑和确认
  source: "template" | "rule" | "llm";
  sourceThroughEntryId: string | null; // Pi transcript 当前活动分支的末条来源 ID
  inputTokens: number | null;
  outputTokens: number | null;
  generatedAt: ISODateTime;
};
~~~

一个 Room 同时至多保存一份 `draftJson`。草稿及其中 Token 用量用于审查，未确认前没有模型输入效力。规则或模板未调用模型时 Token 用量为 0；服务端未返回用量时可为 null。`sourceThroughEntryId` 只保存原生条目 ID，不复制 transcript 正文。

用户可以编辑草稿的 `context` 后确认。确认时在一个事务中以草稿内容替换 `contextJson`、清空 `draftJson`，并将已审阅的来源位置写入 `lastReviewedEntryId`。拒绝时清空草稿并记录已审阅位置。手动编辑当前上下文并保存本身就是用户确认，直接更新 `contextJson`。没有内容版本表、版本号或自动恢复旧内容功能。

## 5. Room 表

~~~ts
type Room = {
  id: EntityId;
  projectId: EntityId | null;
  sourceTemplateId: EntityId | null;
  title: string;
  contextJson: RoomContext;
  draftJson: RoomDraft | null;
  lastReviewedEntryId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
~~~

`projectId=null` 表示模板；非空表示只属于这个 Project 的可运行 Room。`sourceTemplateId` 是可选的同表直接引用，只能指向模板 Room，记录复制来源；模板修改不自动同步给项目副本。模板可保存通用的目标与约束，`facts`、`decisions`、`nextActions` 和 `outputs` 不包含具体 Session 历史或项目路径。复制模板时生成新 Room ID，初始模板内容进入项目 Room 的 `draftJson`，等待用户确认；`contextJson` 起初为空结构。

本版不使用 `RoomProject`、`RoomContent`、`RoomRun` 或 `Task` 表表达项目 Room。这些旧表在现有数据库中可能含有历史记录，何时迁移或如何保存由用户另行决定。

## 6. Session 与项目资源

~~~ts
type Session = {
  id: EntityId;
  projectId: EntityId;
  roomId: EntityId; // 项目 Session 必填且唯一
  purpose: string;
  state: SessionState;
  nativeRef: JsonObject | null;
  nativeMetadata: JsonObject;
  createdAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
  endedAt: ISODateTime | null;
};
~~~

Session 的 Project 与所绑定 Room 的 Project 必须一致，绑定创建后不可更换。Pi transcript 由 `nativeRef` 指向原生文件，不复制为数据库消息表。Session 的模型、Agent、MCP、工具、扩展和 Skill 运行配置属于独立基础模型和 Runtime 边界，不由 Room 持有；既有 Session 配置字段的后续目标由这些基础模型单独定义。

资源所有权规则独立于 Room：Project 为空的资源是模板；复制后生成新 ID 和固定 Project 归属，项目实例的配置、凭据与调试结果互不共享。一个资源实例只用于一个 Project。不建立 Room 与资源的关联表。

## 7. SQLite 与校验约束

1. `rooms.project_id` 非空时外键指向 Project；`source_template_id` 是指向 `rooms.id` 的可选外键，并经约束校验目标是模板。
2. `sessions.room_id` 对项目 Session 必填、唯一且不可变；`(room_id, project_id)` 必须匹配同一项目 Room，模板 Room 不可绑定 Session。
3. 新建项目 Session 时，Room 和 Session 在同一事务中创建；失败不得留下无主的项目 Room。
4. `context_json` 必须是有效 JSON object，`draft_json` 必须为空或有效 JSON object；应用层严格验证第 3、4 节的字段、数组元素、长度及来源 ID。
5. `outputs.path` 只允许当前 Project 内的安全相对路径，拒绝越界和敏感路径；模板不得保存项目路径。
6. 一个 Room 同时最多一份草稿。当前草稿待确认时，自动生成不得覆盖用户编辑；新轮次暂留 Pi transcript，草稿决议后再处理尚未审阅的轮次。
7. 不因删除或归档模板而级联删除项目 Room；被 Session 引用的项目 Room 不可单独硬删除，历史记录优先保留。

## 8. 非持久化数据与提示词装配

当前 `contextJson` 从数据库读取并在每次用户提交时组装为内存中的 Markdown；不会生成 `.data/rooms`、`goal.md` 或其他 Room context 文件。`draftJson` 不进入 Pi 系统提示词。完整 transcript、原始 thinking、未脱敏工具结果、secret、Runtime 句柄、上下文组装结果和模型 Client 不写入 Room。

生成草稿可读取 Pi 当前活动分支中新增的用户消息、assistant 公开输出、可安全提炼的项目变更和现有已确认上下文；不得将原始 thinking 作为总结来源。总结使用固定服务端模型，费用只由规则触发的独立调用产生，不阻断主会话回复。

## 9. 现有数据库与迁移决策

现有 Schema 仍有 `rooms.kind=cross_project`、`room_projects`、`room_contents`、`room_runs`、`tasks`，直接项目 Session 的 `room_id` 可空，Agent/MCP 也可能是无项目实例。本版目标与这些历史记录不兼容。表结构、约束、Repository 和应用代码由实现者修改；是否迁移旧记录由用户决定。

实现前须报告受影响记录类别、无迁移时的运行影响及可选策略；用户确认需要后才交付独立、可审查的脚本，默认不执行。禁止自动清库、静默转换、启动时迁移或用重建数据库规避决策。旧库无法安全写入时应无破坏性地阻止写入并给出诊断；Schema 验证使用临时数据库。
