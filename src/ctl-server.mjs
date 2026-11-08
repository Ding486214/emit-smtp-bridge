#!/usr/bin/env node
/**
 * emit-smtp-ctl —— root 权限守护进程（极小、只暴露白名单操作）。
 *
 * 以独立 systemd 服务运行（User=root），监听 Unix socket，只有
 * root:emit-smtp 0660 权限的 socket，主服务（低权用户 emit-smtp）通过
 * ctl-client.mjs 调用。这样「完整管理」不需要把主服务提权。
 *
 * 协议：一行一个 JSON 请求，回一行 JSON 响应。
 *   {"cmd":"get_env"}              → 返回 SMTP 相关 env（不含 API key / web 密码哈希）
 *   {"cmd":"set_env","key","value"}→ 校验后原子写回 env（仅白名单键）
 *   {"cmd":"set_web_pass","value"} → 重算 web 登录密码哈希
 *   {"cmd":"restart"}              → systemctl restart emit-smtp
 *   {"cmd":"status"}               → 服务状态
 *   {"cmd":"logs","n":50}          → journalctl 尾部日志
 */
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { scryptHash } from './web-auth.mjs';

const ENV_FILE = process.env.CTL_ENV_FILE || '/etc/emit-smtp/env';
const SOCK = process.env.CTL_SOCK || '/run/emit-smtp/ctl.sock';
const SERVICE = process.env.CTL_SERVICE || 'emit-smtp';

const ALLOWED_KEYS = new Set([
  'EMIT_SMTP_HOST',
  'EMIT_SMTP_PORT',
  'EMIT_SMTP_SECURE',
  'EMIT_SMTP_USER',
  'EMIT_SMTP_PASS',
  'EMIT_RATE_PER_HOUR',
]);

function readEnv() {
  const txt = fs.readFileSync(ENV_FILE, 'utf8');
  const map = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function validate(key, value) {
  switch (key) {
    case 'EMIT_SMTP_PORT': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return '端口必须是 1-65535 的整数';
      return null;
    }
    case 'EMIT_SMTP_SECURE':
      if (value !== '0' && value !== '1') return 'SECURE 只能是 0 或 1';
      return null;
    case 'EMIT_RATE_PER_HOUR': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return '限速必须是非负整数';
      return null;
    }
    case 'EMIT_SMTP_HOST':
      if (!value || /\s/.test(value)) return 'HOST 不能为空或含空白';
      return null;
    case 'EMIT_SMTP_USER':
      if (!value || /[\s:]/.test(value)) return '用户名不能为空或含空白/冒号';
      return null;
    case 'EMIT_SMTP_PASS':
      if (!value || value.length > 128 || /[\r\n]/.test(value)) return '密码不能为空、超 128 字符或含换行';
      return null;
    default:
      return '不允许的键 ' + key;
  }
}

/** 原子写回 env，并保持 root:emit-smtp 0640。 */
function writeEnv(key, value) {
  const txt = fs.readFileSync(ENV_FILE, 'utf8');
  const lines = txt.split('\n');
  let replaced = false;
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && m[1] === key) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) out.push(`${key}=${value}`);
  const content = out.join('\n').replace(/\n+$/, '') + '\n';
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o640 });
  fs.renameSync(tmp, ENV_FILE);
  try {
    execFileSync('chown', ['root:emit-smtp', ENV_FILE]);
    execFileSync('chmod', ['640', ENV_FILE]);
  } catch { /* 属主设置失败可容忍，但会打印 */ }
}

function run(cmd, args, timeout = 20_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
        err: err ? String(err.message) : '',
      });
    });
  });
}

async function handle(cmd) {
  switch (cmd.cmd) {
    case 'ping':
      return { ok: true, data: 'pong' };

    case 'get_env': {
      const env = readEnv();
      const data = {};
      for (const k of ALLOWED_KEYS) data[k] = env[k] ?? '';
      return { ok: true, data };
    }

    case 'set_env': {
      if (!ALLOWED_KEYS.has(cmd.key)) return { ok: false, error: '不允许的键' };
      const err = validate(cmd.key, String(cmd.value ?? ''));
      if (err) return { ok: false, error: err };
      writeEnv(cmd.key, String(cmd.value));
      return { ok: true };
    }

    case 'set_web_pass': {
      const p = String(cmd.value ?? '');
      if (p.length < 6 || p.length > 128) return { ok: false, error: 'web 密码需 6-128 位' };
      const salt = crypto.randomBytes(16).toString('hex');
      // 必须与 verifyPassword 用同一套：salt 为 hex，解码成字节后作为 scrypt 的盐
      const hash = scryptHash(p, salt);
      writeEnv('WEB_SALT', salt);
      writeEnv('WEB_PASS_HASH', hash);
      return { ok: true };
    }

    case 'restart': {
      // 不在 ctl 单元上下文里直接等待 restart 任务：那样 systemd 会因 ordering /
      // cgroup 关系让子 systemctl 收到信号、或让目标停在 deactivating。
      // 改成用 systemd-run 起一个独立瞬态单元去重启，ctl 只负责投递。
      const unit = `emit-smtp-restart-${Date.now()}`;
      const r = await run('systemd-run',
        ['--quiet', '--collect', '--no-block', '--unit', unit, '/bin/systemctl', 'restart', SERVICE]);
      if (r.code === 0) return { ok: true };
      // 兜底：直接投递（--no-block 只排队即返回，不等待）
      const r2 = await run('systemctl', ['restart', '--no-block', SERVICE]);
      if (r2.code === 0) return { ok: true };
      return {
        ok: false,
        error: ((r.stderr || r.err || '') + ' / ' + (r2.stderr || r2.err || '')).trim() || 'restart failed',
      };
    }

    case 'status': {
      const active = await run('systemctl', ['is-active', SERVICE]);
      const show = await run('systemctl', ['show', SERVICE, '-p', 'ActiveState', '-p', 'SubState', '-p', 'NRestarts', '-p', 'MainPID', '-p', 'ExecMainStartTimestamp', '-p', 'MemoryCurrent']);
      return { ok: true, data: { active: active.stdout.trim(), fields: show.stdout.trim() } };
    }

    case 'logs': {
      const n = Math.min(Math.max(Number(cmd.n) || 50, 1), 500);
      const r = await run('journalctl', ['-u', SERVICE, '-n', String(n), '-o', 'cat', '--no-pager']);
      return { ok: true, data: r.stdout };
    }

    default:
      return { ok: false, error: '未知命令' };
  }
}

if (fs.existsSync(SOCK)) {
  try { fs.unlinkSync(SOCK); } catch { /* 忽略 */ }
}

const server = net.createServer((conn) => {
  let buf = '';
  conn.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let req;
      try { req = JSON.parse(line); } catch {
        conn.write(JSON.stringify({ ok: false, error: 'bad json' }) + '\n');
        continue;
      }
      handle(req)
        .then((res) => conn.write(JSON.stringify(res) + '\n'))
        .catch((e) => conn.write(JSON.stringify({ ok: false, error: String(e.message) }) + '\n'));
    }
  });
});

server.listen(SOCK, () => {
  try {
    execFileSync('chown', ['root:emit-smtp', SOCK]);
    execFileSync('chmod', ['660', SOCK]);
  } catch { /* socket 属主设置失败可容忍 */ }
  process.stdout.write(`ctl ready ${SOCK}\n`);
});
