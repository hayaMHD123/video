import type { PlanResponse } from "../../../lib/types";
import { planWithGemini, planWithOllama, PlanningProviderError } from "../../../lib/planning/providers";
import { parsePlanRequest, PlanValidationError } from "../../../lib/planning/schema";
import { createTemplatePlan } from "../../../lib/planning/template";

function providerNotice(error: unknown): string {
  if (!(error instanceof PlanningProviderError)) {
    return "تعذّر إنشاء الخطة بالذكاء الاصطناعي.";
  }
  if (error.reason === "quota") return `انتهت الحصة المجانية لدى ${error.provider}.`;
  if (error.reason === "access") return `تعذّر الوصول إلى ${error.provider} بهذا الإعداد أو من هذه المنطقة.`;
  if (error.reason === "invalid-output") return `أعاد ${error.provider} خطة غير مكتملة.`;
  return `تعذّر الاتصال بـ${error.provider}.`;
}

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 12_000) {
    return Response.json({ error: "الوصف طويل جداً." }, { status: 413 });
  }

  let input;
  try {
    const body = await request.text();
    if (body.length > 12_000) {
      return Response.json({ error: "الوصف طويل جداً." }, { status: 413 });
    }
    input = parsePlanRequest(JSON.parse(body));
  } catch (error) {
    const message = error instanceof PlanValidationError ? error.message : "تعذّر قراءة طلب التخطيط.";
    return Response.json({ error: message }, { status: 400 });
  }

  const failures: string[] = [];
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const plan = await planWithGemini(input, geminiKey);
      const result: PlanResponse = { plan, source: "gemini" };
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      failures.push(providerNotice(error));
    }
  }

  const ollamaModel = process.env.OLLAMA_MODEL?.trim();
  if (ollamaModel) {
    try {
      const plan = await planWithOllama(input, ollamaModel);
      const result: PlanResponse = {
        plan,
        source: "ollama",
        ...(failures.length ? { notice: `${failures.join(" ")} استُخدم النموذج المحلي.` } : {}),
      };
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      failures.push(providerNotice(error));
    }
  }

  const notice = failures.length
    ? `${failures.join(" ")} عُرضت مسودة قالبية قابلة للتعديل؛ راجع النص والبرومبتات قبل الإنتاج.`
    : "هذه مسودة قالبية قابلة للتعديل، وليست خطة مولّدة بالذكاء الاصطناعي. أضف مفتاح Gemini المجاني أو نموذج Ollama المحلي للحصول على خطة مخصصة.";
  const result: PlanResponse = {
    plan: createTemplatePlan(input),
    source: "template",
    notice,
  };
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
