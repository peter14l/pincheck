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
import { readJsonObjectBody } from "@/lib/http";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rateLimit";

const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT = { bucket: "circuits:create", limit: 20, windowMs: 60_000 };

export async function GET() {
  try {
    const circuits = await prisma.circuit.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        boardId: true,
        stateJson: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(
      circuits.map((circuit) => {
        const state = parseCircuitState(circuit.stateJson);
        const diagnostics = state ? lintCircuit(state) : [];
        return {
          id: circuit.id,
          title: circuit.title,
          description: circuit.description,
          boardId: circuit.boardId,
          boardName: getBoard(circuit.boardId)?.name ?? circuit.boardId,
          peripheralCount: state
            ? state.components.filter((component) => component.kind === "peripheral").length
            : 0,
          healthScore: state ? scoreDiagnostics(diagnostics) : 0,
          valid: Boolean(state),
          createdAt: circuit.createdAt,
        };
      }),
    );
  } catch (error) {
    console.error("GET /api/circuits failed:", error);
    return Response.json({ error: "Failed to load circuits" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const limit = checkRateLimit({ ...RATE_LIMIT, key: getClientIp(request) });
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }

  const parsed = await readJsonObjectBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status });
  }

  const input = parsed.value;
  const title = validateTitle(input.title);
  if (!title) {
    return Response.json(
      { error: "`title` is required and must be 1-120 characters" },
      { status: 400 },
    );
  }

  const description = validateDescription(input.description);
  if (description === undefined && input.description !== undefined) {
    return Response.json({ error: "`description` must be a string or null" }, { status: 400 });
  }

  if (input.stateJson === undefined) {
    return Response.json({ error: "`stateJson` is required" }, { status: 400 });
  }

  const validated = validateCircuitState(input.stateJson, input.boardId);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  try {
    const circuit = await prisma.circuit.create({
      data: {
        title,
        description: description ?? null,
        boardId: validated.value.boardId,
        stateJson: validated.value.stateJson,
        healthScore: validated.value.healthScore,
      },
    });
    return Response.json(circuit, { status: 201 });
  } catch (error) {
    console.error("POST /api/circuits failed:", error);
    return Response.json({ error: "Failed to create circuit" }, { status: 500 });
  }
}
