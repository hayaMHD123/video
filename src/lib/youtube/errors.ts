export class YouTubeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof YouTubeError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  console.error("YouTube integration error", error);
  return Response.json(
    { error: "internal_error", message: "حدث خطأ غير متوقع أثناء الاتصال بيوتيوب." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function googleError(response: Response, fallback: string): Promise<YouTubeError> {
  let reason = "";
  let message = fallback;
  try {
    const data = await response.json() as {
      error?: string | { message?: string; errors?: Array<{ reason?: string }> };
      error_description?: string;
    };
    if (typeof data.error === "string") {
      reason = data.error;
      message = data.error_description || fallback;
    } else if (data.error) {
      reason = data.error.errors?.[0]?.reason || "";
      message = data.error.message || fallback;
    }
  } catch {
    // Google's response is occasionally empty or not JSON.
  }

  if (["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded", "rateLimitExceeded"].includes(reason) || response.status === 429) {
    return new YouTubeError(429, "youtube_quota", "بلغ مشروع Google حد الرفع اليومي. جرّب لاحقاً أو راجع الحصة في Google Cloud.");
  }
  if (reason === "authError" || reason === "invalid_grant" || response.status === 401) {
    return new YouTubeError(401, "youtube_auth", "انتهى تفويض يوتيوب. أعد ربط القناة ثم حاول مجدداً.");
  }
  if (response.status === 403) {
    return new YouTubeError(403, "youtube_forbidden", `رفض يوتيوب العملية: ${message.slice(0, 300)}`);
  }
  return new YouTubeError(502, "youtube_api", `تعذّر إكمال العملية على يوتيوب: ${message.slice(0, 300)}`);
}
