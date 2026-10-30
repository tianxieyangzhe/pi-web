# Bot 六表与角色迁移

当前目标包含六张 Bot 运行表，以及 Agent 定义和 Session 直接父归属。原 `bot_conversation_sessions` 保留为只读历史表，不参与新调度。用户已授权本轮自行完成迁移。

独立脚本默认预览：

```sh
node scripts/migrate-bot-v2.cjs .data/ai-workspace-v5.sqlite
```

离线执行：

```sh
node scripts/migrate-bot-v2.cjs .data/ai-workspace-v5.sqlite --apply
```

执行前校验 3000 服务及 SQLite 无打开连接；备份一致数据库，再在单事务重建目标表、映射 Session 归属及执行/消息引用。旧协调正文、执行渲染、消息类型、角色 extension/policy 和全部记忆/原生引用保留。核对每行全部字段、关系、外键及完整性；错误回滚，不创建替代数据库。

迁移不会初始化 OpenCode 角色。已有 Bot 和会话显示待配置，历史仍可读；配置协调/项目角色后新请求才能执行。旧在途/不明执行先核对，脚本拒绝自动重放；缺正式快照的旧排队记录保留并暂停。

原七表脚本使用冻结的 `scripts/bot-schema-v1.sql`，只用于旧阶段迁移，不能用于本次角色和六表升级。空库由当前 Schema 初始化，已有数据库不启动隐式迁移。

备份路径由脚本输出。需要恢复时保留迁移后库及 Pi 文件，停止服务后再明确选择备份恢复；脚本不自动覆盖当前库。
