/**
 * SMTP 服务核心：接收 SMTP 会话，解析邮件，转发给 Emit。
 */
import { SMTPServer } from 'smtp-server';
import { buildEmitPayload, parseMessage, sendToEmit } from './emit-client.mjs';
import { createRateLimiter } from './rate-limit.mjs';

const DOMAIN_RE = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function createSmtpServer(cfg, logger) {
  const limiter = createRateLimiter({ limitPerHour: cfg.ratePerHour });

  const server = new SMTPServer({
    secure: cfg.secure,
    authOptional: !cfg.authUser,
    // AUTH 只允许在 TLS 之上进行
    allowInsecureAuth: false,
    authMethods: ['PLAIN', 'LOGIN'],
    size: cfg.maxSizeBytes,
    rejectOversized: true,
    maxClients: cfg.maxClients,
    socketTimeout: 5 * 60_000,
    maxAllowedUnauthenticatedCommands: 10,
    maxRecipients: 50,
    disableReverseLookup: true,
    logger: false,
    banner: cfg.banner,
    ...(cfg.tls ? { key: cfg.tls.key, cert: cfg.tls.cert } : {}),

    onAuth(auth, session, callback) {
      if (!cfg.authUser) return callback(null, { user: 'anonymous' });
      if (auth.username === cfg.authUser && auth.password === cfg.authPass) {
        return callback(null, { user: auth.username });
      }
      logger.error(`AUTH 失败 ip=${session.remoteAddress} user=${auth.username}`);
      return callback(new Error('Invalid username or password'));
    },

    onMailFrom(address, session, callback) {
      if (!address.address || !address.address.includes('@')) {
        return callback(new Error('Invalid MAIL FROM address'));
      }
      if (!cfg.allowAnyFrom) {
        const domain = address.address.split('@')[1] || '';
        if (!DOMAIN_RE.test(domain)) {
          return callback(new Error('MAIL FROM domain looks invalid'));
        }
      }
      return callback();
    },

    onRcptTo(address, session, callback) {
      if (!address.address || !address.address.includes('@')) {
        return callback(new Error('Invalid RCPT TO address'));
      }
      return callback();
    },

    onData(stream, session, callback) {
      const ip = session.remoteAddress || 'unknown';
      if (limiter.hit(ip)) {
        logger.error(`限速拒绝 ip=${ip}`);
        const e = new Error('Too many messages from this address, try again later');
        e.responseCode = 451;
        return callback(e);
      }

      const chunks = [];
      let total = 0;
      stream.on('data', (c) => {
        total += c.length;
        if (total <= cfg.maxSizeBytes) chunks.push(c);
      });
      stream.on('error', (err) => callback(err));
      stream.on('end', async () => {
        try {
          const parsed = await parseMessage(Buffer.concat(chunks));
          const payload = buildEmitPayload(parsed);
          if (!payload.to.length) return callback(new Error('No valid recipient'));

          const res = await sendToEmit(payload, {
            apiKey: cfg.apiKey,
            url: cfg.emitUrl,
          });

          if (res.ok) {
            logger.info(`OK ip=${ip} to=${payload.to.join(',')} subject=${JSON.stringify(payload.subject)} id=${res.id || ''}`);
            return callback(null, 'Message accepted for delivery');
          }

          logger.error(`ERR ip=${ip} status=${res.status} body=${JSON.stringify(res.body).slice(0, 300)}`);
          const e = new Error(res.body?.message || `Emit rejected the message (HTTP ${res.status})`);
          // 429 -> 451(临时性)，其余 -> 554(永久性)
          e.responseCode = res.status === 429 ? 451 : 554;
          return callback(e);
        } catch (err) {
          logger.error(`ERR ip=${ip} exception=${err.message}`);
          const e = new Error(err.message);
          e.responseCode = 451;
          return callback(e);
        }
      });
    },
  });

  server.on('error', (err) => logger.error(`server error: ${err.message}`));
  return server;
}
