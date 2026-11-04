# 安全策略

## 支持版本

| 版本 | 修复 |
|---|---|
| 1.x | ✅ |

## 报告漏洞

请**不要**在公开 Issue 里报告安全问题。
请通过仓库的 GitHub **Security Advisory**（`Security` → `Report a vulnerability`）私下报告。

报告请包含：

- 受影响版本与部署方式（systemd / Docker / 本地）
- 复现步骤
- 影响范围（是否会泄露 API key、导致越权发信等）

我会在 72 小时内确认收到，7 天内给出修复或缓解方案。

## 部署者的安全清单

本服务会**代你使用你的 Emit API key 发信**，因此：

- [ ] **公网部署必须启用 SMTP AUTH**（`EMIT_SMTP_USER` / `EMIT_SMTP_PASS`）
      未启用时，任何能连上的人都能借用你的 key 发信——服务启动时会打印 WARN 提醒。
- [ ] **启用 TLS**（465 隐式 TLS 或 587 + STARTTLS），因为 AUTH 只允许在加密连接上使用。
- [ ] **不要把 `.env` 提交到版本库**（`.gitignore` 已排除 `.env`、`*.key`、`*.pem`）。
- [ ] **限制来源 IP**：除 ufw 外，建议在云安全组只对可信 IP 开放 587/465。
- [ ] **设置每 IP 限速**（`EMIT_RATE_PER_HOUR`，默认 120），避免被当作 spam 跳板。
- [ ] **定期轮换 Emit API key**：Emit 控制台可创建 `sending_access` 权限的受限 key，更安全。

## 已知的安全边界

- 桥接**不校验**邮件内容，也不做 SPF/DKIM 签名；最终发信域名由 Emit 平台决定。
- 桥接**不限制**收件人数量上限之外的业务规则；Emit 侧仍有「同一收件人每日收信上限」等限制。
- `EMIT_ALLOW_ANY_FROM=1` 时，任何 MAIL FROM 都会被接受，仅建议在受控内网使用。
