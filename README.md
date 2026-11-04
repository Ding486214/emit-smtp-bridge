# emit-smtp-bridge

> 把任意支持 SMTP 的客户端（Outlook、Thunderbird、WordPress、脚本、老旧系统……）接到 [vsllm.cc 的 Emit 邮件 API](https://vsllm.cc/emit/llms.txt)。

**SMTP ⇄ HTTP 桥接服务**。Emit 只提供 HTTP API（Resend 兼容），没有任何 SMTP 端口，所以需要一个小服务把 SMTP 会话翻译成 `POST /emails`。

```
┌──────────────┐   SMTP 587 / 465   ┌────────────────────┐    HTTPS     ┌────────────────┐
│  邮件客户端   │ ─────────────────▶ │  emit-smtp-bridge  │ ───────────▶ │ vsllm.cc/emit │
│ Outlook 等   │                    │ (Node + systemd)   │              │   /v1/emails   │
└──────────────┘                    └────────────────────┘              └────────────────┘
```

---

## 特性

- **开箱即用**：填一个 Emit API key 就能用，任何 SMTP 客户端连上即可发信
- **单进程零外部依赖**：只需 Node.js ≥ 20，systemd / Docker 都提供
- **安全默认值**：AUTH 只允许在 TLS 上进行、每 IP 限速、并发与体积限制、systemd 沙箱加固
- **错误可观测**：Emit 的错误码（如收件人当日超限 429）会以真实原因回传给 SMTP 客户端
- **完整 MIME 支持**：HTML / 纯文本 / 附件 / cc / bcc / reply_to / 自定义头

## 快速开始

### Docker Compose（推荐）

```bash
cp .env.example .env
# 编辑 .env，填入 EMIT_API_KEY
docker compose up -d
```

### Linux + systemd

```bash
git clone <this-repo> emit-smtp
cd emit-smtp
sudo bash deploy/install.sh
sudo vi /etc/emit-smtp/env      # 填 EMIT_API_KEY / EMIT_SMTP_USER / EMIT_SMTP_PASS
sudo systemctl restart emit-smtp
sudo journalctl -u emit-smtp -f
```

### 本地开发

```bash
npm install
EMIT_API_KEY=re_xxx EMIT_SMTP_PORT=2587 npm start
# 另一个终端发一封测试
node scripts/send-test.mjs delivered@resend.dev
```

## 客户端配置

| 项 | 值 |
|---|---|
| SMTP 服务器 | `服务器IP` 或域名 |
| 端口 | `587`（推荐，配 STARTTLS）或 `465`（隐式 TLS） |
| 加密 | STARTTLS（587）/ SSL-TLS（465） |
| 认证 | 开启；用户名 = `EMIT_SMTP_USER`，密码 = `EMIT_SMTP_PASS` |
| 发件人 | 任意合法地址；显示名会原样透传给收件人 |

> **不需要 25 端口** —— 25 是收信（MX）用的，本项目只做发信。

## 配置项

全部通过环境变量，见 [`.env.example`](./.env.example)。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `EMIT_API_KEY` | *(必填)* | Emit API key |
| `EMIT_SMTP_HOST` | `127.0.0.1` | 监听地址，公网用 `0.0.0.0` |
| `EMIT_SMTP_PORT` | `587` / `465` | 监听端口 |
| `EMIT_SMTP_SECURE` | `0` | `1` = 隐式 TLS（465） |
| `EMIT_TLS_CERT` / `EMIT_TLS_KEY` | – | 证书与私钥路径（PEM） |
| `EMIT_SMTP_USER` / `EMIT_SMTP_PASS` | – | 设置后强制 SMTP AUTH |
| `EMIT_ALLOW_ANY_FROM` | `0` | `1` = 放宽 MAIL FROM 校验 |
| `EMIT_MAX_CLIENTS` | `50` | 最大并发连接 |
| `EMIT_RATE_PER_HOUR` | `120` | 每 IP 每小时发信上限，`0` = 不限 |
| `EMIT_MAX_SIZE_MB` | `20` | 单封最大体积 |
| `EMIT_LOG_FILE` | – | 日志额外写入文件 |
| `EMIT_URL` | `https://vsllm.cc/emit/v1/emails` | Emit 端点 |

## 安全说明

- **AUTH 只在 TLS 上可用**（`allowInsecureAuth: false`）。明文连接无法认证。
- **公网部署务必设置 `EMIT_SMTP_USER` / `EMIT_SMTP_PASS`**，否则任何能连上的人都能借用你的 API key 发信。
- systemd 单元已启用 `ProtectSystem=strict`、`NoNewPrivileges`、`MemoryDenyWriteExecute`、`SystemCallFilter=@system-service`，以独立低权用户 `emit-smtp` 运行。
- 每 IP 限速默认 120 封/小时，超限返回 SMTP `451`。
- **`.env` 与证书已被 `.gitignore` 排除，请勿把密钥提交到仓库。**

## 已知限制

- **收件人日限**：Emit 对同一收件人每天可收邮件数有限（实测约 30 封/天触发 `429 rate_limit_exceeded`），桥接无法绕过。
- **月配额**：10000 封/月免费额度。
- **只发不收**：不提供 IMAP/POP。
- **无投递追踪**：Emit 只回报 `queued / scheduled / sent / failed / canceled`，不回报 delivered / opened / bounced。
- **不透明转发**：发件人域名无需验证，实际发送地址由 Emit 平台分配。

## 开发

```bash
npm test        # 离线冒烟测试（不触网、不需要真实 key）
npm run lint    # 语法检查
npm run client -- someone@example.com   # 用真实客户端发一封
node scripts/send-test.mjs delivered@resend.dev   # 发到测试地址（不投递不计费）
```

## 致谢

- [vsllm.cc Emit API 文档](https://vsllm.cc/emit/llms.txt)
- [smtp-server](https://github.com/nodemailer/smtp-server)
- [mailparser](https://github.com/nodemailer/mailparser)

## License

[MIT](./LICENSE)
