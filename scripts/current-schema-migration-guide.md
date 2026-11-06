# 当前7表离线迁移

契约：`docs/02-data-model.md` §11.2（DBUP-002）。不属于应用启动流程，不启停服务，不调用模型或Pi。

只读预检：

```sh
node scripts/migrate-current-schema.cjs
```

仅支持脚本固定摘要所对应的已知14表来源。预检输出来源结构/完整数据摘要、目标结构/数据摘要、保留行数、归档文件和Agent版本映射、planSha256。未知结构、其他打开连接、目标文件已存在、版本摘要不一致及约束失败均拒绝。

在用户明确授权本目标且核对预检后执行：

```sh
node scripts/migrate-current-schema.cjs .data/ai-workspace-v5.sqlite --apply <planSha256>
```

旧库完整备份、所有旧Agent版本及manifest写到数据库旁的`.current-schema-<UUID>`目录，备份与文件设为0400。保留7表内全部项目/会话/工作区数据；删除退役表及协调Agent；项目Agent生成新不可变版本（原正文不变，仅移除退役能力键并更新版本），对应Session绑定映射，nativeRef完全不变。SQL在原库单事务完成，完整性、外键、逐行投影、版本摘要均成功才提交。

失败回滚SQL，保留归档及已生成候选文件以供核对，禁止盲目重试或覆盖候选。已是目标结构时重复运行只读返回current。恢复旧版本须先停用新写入并单独决定，不能在已有新数据后直接覆盖。保留迁移输出与manifest用于审计；它们包含本机路径，应按本地管理资料处理。

测试：`node --test tests/current-schema-migration.test.cjs`，仅临时数据库/文件。
