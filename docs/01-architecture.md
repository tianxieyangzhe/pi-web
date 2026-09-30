# 01｜架构设计

> 状态：**单项目 Room 目标架构，代码尚未按本版重构。** 本版只决定一个 Project 内的 Session 与 Room。跨项目会话以后决定扩表或新增表；现有跨项目代码及旧文档不是本版 Room 的依据。历史数据处理遵循 `02-data-model.md`。

## 1. 架构结论

~~~text
Project
├─ Project Session * ── 1 Project Room
│                         ├─ contextJson：用户确认的当前上下文
│                         └─ draftJson：自动形成、待确认的草稿
└─ Project 资源实例 *       每个实例仅归属本 Project

无项目 Room / 资源 → 模板 → 复制成独立项目实例
~~~

Project 是文件与执行权限边界。项目 Session 绑定一个固定 Project 和一个独有项目 Room；Room 不拥有独立 Pi transcript，不负责 Router、Task 调度或跨项目协调。项目用户消息直接进入 Pi Session。Room 只向后续模型调用提供已确认的文字上下文，并在页面上展示当前内容和自动生成草稿。

Room 相关持久数据只使用 `rooms` 一张表。`Session.roomId` 是唯一、必填的直接引用；不建立 RoomProject、RoomContent、RoomAgent、RoomMcp 或其他关系表。具体字段、JSON 结构和约束以 `02-data-model.md` 为准。

## 2. 资源归属

无项目的 Room、Agent、MCP 及未来工具、扩展、Skill 对象属于模板类。复制到 Project 时产生新的资源 ID，配置和调试独立；模板更新不自动同步项目副本。实际执行只能使用所属 Project 的资源实例。

Room 不保存工具、扩展、Agent、MCP、Skill 的 ID、配置、启用列表、凭据或快照。它们的固定对象模型另行设计，不能暂存于 Room JSON 或建立 Room 资源关联表。项目 Room 的 JSON 只保存 `02-data-model.md` 所定义的已确认会话摘要与待确认草稿。

## 3. Pi 执行与 Room 输入

~~~text
Project Composer
→ Project Session Service：验证 Project、Session、Room
→ 从数据库读取已确认 contextJson
→ 校验并按固定顺序渲染 Markdown
→ Pi before_agent_start：仅本轮加入 system prompt
→ session.prompt(原样用户文本)
→ Pi 原生 transcript 与流式 UI
~~~

Pi Agent 是唯一执行 Runtime。Project Session cwd 固定为 Project.rootPath；原生 SessionManager 保存 transcript，数据库仅持有恢复引用。Room Markdown 在内存中装配，不创建 Room context 文件，不把系统上下文伪装成用户消息。每轮开始时读当前确认内容，正在运行的轮次不随页面编辑变化。

模型是固定服务端基础设施，使用项目根目录 `.env.local` 的 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL_ID`，只兼容 OpenAI Chat Completions。Room、Session、Agent、请求和 UI 均不覆盖模型或凭据。

## 4. 自动形成 Room 草稿

~~~text
Pi 本轮结束并稳定
→ 固定规则检查新增公开对话是否值得总结
→ 必要时：独立、无工具的临时 Pi 总结 Session
→ 校验固定 JSON 和项目边界
→ 写入 Room.draftJson
→ 用户编辑 / 确认 / 拒绝
→ 确认后写入 Room.contextJson
→ 下一条用户请求读取新内容
~~~

总结调用使用数据库中的已确认上下文和 Pi transcript 当前分支的新增安全投影；不使用原始 thinking、未脱敏工具结果或 secret。总结可消耗 Token，但须受输入长度、输出长度、频率和耗时限制。生成失败不阻断主会话回答。

一个 Room 同时只保存一份待确认草稿；用户未处理时，新对话继续保存在 Pi transcript，自动总结不覆盖用户正在编辑的草稿。草稿决议后再增量处理积累的内容。只有用户保存当前内容或确认草稿才使其影响下一次提示词；不建立用户可见内容版本系统。

## 5. 分层与文件职责

~~~text
src/app/                     Next 页面与 Route Handler 入口
src/application/             Session/Room 创建、上下文装配、草稿生成与确认
src/application/ports/       数据库与 Pi Runtime 能力边界
src/domain/                  Room 固定 JSON 结构、关系和状态校验
src/infrastructure/database/ SQLite Schema、Repository、历史库诊断
src/infrastructure/pi/       Pi Session、逐轮 system prompt、无工具总结
src/infrastructure/projects/ 项目文件和路径安全
src/bootstrap/               Application/Infrastructure 装配
web/workspace/workspace.tsx  页面壳与区域装配
web/workspace/use-workspace-state.ts 跨区域选择状态
web/workspace/sidebar/       左侧项目导航、弹窗、表单与导航状态
web/workspace/conversation/  中间画布、输入与消息 UI
  project-session/           项目会话及流式状态
  room/                      现有 Room 视图及状态
web/workspace/files/         文件浏览和预览
web/workspace/inspector/     右侧面板、诊断与资源表单
web/api/                     同源 REST/NDJSON Client
web/domain/                  浏览器端 DTO 与事件类型
web/styles/                  全局视觉样式
~~~

`web/workspace/` 按页面可见区域组织，区域内再按功能分子目录；看左侧功能先进入 `sidebar/`，看中间对话进入 `conversation/`，看文件与右侧检查分别进入 `files/` 和 `inspector/`。区域专用组件、表单与 Hook 同目录。`workspace.tsx` 维护区域装配，`use-workspace-state.ts` 维护跨区域选择；通用 API Client、DTO 和全局视觉样式保留在公共层。

依赖方向为 `app → application → domain + ports`、`infrastructure → ports + domain` 和 `app → web/workspace → web/api + web/domain`。只有 composition root 同时认识应用服务与基础设施。`page.tsx` 和 `route.ts` 只做入口与装配，不承载完整业务实现；页面不直接访问 Pi、SQLite 或 Node 文件系统。

Next.js 同时提供页面和同源 API；不增加独立 Vite 服务或第二个浏览器端口。文件树、预览与 Git 变化仍由独立项目 API 读取；目录列表不依赖 Git 状态。

## 6. AI Elements 组件治理

新增或改造前端组件前，先检索官方 AI Elements 组件。语义匹配时优先经 Feature Wrapper 映射领域 DTO；组件库不能决定 Room 的字段或协议。当前选型：

| 场景 | 组件语义 | 现有例外或替代 |
| --- | --- | --- |
| Session 消息与 Markdown 回复 | Conversation / Message / Response | 现有 `web/workspace/conversation/ai-elements/response.tsx` 提供安全 Markdown 子集；官方依赖可用后复核替换 |
| Pi 轮次与真实工具调用 | Reasoning / Tool | 原始 thinking 不下发；`activity-groups.tsx` 用原生 disclosure 展示公开摘要和真实工具记录，默认收起；官方组件可接受公开摘要语义后复核 |
| Room 草稿审查 | Confirmation / 编辑表单 | 草稿确认经 Room Feature Wrapper 映射；在实现前复核官方 Confirmation 能否承载整体 JSON 差异与编辑 |
| Project 导航折叠 | 通用导航触发器 | 官方 AI Elements 无匹配通用 App Shell Sidebar Trigger；沿用原生按钮与现有图标，导航重做时复核 |
| 项目文件树与预览 | File Tree / Code Block | 只读且受 Project Path Guard 约束；Git 只是可选状态 |
| 项目或 Room 模板选择 | 资源选择弹窗 | 选择并复制 Project/模板不等于模型操作审批；沿用 Feature 层弹窗，官方组件有匹配语义时复核 |
| Project 新建/编辑/删除弹窗 | 普通表单 / 确认弹窗 | 本轮检索现有 AI Elements 组件与依赖，未发现适合项目资料编辑的组件；沿用 `web/workspace/sidebar/project-dialog.tsx` 与同目录项目表单。官方出现匹配的通用表单弹窗时复核 |
| 项目导航与检查区域容器 | 通用应用布局 | AI Elements 不提供应用列容器语义；沿用 `web/workspace/sidebar/project-navigation.tsx` 和 `web/workspace/inspector/context-panel.tsx`。引入统一 App Shell 组件时复核 |

AI Elements 不承担 API、NDJSON 解析、持久状态或权限校验。Tailwind CSS 与现有项目样式系统承载视觉样式。

## 7. 安全与关键不变量

1. 项目 Session、项目 Room 和执行资源必须属于同一 Project；模板 Room 与资源模板不可直接执行。
2. 项目 Session 的 `roomId` 唯一且不可变；一个项目 Room 只服务一个 Session。
3. Room `contextJson` 是唯一可进入后续系统提示词的 Room 事实；`draftJson` 只用于审核。
4. Room 的 `outputs` 用于展示，Room 不选择或授权工具、Agent、MCP、Skill 和扩展。
5. 用户消息属于 Pi 原生 transcript；Room 不保存完整 transcript 或原始思维链。
6. Room 数据只存数据库，上下文组装只在内存中存在；不创建 `.data/rooms` 或本地 Room 文件。
7. 同一 Session 同时最多一个 active turn；同一 Room 至多一个生成任务和一份待确认草稿。
8. Room Schema 变更必须兼顾历史记录，数据迁移是否执行由用户决定。

## 8. 跨项目与旧模型

本版不定义跨项目 Room 的数据表、Router、RoomRun、Task、Synthesizer 或 UI；后续独立决定扩表还是新表。现有跨项目实现和 `RoomProject/RoomContent` 等旧表可能仍在代码及用户数据库中；实现本版时须先进行无破坏影响评估，不能自动删除或把旧记录解释为新的单项目 Room。
