/**
 * 只验证“改端口 + 重启 + 端口回切”这一条完整管理链路。
 */
import https from 'node:https';
import net from 'node:net';

const HOST = process.env.WEB_HOST || '127.0.0.1';
const USER = process.env.WEB_USER || 'admin';
const PASS = process.env.WEB_PASS || '';
if (!PASS) {
  console.error('请用环境变量提供密码：WEB_PASS=xxx WEB_HOST=服务器IP node scripts/test-port.mjs');
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
    const r = https.request({ host: HOST, port: 3000, path, method, headers, rejectUnauthorized: false }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc) cookie = sc[0].split(';')[0];
      let d = '';
      res.on('data', (x) => (d += x));
      res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch { j = { raw: d }; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function probe(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: HOST, port });
    s.setTimeout(6000);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const login = await req('POST', '/api/login', { user: USER, pass: PASS });
  csrf = login.body.csrf || '';
  console.log('登录:', login.status, login.body.ok);

  console.log('改端口 2465 -> 2466:', (await req('POST', '/api/smtp', { EMIT_SMTP_PORT: '2466' })).body);
  await sleep(6000);
  console.log('  2466 可达:', await probe(2466), '| 2465 可达:', await probe(2465));

  console.log('改回 2465:', (await req('POST', '/api/smtp', { EMIT_SMTP_PORT: '2465' })).body);
  await sleep(6000);
  console.log('  2465 可达:', await probe(2465), '| 2466 可达:', await probe(2466));

  const smtp = await req('GET', '/api/smtp');
  console.log('  配置现值:', smtp.body?.data?.EMIT_SMTP_PORT);
  console.log('退出:', (await req('POST', '/api/logout')).status);
})().catch((e) => console.error('失败:', e.message));
