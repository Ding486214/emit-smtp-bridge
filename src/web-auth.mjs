/**
 * Web 认证：scrypt 密码哈希 + HMAC 签名会话 + CSRF token。
 * 只用 node:crypto，不引入任何第三方依赖（bcrypt 等原生模块在低配机上装起来麻烦）。
 */
import crypto from 'node:crypto';

export function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function scryptHash(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

/** 生成带过期时间与 CSRF 的会话 token（payload.sig，base64url）。 */
export function makeSession(user, secret, csrf, ttlMs = 12 * 3600 * 1000) {
  const exp = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ u: user, e: exp, c: csrf })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** 校验会话 token；返回 {user, csrf} 或 null。 */
export function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.e !== 'number' || Date.now() > data.e) return null;
    return { user: data.u, csrf: data.c };
  } catch {
    return null;
  }
}

/** 常数时间比较密码。 */
export function verifyPassword(input, hashHex, saltHex) {
  if (!hashHex || !saltHex) return false;
  const h = scryptHash(input, saltHex);
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
