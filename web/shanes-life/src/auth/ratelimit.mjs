// A real, in-process sliding-window limiter.
//
// In-process is the correct scope here and not a shortcut: the deployment is a single Node
// process on Replit, and the durable record of every attempt still lands in the auth_events
// table, so nothing is lost on restart except the counters themselves -- which is the
// conservative direction to fail (a restart forgives, it never locks someone out).

const buckets = new Map();

/**
 * @param {string} key      what is being limited (e.g. "login:ip:1.2.3.4")
 * @param {number} limit    allowed hits inside the window
 * @param {number} windowMs window length in milliseconds
 */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const stamps = (buckets.get(key) || []).filter((t) => t > cutoff);
  stamps.push(now);
  buckets.set(key, stamps);
  const allowed = stamps.length <= limit;
  const retryAfterMs = allowed ? 0 : Math.max(0, stamps[0] + windowMs - now);
  return { allowed, remaining: Math.max(0, limit - stamps.length), retryAfterMs };
}

/** Called on a successful login so a legitimate sign-in clears the pressure it built up. */
export function clear(key) {
  buckets.delete(key);
}

/** Drop empty/expired buckets so a long-running process does not grow a map forever. */
export function sweep(maxAgeMs = 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, stamps] of buckets) {
    const live = stamps.filter((t) => t > cutoff);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}
