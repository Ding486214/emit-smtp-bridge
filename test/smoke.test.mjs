/**
 * 离线冒烟测试：不触网、不需要真实 API key。
 * 覆盖：配置校验、速率限制、MIME -> Emit 请求体映射、SMTP 会话受理与认证。
 *
 * 运行: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { loadConfig, validateConfig } from '../src/config.mjs';
import { createRateLimiter } from '../src/rate-limit.mjs';
import { buildEmitPayload } from '../src/emit-client.mjs';

test('配置：缺少 API key 应报错', () => {
  const cfg = loadConfig({});
  const errs = validateConfig(cfg);
  assert.ok(errs.some((e) => e.includes('EMIT_API_KEY')));
});

test('配置：secure=1 但没有证书应报错', () => {
  const cfg = loadConfig({ EMIT_API_KEY: 're_x', EMIT_SMTP_SECURE: '1' });
  assert.ok(validateConfig(cfg).some((e) => e.includes('EMIT_TLS_CERT')));
});

test('配置：默认端口随 secure 变化', () => {
  assert.equal(loadConfig({}).port, 587);
  assert.equal(loadConfig({ EMIT_SMTP_SECURE: '1' }).port, 465);
});

test('速率限制：超过每小时上限后拒绝', () => {
  const rl = createRateLimiter({ limitPerHour: 3 });
  assert.equal(rl.hit('1.2.3.4'), false);
  assert.equal(rl.hit('1.2.3.4'), false);
  assert.equal(rl.hit('1.2.3.4'), false);
  assert.equal(rl.hit('1.2.3.4'), true);
  // 其它 IP 独立计数
  assert.equal(rl.hit('5.6.7.8'), false);
});

test('速率限制：limit=0 表示不限制', () => {
  const rl = createRateLimiter({ limitPerHour: 0 });
  for (let i = 0; i < 100; i++) assert.equal(rl.hit('1.1.1.1'), false);
});

test('MIME 映射：from/to/subject/正文/附件', () => {
  const payload = buildEmitPayload({
    from: { value: [{ name: '牢钉测试', address: 'src@example.com' }] },
    to: { value: [{ address: 'a@example.com' }] },
    cc: { value: [{ address: 'b@example.com' }] },
    bcc: { value: [{ address: 'c@example.com' }] },
    subject: 'Hello',
    html: '<p>Hi</p>',
    text: 'Hi',
    replyTo: { value: [{ address: 'reply@example.com' }] },
    attachments: [{ filename: 'a.txt', content: Buffer.from('x'), contentType: 'text/plain' }],
    headers: [['x-custom', 'v']],
  });

  assert.equal(payload.from, '牢钉测试 <src@example.com>');
  assert.deepEqual(payload.to, ['a@example.com', 'b@example.com', 'c@example.com']);
  assert.equal(payload.subject, 'Hello');
  assert.equal(payload.html, '<p>Hi</p>');
  assert.deepEqual(payload.reply_to, ['reply@example.com']);
  assert.equal(payload.attachments.length, 1);
  assert.equal(payload.attachments[0].content, Buffer.from('x').toString('base64'));
  assert.equal(payload.headers['x-custom'], 'v');
});

test('MIME 映射：收件人去重，剔除 from/to 等受控头', () => {
  const payload = buildEmitPayload({
    from: { value: [{ address: 's@example.com' }] },
    to: { value: [{ address: 'dup@example.com' }] },
    cc: { value: [{ address: 'dup@example.com' }] },
    subject: 's',
    headers: [['Message-ID', '<abc>'], ['X-Keep', 'yes']],
  });
  assert.deepEqual(payload.to, ['dup@example.com']);
  assert.equal(payload.headers['message-id'], undefined);
  assert.equal(payload.headers['x-keep'], 'yes');
});

/** 极简 SMTP 客户端：拿到所有响应行后 resolve。 */
function smtpDialog(port, script) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let buf = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('smp timeout')); }, 8000);
    sock.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\r\n');
      // 只在收到完整响应（最后一个非续行）后推进
      if (lines.length < 2) return;
      const last = lines[lines.length - 2] || '';
      if (/^\d{3}-/.test(last)) return; // 多行响应还没结束
      buf = lines.slice(lines.length - 2).join('\r\n');
      const cmd = script[step];
      step += 1;
      if (!cmd) { clearTimeout(timer); sock.end(); resolve(buf); return; }
      sock.write(cmd + '\r\n');
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

test('SMTP：未认证时 AUTH 应被拒绝（明文不允许认证）', async () => {
  const { createSmtpServer } = await import('../src/server.mjs');
  const cfg = loadConfig({
    EMIT_API_KEY: 're_test',
    EMIT_SMTP_HOST: '127.0.0.1',
    EMIT_SMTP_PORT: '0',
    EMIT_SMTP_USER: 'u',
    EMIT_SMTP_PASS: 'p',
  });
  cfg.port = 12599;
  const logger = { info() {}, error() {}, warn() {} };
  const server = createSmtpServer(cfg, logger);
  await new Promise((r) => server.listen(cfg.port, '127.0.0.1', r));

  try {
    const out = await smtpDialog(cfg.port, ['EHLO tester', 'AUTH PLAIN dTpw']);
    assert.match(out, /5\d\d|535|502/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
