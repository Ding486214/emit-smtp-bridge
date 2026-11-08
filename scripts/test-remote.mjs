/**
 * 远端服务器 emit-smtp 端到端验证：隐式 TLS + 认证 + 投递到 Emit。
 * 用法: SMTP_USER=xxx SMTP_PASS=xxx node scripts/test-remote.mjs <host> <port> <to>
 */
import nodemailer from 'nodemailer';

const HOST = process.argv[2] || '127.0.0.1';
const PORT = Number(process.argv[3] || 2465);
const TO = process.argv[4] || 'delivered@resend.dev';
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
if (!USER || !PASS) {
  console.error('请用环境变量提供 SMTP 凭据：SMTP_USER=xxx SMTP_PASS=xxx node scripts/test-remote.mjs <host> <port> <to>');
  process.exit(1);
}

console.log(`目标: ${HOST}:${PORT}  收件人: ${TO}`);

const transport = nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: true,
  auth: { user: USER, pass: PASS },
  tls: { rejectUnauthorized: false }, // 自签证书
  connectionTimeout: 25_000,
  greetingTimeout: 25_000,
  socketTimeout: 40_000,
});

const t0 = Date.now();
try {
  const info = await transport.sendMail({
    from: 'Remote Bridge <bridge@ldnb.me>',
    to: TO,
    subject: 'Remotebrdg',
    text: 'HelloWorld',
  });
  console.log(`✅ 受理成功 (${Date.now() - t0}ms)`);
  console.log('   response:', (info.response || '').slice(0, 200));
  console.log('   messageId:', info.messageId || '(空)');
} catch (err) {
  console.log(`❌ 失败 (${Date.now() - t0}ms)`);
  console.log('   code:', err.code, '| command:', err.command);
  console.log('   message:', String(err.message).slice(0, 300));
} finally {
  transport.close();
}
