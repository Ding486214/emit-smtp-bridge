/**
 * 每 IP 速率限制（内存实现，进程重启即清零）。
 */
export function createRateLimiter({ limitPerHour = 120 } = {}) {
  const buckets = new Map(); // ip -> { count, resetAt }

  return {
    /** 返回 true 表示该 IP 已超限，应拒绝。 */
    hit(ip, now = Date.now()) {
      if (!limitPerHour || limitPerHour <= 0) return false;
      const b = buckets.get(ip);
      if (!b || now > b.resetAt) {
        buckets.set(ip, { count: 1, resetAt: now + 3600_000 });
        if (buckets.size > 10_000) {
          for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
        }
        return false;
      }
      b.count += 1;
      return b.count > limitPerHour;
    },
    size() { return buckets.size; },
  };
}
