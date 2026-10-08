# SessionMemory 存储改名

新代码使用 `session_memories` 和 `sessions.session_memory_id`，已有数据库需要单独离线改名。旧存储没有改名时，新应用以只读方式打开并提示结构不兼容。

先由用户停止服务，再运行只读预览：

```sh
node scripts/rename-session-memory-storage.cjs .data/ai-workspace-v5.sqlite
```

确认执行后增加 `--apply`。脚本先生成完整 SQLite 备份，再在事务内改名表、绑定列和活跃索引/触发器；所有记忆 JSON、草稿、游标、Session ID 和原生 transcript 引用保持原值。历史归档表与其他历史库保留，不重新接入应用。

应用启动不会调用脚本。代码清理不等于删除历史数据；如需删除历史归档，由用户另行决定。
