/**
 * 发送历史：追加式 JSONL 文件，超限自动轮转。
 * 刻意用文件而非数据库，避免原生依赖，单机够用。
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

/** 追加一条发送记录。写失败不影响发信主流程。 */
export function appendHistory(file, entry) {
  const line = JSON.stringify({ t: Date.now(), ...entry }) + '\n';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch { /* 目录已存在或不可建，继续尝试写 */ }
  try {
    fs.appendFileSync(file, line);
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
    } catch { /* 轮转失败可忽略 */ }
  } catch { /* 历史写入失败不应影响发信 */ }
}

/** 读取最近 limit 条，新的在前。 */
export function readHistory(file, limit = 100) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const lines = txt.split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch { /* 跳过坏行 */ }
  }
  return out;
}
