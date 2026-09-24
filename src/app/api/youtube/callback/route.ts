import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getYouTubeConfig } from "../../../../lib/youtube/config";
import { errorResponse, YouTubeError } from "../../../../lib/youtube/errors";
import { assertLocalRequest } from "../../../../lib/youtube/local";
import { saveTokens } from "../../../../lib/youtube/tokens";

export const runtime = "nodejs";

function sameSecret(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

function redirectHome(request: Request, result: "connected" | "error", reason?: string): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("youtube", result);
  if (reason) {
    url.searchParams.set("reason", reason);
    const messages: Record<string, string> = {
      invalid_state: "تعذّر التحقق من جلسة ربط يوتيوب. حاول الربط من جديد.",
      authorization_denied: "لم يُمنح تصريح الوصول إلى يوتيوب.",
      missing_code: "لم تُعد Google رمز التصريح المطلوب.",
      token_exchange_failed: "تعذّر إكمال ربط يوتيوب. راجع إعدادات Google وحاول ثانية.",
      missing_refresh_token: "لم تُعد Google تصريحاً دائماً. أعد المحاولة ووافق على طلب الوصول.",
      missing_scope: "لم يُمنح تصريح رفع الفيديو المطلوب.",
      callback_failed: "تعذّر إكمال ربط يوتيوب.",
    };
    url.searchParams.set("message", messages[reason] || messages.callback_failed);
  }
  const response = NextResponse.redirect(url);
  const expiredCookie = { httpOnly: true, sameSite: "lax" as const, path: "/api/youtube/callback", maxAge: 0 };
  response.cookies.set("youtube_oauth_state", "", expiredCookie);
  response.cookies.set("youtube_oauth_verifier", "", expiredCookie);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    assertLocalRequest(request);
  } catch (error) {
    return errorResponse(error);
  }
  try {
    const url = assertLocalRequest(request);
    const state = request.cookies.get("youtube_oauth_state")?.value;
    const verifier = request.cookies.get("youtube_oauth_verifier")?.value;
    if (!sameSecret(state, url.searchParams.get("state")) || !verifier) {
      return redirectHome(request, "error", "invalid_state");
    }
    if (url.searchParams.has("error")) {
      return redirectHome(request, "error", "authorization_denied");
    }
    const code = url.searchParams.get("code");
    if (!code) return redirectHome(request, "error", "missing_code");

    const config = getYouTubeConfig(url.origin);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return redirectHome(request, "error", "token_exchange_failed");

    const token = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!token.access_token || !token.refresh_token || !token.expires_in) {
      return redirectHome(request, "error", "missing_refresh_token");
    }
    if (token.scope && !token.scope.split(" ").includes("https://www.googleapis.com/auth/youtube.upload")) {
      return redirectHome(request, "error", "missing_scope");
    }
    await saveTokens({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    });
    return redirectHome(request, "connected");
  } catch (error) {
    if (!(error instanceof YouTubeError)) console.error("YouTube OAuth callback error", error);
    return redirectHome(request, "error", "callback_failed");
  }
}
