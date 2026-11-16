import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id } });
    if (!circuit) {
      return Response.json(
        { error: `Circuit "${id}" not found` },
        { status: 404 },
      );
    }
    return Response.json(circuit);
  } catch (error) {
    console.error(`GET /api/circuits/${id} failed:`, error);
    return Response.json({ error: "Failed to load circuit" }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;
  const data: {
    title?: string;
    description?: string | null;
    boardId?: string;
    stateJson?: string;
    healthScore?: number;
  } = {};

  if ("title" in input) {
    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      return Response.json(
        { error: "`title` must be a non-empty string" },
        { status: 400 },
      );
    }
    data.title = input.title.trim();
  }
  if ("description" in input) {
    if (input.description !== null && typeof input.description !== "string") {
      return Response.json(
        { error: "`description` must be a string or null" },
        { status: 400 },
      );
    }
    data.description = input.description as string | null;
  }
  if ("boardId" in input) {
    if (typeof input.boardId !== "string" || input.boardId.trim().length === 0) {
      return Response.json(
        { error: "`boardId` must be a non-empty string" },
        { status: 400 },
      );
    }
    data.boardId = input.boardId.trim();
  }
  if ("stateJson" in input) {
    if (
      typeof input.stateJson !== "string" ||
      input.stateJson.trim().length === 0
    ) {
      return Response.json(
        { error: "`stateJson` must be a non-empty string" },
        { status: 400 },
      );
    }
    try {
      JSON.parse(input.stateJson);
    } catch {
      return Response.json(
        { error: "`stateJson` must be a valid JSON string" },
        { status: 400 },
      );
    }
    data.stateJson = input.stateJson;
  }
  if ("healthScore" in input) {
    if (typeof input.healthScore !== "number" || !Number.isFinite(input.healthScore)) {
      return Response.json(
        { error: "`healthScore` must be a number" },
        { status: 400 },
      );
    }
    data.healthScore = input.healthScore;
  }

  if (Object.keys(data).length === 0) {
    return Response.json(
      { error: "No updatable fields provided" },
      { status: 400 },
    );
  }

  try {
    const circuit = await prisma.circuit.update({ where: { id }, data });
    return Response.json(circuit);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return Response.json(
        { error: `Circuit "${id}" not found` },
        { status: 404 },
      );
    }
    console.error(`PUT /api/circuits/${id} failed:`, error);
    return Response.json({ error: "Failed to update circuit" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    await prisma.circuit.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return Response.json(
        { error: `Circuit "${id}" not found` },
        { status: 404 },
      );
    }
    console.error(`DELETE /api/circuits/${id} failed:`, error);
    return Response.json({ error: "Failed to delete circuit" }, { status: 500 });
  }
}
