import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const prismaMock = vi.hoisted(() => ({
  circuit: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

function makeRequest(body?: unknown, ip = "10.0.0.1") {
  return new Request("http://localhost/api/circuits", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  prismaMock.circuit.findMany.mockReset();
  prismaMock.circuit.create.mockReset();
});

describe("GET /api/circuits", () => {
  it("derives board name, peripheral count, and recomputed health", async () => {
    prismaMock.circuit.findMany.mockResolvedValue([
      {
        id: "c1",
        title: "Weather",
        description: "desc",
        boardId: "esp32_devkit_v1",
        stateJson: JSON.stringify({
          components: [
            { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
            { id: "oled", kind: "peripheral", refId: "ssd1306" },
          ],
          wires: [],
        }),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({
      id: "c1",
      title: "Weather",
      boardName: "ESP32 DevKit V1 (30-pin)",
      peripheralCount: 1,
      valid: true,
    });
    expect(typeof json[0].healthScore).toBe("number");
  });

  it("returns an empty array when nothing is stored", async () => {
    prismaMock.circuit.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns 500 when the database fails", async () => {
    prismaMock.circuit.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/circuits", () => {
  it("creates a circuit with server-derived boardId and health", async () => {
    prismaMock.circuit.create.mockResolvedValue({ id: "new-1" });
    const body = {
      title: "  My Circuit  ",
      description: "  hello  ",
      stateJson: JSON.stringify({
        components: [
          { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
          { id: "oled", kind: "peripheral", refId: "ssd1306" },
        ],
        wires: [
          { id: "v", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "oled", pinId: "VCC" } },
        ],
      }),
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(201);
    const createArgs = prismaMock.circuit.create.mock.calls[0][0];
    expect(createArgs.data.title).toBe("My Circuit");
    expect(createArgs.data.description).toBe("hello");
    expect(createArgs.data.boardId).toBe("esp32_devkit_v1");
    expect(typeof createArgs.data.stateJson).toBe("string");
    expect(typeof createArgs.data.healthScore).toBe("number");
  });

  it("rejects invalid JSON", async () => {
    const req = new Request("http://localhost/api/circuits", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.2" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a non-object body", async () => {
    const res = await POST(makeRequest(["nope"], "10.0.0.3"));
    expect(res.status).toBe(400);
  });

  it("requires a title", async () => {
    const res = await POST(makeRequest({ stateJson: "{}" }, "10.0.0.4"));
    expect(res.status).toBe(400);
  });

  it("requires stateJson", async () => {
    const res = await POST(makeRequest({ title: "x" }, "10.0.0.5"));
    expect(res.status).toBe(400);
  });

  it("rejects malformed circuit state", async () => {
    const res = await POST(
      makeRequest({ title: "x", stateJson: "not json" }, "10.0.0.6"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown boards", async () => {
    const res = await POST(
      makeRequest(
        {
          title: "x",
          boardId: "nope",
          stateJson: JSON.stringify({
            components: [{ id: "mcu", kind: "board", refId: "nope" }],
            wires: [],
          }),
        },
        "10.0.0.7",
      ),
    );
    expect(res.status).toBe(400);
  });

  it("rejects oversized bodies with 413", async () => {
    const huge = "x".repeat(300 * 1024);
    const req = new Request("http://localhost/api/circuits", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(huge.length),
        "x-forwarded-for": "10.0.0.8",
      },
      body: huge,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("returns 500 when the database fails", async () => {
    prismaMock.circuit.create.mockRejectedValue(new Error("db down"));
    const res = await POST(
      makeRequest(
        {
          title: "x",
          stateJson: JSON.stringify({
            components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
            wires: [],
          }),
        },
        "10.0.0.9",
      ),
    );
    expect(res.status).toBe(500);
  });
});
