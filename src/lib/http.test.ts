import { describe, expect, it } from "vitest";
import { readJsonBody, readJsonObjectBody } from "./http";

const url = "http://localhost/api/test";

function jsonRequest(body: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function stubRequest(headers: Record<string, string>, body: string): Request {
  return {
    headers: new Headers(headers),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  } as unknown as Request;
}

describe("readJsonBody", () => {
  it("parses a valid JSON body", async () => {
    const result = await readJsonBody(
      jsonRequest(JSON.stringify({ title: "ok", nested: { pins: [1, 2] } })),
      1024,
    );
    expect(result).toEqual({
      ok: true,
      value: { title: "ok", nested: { pins: [1, 2] } },
    });
  });

  it("rejects malformed JSON with 400", async () => {
    const result = await readJsonBody(jsonRequest("{ oops"), 1024);
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid JSON body" });
  });

  it("rejects a missing body with 400", async () => {
    const result = await readJsonBody(new Request(url, { method: "POST" }), 1024);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an oversized declared content-length with 413 before reading", async () => {
    let read = false;
    const request = {
      headers: new Headers({ "content-length": "2048" }),
      arrayBuffer: async () => {
        read = true;
        return new TextEncoder().encode("{}").buffer as ArrayBuffer;
      },
    } as unknown as Request;

    const result = await readJsonBody(request, 1024);
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(read).toBe(false);
  });

  it("rejects a body larger than the cap when no content-length is present", async () => {
    const result = await readJsonBody(jsonRequest("x".repeat(2048)), 1024);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("ignores a malformed content-length and still parses a small body", async () => {
    const result = await readJsonBody(
      stubRequest({ "content-length": "not-a-number" }, JSON.stringify({ ok: true })),
      1024,
    );
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it("rejects a body with invalid UTF-8 bytes", async () => {
    const request = {
      headers: new Headers({ "content-length": "2" }),
      arrayBuffer: async () => new Uint8Array([0xff, 0xfe]).buffer as ArrayBuffer,
    } as unknown as Request;

    const result = await readJsonBody(request, 1024);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("readJsonObjectBody", () => {
  it("accepts a JSON object", async () => {
    const result = await readJsonObjectBody(jsonRequest('{"a":1}'), 1024);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it.each(["[]", "null", "42", '"text"'])(
    "rejects the non-object JSON value %s with 400",
    async (body) => {
      const result = await readJsonObjectBody(jsonRequest(body), 1024);
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: "Request body must be a JSON object",
      });
    },
  );

  it("propagates the 413 from readJsonBody", async () => {
    const result = await readJsonObjectBody(jsonRequest("x".repeat(2048)), 1024);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });
});
