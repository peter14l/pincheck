import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getBoard,
  lintCircuit,
  parseCircuitState,
  scoreDiagnostics,
} from "@/lib/hardwareEngine";
import {
  validateCircuitState,
  validateDescription,
  validateTitle,
} from "@/lib/circuitInput";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const circuit = await prisma.circuit.findUnique({ where: { id } });
    if (!circuit) {
      return Response.json({ error: `Circuit "${id}" not found` }, { status: 404 });
    }

    const state = parseCircuitState(circuit.stateJson);
    const diagnostics = state ? lintCircuit(state) : [];
    return Response.json({
      ...circuit,
      boardName: getBoard(circuit.boardId)?.name ?? circuit.boardId,
      stateJson: state ? JSON.stringify(state) : circuit.stateJson,
      healthScore: state ? scoreDiagnostics(diagnostics) : 0,
      valid: Boolean(state),
    });
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
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
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
    const title = validateTitle(input.title);
    if (!title) {
      return Response.json(
        { error: "`title` must be a non-empty string of at most 120 characters" },
        { status: 400 },
      );
    }
    data.title = title;
  }

  if ("description" in input) {
    const description = validateDescription(input.description);
    if (description === undefined) {
      return Response.json(
        { error: "`description` must be a string or null" },
        { status: 400 },
      );
    }
    data.description = description;
  }

  if ("boardId" in input && !("stateJson" in input)) {
    return Response.json(
      { error: "`boardId` is derived from `stateJson`; update them together" },
      { status: 400 },
    );
  }

  if ("stateJson" in input) {
    const validated = validateCircuitState(input.stateJson, input.boardId);
    if (!validated.ok) {
      return Response.json({ error: validated.error }, { status: 400 });
    }
    data.stateJson = validated.value.stateJson;
    data.boardId = validated.value.boardId;
    data.healthScore = validated.value.healthScore;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  try {
    const circuit = await prisma.circuit.update({ where: { id }, data });
    return Response.json(circuit);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return Response.json({ error: `Circuit "${id}" not found` }, { status: 404 });
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return Response.json({ error: `Circuit "${id}" not found` }, { status: 404 });
    }
    console.error(`DELETE /api/circuits/${id} failed:`, error);
    return Response.json({ error: "Failed to delete circuit" }, { status: 500 });
  }
}
