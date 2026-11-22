# MCP 服务中心

浏览服务，保存自己的平台账号，为不同客户端配对账号并生成独立连接。

React、Next.js、shadcn/ui、Tailwind CSS；Express 提供管理 API 和 OAuth，SQLite 保存用户与授权状态。

## 使用

1. 登录（开放注册时可先注册），打开「账号」添加邮箱或平台凭据。
2. 在「服务」选择服务、客户端和允许访问的账号。
3. 保存新生成的连接密码，将 MCP 地址填写到客户端，选择 OAuth。
4. 在授权页面核对账号，输入这条连接的密码。

邮箱连接可配对多个邮箱；其他服务每条连接配对一个账号。「连接」中可复制配置、重置密码、生成 90 天 Bearer 令牌或撤销授权。重置密码会同时使该连接的既有授权失效。登录密码和连接密码彼此独立。

下载邮件附件时，`mail_download_attachment` 返回可直接下载的 `download_url` 和 `expires_at`，同时提供 MCP 文件链接。链接最长有效 1 小时，持有链接即可下载；过期后再次调用工具。客户端可通过链接保存到本机，返回的 `saved_to` 只是服务器路径。

连接名称与接入平台分开显示。「管理」中可修改名称、上传 10 KB 内的 PNG 图标或恢复默认；授权页及 MCP 服务信息同步展示，地址、密码和已有授权保持有效。客户端自身保存的名称和图标由对应平台管理。

找回的旧版 ChatGPT 连接保留原 MCP 地址及授权。管理中心只保存它们的显示信息，不复制令牌，也不接管旧服务的账号和凭据；名称与图标的编辑仅影响管理中心。

支持 ChatGPT、Gemini、Claude、Gemini CLI、Claude Code、VS Code 和通用 HTTP MCP 客户端的配置。客户端是否开放自定义 MCP 取决于其版本、套餐与工作区设置。

## 服务

| 服务 | 账号配置 |
| --- | --- |
| MailBridge | IMAP/SMTP 邮箱及授权码；预设常见服务商，也可填写公网邮件服务器 |
| 学习通 | 账号与密码 |
| 墨墨 | 用户自己的 API Token |
| Agent Reach | 独立公开内容配置；不继承服务器已有登录态 |
| Transcriptor | 可选 Netscape Cookie；支持的视频平台公开链接 |

Agent Reach 的部分渠道需要额外的平台登录配置，此版本未提供 Cookie 管理入口。邮件管理界面目前支持 IMAP/SMTP，不提供 Microsoft Graph OAuth 账号绑定。

## 部署

需要 Linux、Node.js 24、Python 3.12、Bubblewrap、Nginx，以及已安装的各服务运行环境。此项目依赖同组织各服务和 `auth-ui`，并非包含所有依赖的一键安装包。

```text
/opt/mcp/control-center/          源码、依赖和 out 静态构建
/opt/mcp/control-center/vendor/transcriptor/  视频服务的 dist、node_modules、package.json
/opt/mcp/control-center/.video-venv/          yt-dlp 环境
/opt/mcp/auth-ui/                 共用授权页与 server/render.mjs
/var/lib/mcp-center/              数据库、加密密钥、按用户和连接分开的工作目录
/var/lib/mcp-center/attachment-links/       有期限的附件下载副本和凭证哈希
/etc/mcp-center.env               私有部署配置
```

在服务器构建：

```bash
npm ci
npm run build
npm run typecheck
npm test
```

按 `.env.example` 配置 `/etc/mcp-center.env`，使用权限为 `0600` 的文件保存环境和随机生成的 32 字节十六进制加密密钥。数据库与密钥需要一起备份；切勿在升级时重新生成密钥。

服务模板见 `deploy/mcp-center.service`，Nginx 路由见 `deploy/nginx-locations.conf`。中心位于 `/center/`，每条连接使用 `/connect/<id>/mcp`。原有独立服务的地址和授权数据库不需要改动。

附件下载复用 `/opt/mcp/mailbridge/gateway/src/downloads.mjs`，升级时先更新 MailBridge，再更新本项目。每条连接只发布自己 `downloads/` 内的文件；链接绑定用户、连接和账号版本，删除账号、更新凭据、撤销连接或重置连接密码后立即失效。下载副本每分钟清理过期项，Nginx 的 `/connect/` 路由关闭访问日志，避免记录临时下载凭证。

`scripts/bootstrap.mjs` 仅供已有部署的管理员一次性迁移自己的账号。它生成管理员初始登录信息到 root 专用文件，不在终端打印凭据。注册默认关闭；仅当私有部署环境设置 `ALLOW_REGISTRATION=true` 时，页面显示注册入口且接口接受新用户。关闭注册不影响现有用户登录、OAuth 客户端注册和 MCP 连接。每个用户都有独立账号库。

管理员可在服务器运行 `node scripts/recover-connections.mjs /private/sources.json`，把旧服务中已授权的 ChatGPT 连接加入自己的列表。私有 JSON 包含 `owner` 用户名与 `sources` 数组，每项提供 `service`、OAuth SQLite 的 `database` 绝对路径、原 MCP 相对 `path`。只读取有未过期访问或刷新凭据的 ChatGPT 客户端，忽略测试注册；重复执行不会覆盖已编辑的名称和图标。原数据库始终只读。

墨墨原有的 Bearer 连接没有 OAuth 数据库。管理员核对原接入后，可在私有清单中明确加入 `{"service":"momo","auth":"bearer","path":"/momo"}`。管理中心显示真实认证类型，沿用客户端保存的墨墨 API Token，不导入、生成或更换 Token。

## 隔离与验证

凭据使用 AES-256-GCM 加密，登录密码与连接密码使用 scrypt 哈希。会话 Cookie 为 HttpOnly、Secure、SameSite=Lax；API 写操作检查来源。OAuth 支持动态客户端注册、PKCE、刷新令牌轮换及按连接校验访问令牌。

邮件、学习通、检索和视频服务在每条连接独立的进程与文件系统视图内运行；不挂载其他用户目录或服务器凭据。Python 网络请求拒绝私网目标，视频输入限定支持的平台。墨墨后端按请求接收当前用户的 Token。删除账号、撤销或重置连接会清除对应连接的工作目录；服务进程不以 root 运行。

```bash
# 在完成 Linux 依赖部署后，以服务用户执行真实工作进程检查
MCP_WORKER_INTEGRATION=1 node --test test/workers.integration.mjs
```

自动测试覆盖用户隔离、跨账号绑定拒绝、CSRF、PKCE、授权码重放、令牌用途限制和即时撤销。真实平台凭据仍需在部署环境验证；工具列表可用不等于平台账号已登录。

运行日志记录工具名、耗时、结果状态和 OAuth 错误类别，不记录工具参数、邮件内容、授权码或令牌。邮件日期索引较慢时返回 `MAIL_INDEX_PENDING` 及已保存进度，重试会继续；操作超时会重置该连接的工作进程，排队请求立即结束，下一次请求可重新连接。
