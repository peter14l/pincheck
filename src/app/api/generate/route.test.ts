import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resetRateLimit } from "@/lib/rateLimit";

describe("POST /api/generate", () => {
  beforeEach(() => {
    resetRateLimit();
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  function makeRequest(body: unknown, ip = "10.2.0.1") {
    return new Request("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    });
  }

  it("returns a deterministic circuit without AI keys", async () => {
    const res = await POST(makeRequest({ prompt: "ESP32 weather station with OLED and BME280" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.usedAI).toBe(false);
    expect(json.boardId).toBe("esp32_devkit_v1");
    expect(Array.isArray(json.circuitState.components)).toBe(true);
    expect(json.circuitState.components.filter((c: { kind: string }) => c.kind === "peripheral").length).toBeGreaterThanOrEqual(2);
    expect(typeof json.healthScore).toBe("number");
  });

  it("rejects an empty prompt", async () => {
    const res = await POST(makeRequest({ prompt: "   " }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-string prompt", async () => {
    const res = await POST(makeRequest({ prompt: 42 }));
    expect(res.status).toBe(400);
  });

  it("rejects an over-long prompt", async () => {
    const res = await POST(makeRequest({ prompt: "a".repeat(1001) }));
    expect(res.status).toBe(400);
  });

  it("rejects oversized bodies with 413", async () => {
    const huge = "x".repeat(10 * 1024);
    const req = new Request("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(huge.length),
        "x-forwarded-for": "10.2.0.2",
      },
      body: huge,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("rejects invalid JSON", async () => {
    const req = new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.2.0.3" },
      body: "{bad",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("uses AI when configured and falls back on upstream failure", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const res = await POST(makeRequest({ prompt: "ESP32 weather station with OLED and BME280" }, "10.2.0.4"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.usedAI).toBe(false);
    expect(json.boardId).toBe("esp32_devkit_v1");
  });

  it("uses AI result when upstream returns a valid intent", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ boardId: "arduino_uno_r3", peripherals: ["ssd1306"] }) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const res = await POST(makeRequest({ prompt: "arduino with oled" }, "10.2.0.5"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.usedAI).toBe(true);
    expect(json.boardId).toBe("arduino_uno_r3");
    expect(json.aiProvider).toBe("openai");
  });

  it("enforces the rate limit", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await POST(makeRequest({ prompt: "ESP32" }, "10.2.0.6"));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
