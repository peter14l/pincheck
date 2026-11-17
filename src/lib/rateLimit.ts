/**
 * Best-effort, per-process, in-memory rate limiting.
 *
 * This is deliberately simple: a fixed window counter keyed by client IP and
 * bucket name. It is NOT a security boundary on its own:
 *
 * - State lives in one Node.js process. Multiple instances, serverless
 *   invocations, or a restart all start from zero.
 * - Client IPs come from `x-forwarded-for` / `x-real-ip`, which are only
 *   trustworthy behind a proxy that overwrites them.
 *
 * It exists to blunt accidental or cheap abuse of the JSON/API surface without
 * adding infrastructure.
 */

export interface RateLimitOptions {
  /** Logical bucket name, e.g. "circuits:create". */
  bucket: string;
  /** Maximum requests allowed per key per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Identity to throttle. Defaults to "unknown". */
  key?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Whole seconds until the window resets; 0 when the request is allowed. */
  retryAfterSeconds: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();
const MAX_TRACKED_WINDOWS = 10_000;

function pruneExpired(now: number) {
  for (const [key, state] of windows) {
    if (state.resetAt <= now) windows.delete(key);
  }
}

/**
 * Record a request against a fixed window and report whether it is allowed.
 * Deterministic: it only reads `Date.now()`.
 */
export function checkRateLimit({
  bucket,
  limit,
  windowMs,
  key = "unknown",
}: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const storeKey = `${key}:${bucket}`;
  const window = windows.get(storeKey);

  if (!window || window.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_WINDOWS) pruneExpired(now);
    windows.set(storeKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }

  if (window.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  window.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - window.count),
    retryAfterSeconds: 0,
  };
}

/** Drop all rate-limit state. Intended for tests. */
export function resetRateLimit(): void {
  windows.clear();
}

/**
 * Best-effort client identity: first `x-forwarded-for` entry, then `x-real-ip`,
 * then "unknown".
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

/** 429 response with a `Retry-After` header and a JSON error body. */
export function rateLimitResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    },
  );
}
