'use strict';
// In-memory sliding-window limiter. Fine for one server process.
// If you run several instances, move this to Redis (same interface).
const buckets = new Map();
function hit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000)) };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true };
}
function reset(key) { buckets.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 3600e3) buckets.delete(k);
}, 600e3).unref();
module.exports = { hit, reset };
