# Pi Web

基于 Pi Coding Agent 的网页工作台，支持独立项目、跨项目工作区和可恢复的 AI 编程会话。Next.js 提供页面与 API，SQLite 保存业务记录，Pi 原生文件保存对话和会话分支。

## 1. 开发说明

需要 Node.js **22.19.0 或以上**、npm、Git 和 Bash，以及可用模型和认证。应用按可信单用户、单进程设计，运行用户需要有应用及项目目录的访问权限；公网部署应在入口配置访问控制。

克隆并安装完整依赖：

```bash
git clone git@github.com:tianxieyangzhe/pi-web.git
cd pi-web
npm ci
```

`better-sqlite3` 使用原生模块；如果没有匹配的预编译包，Ubuntu 需要安装 `python3`、`make`、`g++`。

### 模型配置

开发时从项目根目录启动。`models.json` 和 `settings.json` 各自独立选择来源，本地文件存在时整份使用，不合并全局内容：

| 配置 | 项目根目录 | 本地文件不存在时 |
| --- | --- | --- |
| 模型与供应商 | `models.json` | `~/.pi/agent/models.json` |
| 默认模型与启用范围 | `settings.json` | `~/.pi/agent/settings.json` |

全新配置可复制示例；已有文件不要覆盖：

```bash
cp examples/pi/models.json models.json
cp examples/pi/settings.json settings.json
```

编辑示例中的供应商、`baseUrl`、API 协议、模型 ID、上下文容量及输出上限。`settings.json` 的 `defaultProvider`、`defaultModel` 应与模型配置对应；`enabledModels` 可限制可选模型，省略或空数组表示不限制。

认证使用运行用户的 `~/.pi/agent/auth.json`，或在模型配置中引用环境变量。示例引用 `PI_EXAMPLE_API_KEY`，在启动前设置：

```bash
export PI_EXAMPLE_API_KEY='替换为实际 API Key'
```

模型配置不依赖 `.env` 文件。不要将真实密钥或带凭据的配置提交到 Git。

### 联网搜索

输入框提供一个搜索下拉选择，默认选择内置搜索：

- **内置搜索 · 服务端**：默认开启，需要使用支持 `web_search` 的 OpenAI Responses 模型（`api: "openai-responses"`）；搜索由供应商执行，不支持时可关闭。
- **工具搜索 · 应用端**：只提供 `web_fetch`，直接使用运行机器的网络。有网址时抓取网页并提取正文；没有网址时模型提供查询词，从 `bing.com` 获取搜索结果，再读取相关链接。无需搜索 API Key，也不需要额外服务。
- **无搜索**：不启用上述两种搜索。

`web_fetch` 使用单一必填参数 `input`：`{"input":"https://example.com/article"}` 直接读取网址，`{"input":"最新科技新闻","maxResults":3}` 查询 Bing。旧 `url`／`query` 参数会在执行前归一化，已有会话历史保持原样。

应用部署在 Ubuntu 上，应用端联网就使用 Ubuntu 的网络出口。需要代理时，在运行应用的服务器环境设置，例如：

```bash
export HTTPS_PROXY='http://127.0.0.1:7890'
export HTTP_PROXY='http://127.0.0.1:7890'
export NO_PROXY='localhost,127.0.0.1,::1'
pm2 restart ai-workspace --update-env
```

代理地址必须是 Ubuntu 自己能够访问的地址；`127.0.0.1` 表示 Ubuntu 本机，不是打开网页的个人电脑。开发时可在项目根目录 `.env.local` 设置这些变量并重启开发进程。未配置代理时直接连接，不更改系统代理或模型配置。

每次发送只启用选中的方式，切换会话后恢复默认内置搜索。应用端工具每轮最多 8 次调用，单次超时 20 秒，响应上限 2MiB；只读取公开网页，不执行网页脚本。Bing 验证码、访问限制、搜索页格式变化以及需要 JavaScript 的网页会明确报错，不切换额外搜索服务或伪造结果。

### 会话滚动与自动压缩

项目与工作区会话均在单击会话（含当前会话）和提交提示词后自动滚到底部；历史加载完成后仍定位在底部。位于底部时跟随后续内容，上翻阅读或定位历史节点时暂停，再次点击会话或发送后恢复跟随。

业务 Session 的 Pi 原生自动压缩始终开启，使用当前 Pi 版本的默认参数，没有关闭入口。保留手动压缩按钮，压缩记录和完整历史仍由所属 Pi 会话管理。此策略无需修改数据库或用户配置。

上述变更须重新构建发布并重启生产进程后生效；发布步骤见下文，保留原有数据、Pi 原生历史与请求 journal。

### 启动与检查

```bash
npm run dev
```

默认访问 <http://localhost:3000>。远程开发时，可在项目根目录 `.env.local` 配置浏览器访问使用的 IP 或域名：

```dotenv
AI_WORKSPACE_ALLOWED_DEV_ORIGINS=106.12.15.161,dev.example.com
```

多个来源用逗号分隔，不带协议、端口或路径；支持 `*.example.com`，不支持单独的 `*` 或 `**`。修改后重启，再监听全部 IPv4 网卡：

```bash
npm run dev -- --hostname 0.0.0.0
```

该配置只控制开发资源及热更新的来源校验。开发模式首次访问会编译路由，生产部署使用下文的构建产物。

全新安装无需手动建库，首次访问相关 API 时自动创建 `.data/ai-workspace-v5.sqlite`。已有库不兼容时会阻止写入，不自动迁移或重建；历史升级见 [会话 Schema 升级指南](scripts/session-schema-upgrade-guide.md)。

开发检查按改动范围执行：

```bash
npm run typecheck
node --test tests/standalone-release.test.cjs
```

详细设计见 [架构](docs/01-architecture.md)、[模型](docs/02-data-model.md)、[API](docs/03-interaction-logic.md)、[页面](docs/04-ui-layout.md)、[需求](docs/05-requirements.md)及[工作区与 Bot](docs/06-bot.md)。

## 2. 构建不包含 node_modules

在与生产环境兼容的 Linux 构建机或 CI 中执行，构建机须安装完整依赖：

```bash
npm ci
npm run release -- --without-node-modules
```

生成的 `release/` 包含：

```text
release/
├── server.js
├── .next/              # 编译产物和静态资源
├── runtime/database/   # SQL 运行资源
├── package.json
├── package-lock.json
├── scripts/            # 部署辅助工具
├── release.json
└── RUN.txt
```

如果项目有 `public/`，也会一并复制。发布包不包含 `node_modules`、应用 TS/TSX 源码、用户 `.data`、模型配置、认证或环境文件。

输出目录已存在时拒绝覆盖。后续可重新构建并打包到一个新的目录：

```bash
npm run build
node scripts/package-release.cjs /新的/输出目录 --without-node-modules
```

打包默认输出并传到服务器：

```bash
tar -czf ai-workspace-release.tar.gz -C release .
scp ai-workspace-release.tar.gz 用户名@服务器IP:/tmp/
```

首次部署，在服务器准备固定发布目录，例如 `/opt/ai-workspace`，由运行用户解压并安装生产依赖：

```bash
mkdir -p /opt/ai-workspace
cd /opt/ai-workspace
tar -xzf /tmp/ai-workspace-release.tar.gz
npm ci --omit=dev
```

运行用户需有该目录写入权限。服务器需要兼容的 Node.js、npm、Git、Bash 和依赖下载网络连接，无需应用源码或再次执行 `npm run build`。原生依赖由服务器安装；缺少预编译包时需要编译工具，不要使用 `--ignore-scripts` 跳过安装。应用产物仍建议在兼容的 Linux/Node 环境构建。

在发布目录单独放置 `models.json`、`settings.json`，或使用运行用户的全局 Pi 配置与认证；规则与开发环境相同。然后按下文用 PM2 启动。

## 3. PM2 后台运行

### 安装与启动

以实际运行用户安装 PM2：

```bash
npm install -g pm2
```

进入发布目录启动，路径替换为实际位置：

```bash
cd /opt/ai-workspace
NODE_ENV=production INIT_CWD=/opt/ai-workspace HOSTNAME=0.0.0.0 PORT=3000 \
  pm2 start server.js --name ai-workspace --cwd /opt/ai-workspace --time
```

浏览器访问 `http://服务器IP:3000`，服务器安全组及防火墙需允许对应访问。`INIT_CWD` 与 `--cwd` 指向同一个固定发布目录；Pi 配置、认证和文件访问均使用该运行用户的环境。模型引用的 API Key 环境变量须在启动前设置。

此命令以单个 fork 实例运行，退出 SSH 后继续运行，异常退出时自动重启。**不要使用 `-i max` 或 cluster 模式，也不要同时启动第二个服务进程操作同一份数据。**

### 常用命令

```bash
# 状态及日志；Ctrl+C 只退出日志查看
pm2 status
pm2 logs ai-workspace --lines 100

# 重启
pm2 restart ai-workspace

# 修改环境变量后重启
HOSTNAME=0.0.0.0 PORT=3000 pm2 restart ai-workspace --update-env

# 停止，保留进程配置
pm2 stop ai-workspace

# 移除进程配置，不删除应用数据
pm2 delete ai-workspace
```

PM2 按用户隔离，始终用同一用户管理。后台运行不等于开机自启：`pm2 save` 保存进程列表，服务器重启后可用同一用户执行 `pm2 resurrect` 恢复；`pm2 save` 本身不设置自启。Ubuntu 的 `pm2 startup` 通常使用 systemd，不需要时无需执行。进程快照可能包含环境凭据，保护好 `~/.pm2`；更新列表或环境后需要重新保存。使用 nvm 更换 Node 后，核对 PM2 与应用的 Node 版本。

### 更新与数据保留

先在服务器停止应用：

```bash
pm2 stop ai-workspace
```

将新包解压到同一发布目录，替换程序产物，保留现有运行数据和配置。依赖清单或锁文件变化、依赖不完整或 Node ABI 变化时，重新安装依赖后启动：

```bash
cd /opt/ai-workspace
npm ci --omit=dev
pm2 restart ai-workspace
```

`package.json`、`package-lock.json` 和 Node ABI 均未变化且依赖完整时，可保留已有 `node_modules` 并跳过安装。`npm ci` 会重建依赖目录，只在停服后执行；不使用会让新旧进程重叠的零停机 reload。

部署路径保持稳定，更新和备份时保留：

- `.data/`：SQLite、Agent Markdown、操作 journal 和最后打开时间等。
- Pi 原生会话文件及其关联 journal。
- 本地模型配置、运行用户的 Pi 认证及实际项目目录。

不要删除整个部署目录、用旧备份直接覆盖当前库，或只备份 SQLite 而遗漏对应的 Pi 文件。迁移数据库、移动目录和更换运行用户都需单独核对，不属于普通产物更新。
