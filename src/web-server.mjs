/**
 * Web 后端：Express REST API + 静态前端 + HTTPS。
 * 与 SMTP 服务同进程运行（见 index.mjs），复用同一份配置与 Emit 客户端。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';
import express from 'express';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { buildEmitPayload, sendToEmit } from './emit-client.mjs';
import { makeSession, verifySession, verifyPassword, randomHex } from './web-auth.mjs';
import { appendHistory, readHistory } from './history.mjs';
import { ctlRequest } from './ctl-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, '..', 'web');
const COOKIE = 'emit_web';

export function createWebApp({ cfg, logger, historyFile, ctlSock }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32mb' }));

  const webUser = process.env.WEB_USER || 'admin';
  const webPassHash = process.env.WEB_PASS_HASH || '';
  const webSalt = process.env.WEB_SALT || '';
  const sessionSecret = process.env.WEB_SESSION_SECRET || 'insecure-dev-secret-change-me';

  function getToken(req) {
    const c = req.headers.cookie || '';
    for (const part of c.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      if (k === COOKIE) {
        try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return part.slice(idx + 1).trim(); }
      }
    }
    return null;
  }

  function auth(req, res, next) {
    const s = verifySession(getToken(req), sessionSecret);
    if (!s) return res.status(401).json({ ok: false, error: '未登录' });
    req.session = s;
    next();
  }

  function csrf(req, res, next) {
    const t = req.get('X-CSRF') || '';
    if (!req.session || t !== req.session.csrf) {
      return res.status(403).json({ ok: false, error: 'CSRF 校验失败' });
    }
    next();
  }

  app.get('/api/me', auth, (req, res) => res.json({ ok: true, user: req.session.user }));

  app.post('/api/login', (req, res) => {
    const { user, pass } = req.body || {};
    if (!user || !pass) return res.status(400).json({ ok: false, error: '缺少用户名或密码' });
    if (user !== webUser || !verifyPassword(pass, webPassHash, webSalt)) {
      return res.status(401).json({ ok: false, error: '用户名或密码错误' });
    }
    const csrfToken = randomHex(16);
    const token = makeSession(user, sessionSecret, csrfToken);
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200; Secure`);
    res.json({ ok: true, user, csrf: csrfToken });
  });

  app.post('/api/logout', auth, (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure`);
    res.json({ ok: true });
  });

  app.post('/api/send', auth, csrf, async (req, res) => {
    try {
      const b = req.body || {};
      const to = [].concat(b.to || []).map(String).filter(Boolean);
      if (!to.length) return res.status(400).json({ ok: false, error: '缺少收件人' });

      const from = b.from || `${webUser}@localhost`;
      const subject = b.subject || '(no subject)';
      const attachments = (b.attachments || []).map((a) => ({
        filename: a.filename || 'attachment',
        content: Buffer.from(a.contentBase64 || '', 'base64'),
        ...(a.contentType ? { contentType: a.contentType } : {}),
      }));

      // 复用 SMTP 同一条链路：nodemailer 组 MIME → mailparser 解析 → buildEmitPayload
      const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
      const sent = await transporter.sendMail({
        from,
        to,
        cc: b.cc || undefined,
        bcc: b.bcc || undefined,
        subject,
        text: b.text,
        html: b.html,
        attachments,
      });
      // streamTransport+buffer 下，原始 MIME 字节流在返回对象的 .message 字段里
      const raw = sent?.message || sent;
      const parsed = await simpleParser(raw);
      const payload = buildEmitPayload(parsed);
      const result = await sendToEmit(payload, { apiKey: cfg.apiKey, url: cfg.emitUrl });

      appendHistory(historyFile, {
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        status: result.ok ? (result.body?.last_event || 'sent') : 'failed',
        httpStatus: result.status,
        id: result.id || '',
        error: result.ok ? '' : (result.body?.message || `HTTP ${result.status}`),
      });

      logger.info(`WEB send ok=${result.ok} to=${payload.to.join(',')} id=${result.id || ''}`);
      res.json({ ok: result.ok, status: result.status, id: result.id, body: result.body });
    } catch (err) {
      logger.error(`WEB send exception ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/history', auth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json({ ok: true, items: readHistory(historyFile, limit) });
  });

  app.get('/api/smtp', auth, async (req, res) => {
    try { res.json(await ctlRequest(ctlSock, { cmd: 'get_env' })); }
    catch (e) { res.status(500).json({ ok: false, error: 'ctl 不可用: ' + e.message }); }
  });

  app.post('/api/smtp', auth, csrf, async (req, res) => {
    try {
      const fields = ['EMIT_SMTP_HOST', 'EMIT_SMTP_PORT', 'EMIT_SMTP_SECURE', 'EMIT_SMTP_USER', 'EMIT_SMTP_PASS', 'EMIT_RATE_PER_HOUR'];
      const b = req.body || {};
      for (const k of fields) {
        if (k in b) {
          const r = await ctlRequest(ctlSock, { cmd: 'set_env', key: k, value: String(b[k]) });
          if (!r.ok) return res.status(400).json({ ok: false, error: `${k}: ${r.error}` });
        }
      }
      res.json(await ctlRequest(ctlSock, { cmd: 'restart' }));
    } catch (e) { res.status(500).json({ ok: false, error: 'ctl 不可用: ' + e.message }); }
  });

  app.post('/api/smtp/restart', auth, csrf, async (req, res) => {
    try { res.json(await ctlRequest(ctlSock, { cmd: 'restart' })); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/status', auth, async (req, res) => {
    try { res.json(await ctlRequest(ctlSock, { cmd: 'status' })); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/logs', auth, async (req, res) => {
    try {
      const r = await ctlRequest(ctlSock, { cmd: 'logs', n: Number(req.query.n) || 50 });
      res.json(r);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/webpass', auth, csrf, async (req, res) => {
    const { oldPass, newPass } = req.body || {};
    if (!verifyPassword(oldPass || '', webPassHash, webSalt)) {
      return res.status(401).json({ ok: false, error: '旧密码错误' });
    }
    try {
      const r = await ctlRequest(ctlSock, { cmd: 'set_web_pass', value: newPass });
      if (!r.ok) return res.status(400).json(r);
      await ctlRequest(ctlSock, { cmd: 'restart' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.use(express.static(webDir));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(webDir, 'index.html')));

  return app;
}

export function startWebServer({ cfg, logger, historyFile, ctlSock }) {
  const app = createWebApp({ cfg, logger, historyFile, ctlSock });
  const port = Number(process.env.WEB_PORT || 3000);
  const cert = process.env.WEB_CERT || cfg.tlsCert;
  const key = process.env.WEB_KEY || cfg.tlsKey;
  const useTls = cert && key && fs.existsSync(cert) && fs.existsSync(key);
  const server = useTls
    ? https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app)
    : http.createServer(app);
  server.listen(port, '0.0.0.0', () => {
    logger.info(`web listening https=${useTls} 0.0.0.0:${port}`);
  });
  return server;
}
