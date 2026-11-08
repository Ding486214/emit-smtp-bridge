/**
 * 调用 root 守护进程 emit-smtp-ctl（Unix socket，一行一 JSON）。
 */
import net from 'node:net';

export function ctlRequest(sockPath, cmd, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(sockPath);
    let buf = '';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('ctl 请求超时'));
    }, timeoutMs);

    sock.on('connect', () => sock.write(JSON.stringify(cmd) + '\n'));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const i = buf.indexOf('\n');
      if (i >= 0) {
        clearTimeout(timer);
        const line = buf.slice(0, i);
        sock.destroy();
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error('ctl 响应不是合法 JSON'));
        }
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
