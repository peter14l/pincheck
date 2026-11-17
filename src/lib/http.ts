/**
 * Shared request parsing helpers for route handlers.
 *
 * Route handlers must never trust `Content-Length` and must never buffer an
 * unbounded body: `readJsonBody` checks the declared length first (cheap 413)
 * and then enforces the same cap against the bytes actually received.
 */

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

export type JsonObjectBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: number; error: string };

function tooLarge(maxBytes: number): { ok: false; status: 413; error: string } {
  return {
    ok: false,
    status: 413,
    error: `Request body is too large (max ${maxBytes} bytes)`,
  };
}

function invalidJson(): { ok: false; status: 400; error: string } {
  return { ok: false, status: 400, error: "Invalid JSON body" };
}

/**
 * Read and parse a JSON request body with a hard byte cap.
 *
 * - Declared `Content-Length` above the cap is rejected with 413 before reading.
 * - Missing or malformed `Content-Length` is ignored; the actual byte count is
 *   still enforced after reading.
 * - Empty bodies and malformed JSON are rejected with 400.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && declaredLength.trim() !== "") {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return tooLarge(maxBytes);
    }
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return { ok: false, status: 400, error: "Failed to read request body" };
  }

  if (buffer.byteLength === 0) {
    return invalidJson();
  }
  if (buffer.byteLength > maxBytes) {
    return tooLarge(maxBytes);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid UTF-8" };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return invalidJson();
  }
}

/**
 * Same as `readJsonBody`, but also requires the parsed value to be a plain
 * JSON object (not an array or primitive).
 */
export async function readJsonObjectBody(
  request: Request,
  maxBytes: number,
): Promise<JsonObjectBodyResult> {
  const result = await readJsonBody(request, maxBytes);
  if (!result.ok) return result;

  const { value } = result;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}
