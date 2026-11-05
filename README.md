# Pi Web

Pi Web 是基于 [Pi Coding Agent](https://github.com/badlogic/pi-mono) 的网页工作台，用于在浏览器中管理本机项目、工作区和持续的 AI 编程会话。页面与 API 由 Next.js 提供，Pi 是唯一的 Agent Runtime，业务记录保存在本地 SQLite，消息和会话分支保存在 Pi 原生会话文件中。

适合在自己的电脑或 Linux 服务器上运行，让 AI 在指定项目目录内读取文件、执行工具，并保留可恢复的对话历史。

## 项目作用

- **独立项目**：登记本机项目目录，在项目下创建和恢复多个独立会话。
- **工作区**：将多个项目目录放入同一工作区，在一个工作区会话中处理跨项目工作。
- **会话管理**：查看完整 Pi 会话树与分支、历史消息、思考内容、工具调用及结果；支持停止、关闭后重开、派生、导出和删除会话记录。
- **会话设置**：切换模型与思考等级，查看上下文用量，手动压缩上下文。
- **文件查看**：浏览项目文件，预览内容并定位回复中的源码链接。
- **本地部署**：开发模式、生产模式与 Linux systemd 运行方式。

当前功能完整检查点不包含 Agent 与 MCP 管理能力的整体验收。项目不再使用 SessionMemory 或后台对话总结。

## 环境要求

- Node.js **22.19.0 或以上**，以及 npm。
- Git。
- 至少一个可用模型及对应认证。
- 对应用目录和要操作的项目目录具有相应权限。
- Linux 使用 systemd 部署时，需要 systemd 和 Bash。

`better-sqlite3` 包含原生模块。如果当前平台无法使用预编译包，需要安装 Python 3 和 C/C++ 编译工具链；Debian/Ubuntu 可安装 `python3`、`make`、`g++`。

本应用按单用户、单进程、长驻 Node 服务设计。请在自己控制的访问范围内运行；需要面向不可信网络开放时，应先在反向代理等入口配置访问控制。

## 初始化项目

### 1. 克隆并安装依赖

```bash
git clone git@github.com:tianxieyangzhe/pi-web.git
cd pi-web
npm ci
```

后续命令均在这个项目根目录执行。构建需要开发依赖，首次安装不要使用 `npm ci --omit=dev`。

### 2. 配置模型

应用不需要 `.env` 文件。模型配置使用 Pi 的 `models.json` 和 `settings.json`，分别按以下规则选择来源：

| 配置 | 优先位置 | 本地文件不存在时 |
| --- | --- | --- |
| 模型与供应商 | 项目根目录 `models.json` | `~/.pi/agent/models.json` |
| 默认模型与启用范围 | 项目根目录 `settings.json` | `~/.pi/agent/settings.json` |

两个文件各自独立选择，使用整份文件，不合并本地与全局内容。本地文件损坏会报错，不会自动改用全局文件。配置根目录以启动时的 `INIT_CWD` 或当前工作目录为准，请始终从项目根目录启动。

如果已经配置好全局 Pi 模型和默认设置，可以直接使用。如果是全新安装，可复制仓库示例：

```bash
cp examples/pi/models.json models.json
cp examples/pi/settings.json settings.json
```

只在本地没有对应配置时复制，已有配置不要覆盖。示例为占位配置，必须编辑后才能调用模型：

1. 修改 `models.json` 中的 `baseUrl`、API 协议和模型 `id`，填写供应商支持的上下文容量与输出上限；推理、图片输入等能力也应与真实模型一致。
2. 修改 `settings.json` 的 `defaultProvider`、`defaultModel`，与 `models.json` 中的供应商键和模型 ID 对应。
3. 根据需要调整 `enabledModels`；示例的 `example/*` 只允许 `example` 供应商的模型。省略或空数组表示不限制。
4. 配置模型认证。支持 Pi 原生认证；也可以像示例一样，在 `apiKey` 中引用环境变量名。

示例配置引用 `PI_EXAMPLE_API_KEY`，使用时在启动服务的同一 shell 中设置：

```bash
export PI_EXAMPLE_API_KEY='替换为实际 API Key'
```

环境变量引用仍然有效，不需要为此新建 `.env`。使用全局 Pi 认证时，认证来自运行用户的 `~/.pi/agent/auth.json`；切换运行用户后需要使用该用户自己的配置与认证。不要将真实密钥或带凭据的本地配置提交到 Git。

### 3. 初始化数据

**全新安装无需手动建库或执行迁移脚本。** 首次运行并访问应用时，会在项目根目录的 `.data/ai-workspace-v5.sqlite` 创建 SQLite 数据库并初始化目标表结构。

如果应用目录中已有历史数据库，会先检查兼容性；不兼容时阻止写入，不自动迁移、清库或重建。历史升级按 [会话 Schema 升级指南](scripts/session-schema-upgrade-guide.md) 单独预检、备份并明确执行。

## 开发启动

```bash
npm run dev
```

浏览器访问：<http://localhost:3000>。

开发脚本默认监听 `localhost:3000`。如需绑定其他本机IP，可使用 `npm run dev -- --hostname 192.168.1.10`；监听全部IPv4网卡则使用 `--hostname 0.0.0.0`。开发模式用于调试与热更新，长期部署请使用生产模式。

## 生产构建与启动

先构建：

```bash
npm run build
```

构建成功后启动：

```bash
npm start
```

默认监听 `localhost:3000`，本机使用 <http://localhost:3000>。显式指定本机IP后，其他设备使用 `http://服务器IP:端口` 访问；指定 `--hostname 0.0.0.0` 可监听全部IPv4网卡。前台运行时用 `Ctrl+C` 停止。

如需绑定某个本机地址或更换端口，可显式指定：

```bash
npm start -- --hostname 192.168.1.10 --port 3100
```

更换端口时替换 `3000`。`npm start` 需要已有生产构建，修改代码后需重新构建。不要同时运行多个实例操作同一份应用数据。

## 使用 systemd 长期运行

在 Linux 上，先按前面的步骤完成依赖安装、模型配置和生产构建，再以实际运行用户执行：

```bash
# 查看将生成的用户服务配置
npm run systemd -- render

# 安装 unit 并重新加载 systemd 配置，不自动启动
npm run systemd -- install

# 启动服务并设置自启
systemctl --user enable --now ai-workspace.service

# 查看状态和实时日志
systemctl --user status ai-workspace.service
journalctl --user -u ai-workspace.service -f
```

默认监听 `localhost:3000`，默认使用当前 Node 的绝对路径。可用 `--port`、`--host`、`--name` 调整生成的服务配置。

systemd 不继承当前交互式 shell 的环境变量。配置中引用 API Key 环境变量时，可在启动前执行 `systemctl --user edit ai-workspace.service`，为该服务添加覆盖配置：

```ini
[Service]
Environment="PI_EXAMPLE_API_KEY=替换为实际APIKey"
```

保存后执行 `systemctl --user daemon-reload`，再启动服务；已运行的服务需要重启才能读取新环境。也可使用服务运行用户已有的 Pi 原生认证，无需添加此覆盖配置。

需要退出登录后继续运行并随机器启动，由管理员执行：

```bash
sudo loginctl enable-linger <运行用户名>
```

系统级服务、环境与权限说明、覆盖已有 unit、停止和卸载步骤见 [systemd 使用指南](scripts/systemd-guide.md)。

## 首次使用

1. 打开网页，新建独立项目并选择真实项目目录；或新建工作区，添加项目目录并选择默认项目。
2. 新建会话，等待连接成功后输入消息。
3. 使用“文件”查看项目内容，使用“会话检查”查看会话树、模型、思考等级和上下文。
4. 左侧会话列表显示最后一次用户输入的截断预览，以及最后一次成功打开时间。

会话的关闭与删除是不同操作：关闭后可继续打开同一会话；删除会话记录会移除应用中的记录，保留磁盘上的 Pi 历史文件和项目文件。

## 数据保存与升级

需要保留的数据包括：

- 项目目录下的 `.data/`：SQLite、版本化 Agent 文件、操作 journal、最后打开时间等应用数据。
- Pi 原生会话文件：会话记录按精确文件与身份恢复，文件位置由 Pi 和应用保存的引用决定。
- 运行用户的 Pi 配置与认证，以及实际项目目录。

备份时不要只复制 SQLite 而遗漏对应的 Pi 原生会话文件。移动应用或更换用户前，检查文件权限和历史引用的路径是否仍可访问。

更新已部署的用户服务时，先停止服务，再更新代码、安装依赖和构建，最后启动：

```bash
systemctl --user stop ai-workspace.service
git pull --ff-only
npm ci
npm run build
systemctl --user start ai-workspace.service
```

历史库迁移单独按指南处理，不是上述启动步骤的一部分。

## 常用检查

```bash
# TypeScript 类型检查
npm run typecheck

# 按修改范围运行具体测试文件，例如 systemd 脚本测试
node --test tests/systemd-scripts.test.cjs
```

日常开发按改动范围运行定向测试；`npm test` 会运行全部测试文件。

## 目录与文档

```text
src/app/               Next.js 页面与 API 入口
src/application/       用例与端口
src/domain/            模型与领域规则
src/infrastructure/    SQLite、Pi、文件及持久化实现
src/bootstrap/         服务装配
web/                   浏览器界面与 API Client
examples/pi/           模型配置示例
scripts/               部署、历史迁移及维护脚本
tests/                 定向测试
docs/                  设计契约与验收记录
```

详细设计见 [架构](docs/01-architecture.md)、[数据模型](docs/02-data-model.md)、[交互与 API](docs/03-interaction-logic.md)、[页面布局](docs/04-ui-layout.md)、[需求与验收](docs/05-requirements.md)；工作区与 Bot 专属规则见 [工作区与 Bot](docs/06-bot.md)。
