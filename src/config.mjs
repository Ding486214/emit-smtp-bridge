/**
 * 运行配置：全部来自环境变量，便于 systemd / Docker / 本地开发共用。
 */
import fs from 'node:fs';

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

function int(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(env = process.env) {
  const secure = bool(env.EMIT_SMTP_SECURE, false);
  const port = int(env.EMIT_SMTP_PORT, secure ? 465 : 587);

  const cfg = {
    apiKey: env.EMIT_API_KEY || '',
    host: env.EMIT_SMTP_HOST || '127.0.0.1',
    port,
    secure,
    tlsCert: env.EMIT_TLS_CERT || '',
    tlsKey: env.EMIT_TLS_KEY || '',
    authUser: env.EMIT_SMTP_USER || '',
    authPass: env.EMIT_SMTP_PASS || '',
    allowAnyFrom: bool(env.EMIT_ALLOW_ANY_FROM, false),
    maxClients: int(env.EMIT_MAX_CLIENTS, 50),
    ratePerHour: int(env.EMIT_RATE_PER_HOUR, 120),
    maxSizeMb: int(env.EMIT_MAX_SIZE_MB, 20),
    logFile: env.EMIT_LOG_FILE || '',
    emitUrl: env.EMIT_URL || 'https://vsllm.cc/emit/v1/emails',
    banner: env.EMIT_SMTP_BANNER || 'Emit SMTP Bridge',
  };

  cfg.maxSizeBytes = cfg.maxSizeMb * 1024 * 1024;
  cfg.tls = cfg.tlsCert && cfg.tlsKey
    ? { key: fs.readFileSync(cfg.tlsKey), cert: fs.readFileSync(cfg.tlsCert) }
    : null;

  return cfg;
}

/** 校验配置，返回错误列表（空数组表示合法）。 */
export function validateConfig(cfg) {
  const errors = [];
  if (!cfg.apiKey) errors.push('缺少 EMIT_API_KEY');
  if (cfg.secure && !cfg.tls) errors.push('EMIT_SMTP_SECURE=1 需要同时提供 EMIT_TLS_CERT 与 EMIT_TLS_KEY');
  if (cfg.authUser && !cfg.authPass) errors.push('设置了 EMIT_SMTP_USER 但没有 EMIT_SMTP_PASS');
  return errors;
}
