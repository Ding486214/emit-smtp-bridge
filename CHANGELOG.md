# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.1] - 2026-11-07

### 修复

- **systemd 单元移除 `MemoryDenyWriteExecute=true`**：该限制禁止创建可执行内存页，
  Node 的 V8 JIT 申请失败后以 `Check failed: 12 == (*__errno_location ())` / `status=5/TRAP`
  无限重启。这是最隐蔽的一处部署故障。
- `install.sh` 改为复制 `src/` 目录（此前拍平到 `/opt/emit-smtp/`，与单元文件的
  `ExecStart=/opt/emit-smtp/src/index.mjs` 不一致）。

### 变更

- `sendToEmit` 从全局 `fetch` 改为 `node:https` / `node:http`：`fetch` 由 undici 实现，
  依赖 WebAssembly 编译 llhttp，在 `--jitless` 等禁用 WASM 的环境下会直接报
  `ReferenceError: WebAssembly is not defined`。改为原生 HTTP 后无此依赖，也让
  「低内存机器关 JIT」这条兜底路径真正可用。
- 文档补充「部署踩坑（真实案例）」：`MemoryDenyWriteExecute` 陷阱、云厂商封禁
  25/465/587、非 root 绑定低端口 `EACCES`、自签证书权限。

### 新增

- `scripts/send-batch.mjs`：批量测试发信（`node scripts/send-batch.mjs 20 a@x.com b@y.com`）
- `scripts/test-remote.mjs`：远端桥接端到端验证（465/2465 隐式 TLS + 认证）

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
