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
- systemd 单元已启用 `ProtectSystem=strict`、`NoNewPrivileges`、`SystemCallFilter=@system-service`，以独立低权用户 `emit-smtp` 运行。
- ⚠ **不要给这个服务加 `MemoryDenyWriteExecute=true`**：它禁止创建可执行内存页，Node 的 V8 JIT 一申请就 SIGTRAP 崩掉（旧版本单元文件里曾有这一条，已移除）。
- 每 IP 限速默认 120 封/小时，超限返回 SMTP `451`。
- **`.env` 与证书已被 `.gitignore` 排除，请勿把密钥提交到仓库。**

## 部署踩坑（真实案例）

以下是实际在 Debian 12 / 2C2G 云主机上部署时踩到的坑，按出现顺序：

### 1. 进程反复 `status=5/TRAP` 崩溃

```
# Fatal error in , line 0
# Check failed: 12 == (*__errno_location ()).
  v8::internal::MemoryAllocator::SetPermissionsOnExecutableMemoryChunk
```

`errno 12 = ENOMEM`，缺的**不是内存，是「可执行内存页」的权限**。元凶是 systemd 单元里的
`MemoryDenyWriteExecute=true`（seccomp 禁止 `mprotect(PROT_EXEC)`）。

- **正解**：删掉这一条（本仓库单元文件已修正）。
- **如果要保留该限制**：给 Node 加 `--jitless`，但注意 `--jitless` 会同时禁用 WebAssembly，
  而 Node 内置 `fetch`（undici）依赖 WASM 编 llhttp，会直接 `ReferenceError: WebAssembly is not defined`。
  本项目的 Emit 客户端因此刻意改用 `node:https`，在 `--jitless` 下也能工作。

### 2. 云厂商封禁 25 / 465 / 587

阿里云、腾讯云、AWS、GCP 等默认封锁这些「垃圾邮件高危端口」，`ufw` 放行了**依然连不通**
（从外部 `connect ETIMEDOUT`）。服务器上 `ss -tlnp` 能看到监听，但公网到不了。

- **正解**：换高位端口（本仓库示例用 `2465`），并在云控制台安全组放行。
- 顺带一提：Debian 自带的 exim4/postfix 常占用 `127.0.0.1:25` 和 `127.0.0.1:587`，
  若想用这两个端口，需要绑定公网 IP（不与回环地址冲突）或先停掉系统 MTA。

### 3. 非 root 用户绑定 <1024 端口报 `EACCES`

```
[ERROR] server error: listen EACCES: permission denied 0.0.0.0:465
```

- **正解**：用高位端口；或给服务加 `CAP_NET_BIND_SERVICE`（见 `deploy/install.sh` 结尾提示）。

### 4. 自签证书权限

服务以 `emit-smtp` 用户运行，`/etc/emit-smtp/key.pem` 若是 `root:root 600` 会读不到：

```bash
chown emit-smtp:emit-smtp /etc/emit-smtp/key.pem
chmod 600 /etc/emit-smtp/key.pem
```

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
