# 管理中心的数据与恢复

线上实例以 systemd 的 `STATE_DIRECTORY` 为根目录，默认 `/var/lib/mcp-center`。服务、维护脚本和恢复命令共同使用该布局。现有数据库、密钥和工作区直接沿用。

| 目录或文件 | 内容 |
| --- | --- |
| `center.sqlite` | 用户、平台账号、连接和图标、原连接登记、OAuth 客户端及授权、管理页显示的有限操作历史 |
| `encryption-key` | 解密数据库中平台账号所需的实例密钥，可用 `ENCRYPTION_KEY_FILE` 指向独立文件 |
| `outputs/<用户>/<连接>/<输出ID>/` | 用户通过 `mail_export` 生成的 CSV/JSON 和 `export_schedule_ics` 生成的课表。每个输出有文件和 `record.json`，便于按用户、连接和生成时间查找 |
| `workspaces/` | 工作进程的下载暂存、可重建索引和登录缓存。输出落盘后，原工作路径在工作区清理前仍可供当前客户端继续使用 |
| `attachment-links/` | 有时效的邮件附件下载副本及临时凭证哈希 |

保存新的报告或课表时，进程先写入本次的工作目录，成功后才发布持久输出。重置连接、更新账号和清理工作区时，已生成的输出仍在 `outputs/`。邮件附件下载副本、课程下载资料和缓存继续按各自生命周期管理。旧工作区仍可按原路径读取。

## 定位与在线导出

```bash
sudo npm run data:recovery -- check --env /etc/mcp-center.env --state-directory /var/lib/mcp-center --owner-receipt /var/backups/mcp-center-owner-login.json
sudo npm run data:recovery -- outputs --state-directory /var/lib/mcp-center
sudo npm run data:recovery -- export /path/to/new-private-package --env /etc/mcp-center.env --state-directory /var/lib/mcp-center --unit /etc/systemd/system/mcp-center.service --owner-receipt /var/backups/mcp-center-owner-login.json
sudo npm run data:recovery -- verify /path/to/new-private-package
```

`check` 只输出路径、记录数和密钥验证结果。`outputs --owner <用户ID>` 可筛选成果。`export` 读取 SQLite 在线快照，覆盖已提交的 WAL 内容。它保留原连接状态，核验平台账号能用原密钥解封，并生成带 SHA-256 的 `manifest.json`。导出带上运行配置和指定的 systemd 单元。传入私有的初始管理员恢复凭据时，只有它与快照内现行管理员密码吻合才随包保存。

恢复包含账号密钥和授权状态，要用私有目录和加密仓库存放。备份端使用的暂存目录在上传或校验结束后清理。

## 恢复

1. 在隔离目录用项目的 `verify` 校验包。从 `data/center.sqlite` 取出数据库，从 `config/` 取出配套密钥和环境配置。将 `outputs/` 按包内相对路径装入实例状态根目录。
2. 先用原版本启动隔离实例。数据库存为状态根的 `center.sqlite`，密钥写回 `ENCRYPTION_KEY_FILE` 或默认的 `encryption-key`。状态文件由服务用户读取，环境文件和初始管理员恢复凭据仅管理员可读。
3. 正式换机应恢复原 `PUBLIC_URL` 及 `/connect/<id>/` 路由，已有 OAuth 授权绑在原连接资源地址。核对登录、已有连接、账号解密、输出清单与所需 OAuth 刷新后再升级。替换现有库时先停服务，保留原库用于回退，移走旧库对应的 WAL/SHM 后再启动。

旧快照中的 SQLite、密钥和配置仍可用原备份工具校验并恢复。管理中心保存的旧版连接是指向独立服务的登记，旧服务自己的授权仍由对应服务负责恢复。
