import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const circuits = await prisma.circuit.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        boardId: true,
        healthScore: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(circuits);
  } catch (error) {
    console.error("GET /api/circuits failed:", error);
    return Response.json({ error: "Failed to load circuits" }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

  const { title, description, boardId, stateJson, healthScore } = body as Record<
    string,
    unknown
  >;

  if (typeof title !== "string" || title.trim().length === 0) {
    return Response.json({ error: "`title` is required" }, { status: 400 });
  }
  if (typeof boardId !== "string" || boardId.trim().length === 0) {
    return Response.json({ error: "`boardId` is required" }, { status: 400 });
  }
  if (typeof stateJson !== "string" || stateJson.trim().length === 0) {
    return Response.json({ error: "`stateJson` is required" }, { status: 400 });
  }
  try {
    JSON.parse(stateJson);
  } catch {
    return Response.json(
      { error: "`stateJson` must be a valid JSON string" },
      { status: 400 },
    );
  }

  try {
    const circuit = await prisma.circuit.create({
      data: {
        title: title.trim(),
        description:
          typeof description === "string" && description.trim().length > 0
            ? description
            : null,
        boardId: boardId.trim(),
        stateJson,
        healthScore:
          typeof healthScore === "number" && Number.isFinite(healthScore)
            ? healthScore
            : 100,
      },
    });
    return Response.json(circuit, { status: 201 });
  } catch (error) {
    console.error("POST /api/circuits failed:", error);
    return Response.json({ error: "Failed to create circuit" }, { status: 500 });
  }
}
