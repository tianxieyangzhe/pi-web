# SessionMemory 存储改名（已退役）

本文仅说明旧改名脚本的历史用途，不是当前升级步骤。当前设计整体删除 SessionMemory；目标结构和历史数据边界见 [02](../docs/02-data-model.md#4-表数量与模型可读性退役应用记忆) 与 [06](../docs/06-bot.md#52-历史升级与本轮退役)。不得为当前版本先执行该改名脚本，也不得把旧授权视为新迁移授权。以下仅适用于明确选择维护的旧版本。

旧版本代码使用 `session_memories` 和 `sessions.session_memory_id`，已有数据库需要单独离线改名。旧存储没有改名时，新应用以只读方式打开并提示结构不兼容。

先由用户停止服务，再运行只读预览：

```sh
node scripts/rename-session-memory-storage.cjs .data/ai-workspace-v5.sqlite
```

确认执行后增加 `--apply`。脚本先生成完整 SQLite 备份，再在事务内改名表、绑定列和活跃索引/触发器；所有记忆 JSON、草稿、游标、Session ID 和原生 transcript 引用保持原值。历史归档表与其他历史库保留，不重新接入应用。

应用启动不会调用脚本。代码清理不等于删除历史数据；如需删除历史归档，由用户另行决定。
