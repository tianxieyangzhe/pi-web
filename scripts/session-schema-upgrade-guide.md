# 显式会话数据库升级

适用需求：DBUP-001、SREM-003、GAP-001；历史字段映射唯一来源为 [02 §11.1](../docs/02-data-model.md)。脚本为 [upgrade-session-schema.cjs](upgrade-session-schema.cjs)，不随应用启动执行。

脚本准备与正式执行分别记录。用户已明确要求“直接迁移数据库”，本次执行结果见文末；该授权只覆盖本次目标，后续升级仍须单独确认。GAP-006 与 06 保持原范围。

## 旧数据影响与选项

可以暂缓迁移，继续只读历史；应用写操作保持 SCHEMA_INCOMPATIBLE。选择执行时，脚本先生成完整 SQLite 只读备份归档，再在原数据库文件内执行一个排他事务：退役 session_memories、移除项目和工作区会话的记忆绑定、移除 sessions.state/status，增加历史值为 NULL 的创建键列，采用当前目标约束。agents 因摘要约束加强需要表重建，所有原列值保留。

所有保留列逐值比对；会话、项目、工作区、Agent、Bot 历史和调用记录不丢弃。记忆/模板正文、草稿、旧绑定和旧状态留在完整备份内，不映射成新摘要或会话名称。Pi transcript、Agent Markdown 和请求 journal 不读取或改写。不会启动或停止用户服务。

预检只支持 scripts/historical-schema 的完整冻结来源；自定义表/索引/触发器、不同历史版本、未终结运行状态、生命周期冲突及目标约束不符均阻止迁移，不自动修复。

## 可审查的执行方式

在仓库根目录运行只读预检（不创建备份或迁移锁）：

```bash
node scripts/upgrade-session-schema.cjs .data/ai-workspace-v5.sqlite
```

返回 ready/current/blocked、来源及目标 SHA-256、表行数、退役列和阻塞原因；失败原因仅含表名、记录 ID 和错误码，不输出历史正文。blocked 不可应用。

用户确认后，需自行关闭使用此数据库的服务和工具连接；脚本会用 lsof 核验数据库、WAL 和 SHM，无需助手操作服务。将本次 ready 输出的摘要填入以下命令，不复用过期预检结果：

```bash
node scripts/upgrade-session-schema.cjs .data/ai-workspace-v5.sqlite \
  --apply \
  --expect-source <预检的sourceSha256> \
  --expect-target <预检的targetSha256>
```

任一摘要变化时停止，重新预检和审查。已是精确目标时，重复调用只读返回 current，不重复创建归档。

## 归档、验证与失败处理

归档目录为数据库路径加 `.session-upgrade-<UUID>/`，目录权限 0700，包含 `before.sqlite` 和 `manifest.json`，文件只读。manifest 记录来源/目标摘要、表行数和完整备份文件 SHA-256。备份文件、manifest 和目录均 fsync；备份须能只读打开并与预检来源逐表核验后，才修改原库。归档包含完整历史内容，应与数据库采用相同访问边界。

升级同时持有 `.session-upgrade-lock` 目录锁及 SQLite EXCLUSIVE 事务；再次检查来源与归档一致，提交前验证目标对象、保留列值、外键和完整性。正常失败回滚整个事务并保留归档；锁正常退出时删除。若硬退出留下锁，先确认进程和数据库连接、检查 SQLite 恢复结果与归档，再由用户决定处理，脚本不破锁、不截断现场。

成功返回 migrated 与 archive 路径，应用后续初始化能识别目标库。SQLite ALTER TABLE 自动为表名添加的双引号属于等价结构，兼容检查仅规范这一处语法差异，仍逐项检查索引与触发器。

恢复旧库需要离线选择归档并同时使用兼容旧结构的应用版本。若迁移后已有新写入，不能用旧备份直接覆盖；应先保全当前库并审查新旧差异。脚本不提供自动回退覆盖或清库操作。

## 本次真实库只读预检

准备时结果为 ready，阻塞项为零；有 6 个独立项目、5 个 Agent、8 个项目会话、1 个工作区会话及 9 条待归档记忆记录。此结果只证明当时快照，实际执行仍须重新预检，源数据或目标 SQL 变化会使摘要失效。用户明确确认后已重新预检并执行，结果见下。

## 正式执行结果

数据库 .data/ai-workspace-v5.sqlite 已原库内事务升级，返回 migrated；再次只读预检为 current。运行时目标结构兼容、完整性 ok、外键错误 0，所有保留列值比对一致。项目6个、Agent5个、独立项目会话8个、工作区会话1个均保留。

完整只读归档目录：.data/ai-workspace-v5.sqlite.session-upgrade-34c046da-4f87-427d-8554-cfcee4766fdc/。备份 before.sqlite 中9条记忆记录已核验，manifest.json 记录来源/目标摘要与表行数。

- 来源摘要：15f005c7e038263a22e942d0796e552d90b2947a38387aba653b6d10d9e3c5b0
- 目标摘要：e7bee0c5415d7bd99a769b993b855b2eaa20153b021d2be53c25126c59759889
- 备份文件摘要：25d446b60a71a5616834a4a6ec24e3a5e398987f609f071249a70c7a8e3c4d8e

此次未操作用户服务启停、Pi历史、配置、Agent Markdown或请求journal。
