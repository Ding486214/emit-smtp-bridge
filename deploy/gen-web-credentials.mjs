#!/usr/bin/env node
/**
 * 生成 Web 登录密码的 scrypt 哈希与盐（供 install.sh 调用）。
 * 用法: node deploy/gen-web-credentials.mjs <明文密码>
 */
import crypto from 'node:crypto';
import { scryptHash } from '../src/web-auth.mjs';

const pass = process.argv[2];
if (!pass) {
  console.error('usage: node gen-web-credentials.mjs <password>');
  process.exit(1);
}
const salt = crypto.randomBytes(16).toString('hex');
// 与 web-auth.mjs 的 verifyPassword 保持一致（salt 为 hex，解码后作为盐）
const hash = scryptHash(pass, salt);
console.log(`WEB_SALT=${salt}`);
console.log(`WEB_PASS_HASH=${hash}`);
