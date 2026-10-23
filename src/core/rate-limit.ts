/** Token bucket: `capacity` burst, refilled at `refillPerSec`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Blocks a key (e.g. IP) after too many failures inside a window. */
export class FailureLimiter {
  private readonly entries = new Map<string, { count: number; first: number; blockedUntil: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly blockMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(key: string): boolean {
    const e = this.entries.get(key);
    return !!e && e.blockedUntil > this.now();
  }

  fail(key: string): void {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || t - e.first > this.windowMs) {
      e = { count: 0, first: t, blockedUntil: 0 };
      this.entries.set(key, e);
    }
    e.count += 1;
    if (e.count >= this.maxFailures) {
      e.blockedUntil = t + this.blockMs;
      e.count = 0;
      e.first = t;
    }
    if (this.entries.size > 10_000) this.prune();
  }

  private prune(): void {
    const t = this.now();
    for (const [k, e] of this.entries) {
      if (e.blockedUntil < t && t - e.first > this.windowMs) this.entries.delete(k);
    }
  }
}
