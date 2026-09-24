import type { PlanResponse } from "../../../lib/types";
import { planWithGemini, planWithOllama, PlanningProviderError } from "../../../lib/planning/providers";
import { parsePlanRequest, PlanValidationError } from "../../../lib/planning/schema";
import { createTemplatePlan } from "../../../lib/planning/template";

function providerNotice(error: unknown): string {
  if (!(error instanceof PlanningProviderError)) {
    return "تعذّر إنشاء الخطة بالذكاء الاصطناعي.";
  }
  if (error.reason === "quota") return `انتهت الحصة المجانية لدى ${error.provider}.`;
  if (error.reason === "invalid-key") return "رفض Gemini مفتاح API؛ تأكد من نسخ المفتاح كاملًا ومن مشروعه في Google AI Studio.";
  if (error.reason === "free-tier-unavailable") return "رفض Google طلب Gemini لأن الفئة المجانية غير متاحة لجهة الاتصال أو مشروع المفتاح. لم يُفعّل الموقع أي خدمة مدفوعة.";
  if (error.reason === "invalid-request") return "رفض Gemini صيغة الطلب (400). هذه مشكلة في إعداد الاتصال داخل الموقع.";
  if (error.reason === "model-unavailable") return "نموذج Gemini المحدد غير متاح لهذا المشروع (404).";
  if (error.reason === "billing-required") return "مشروع مفتاح Gemini يطلب إعداد فوترة أو رصيدًا (402)، ولن يستخدم الموقع خدمة مدفوعة تلقائيًا.";
  if (error.reason === "timeout") return "انتهت مهلة انتظار Gemini؛ حاول مرة أخرى لاحقًا.";
  if (error.reason === "access") return `تعذّر الوصول إلى ${error.provider} بهذا الإعداد أو من هذه المنطقة.`;
  if (error.reason === "invalid-output") return `أعاد ${error.provider} خطة غير مكتملة.`;
  if (error.provider === "Gemini" && error.httpStatus) return `أعاد خادم Gemini خطأ HTTP ${error.httpStatus}.`;
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
