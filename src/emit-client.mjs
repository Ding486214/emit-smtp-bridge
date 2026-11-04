/**
 * Emit HTTP 客户端：把 SMTP 解析结果投递到 Emit 的 POST /emails。
 */
import { simpleParser } from 'mailparser';

/** 把 mailparser 的解析结果映射成 Emit /emails 请求体。 */
export function buildEmitPayload(parsed) {
  const fromAddr = parsed.from?.value?.[0]?.address || '';
  const fromName = parsed.from?.value?.[0]?.name || '';
  const from = fromAddr
    ? (fromName ? `${fromName} <${fromAddr}>` : fromAddr)
    : 'Emit <no-reply@localhost>';

  const to = [];
  const add = (v) => {
    for (const a of v?.value || []) if (a.address) to.push(a.address);
  };
  add(parsed.to);
  add(parsed.cc);
  add(parsed.bcc);
  const recipients = [...new Set(to)];

  const payload = {
    from,
    to: recipients,
    subject: parsed.subject || '(no subject)',
  };
  if (parsed.html) payload.html = parsed.html;
  if (parsed.text) payload.text = parsed.text;
  if (!payload.html && !payload.text) payload.text = '';

  const replyTo = (parsed.replyTo?.value || []).map((v) => v.address).filter(Boolean);
  if (replyTo.length) payload.reply_to = replyTo;

  const attachments = (parsed.attachments || []).map((a) => ({
    filename: a.filename || 'attachment',
    content: a.content.toString('base64'),
    ...(a.contentType ? { content_type: a.contentType } : {}),
    ...(a.cid ? { content_id: a.cid } : {}),
  }));
  if (attachments.length) payload.attachments = attachments;

  // 透传一部分自定义头，剔除由平台自行生成的头部
  const skip = new Set([
    'from', 'to', 'subject', 'reply-to', 'date', 'message-id', 'content-type',
    'mime-version', 'content-transfer-encoding', 'bcc', 'cc', 'received',
    'return-path', 'dkim-signature',
  ]);
  const headers = {};
  for (const [k, v] of parsed.headers || []) {
    const key = String(k).toLowerCase();
    if (skip.has(key)) continue;
    if (typeof v === 'string' && v.length < 1000) headers[key] = v;
  }
  if (Object.keys(headers).length) payload.headers = headers;

  return payload;
}

/** 解析原始邮件字节流。 */
export async function parseMessage(raw) {
  return simpleParser(raw);
}

/**
 * 调用 Emit 发送接口。
 * @returns {{ok: boolean, status: number, body: object, id?: string}}
 */
export async function sendToEmit(payload, { apiKey, url, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body, id: body?.id };
  } finally {
    clearTimeout(timer);
  }
}
