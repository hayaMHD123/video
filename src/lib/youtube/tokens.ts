import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { YouTubeConfig } from "./config";
import { googleError, YouTubeError } from "./errors";

export interface StoredYouTubeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const tokenPath = path.join(process.cwd(), "data", "youtube-oauth.json");

export async function readTokens(): Promise<StoredYouTubeTokens | null> {
  let contents: string;
  try {
    contents = await readFile(tokenPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  try {
    const value = JSON.parse(contents) as Partial<StoredYouTubeTokens>;
    if (
      typeof value.accessToken !== "string" ||
      typeof value.refreshToken !== "string" ||
      typeof value.expiresAt !== "number"
    ) throw new Error("Invalid token shape");
    return value as StoredYouTubeTokens;
  } catch {
    throw new YouTubeError(500, "token_store_invalid", "ملف ربط يوتيوب المحلي تالف. افصل القناة وأعد ربطها.");
  }
}

export async function saveTokens(tokens: StoredYouTubeTokens): Promise<void> {
  await mkdir(path.dirname(tokenPath), { recursive: true });
  const tempPath = `${tokenPath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(tokens), { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, tokenPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function deleteTokens(): Promise<void> {
  await rm(tokenPath, { force: true });
}

export async function getAccessToken(config: YouTubeConfig): Promise<string> {
  const stored = await readTokens();
  if (!stored) {
    throw new YouTubeError(401, "youtube_not_connected", "اربط قناة يوتيوب قبل الرفع.");
  }
  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;

  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: stored.refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new YouTubeError(502, "token_refresh_network", "تعذّر تجديد الاتصال بيوتيوب. تحقق من الإنترنت وحاول ثانية.");
  }

  if (!response.ok) {
    const error = await googleError(response, "تعذّر تجديد تصريح يوتيوب.");
    if (error.code === "youtube_auth") await deleteTokens();
    throw error;
  }

  const data = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!data.access_token || !data.expires_in) {
    throw new YouTubeError(502, "invalid_token_response", "ردّ غير مكتمل من Google أثناء تجديد التصريح.");
  }
  await saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || stored.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

export async function revokeAndDeleteTokens(): Promise<{ revoked: boolean }> {
  let stored: StoredYouTubeTokens | null;
  try {
    stored = await readTokens();
  } catch (error) {
    if (!(error instanceof YouTubeError) || error.code !== "token_store_invalid") throw error;
    await deleteTokens();
    return { revoked: false };
  }
  let revoked = true;
  if (stored) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: stored.refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      revoked = response.ok;
    } catch {
      revoked = false;
    }
  }
  await deleteTokens();
  return { revoked };
}
