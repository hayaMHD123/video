import type { EpisodePlan, EpisodeScene, PlanRequest } from "../types";

const motionStyles = ["push-in", "pull-out", "pan-left", "pan-right", "float"] as const;
const transitionStyles = ["fade", "slide", "cut"] as const;

// This schema is sent to both Gemini and the local Ollama server. The server
// still validates every returned field; a model's schema support is not trust.
export const generatedPlanSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    visualBible: { type: "string" },
    youtubeTitle: { type: "string" },
    youtubeDescription: { type: "string" },
    youtubeTags: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          durationSec: { type: "number" },
          narration: { type: "string" },
          onScreenText: { type: "string" },
          imagePrompt: { type: "string" },
          motion: { type: "string", enum: motionStyles },
          transition: { type: "string", enum: transitionStyles },
        },
        required: [
          "title",
          "durationSec",
          "narration",
          "onScreenText",
          "imagePrompt",
          "motion",
          "transition",
        ],
      },
    },
  },
  required: [
    "title",
    "description",
    "visualBible",
    "youtubeTitle",
    "youtubeDescription",
    "youtubeTags",
    "scenes",
  ],
} as const;

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlanValidationError("يجب إرسال بيانات بصيغة JSON صحيحة.");
  }
  return value as Record<string, unknown>;
}

function textField(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new PlanValidationError(`الحقل «${label}» يجب أن يكون نصاً.`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new PlanValidationError(`الحقل «${label}» فارغ أو طويل جداً.`);
  }
  return text;
}

export function parsePlanRequest(value: unknown): PlanRequest {
  const data = record(value);
  const durationSec = data.durationSec;
  if (
    typeof durationSec !== "number" ||
    !Number.isInteger(durationSec) ||
    durationSec < 15 ||
    durationSec > 600
  ) {
    throw new PlanValidationError("مدة الحلقة يجب أن تكون بين 15 و600 ثانية.");
  }
  if (data.format !== "16:9" && data.format !== "9:16") {
    throw new PlanValidationError("المقاس يجب أن يكون 16:9 أو 9:16.");
  }
  return {
    description: textField(data.description, "وصف الحلقة", 2000),
    ageGroup: textField(data.ageGroup, "العمر", 60),
    format: data.format,
    durationSec,
    artStyle: textField(data.artStyle, "أسلوب الرسم", 120),
    language: textField(data.language, "اللغة", 60),
  };
}

function normalizeDurations(weights: number[], target: number): number[] {
  const base = weights.map(() => 1);
  const remaining = target - weights.length;
  const sum = weights.reduce((total, value) => total + value, 0);
  const shares = weights.map((value) => (value / sum) * remaining);
  const whole = shares.map(Math.floor);
  let extra = remaining - whole.reduce((total, value) => total + value, 0);
  const indices = shares
    .map((value, index) => ({ index, fraction: value - whole[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of indices) {
    if (extra-- <= 0) break;
    whole[index] += 1;
  }
  return base.map((value, index) => value + whole[index]);
}

export function parseGeneratedPlan(value: unknown, request: PlanRequest): EpisodePlan {
  const data = record(value);
  const visualBible = textField(data.visualBible, "دليل الأسلوب البصري", 1800);
  if (!Array.isArray(data.scenes) || data.scenes.length < 3 || data.scenes.length > 16) {
    throw new PlanValidationError("الخطة يجب أن تضم بين 3 و16 مشهداً.");
  }
  const rawScenes = data.scenes.map((item, index) => {
    const scene = record(item);
    const duration = scene.durationSec;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      throw new PlanValidationError(`مدة المشهد ${index + 1} غير صحيحة.`);
    }
    const motion = motionStyles.find((style) => style === scene.motion) ?? "push-in";
    const transition = transitionStyles.find((style) => style === scene.transition) ?? "fade";
    return {
      title: textField(scene.title, `عنوان المشهد ${index + 1}`, 140),
      duration,
      narration: textField(scene.narration, `تعليق المشهد ${index + 1}`, 1200),
      onScreenText: textField(scene.onScreenText, `نص المشهد ${index + 1}`, 150),
      imagePrompt: textField(scene.imagePrompt, `برومبت المشهد ${index + 1}`, 2200),
      motion,
      transition,
    };
  });
  if (rawScenes.length > request.durationSec) {
    throw new PlanValidationError("عدد المشاهد أكبر من مدة الحلقة.");
  }
  const durations = normalizeDurations(
    rawScenes.map((scene) => scene.duration),
    request.durationSec,
  );
  const scenes: EpisodeScene[] = rawScenes.map((scene, index) => ({
    id: `scene-${index + 1}`,
    title: scene.title,
    durationSec: durations[index],
    narration: scene.narration,
    onScreenText: scene.onScreenText,
    imagePrompt: [
      `Consistent visual style and character: ${visualBible}`,
      `Scene composition: ${scene.imagePrompt}`,
      "No text, letters, captions, watermarks, or logos in the image. Leave clear space for an editor-added title and subtitles.",
    ].join("\n"),
    motion: scene.motion,
    transition: scene.transition,
  }));
  if (!Array.isArray(data.youtubeTags)) {
    throw new PlanValidationError("وسوم يوتيوب غير صحيحة.");
  }
  const youtubeTags = [...new Set(
    data.youtubeTags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean),
  )].slice(0, 12);
  if (youtubeTags.length === 0) {
    throw new PlanValidationError("الخطة تحتاج إلى وسم واحد على الأقل.");
  }
  return {
    title: textField(data.title, "العنوان", 160),
    description: textField(data.description, "ملخص الحلقة", 1000),
    visualBible,
    youtubeTitle: textField(data.youtubeTitle, "عنوان يوتيوب", 100),
    youtubeDescription: textField(data.youtubeDescription, "وصف يوتيوب", 4000),
    youtubeTags,
    format: request.format,
    ageGroup: request.ageGroup,
    language: request.language,
    artStyle: request.artStyle,
    scenes,
  };
}
