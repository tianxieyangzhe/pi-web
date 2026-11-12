# 项目生成技能

本目录统一存放生成项目 AGENTS.md 规则时可选择的技能。统一助手的系统提示词润色不使用这些生成技能；本目录不自动启用会话中的技能或工具。

```text
skills/
  create-agentsmd/
    SKILL.md
    LICENSE
  <another-skill>/
    SKILL.md
```

新增技能时创建一个目录，放入完整的 `SKILL.md`。目录名使用小写字母、数字和连字符，最长 100 字符。文件需为 UTF-8、最多 128KiB，不能使用符号链接。YAML frontmatter 中 `name` 必须与目录名一致，`description` 使用非空单行文本（支持普通、单引号或双引号字符串）；其他上游字段原样保留。保留上游许可证，并在本文件记录来源及版本。符合规则的目录会自动出现在生成页，无须修改列表代码。

项目规则设置默认“不使用技能”，可选择 `create-agentsmd` 或其他已安装技能。不选技能时模型直接调查项目；选定时服务端以完整技能指导 Pi 使用 read/grep/find/ls 自主调查，按目标项目的真实 cwd 生成规则，不预采集固定数量文件。技能指导规则生成过程，不直接写入助手系统提示词，不授予工具或项目权限，不运行技能中的命令。用户要求、项目规范和应用正文格式约束优先；缺少依据的章节、占位符和示例命令不得照搬。

## 已收录

- `create-agentsmd`：GitHub `github/awesome-copilot`，MIT 许可证。
  - [上游页面](https://github.com/github/awesome-copilot/blob/main/skills/create-agentsmd/SKILL.md)
  - [下载版本](https://github.com/github/awesome-copilot/blob/b13e55f85ffdf451d40d09839cb1e337bf3eda98/skills/create-agentsmd/SKILL.md)
  - `SKILL.md` 与该版本逐字节一致，未修改。

更新技能请显式替换文件、核对许可证和记录版本。应用不会联网更新技能。
