# 使用 systemd 运行

适用 Linux + systemd。每个部署目录只运行一个实例，使用 Node.js >=22.19.0。独立发布包优先运行 `node server.js`，源码部署使用生产 `next start`。脚本不构建、不迁移数据库，也不自动启动服务。

## 准备

只部署产物时，在兼容生产平台的构建机执行 `npm ci && npm run release`，将 `release/` 内容部署到固定应用目录。服务器无需源码、安装依赖或构建；配置另行提供。在发布目录可用 `node scripts/systemd.cjs render` 和 `node scripts/systemd.cjs install` 替代下面的 `npm run systemd -- ...`，其余参数不变。\n\n保留源码部署时，以将来运行服务的用户准备应用目录、配置与依赖：

```bash
cd /srv/ai-workspace
npm ci
npm run build
```

保持应用目录稳定。`WorkingDirectory` 和 `INIT_CWD` 都指向该目录；本地 `models.json`、`settings.json` 优先于服务用户 HOME 下的 `~/.pi/agent/` 对应文件。Pi 认证和全局配置使用**服务运行用户**的 HOME。已有 `.data`、Agent 文件、journal、Pi 原生会话文件和项目目录应继续由该用户访问，不删除或重新初始化。新机器构建仍需完整构建依赖，不要先用 `npm ci --omit=dev`。

生产模型配置不依赖 `.env` 文件。模型使用 `models.json`、`settings.json` 与 Pi 原生认证来源；配置中显式引用环境变量时，通过服务环境提供。unit 不复制任何密钥。不加载交互式 shell 的 `.bashrc`/nvm，生成时固定当前 Node 的绝对路径及 PATH，升级 Node 后需重新生成 unit。

默认监听 `0.0.0.0:3000`（全部IPv4网卡），可从本机使用 `http://localhost:3000`，或从其他设备使用 `http://服务器IP:3000` 访问。用 `--host`、`--port` 指定本机地址与端口，例如 `--host 192.168.1.10`，IPv6可用 `--host ::`。远程连通还取决于宿主机防火墙、云安全组与路由配置。

## 用户服务（默认，不需要 sudo）

在运行用户的登录会话中执行：

```bash
npm run systemd -- render
npm run systemd -- install
systemctl --user enable --now ai-workspace.service
systemctl --user status ai-workspace.service
journalctl --user -u ai-workspace.service -f
```

安装路径：`${XDG_CONFIG_HOME:-~/.config}/systemd/user/ai-workspace.service`。安装只写 unit 并执行 `daemon-reload`。已有不同内容时默认拒绝覆盖；先 `render` 审查，再显式 `install --force`。不要用 sudo 安装用户服务。

需要退出登录后继续运行并随机器启动，由管理员为该用户启用 linger：

```bash
sudo loginctl enable-linger <用户名>
```

出现“Failed to connect to bus”时，使用该用户正常登录会话；确认用户 systemd manager 已运行，再安装。无需创建第二个应用实例。

## 系统服务

使用已存在的非 root 账号，例如 `aiworkspace`，并确保账号可读写应用及项目目录。用目标账号构建。安装时显式指定服务账号和 Node 路径：

```bash
node scripts/systemd.cjs render --system --user aiworkspace --node /usr/bin/node
sudo /usr/bin/node scripts/systemd.cjs install --system --user aiworkspace --node /usr/bin/node
sudo systemctl enable --now ai-workspace.service
sudo systemctl status ai-workspace.service
sudo journalctl -u ai-workspace.service -f
```

`/usr/bin/node` 必须满足版本要求；使用其他位置的 Node 时替换为实际绝对路径。系统服务从 `getent passwd` 读取服务账号 HOME，unit 放在 `/etc/systemd/system/`。选择用户服务或系统服务其中一种，避免同时启动。

## 自定义与升级

```bash
npm run systemd -- render --name my-workspace --port 3100 --host 0.0.0.0
npm run systemd -- install --name my-workspace --port 3100 --host 0.0.0.0
```

可用 `--app-dir /absolute/path` 指定安装位置（该位置须有完整项目与脚本）。默认是脚本所在仓库。路径含空格、`%`、`$` 时由生成器做 systemd 转义。

服务退出失败后等待 5 秒重启；60 秒内最多 5 次启动。缺构建或配置错误时先看 journal，修复后执行 `systemctl --user reset-failed ai-workspace` 再启动。日志由 journald 管理。停止时 SIGTERM 发给 Node 及其工具进程，最多等待 120 秒；不承诺强制停机时正在执行的模型请求成功结束，重开时仍按应用恢复/unknown 契约核对。

升级时先停止服务，再更新依赖和构建，最后启动，避免在运行中覆盖 `.next`：

```bash
systemctl --user stop ai-workspace.service
npm ci
npm run build
systemctl --user start ai-workspace.service
```

系统服务使用相应的 `sudo systemctl` 命令。构建不等于数据库迁移授权；历史库不兼容时按迁移指南单独处理。脚本不会自动修改历史数据。

移除用户服务只移除 unit，保留应用与全部数据：

```bash
systemctl --user disable --now ai-workspace.service
rm "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/ai-workspace.service"
systemctl --user daemon-reload
```

当前交付只做脚本与受控测试；实际 Linux 上的 unit 校验、启动、停止、开机自启和模型请求需要在部署机验收。
