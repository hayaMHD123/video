import { getYouTubeConfig } from "../../../../lib/youtube/config";
import { errorResponse, YouTubeError } from "../../../../lib/youtube/errors";
import { assertLocalRequest } from "../../../../lib/youtube/local";
import { MAX_LOCAL_UPLOAD_BYTES, MAX_THUMBNAIL_BYTES, parseUploadForm, setVideoThumbnail, uploadVideo } from "../../../../lib/youtube/upload";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const url = assertLocalRequest(request, true);
    const config = getYouTubeConfig(url.origin);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      throw new YouTubeError(415, "invalid_content_type", "أرسل الفيديو والبيانات بصيغة multipart/form-data.");
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (contentLength > MAX_LOCAL_UPLOAD_BYTES + MAX_THUMBNAIL_BYTES + 1024 * 1024) {
      throw new YouTubeError(413, "upload_too_large", "تجاوزت ملفات الرفع الحدود المحلية: 256 ميغابايت للفيديو و10 ميغابايت للصورة.");
    }
    const form = await request.formData();
    const { video, thumbnail, metadata } = parseUploadForm(form);
    const result = await uploadVideo(config, video, metadata);
    let thumbnailUploaded = false;
    let thumbnailWarning: string | null = null;
    if (thumbnail) {
      try {
        await setVideoThumbnail(config, result.videoId, thumbnail);
        thumbnailUploaded = true;
      } catch (error) {
        thumbnailWarning = error instanceof YouTubeError
          ? error.message
          : "رُفع الفيديو بنجاح، لكن تعذّر رفع الصورة المصغّرة. يمكنك إضافتها من YouTube Studio.";
      }
    }
    return Response.json(
      { ...result, thumbnailUploaded, thumbnailWarning },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
