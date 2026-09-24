import { getYouTubeConfig } from "../../../../lib/youtube/config";
import { errorResponse } from "../../../../lib/youtube/errors";
import { assertLocalRequest } from "../../../../lib/youtube/local";
import { readTokens } from "../../../../lib/youtube/tokens";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = assertLocalRequest(request);
    let configured = true;
    let message: string | null = null;
    try {
      getYouTubeConfig(url.origin);
    } catch (error) {
      configured = false;
      message = error instanceof Error ? error.message : "تعذّر إعداد ربط يوتيوب.";
    }
    const tokens = configured ? await readTokens() : null;
    return Response.json(
      {
        configured,
        connected: Boolean(tokens),
        expiresAt: tokens?.expiresAt ?? null,
        message,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
