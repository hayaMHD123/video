import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getYouTubeConfig } from "../../../../lib/youtube/config";
import { errorResponse } from "../../../../lib/youtube/errors";
import { assertLocalRequest } from "../../../../lib/youtube/local";

export const runtime = "nodejs";

export function GET(request: Request): Response {
  try {
    const localUrl = assertLocalRequest(request);
    const config = getYouTubeConfig(localUrl.origin);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.upload",
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    const response = NextResponse.redirect(url);
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
      path: "/api/youtube/callback",
      maxAge: 600,
    };
    response.cookies.set("youtube_oauth_state", state, cookieOptions);
    response.cookies.set("youtube_oauth_verifier", verifier, cookieOptions);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
