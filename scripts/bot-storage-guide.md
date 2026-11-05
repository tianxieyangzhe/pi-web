# Bot 数据库增量迁移（历史版本）

本文只适用于旧七表 Bot 版本，不是当前 Workspace 或 SessionMemory 退役的迁移指南。当前目标与历史库处理以 [06](../docs/06-bot.md) 和 [02](../docs/02-data-model.md) 为准；下述旧脚本、结构前置条件和运行步骤不构成当前升级要求或执行授权。

当时应用已增加 Bot → 总对话 → 项目会话的目标结构。已有数据库缺少这七张表时，项目功能仍可使用，Bot 写入会明确提示需要迁移；启动不会自动迁移。

脚本：`scripts/migrate-bot-storage.cjs`。默认只读检查和预览；本次没有执行用户数据库迁移。

## 预览

```sh
node scripts/migrate-bot-storage.cjs .data/ai-workspace-v5.sqlite
```

输出要增加的表以及所有保留表的记录数。若 SessionMemory 尚未迁移、Bot 结构只完成一部分或目标约束不一致，脚本停止，不重建数据库。

## 执行

由用户确认执行后，先停止项目服务，再执行：

```sh
node scripts/migrate-bot-storage.cjs .data/ai-workspace-v5.sqlite --apply
```

脚本检查数据库没有被其他进程打开，创建完整一致 SQLite 备份，单事务新增 Bot 表、约束、索引和触发器，核验旧表记录/结构摘要、数据库与外键完整性。失败回滚新增结构。重复预览识别完整目标结构，不重复迁移。

不修改已有 Project、Session、SessionMemory、记忆草稿、游标、Pi 引用或旧归档；不根据旧记录自动创建 Bot，不访问用户知识目录和源码目录，不删除原表或文件。

## 验证与恢复

迁移成功会输出备份绝对路径。由用户启动项目后，新建 Bot、总对话并选择参与项目角色；原有会话继续在项目下保留。

需要恢复时先停止服务，保留迁移后数据库和对应 Pi 历史，再由用户明确选择备份恢复；脚本不自动覆盖当前数据库。恢复旧库后 Bot 功能不可写，原有项目功能保持可用。
