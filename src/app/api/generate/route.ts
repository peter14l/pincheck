import {
  buildCircuitFromPlan,
  generateCircuitFromPrompt,
  type CircuitGenerationResult,
} from "@/lib/circuitGenerator";
import { BOARDS, PERIPHERALS, getBoard, getPeripheral } from "@/lib/hardwareEngine";

interface AiIntent {
  boardId: string;
  peripherals: string[];
}

const SYSTEM_PROMPT = `You translate hardware project descriptions into a JSON plan.
Return ONLY JSON with this shape:
{"boardId":"<board id>","peripherals":["<peripheral id>", ...]}
Allowed board ids: ${Object.keys(BOARDS).join(", ")}.
Allowed peripheral ids: ${Object.keys(PERIPHERALS).join(", ")}.
Choose the board the user explicitly names. If they name no board, pick one that can
safely host every peripheral. Include every peripheral the user mentions, and no extras.`;

function parseIntent(value: unknown): AiIntent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const boardId = typeof record.boardId === "string" ? record.boardId : "";
  if (!getBoard(boardId)) return null;
  if (!Array.isArray(record.peripherals)) return null;
  const peripherals = Array.from(
    new Set(
      record.peripherals.filter(
        (entry): entry is string => typeof entry === "string" && Boolean(getPeripheral(entry)),
      ),
    ),
  );
  if (peripherals.length === 0) return null;
  return { boardId, peripherals };
}

async function interpretWithOpenAI(prompt: string, apiKey: string): Promise<AiIntent | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  return parseIntent(JSON.parse(content));
}

async function interpretWithGemini(prompt: string, apiKey: string): Promise<AiIntent | null> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\nProject: ${prompt}` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) return null;
  return parseIntent(JSON.parse(content));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const prompt = (body as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return Response.json({ error: "A non-empty prompt is required" }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return Response.json({ error: "Prompt is too long (max 2000 characters)" }, { status: 400 });
  }

  const deterministic: CircuitGenerationResult = await generateCircuitFromPrompt(prompt);

  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!openAiKey && !geminiKey) {
    return Response.json({ ...deterministic, usedAI: false });
  }

  try {
    const intent = openAiKey
      ? await interpretWithOpenAI(prompt, openAiKey)
      : await interpretWithGemini(prompt, geminiKey as string);
    if (intent) {
      const result = buildCircuitFromPlan({
        boardId: intent.boardId,
        peripheralIds: intent.peripherals,
      });
      return Response.json({
        ...result,
        presetUsed: deterministic.presetUsed,
        usedAI: true,
        aiProvider: openAiKey ? "openai" : "gemini",
      });
    }
  } catch (error) {
    console.warn("AI interpretation failed, using deterministic parser:", error);
  }

  return Response.json({ ...deterministic, usedAI: false });
}
