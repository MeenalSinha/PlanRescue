/**
 * In-Memory Sliding Window Rate Limiter (Spatial Phase 12)
 *
 * Enforces rate limits per client IP or user ID on sensitive mutation endpoints
 * to protect against automated brute-force, scraping, and denial-of-service.
 */

interface RateLimitRecord {
  timestamps: number[];
}

export class RateLimiter {
  private readonly records = new Map<string, RateLimitRecord>();
  private readonly defaultLimit: number;
  private readonly defaultWindowMs: number;

  constructor(defaultLimit = 60, defaultWindowMs = 60_000) {
    this.defaultLimit = defaultLimit;
    this.defaultWindowMs = defaultWindowMs;
  }

  check(key: string, limit = this.defaultLimit, windowMs = this.defaultWindowMs): {
    allowed: boolean;
    remaining: number;
    resetMs: number;
  } {
    const now = Date.now();
    const cutoff = now - windowMs;

    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Filter out expired timestamps
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);

    if (record.timestamps.length >= limit) {
      const oldest = record.timestamps[0] || now;
      const resetMs = Math.max(0, oldest + windowMs - now);
      return { allowed: false, remaining: 0, resetMs };
    }

    record.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - record.timestamps.length,
      resetMs: windowMs,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.records.delete(key);
    } else {
      this.records.clear();
    }
  }
}

let globalLimiter: RateLimiter | null = null;

export function getGlobalRateLimiter(): RateLimiter {
  if (!globalLimiter) {
    globalLimiter = new RateLimiter(60, 60_000);
  }
  return globalLimiter;
}
