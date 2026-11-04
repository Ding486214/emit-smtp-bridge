# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-11-04

### 新增

- SMTP → Emit HTTP API 桥接核心：`src/server.mjs`、`src/emit-client.mjs`
- 环境变量配置与校验：`src/config.mjs`
- 每 IP 每小时发信限速：`src/rate-limit.mjs`
- 结构化日志（stdout + 可选文件）：`src/logger.mjs`
- Linux 一键安装脚本与 systemd 单元：`deploy/`
- Dockerfile 与 docker-compose 配置
- GitHub Actions CI：Node 20/22/24 矩阵测试 + Docker 构建冒烟
- 离线测试套件（配置、限速、MIME 映射、SMTP 会话）：`test/smoke.test.mjs`
- 测试客户端：`scripts/send-test.mjs`

### 安全

- AUTH 仅允许在 TLS 连接上使用（`allowInsecureAuth: false`）
- 未启用 AUTH 时启动即打印 WARN
- systemd 沙箱加固与独立低权用户
- `.gitignore` 排除 `.env`、`*.key`、`*.pem` 等敏感文件
