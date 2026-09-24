import type { EpisodePlan } from "@/lib/types";
import type { CaptionCue } from "./captions";
import { normalizeCaptions } from "./captions";
import { getEpisodeDurationFrames, getVideoDimensions, VIDEO_FPS } from "./timeline";
import { EpisodeComposition } from "@/components/video/EpisodeComposition";

export interface RenderEpisodeOptions {
  plan: EpisodePlan;
  images: Record<string, string>;
  audioUrl?: string;
  musicUrl?: string;
  subtitles?: string | CaptionCue[];
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

/** Render a YouTube-ready MP4 locally with the browser's H.264/AAC encoders. */
export const renderEpisode = async ({
  plan,
  images,
  audioUrl,
  musicUrl,
  subtitles,
  onProgress,
  signal,
}: RenderEpisodeOptions): Promise<Blob> => {
  if (typeof window === "undefined") throw new Error("تصدير الفيديو يعمل من المتصفح فقط.");
  if (plan.scenes.length === 0) throw new Error("أضف مشهداً واحداً على الأقل قبل التصدير.");

  const missing = plan.scenes.filter((scene) => !images[scene.id]);
  if (missing.length) {
    throw new Error(`ارفع صور جميع المشاهد قبل التصدير. الصور الناقصة: ${missing.map((scene) => scene.title).join("، ")}`);
  }

  const { width, height } = getVideoDimensions(plan.format);
  try {
    onProgress?.(0);
    await document.fonts.load('800 86px "Cairo Variable"');
    const { canRenderMediaOnWeb, renderMediaOnWeb } = await import("@remotion/web-renderer");
    const canRender = await canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      audioCodec: audioUrl || musicUrl ? "aac" : null,
      width,
      height,
      muted: !audioUrl && !musicUrl,
    });

    if (!canRender.canRender) {
      throw new Error(`هذا المتصفح أو الجهاز لا يدعم تصدير MP4 بهذه الدقة. جرّب أحدث Chrome أو Edge. ${canRender.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ")}`);
    }

    const compositionProps = { plan, images, audioUrl, musicUrl, subtitles: normalizeCaptions(subtitles) };
    const result = await renderMediaOnWeb({
      composition: {
        id: "KidstoryEpisode",
        component: EpisodeComposition,
        defaultProps: compositionProps,
        durationInFrames: Math.max(1, getEpisodeDurationFrames(plan)),
        fps: VIDEO_FPS,
        width,
        height,
      },
      inputProps: compositionProps,
      container: "mp4",
      videoCodec: "h264",
      audioCodec: audioUrl || musicUrl ? "aac" : undefined,
      videoBitrate: "high",
      audioBitrate: "high",
      muted: !audioUrl && !musicUrl,
      pageResponsiveness: "high",
      signal,
      onProgress: ({ progress }) => onProgress?.(progress),
    });
    const blob = await result.getBlob();
    onProgress?.(1);
    return blob;
  } catch (error) {
    if (signal?.aborted) throw new Error("تم إلغاء تصدير الفيديو.");
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`تعذر تصدير الفيديو. تحقق من ملفات الصور والصوت وجرّب Chrome أو Edge. ${detail}`);
  }
};
