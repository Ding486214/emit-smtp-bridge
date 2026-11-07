/**
 * 批量测试发信：给每个收件人发 N 封（走本地 SMTP 桥）。
 * 用法: node scripts/send-batch.mjs [每人数] [收件人...]
 * 示例: node scripts/send-batch.mjs 20 1@ldnb.cc.cd admin@ldnb.me 1586004730@qq.com
 */
import nodemailer from 'nodemailer';

const COUNT = Number(process.argv[2] || 20);
const recipients = process.argv.slice(3);
if (!recipients.length) {
  console.error('用法: node scripts/send-batch.mjs <数量> <收件人...>');
  process.exit(1);
}

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1',
  port: Number(process.env.SMTP_PORT || 2587),
  secure: false,
  ignoreTLS: true,
  tls: { rejectUnauthorized: false },
});

const from = process.env.MAIL_FROM || 'Ding Test <test@example.com>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const to of recipients) {
  let ok = 0;
  const failures = [];
  for (let i = 1; i <= COUNT; i++) {
    const n = String(i).padStart(2, '0');
    try {
      await transport.sendMail({
        from,
        to,
        subject: `Testmail${n}`,
        text: 'HelloWorld',
      });
      ok++;
    } catch (err) {
      failures.push(`#${i} ${err.message.slice(0, 120)}`);
    }
    await sleep(150); // 稳一点，别撞 10 req/s
  }
  console.log(`${to}  ->  成功 ${ok} / ${COUNT}`);
  for (const f of failures.slice(0, 5)) console.log('    失败:', f);
  if (failures.length > 5) console.log(`    ...另有 ${failures.length - 5} 条失败`);
}

transport.close();
