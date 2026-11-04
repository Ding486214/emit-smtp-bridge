# 贡献指南

感谢参与！本项目很小，流程也简单。

## 开发

```bash
git clone <repo> emit-smtp-bridge
cd emit-smtp-bridge
pnpm install        # 或 npm install
pnpm test           # 离线测试，不需要 API key
pnpm run lint
```

## 提交前请确认

- [ ] `pnpm test` 全部通过
- [ ] `pnpm run lint` 无报错
- [ ] 新增行为有对应测试（测试不联网、不依赖真实 key）
- [ ] **没有把任何 API key / 证书 / `.env` 提交进来**（`.gitignore` 已覆盖，但仍请人工确认）
- [ ] README 中涉及配置项的改动已同步更新 `.env.example` 和文档表格

## 代码风格

- ESM（`"type": "module"`），Node ≥ 20
- 2 空格缩进，单引号，分号结尾
- 注释解释「为什么」，不解释「做了什么」
- 公共函数导出，便于单测

## 提交信息

```
feat: 支持 IMAP 轮询收取邮件
fix: 附件超过 2MB 时返回 552 而不是 554
docs: 补充 nginx 反向代理示例
```

## 认领 Issue

先留言认领，避免重复劳动；大改动建议先开 Discussion 讨论方案。

## 安全问题

**不要** 在公开 Issue 里报告安全漏洞，请见 [SECURITY.md](./SECURITY.md)。
