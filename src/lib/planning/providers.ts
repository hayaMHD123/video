import type { EpisodePlan, PlanRequest } from "../types";
import { buildPlanningPrompt } from "./prompt";
import { generatedPlanSchema, parseGeneratedPlan } from "./schema";

// This model currently has a free text tier. Never silently switch to a paid
// model. A key must belong to a Free-tier project for the user's zero-cost goal.
const GEMINI_MODEL = "gemini-3.5-flash-lite";

export class PlanningProviderError extends Error {
  constructor(
    public readonly provider: "Gemini" | "Ollama",
    public readonly reason:
      | "quota"
      | "access"
      | "unavailable"
      | "invalid-output"
      | "invalid-key"
      | "free-tier-unavailable"
      | "invalid-request"
      | "model-unavailable"
      | "timeout"
      | "billing-required",
    public readonly httpStatus?: number,
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

async function geminiHttpError(response: Response): Promise<PlanningProviderError> {
  let providerStatus = "unknown";
  let invalidKey = false;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const detail = body.error;
      if (detail && typeof detail === "object") {
        if ("status" in detail && typeof detail.status === "string") {
          const allowedStatuses = [
            "INVALID_ARGUMENT",
            "FAILED_PRECONDITION",
            "PERMISSION_DENIED",
            "NOT_FOUND",
            "RESOURCE_EXHAUSTED",
            "INTERNAL",
            "UNAVAILABLE",
            "DEADLINE_EXCEEDED",
          ];
          if (allowedStatuses.includes(detail.status)) providerStatus = detail.status;
        }
        if ("details" in detail && Array.isArray(detail.details)) {
          invalidKey = detail.details.some(
            (item) => item && typeof item === "object" && "reason" in item && item.reason === "API_KEY_INVALID",
          );
        }
      }
    }
  } catch {
    // Some proxy errors have no JSON body. The HTTP status is still useful.
  }

  const status = response.status;
  const reason: PlanningProviderError["reason"] = invalidKey || status === 401
    ? "invalid-key"
    : providerStatus === "FAILED_PRECONDITION"
      ? "free-tier-unavailable"
      : status === 400
        ? "invalid-request"
        : status === 403
          ? "access"
        : status === 404
          ? "model-unavailable"
          : status === 402
            ? "billing-required"
          : status === 429
              ? "quota"
              : status === 408 || status === 504
                ? "timeout"
                : "unavailable";

  // Never log the response body, request headers, or API key.
  console.warn("[api/plan] Gemini request failed", { httpStatus: status, providerStatus, reason });
  return new PlanningProviderError("Gemini", reason, status);
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
            // The prompt carries the schema. JSON-only mode avoids a 400 from
            // projects that reject this model's nested responseFormat schema.
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      },
    );
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unavailable";
    console.warn("[api/plan] Gemini fetch failed", { reason });
    throw new PlanningProviderError("Gemini", reason);
  }
  if (!response.ok) throw await geminiHttpError(response);
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
