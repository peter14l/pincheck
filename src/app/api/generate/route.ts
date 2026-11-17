import {
  buildCircuitFromPlan,
  generateCircuitFromPrompt,
  type CircuitGenerationResult,
} from "@/lib/circuitGenerator";
import { BOARDS, PERIPHERALS, getBoard, getPeripheral } from "@/lib/hardwareEngine";
import { readJsonObjectBody } from "@/lib/http";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rateLimit";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_PROMPT_LENGTH = 1000;
const AI_TIMEOUT_MS = 15_000;
const RATE_LIMIT = { bucket: "generate", limit: 10, windowMs: 60_000 };

interface AiIntent {
  boardId: string;
  peripherals: string[];
}

/** Carries only a provider name and HTTP status: never the raw upstream body. */
class UpstreamRequestError extends Error {
  constructor(provider: string, status: number) {
    super(`${provider} request failed with status ${status}`);
    this.name = "UpstreamRequestError";
  }
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
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!response.ok) throw new UpstreamRequestError("OpenAI", response.status);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  return parseIntent(JSON.parse(content));
}

async function interpretWithGemini(prompt: string, apiKey: string): Promise<AiIntent | null> {
  // Keep the key out of the URL (and therefore out of logs and error messages).
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\nProject: ${prompt}` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new UpstreamRequestError("Gemini", response.status);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) return null;
  return parseIntent(JSON.parse(content));
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

  const rawPrompt = parsed.value.prompt;
  if (typeof rawPrompt !== "string") {
    return Response.json({ error: "A non-empty prompt is required" }, { status: 400 });
  }
  const prompt = rawPrompt.trim();
  if (prompt.length === 0) {
    return Response.json({ error: "A non-empty prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` },
      { status: 400 },
    );
  }

  const deterministic: CircuitGenerationResult = await generateCircuitFromPrompt(prompt);

  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const provider = openAiKey ? "openai" : geminiKey ? "gemini" : null;
  if (!provider) {
    return Response.json({ ...deterministic, usedAI: false });
  }

  try {
    const intent =
      provider === "openai"
        ? await interpretWithOpenAI(prompt, openAiKey as string)
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
        aiProvider: provider,
      });
    }
  } catch (error) {
    // Log only the error kind: upstream bodies, prompt echoes, and request URLs
    // (which could contain credentials) must not end up in logs.
    const reason =
      error instanceof UpstreamRequestError
        ? error.message
        : error instanceof Error
          ? error.name
          : "unknown error";
    console.warn(`AI interpretation failed (${provider}); using deterministic parser:`, reason);
  }

  return Response.json({ ...deterministic, usedAI: false });
}
