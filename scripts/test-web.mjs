/**
 * Web 管理台端到端验证：登录 → 发信(含附件) → 历史 → SMTP 读/写/重启 → 日志。
 */
import https from 'node:https';

const HOST = process.env.WEB_HOST || '127.0.0.1';
const PORT = Number(process.env.WEB_TLS_PORT || 3000);
const USER = process.env.WEB_USER || 'admin';
const PASS = process.env.WEB_PASS || '';
if (!PASS) {
  console.error('请用环境变量提供密码：WEB_PASS=xxx WEB_HOST=服务器IP node scripts/test-web.mjs');
  process.exit(1);
}

let cookie = '';
let csrf = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (csrf && method !== 'GET') headers['X-CSRF'] = csrf;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const r = https.request({
      host: HOST, port: PORT, path, method, headers,
      rejectUnauthorized: false,
    }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc) cookie = sc[0].split(';')[0];
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(data); } catch { j = { raw: data }; }
        resolve({ status: res.statusCode, body: j });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const log = (...a) => console.log(a.map((v) => (typeof v === 'object' ? JSON.stringify(v).slice(0, 240) : v)).join(' '));

(async () => {
  const me0 = await req('GET', '/api/me');
  log('1) 未登录 /api/me (应401):', me0.status);

  const login = await req('POST', '/api/login', { user: USER, pass: PASS });
  log('2) 登录:', login.status, login.body);
  csrf = login.body.csrf || '';

  const me1 = await req('GET', '/api/me');
  log('3) 已登录 /api/me:', me1.status, me1.body);

  const send = await req('POST', '/api/send', {
    from: 'Web Test <web@ldnb.me>',
    to: ['1586004730@qq.com'],
    subject: 'WebAttach01',
    text: 'Hello from web admin panel',
    attachments: [{ filename: 'note.txt', contentType: 'text/plain', contentBase64: Buffer.from('hello attachment content').toString('base64') }],
  });
  log('4) 发信(含附件):', send.status, send.body);

  const hist = await req('GET', '/api/history?limit=5');
  log('5) 历史条数:', hist.body.items?.length, '首条:', hist.body.items?.[0]);

  const smtp = await req('GET', '/api/smtp');
  log('6) SMTP 配置:', smtp.body);

  const set1 = await req('POST', '/api/smtp', { EMIT_RATE_PER_HOUR: '220' });
  log('7) 改限速 200->220 + 重启:', set1.status, set1.body);
  await new Promise((r) => setTimeout(r, 5000));

  const st = await req('GET', '/api/status');
  log('8) 服务状态:', st.body);
  const logs = await req('GET', '/api/logs?n=30');
  log('   日志(尾部关键行):', (logs.body.data || '').split('\n').filter((l) => /listening|web |ERROR/.test(l)).slice(-3));

  const set2 = await req('POST', '/api/smtp', { EMIT_RATE_PER_HOUR: '200' });
  log('9) 改回 200:', set2.status, set2.body);
  await new Promise((r) => setTimeout(r, 5000));

  const smtp2 = await req('GET', '/api/smtp');
  log('   限速现值(应200):', smtp2.body?.data?.EMIT_RATE_PER_HOUR);

  const out = await req('POST', '/api/logout');
  log('10) 退出:', out.status, out.body);
})().catch((e) => console.error('E2E 失败:', e.message));
