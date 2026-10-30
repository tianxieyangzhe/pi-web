# Agent Markdown / Bot 绑定迁移 v3

该迁移把当前六表 Bot 库升级为独立 Markdown Agent 目录和 Bot 项目角色关系。应用启动不会自动执行；用户库已于 2026-10-13 经用户明确授权完成离线迁移。

迁移新增 agents.content_sha256 目录索引列和四张关系表：bot_projects、bot_project_agents、bot_conversation_projects、bot_conversation_project_agents。Agent 定义正文仍留在历史 definition_json/extension_json 列中作为只读材料；迁移不生成 Agent.md，不调用 LLM，不创建正式 Agent，也不启用旧工具权限。

历史 bot_conversation_projects 从已有 sessions.bot_conversation_id 的 Project 关系去重生成，表示旧会话已实际纳入的项目范围。bot_projects 留空，避免历史 Project 并集扩大未来会话权限；bot_project_agents 与 bot_conversation_project_agents 留空，避免把旧 Agent owner/name 自动解释成新绑定。用户需在 Bot 配置中明确选择协调 Agent、当前 Project 集合和各 Project Agent。

先预览（默认只读）：

~~~sh
node scripts/migrate-agent-markdown-v3.cjs /path/to/ai-workspace-v5.sqlite
~~~

只有服务已停止、数据库确认离线且预览符合预期后，用户才可明确传入 --apply。执行会先创建不覆盖的 `.before-agent-markdown-v3.bak` 备份；数据库已有同名备份时停止。脚本会检查除迁移脚本自身以外的数据库打开连接和 3000 端口，不启动/停止服务；应用迁移后核对原表所有既有列值、外键与 integrity_check。迁移失败回滚 SQLite 事务，保留备份和旧记录。

应用升级后，历史无 content_sha256 的角色只读展示并标为待转换；只有用户通过 Agent 编辑对话明确转换并保存，才创建新 Agent Markdown 版本。旧 Bot/Session/Execution 快照和 Pi transcript 不回填、不覆写。

2026-10-13 用户库执行记录：迁移前预览为 2 Projects、0 Agents、1 Bot、0 BotConversations、4 Sessions、4 SessionMemories；新增 `agents.content_sha256` 和四张关系表。备份 `.data/ai-workspace-v5.sqlite.before-agent-markdown-v3.bak` 可正常打开且检查通过；旧表行值无变化，迁移后完整性和外键检查通过。旧 Agent 未激活，Bot 默认项目及 Agent 关系保持空。
