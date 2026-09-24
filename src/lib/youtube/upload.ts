import { YouTubeConfig } from "./config";
import { googleError, YouTubeError } from "./errors";
import { getAccessToken } from "./tokens";

const CHUNK_SIZE = 8 * 1024 * 1024; // Google requires non-final chunks to be multiples of 256 KiB.
export const MAX_LOCAL_UPLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;

export type PrivacyStatus = "private" | "unlisted" | "public";

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: PrivacyStatus;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
}

interface YouTubeInsertResponse {
  id?: string;
  status?: {
    privacyStatus?: PrivacyStatus;
    uploadStatus?: string;
    selfDeclaredMadeForKids?: boolean;
  };
}

interface UploadProgress {
  offset: number;
  completed?: YouTubeInsertResponse;
}

function toUploadResult(result: YouTubeInsertResponse, metadata: VideoMetadata) {
  const videoId = result.id!;
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    requestedPrivacyStatus: metadata.privacyStatus,
    privacyStatus: result.status?.privacyStatus ?? null,
    madeForKids: result.status?.selfDeclaredMadeForKids ?? metadata.madeForKids,
    uploadStatus: result.status?.uploadStatus || "uploaded",
  };
}

function parseTags(input: FormDataEntryValue | null): string[] {
  if (typeof input !== "string" || !input.trim()) return [];
  let values: unknown;
  try {
    values = JSON.parse(input);
  } catch {
    values = input.split(",");
  }
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new YouTubeError(400, "invalid_tags", "الوسوم يجب أن تكون قائمة نصوص أو كلمات مفصولة بفواصل.");
  }
  return values.map((value: string) => value.trim()).filter(Boolean).slice(0, 30);
}

export function parseUploadForm(form: FormData): { video: File; thumbnail: File | null; metadata: VideoMetadata } {
  const video = form.get("video");
  if (!video || typeof video === "string") {
    throw new YouTubeError(400, "missing_video", "اختر ملف MP4 مُصدّراً من المحرر أولاً.");
  }
  if (!video.size) throw new YouTubeError(400, "empty_video", "ملف الفيديو فارغ.");
  if (video.size > MAX_LOCAL_UPLOAD_BYTES) {
    throw new YouTubeError(413, "video_too_large", "الحد المحلي للرفع المباشر هو 256 ميغابايت. احفظ الملف وارفعه من YouTube Studio إذا كان أكبر.");
  }
  if (video.type !== "video/mp4" && !video.name.toLowerCase().endsWith(".mp4")) {
    throw new YouTubeError(415, "unsupported_video", "الرفع المباشر يقبل ملفات MP4 فقط.");
  }

  const thumbnailEntry = form.get("thumbnail");
  let thumbnail: File | null = null;
  if (thumbnailEntry !== null) {
    if (typeof thumbnailEntry === "string" || !thumbnailEntry.size) {
      throw new YouTubeError(400, "invalid_thumbnail", "اختر صورة مصغّرة بصيغة JPEG أو PNG.");
    }
    if (thumbnailEntry.size > MAX_THUMBNAIL_BYTES) {
      throw new YouTubeError(413, "thumbnail_too_large", "الحد المحلي للصورة المصغّرة هو 10 ميغابايت.");
    }
    const name = thumbnailEntry.name.toLowerCase();
    if (
      !["image/jpeg", "image/png"].includes(thumbnailEntry.type) &&
      !name.endsWith(".jpg") && !name.endsWith(".jpeg") && !name.endsWith(".png")
    ) {
      throw new YouTubeError(415, "unsupported_thumbnail", "الصورة المصغّرة يجب أن تكون JPEG أو PNG.");
    }
    thumbnail = thumbnailEntry;
  }

  const title = String(form.get("title") || "").trim();
  if (!title || title.length > 100 || /[<>]/.test(title)) {
    throw new YouTubeError(400, "invalid_title", "عنوان الفيديو مطلوب، بحد أقصى 100 حرف ومن دون < أو >.");
  }
  const description = String(form.get("description") || "").trim();
  if (description.length > 5_000) {
    throw new YouTubeError(400, "invalid_description", "الوصف أطول من حد يوتيوب البالغ 5000 حرف.");
  }
  const selectedPrivacy = String(form.get("privacyStatus") || "private");
  if (!["private", "unlisted", "public"].includes(selectedPrivacy)) {
    throw new YouTubeError(400, "invalid_privacy", "اختر خصوصية الفيديو: خاص أو غير مُدرج أو عام.");
  }
  const categoryId = String(form.get("categoryId") || "27");
  if (!/^\d{1,4}$/.test(categoryId)) {
    throw new YouTubeError(400, "invalid_category", "معرّف فئة يوتيوب غير صالح.");
  }

  return {
    video,
    thumbnail,
    metadata: {
      title,
      description,
      tags: parseTags(form.get("tags")),
      categoryId,
      privacyStatus: selectedPrivacy as PrivacyStatus,
      madeForKids: String(form.get("madeForKids") ?? "true") !== "false",
      containsSyntheticMedia: String(form.get("containsSyntheticMedia") ?? "false") === "true",
    },
  };
}

export async function setVideoThumbnail(
  config: YouTubeConfig,
  videoId: string,
  thumbnail: File,
): Promise<void> {
  const endpoint = new URL("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
  endpoint.searchParams.set("videoId", videoId);
  endpoint.searchParams.set("uploadType", "media");
  const contentType = thumbnail.type === "image/png" || thumbnail.name.toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken(config)}`,
      "Content-Type": contentType,
      "Content-Length": String(thumbnail.size),
    },
    body: await thumbnail.arrayBuffer(),
    cache: "no-store",
    redirect: "manual",
  });
  if (!response.ok) throw await googleError(response, "رفض يوتيوب الصورة المصغّرة.");
}

async function initiateUpload(config: YouTubeConfig, video: File, metadata: VideoMetadata): Promise<URL> {
  const response = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getAccessToken(config)}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(video.size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          categoryId: metadata.categoryId,
          defaultLanguage: "ar",
        },
        status: {
          privacyStatus: metadata.privacyStatus,
          selfDeclaredMadeForKids: metadata.madeForKids,
          containsSyntheticMedia: metadata.containsSyntheticMedia,
        },
      }),
      cache: "no-store",
      redirect: "manual",
    },
  );
  if (!response.ok) throw await googleError(response, "تعذّر بدء رفع الفيديو.");
  const location = response.headers.get("location");
  if (!location) throw new YouTubeError(502, "missing_upload_session", "لم يُرجع يوتيوب رابط جلسة الرفع.");

  const session = new URL(location);
  if (session.protocol !== "https:" || session.hostname !== "www.googleapis.com") {
    throw new YouTubeError(502, "invalid_upload_session", "رابط جلسة الرفع المُعاد من يوتيوب غير متوقع.");
  }
  return session;
}

async function parseProgress(response: Response, size: number): Promise<UploadProgress> {
  if (response.status === 200 || response.status === 201) {
    const data = await response.json() as YouTubeInsertResponse;
    if (!data.id) throw new YouTubeError(502, "missing_video_id", "اكتمل الرفع لكن يوتيوب لم يُرجع معرّف الفيديو. راجع YouTube Studio قبل إعادة المحاولة.");
    return { offset: size, completed: data };
  }
  if (response.status === 308) {
    const range = response.headers.get("range");
    const match = range?.match(/^bytes=0-(\d+)$/);
    const offset = match ? Number(match[1]) + 1 : 0;
    if (!Number.isSafeInteger(offset) || offset > size) {
      throw new YouTubeError(502, "invalid_upload_offset", "أعاد يوتيوب موضع رفع غير صالح.");
    }
    return { offset };
  }
  throw await googleError(response, "تعذّر رفع الفيديو.");
}

async function queryProgress(config: YouTubeConfig, session: URL, size: number): Promise<UploadProgress> {
  const response = await fetch(session, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await getAccessToken(config)}`,
      "Content-Length": "0",
      "Content-Range": `bytes */${size}`,
    },
    body: new Uint8Array(0),
    cache: "no-store",
    redirect: "manual",
  });
  return parseProgress(response, size);
}

export async function uploadVideo(
  config: YouTubeConfig,
  video: File,
  metadata: VideoMetadata,
): Promise<{
  videoId: string;
  url: string;
  requestedPrivacyStatus: PrivacyStatus;
  privacyStatus: PrivacyStatus | null;
  madeForKids: boolean;
  uploadStatus: string;
}> {
  const session = await initiateUpload(config, video, metadata);
  let offset = 0;
  let retries = 0;

  while (offset < video.size) {
    const end = Math.min(offset + CHUNK_SIZE, video.size);
    try {
      const bytes = await video.slice(offset, end).arrayBuffer();
      const response = await fetch(session, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${await getAccessToken(config)}`,
          "Content-Type": "video/mp4",
          "Content-Length": String(bytes.byteLength),
          "Content-Range": `bytes ${offset}-${end - 1}/${video.size}`,
        },
        body: bytes,
        cache: "no-store",
        redirect: "manual",
      });
      if ([429, 500, 502, 503, 504].includes(response.status)) throw new Error(`Retryable YouTube status ${response.status}`);
      const progress = await parseProgress(response, video.size);
      if (progress.completed) {
        return toUploadResult(progress.completed, metadata);
      }
      if (progress.offset <= offset) throw new Error("YouTube upload made no progress");
      offset = progress.offset;
      retries = 0;
    } catch (error) {
      if (error instanceof YouTubeError) throw error;
      retries += 1;
      if (retries > 5) {
        throw new YouTubeError(502, "upload_interrupted", "انقطع رفع يوتيوب بعد عدة محاولات. افحص YouTube Studio قبل إعادة الرفع لتجنب نسخة مكررة.");
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * 2 ** (retries - 1), 10_000)));
      try {
        const progress = await queryProgress(config, session, video.size);
        if (progress.completed) {
          return toUploadResult(progress.completed, metadata);
        }
        offset = progress.offset;
      } catch (statusError) {
        if (statusError instanceof YouTubeError && statusError.status < 500) throw statusError;
      }
    }
  }
  throw new YouTubeError(502, "upload_unconfirmed", "أُرسلت بيانات الفيديو لكن لم يتم تأكيد اكتمال الرفع. افحص YouTube Studio قبل إعادة المحاولة.");
}
