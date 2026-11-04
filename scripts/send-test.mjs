/**
 * 测试客户端：通过本地 SMTP 桥发一封信。
 *
 * 用法:
 *   node test/send-test.mjs [收件人]
 *   node test/send-test.mjs delivered@resend.dev     # 测试地址，不投递不计费
 *   node test/send-test.mjs someone@example.com      # 真实投递
 *
 * 依赖 nodemailer（devDependency）。
 */
import nodemailer from 'nodemailer';

const to = process.argv[2] || 'delivered@resend.dev';
const host = process.env.SMTP_HOST || '127.0.0.1';
const port = Number(process.env.SMTP_PORT || 2587);
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';

const transport = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  ignoreTLS: port !== 465,
  tls: { rejectUnauthorized: false },
  ...(user ? { auth: { user, pass } } : {}),
});

try {
  const info = await transport.sendMail({
    from: process.env.MAIL_FROM || 'Emit Bridge Test <test@example.com>',
    to,
    subject: process.env.MAIL_SUBJECT || 'EmitBridgeTestOK',
    text: process.env.MAIL_TEXT || 'SMTP bridge works.',
    html: process.env.MAIL_HTML || '<p>SMTP bridge works.</p>',
  });
  console.log(`✅ SMTP envelope 已受理 -> ${info.messageId}`);
  console.log('   （桥接服务日志里会出现 Emit 返回的邮件 id）');
} catch (err) {
  console.error('❌ 发送失败:', err.message);
  process.exitCode = 1;
} finally {
  transport.close();
}
