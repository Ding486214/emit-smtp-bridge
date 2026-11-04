/**
 * 日志：输出到 stdout，并可选同时追加到文件。
 */
import fs from 'node:fs';

export function createLogger({ logFile = '', component = 'emit-smtp' } = {}) {
  const write = (level, msg) => {
    const line = `${new Date().toISOString()} [${component}] [${level}] ${msg}`;
    if (level === 'ERROR') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
    if (logFile) {
      try { fs.appendFileSync(logFile, line + '\n'); } catch { /* 日志失败不应影响主流程 */ }
    }
  };
  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
  };
}
