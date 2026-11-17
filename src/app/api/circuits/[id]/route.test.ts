import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DELETE, GET, PUT } from "./route";

const prismaMock = vi.hoisted(() => ({
  circuit: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

function makeRequest(method: string, body?: unknown, ip = "10.1.0.1") {
  return new Request("http://localhost/api/circuits/c1", {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  prismaMock.circuit.findUnique.mockReset();
  prismaMock.circuit.update.mockReset();
  prismaMock.circuit.delete.mockReset();
});

describe("GET /api/circuits/[id]", () => {
  it("returns a circuit with recomputed health", async () => {
    prismaMock.circuit.findUnique.mockResolvedValue({
      id: "c1",
      title: "Weather",
      description: null,
      boardId: "esp32_devkit_v1",
      stateJson: JSON.stringify({
        components: [
          { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
          { id: "oled", kind: "peripheral", refId: "ssd1306" },
        ],
        wires: [],
      }),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      healthScore: 999,
    });
    const res = await GET(makeRequest("GET"), ctx("c1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.healthScore).not.toBe(999);
    expect(json.boardName).toBe("ESP32 DevKit V1 (30-pin)");
    expect(json.valid).toBe(true);
  });

  it("returns 404 for a missing circuit", async () => {
    prismaMock.circuit.findUnique.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an invalid id without reflecting it", async () => {
    const res = await GET(makeRequest("GET"), ctx("a".repeat(100)));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("a".repeat(100));
  });
});

describe("PUT /api/circuits/[id]", () => {
  it("updates the title only", async () => {
    prismaMock.circuit.update.mockResolvedValue({ id: "c1", title: "New" });
    const res = await PUT(makeRequest("PUT", { title: "New" }), ctx("c1"));
    expect(res.status).toBe(200);
    expect(prismaMock.circuit.update.mock.calls[0][0].data.title).toBe("New");
  });

  it("allows a null description", async () => {
    prismaMock.circuit.update.mockResolvedValue({ id: "c1" });
    const res = await PUT(makeRequest("PUT", { description: null }), ctx("c1"));
    expect(res.status).toBe(200);
    expect(prismaMock.circuit.update.mock.calls[0][0].data.description).toBeNull();
  });

  it("rejects boardId without stateJson", async () => {
    const res = await PUT(makeRequest("PUT", { boardId: "esp32_devkit_v1" }), ctx("c1"));
    expect(res.status).toBe(400);
  });

  it("rejects an empty update", async () => {
    const res = await PUT(makeRequest("PUT", {}), ctx("c1"));
    expect(res.status).toBe(400);
  });

  it("rejects malformed state", async () => {
    const res = await PUT(makeRequest("PUT", { stateJson: "nope" }), ctx("c1"));
    expect(res.status).toBe(400);
  });

  it("maps P2025 to 404", async () => {
    prismaMock.circuit.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("missing", {
        code: "P2025",
        clientVersion: "7.10.1",
      }),
    );
    const res = await PUT(makeRequest("PUT", { title: "x" }), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("rejects oversized bodies with 413", async () => {
    const huge = "x".repeat(300 * 1024);
    const req = new Request("http://localhost/api/circuits/c1", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "content-length": String(huge.length),
        "x-forwarded-for": "10.1.0.2",
      },
      body: huge,
    });
    const res = await PUT(req, ctx("c1"));
    expect(res.status).toBe(413);
  });
});

describe("DELETE /api/circuits/[id]", () => {
  it("returns 204 on success", async () => {
    prismaMock.circuit.delete.mockResolvedValue({ id: "c1" });
    const res = await DELETE(makeRequest("DELETE"), ctx("c1"));
    expect(res.status).toBe(204);
  });

  it("maps P2025 to 404", async () => {
    prismaMock.circuit.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("missing", {
        code: "P2025",
        clientVersion: "7.10.1",
      }),
    );
    const res = await DELETE(makeRequest("DELETE", undefined, "10.1.0.3"), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("rejects oversized ids", async () => {
    const res = await DELETE(makeRequest("DELETE", undefined, "10.1.0.4"), ctx("a".repeat(100)));
    expect(res.status).toBe(404);
  });
});
