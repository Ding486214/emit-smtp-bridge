/**
 * Emit HTTP 客户端：把 SMTP 解析结果投递到 Emit 的 POST /emails。
 */
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
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
 *
 * 刻意使用 node:https / node:http 而不是全局 fetch：fetch 由 undici 实现，
 * 依赖 WebAssembly 编译 llhttp，而 --jitless 模式下 WebAssembly 不可用。
 * 小内存 VPS 上账要关 JIT（见 deploy/README），所以这里不能依赖 WASM。
 *
 * @returns {{ok: boolean, status: number, body: object, id?: string}}
 */
export function sendToEmit(payload, { apiKey, url, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error(`EMIT_API_URL 不是合法 URL: ${url}`));
      return;
    }

    const body = JSON.stringify(payload);
    const isHttps = target.protocol === 'https:';
    const doRequest = isHttps ? httpsRequest : httpRequest;

    const req = doRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: parsed,
            id: parsed?.id,
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Emit 请求超时 (${timeoutMs}ms)`));
    });
    req.on('error', reject);
    req.end(body);
  });
}
