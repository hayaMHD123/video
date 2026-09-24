import { YouTubeError } from "./errors";

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function isYouTubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

export function getYouTubeConfig(origin: string): YouTubeConfig {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || `${origin}/api/youtube/callback`;

  if (!clientId || !clientSecret) {
    throw new YouTubeError(
      503,
      "youtube_not_configured",
      "أضف YOUTUBE_CLIENT_ID وYOUTUBE_CLIENT_SECRET إلى .env.local ثم أعد تشغيل الموقع.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new YouTubeError(503, "invalid_redirect_uri", "عنوان YOUTUBE_REDIRECT_URI غير صالح.");
  }
  if (
    parsed.origin !== origin ||
    parsed.pathname !== "/api/youtube/callback" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new YouTubeError(
      503,
      "redirect_uri_mismatch",
      "يجب أن يطابق YOUTUBE_REDIRECT_URI عنوان الموقع المحلي المفتوح، وأن ينتهي بـ /api/youtube/callback.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}
