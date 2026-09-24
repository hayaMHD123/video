import type { EpisodePlan, PlanRequest } from "../types";
import { buildPlanningPrompt } from "./prompt";
import { generatedPlanSchema, parseGeneratedPlan } from "./schema";

// This model currently has a free text tier. Never silently switch to a paid
// model. A key must belong to a Free-tier project for the user's zero-cost goal.
const GEMINI_MODEL = "gemini-3.5-flash-lite";

export class PlanningProviderError extends Error {
  constructor(
    public readonly provider: "Gemini" | "Ollama",
    public readonly reason: "quota" | "access" | "unavailable" | "invalid-output",
  ) {
    super(`${provider}: ${reason}`);
    this.name = "PlanningProviderError";
  }
}

function parseModelJson(text: unknown, request: PlanRequest, provider: "Gemini" | "Ollama"): EpisodePlan {
  if (typeof text !== "string" || !text.trim() || text.length > 200_000) {
    throw new PlanningProviderError(provider, "invalid-output");
  }
  try {
    return parseGeneratedPlan(JSON.parse(text), request);
  } catch {
    throw new PlanningProviderError(provider, "invalid-output");
  }
}

function httpReason(status: number): PlanningProviderError["reason"] {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "access";
  return "unavailable";
}

export async function planWithGemini(request: PlanRequest, apiKey: string): Promise<EpisodePlan> {
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildPlanningPrompt(request) }] }],
          generationConfig: {
            responseFormat: {
              text: { mimeType: "application/json", schema: generatedPlanSchema },
            },
            temperature: 0.7,
          },
        }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      },
    );
  } catch {
    throw new PlanningProviderError("Gemini", "unavailable");
  }
  if (!response.ok) throw new PlanningProviderError("Gemini", httpReason(response.status));
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new PlanningProviderError("Gemini", "invalid-output");
  }
  const candidates = (result as { candidates?: unknown })?.candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const parts = (first as { content?: { parts?: unknown } } | undefined)?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((part) => (part && typeof part === "object" ? (part as { text?: unknown }).text : ""))
        .filter((part): part is string => typeof part === "string")
        .join("")
    : undefined;
  return parseModelJson(text, request, "Gemini");
}

export async function planWithOllama(request: PlanRequest, model: string): Promise<EpisodePlan> {
  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: buildPlanningPrompt(request),
        format: generatedPlanSchema,
        stream: false,
        options: { temperature: 0.6 },
      }),
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
  } catch {
    throw new PlanningProviderError("Ollama", "unavailable");
  }
  if (!response.ok) throw new PlanningProviderError("Ollama", httpReason(response.status));
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new PlanningProviderError("Ollama", "invalid-output");
  }
  const text = (result as { response?: unknown })?.response;
  return parseModelJson(text, request, "Ollama");
}
