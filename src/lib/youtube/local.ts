import { YouTubeError } from "./errors";

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function assertLocalRequest(request: Request, mutation = false): URL {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  let hostName = "";
  try {
    hostName = host ? new URL(`http://${host}`).hostname : "";
  } catch {
    // Invalid Host header.
  }

  if (!isLoopback(url.hostname) || !isLoopback(hostName)) {
    throw new YouTubeError(403, "local_only", "ربط يوتيوب متاح عند تشغيل الموقع محلياً فقط.");
  }

  if (mutation) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== url.origin) || fetchSite === "cross-site") {
      throw new YouTubeError(403, "invalid_origin", "هذا الطلب لم يأتِ من صفحة الموقع المحلية.");
    }
  }

  return url;
}
