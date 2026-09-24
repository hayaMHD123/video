import { errorResponse } from "../../../../lib/youtube/errors";
import { assertLocalRequest } from "../../../../lib/youtube/local";
import { revokeAndDeleteTokens } from "../../../../lib/youtube/tokens";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request, true);
    const result = await revokeAndDeleteTokens();
    return Response.json(
      {
        connected: false,
        revoked: result.revoked,
        message: result.revoked
          ? "تم فصل قناة يوتيوب وإلغاء التصريح."
          : "حُذف الربط المحلي. تعذّر تأكيد إلغاء التصريح لدى Google؛ يمكنك إزالته من إعدادات حساب Google.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
