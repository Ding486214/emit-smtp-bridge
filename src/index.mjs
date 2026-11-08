#!/usr/bin/env node
/**
 * emit-smtp-bridge
 * -----------------
 * 把 SMTP 会话翻译成 Emit (https://vsllm.cc/emit) 的 HTTP API 调用。
 * 同时可选启动 Web 管理界面（发信 + SMTP 完整管理 + 发送历史）。
 *
 * 用法:
 *   node src/index.mjs
 * 或:
 *   npm start
 *
 * 完整环境变量说明见 README.md 或 .env.example。
 */
import path from 'node:path';
import { loadConfig, validateConfig } from './config.mjs';
import { createLogger } from './logger.mjs';
import { createSmtpServer } from './server.mjs';
import { startWebServer } from './web-server.mjs';

const cfg = loadConfig();
const errors = validateConfig(cfg);

if (errors.length) {
  for (const e of errors) console.error(`[emit-smtp] 配置错误: ${e}`);
  console.error('[emit-smtp] 参考 .env.example 补齐后重试');
  process.exit(1);
}

const logger = createLogger({ logFile: cfg.logFile });
const server = createSmtpServer(cfg, logger);

server.listen(cfg.port, cfg.host, () => {
  logger.info(`listening ${cfg.host}:${cfg.port} secure=${cfg.secure} auth=${cfg.authUser ? 'required' : 'none'} -> ${cfg.emitUrl}`);
  if (!cfg.secure && !cfg.tls) {
    logger.info('提示: 未配置证书，STARTTLS 将使用内置自签证书（仅建议本机测试）');
  }
  if (!cfg.authUser) {
    logger.warn('警告: 未启用 SMTP AUTH，任何能连上本服务的人都能借你的 API key 发信');
  }
});

// Web 管理界面（可选，设置了 WEB_PORT 才启用）
let webServer = null;
if (process.env.WEB_PORT) {
  const historyFile = process.env.EMIT_HISTORY_FILE || path.join(process.cwd(), 'data', 'history.jsonl');
  const ctlSock = process.env.CTL_SOCK || '/run/emit-smtp/ctl.sock';
  try {
    webServer = startWebServer({ cfg, logger, historyFile, ctlSock });
  } catch (err) {
    logger.error(`web 启动失败: ${err.message}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info('shutting down');
    server.close(() => {
      if (webServer) webServer.close(() => process.exit(0));
      else process.exit(0);
    });
  });
}
