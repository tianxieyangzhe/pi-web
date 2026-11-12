# 助手版本目录

应用生成及自定义助手的版本文件统一保存在此目录：

```text
agents/<agentId>/<revision>/AGENTS.md                            # 独立项目
agents/<agentId>/<revision>/workspace/AGENTS.md                  # 工作区自身
agents/<agentId>/<revision>/projects/<项目ID的SHA256>/AGENTS.md # 工作区内项目
agents/<agentId>/<revision>/definition.json
```

文件由助手保存 API 管理。`AGENTS.md` 仅保存原始 Markdown 正文，不添加 XML 组织标签或转义字符。新版本的 `definition.json` 使用 format 5 保存范围、来源、文件位置及各文件摘要；每个工作区项目和工作区自身各有独立正文，不复制为合并文件。XML 只在调用模型时按项目关系组装。元信息与所有正文共同受到版本摘要校验，旧版本格式仍可读取。请通过应用编辑并保存新版本，不直接改写已有版本。

`AI_WORKSPACE_AGENT_DIR` 可显式覆盖此默认目录。未设置时，读取历史版本仍兼容 `.data/agents/`，但新版本只写入 `agents/`。应用不自动搬迁、修改或删除历史文件。

项目根目录的 `AGENTS.md` 是开发契约，不是用户助手文件。生成技能另存于 `skills/`。

此目录的用户助手版本被 Git 忽略，仅此说明文件纳入版本控制。备份应用数据时请同时备份数据库、`.data/` 和 `agents/`（使用自定义目录时备份对应目录）。

当前统一助手（ASSIST-011）只保存 `agents/<assistantId>/<revision>/definition.json`，存储 format 6；其中含系统提示词方式、替换正文及作用范围，不生成助手 AGENTS.md。
项目规则单独保存在 `agents/project-rules/<归属键SHA256>/<revision>/AGENTS.md`，对应目录的 `state.json` 记录所属项目（工作区项目包含 workspaceId）、当前版本和启用开关。首次生成默认关闭，重新生成保留开关。历史助手目录仅兼容读取，不自动搬迁规则。

项目目录的 `generations/<UUID>.json` 保存后台规则生成任务与幂等、进度和终态。任务独立于页面连接；未完成任务在应用重启后核对结果或标记中断，不自动重新调用模型。技能可选，未选时由模型在项目目录使用读取工具自主分析。
