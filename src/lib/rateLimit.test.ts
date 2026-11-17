import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
  resetRateLimit,
} from "./rateLimit";

const START = Date.UTC(2026, 0, 1, 0, 0, 0);
const WINDOW_MS = 60_000;
const OPTIONS = { bucket: "test", limit: 3, windowMs: WINDOW_MS, key: "203.0.113.7" };

let now = START;

beforeEach(() => {
  now = START;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  resetRateLimit();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimit();
});

function advance(ms: number) {
  now += ms;
}

describe("checkRateLimit", () => {
  it("allows requests up to the limit and decrements remaining", () => {
    expect(checkRateLimit(OPTIONS)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(OPTIONS)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(OPTIONS)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });
  });

  it("denies over-limit requests and reports the time left in the window", () => {
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);

    advance(15_000);
    expect(checkRateLimit(OPTIONS)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 45,
    });
  });

  it("never reports a retryAfter below one second", () => {
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);

    advance(WINDOW_MS - 100);
    expect(checkRateLimit(OPTIONS).retryAfterSeconds).toBe(1);
  });

  it("isolates keys from each other", () => {
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);

    expect(
      checkRateLimit({ ...OPTIONS, key: "198.51.100.4" }),
    ).toMatchObject({ allowed: true, remaining: 2 });
    expect(checkRateLimit(OPTIONS)).toMatchObject({ allowed: false });
  });

  it("isolates buckets that share a key", () => {
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);

    expect(
      checkRateLimit({ ...OPTIONS, bucket: "other" }),
    ).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("starts a fresh window once windowMs has elapsed", () => {
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    expect(checkRateLimit(OPTIONS)).toMatchObject({ allowed: false });

    advance(WINDOW_MS);
    expect(checkRateLimit(OPTIONS)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
  });

  it("keeps counting while inside the same window", () => {
    checkRateLimit(OPTIONS);
    advance(WINDOW_MS - 1);
    expect(checkRateLimit(OPTIONS)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkRateLimit(OPTIONS)).toMatchObject({ allowed: true, remaining: 0 });
    expect(checkRateLimit(OPTIONS)).toMatchObject({ allowed: false });
  });

  it("clears all state with resetRateLimit", () => {
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    checkRateLimit(OPTIONS);
    expect(checkRateLimit(OPTIONS)).toMatchObject({ allowed: false });

    resetRateLimit();
    expect(checkRateLimit(OPTIONS)).toMatchObject({ allowed: true, remaining: 2 });
  });
});

describe("getClientIp", () => {
  const url = "http://localhost/api/test";

  it("uses the first x-forwarded-for entry", () => {
    const request = new Request(url, {
      headers: { "x-forwarded-for": " 203.0.113.9 , 10.0.0.1", "x-real-ip": "10.9.9.9" },
    });
    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    const request = new Request(url, { headers: { "x-real-ip": "198.51.100.8" } });
    expect(getClientIp(request)).toBe("198.51.100.8");
  });

  it("falls back to unknown", () => {
    expect(getClientIp(new Request(url))).toBe("unknown");
  });
});

describe("rateLimitResponse", () => {
  it("returns 429 with Retry-After and a JSON error body", async () => {
    const response = rateLimitResponse(42);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "Too many requests. Please try again later.",
    });
  });

  it("never sends a Retry-After below one second", () => {
    expect(rateLimitResponse(0).headers.get("retry-after")).toBe("1");
  });
});
