import type { EpisodePlan } from "@/lib/types";

export const VIDEO_FPS = 30;

export const getVideoDimensions = (format: EpisodePlan["format"]) =>
  format === "9:16"
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };

export const getSceneTimeline = (plan: EpisodePlan, fps = VIDEO_FPS) => {
  let startFrame = 0;
  return plan.scenes.map((scene, index) => {
    const durationFrames = Math.max(1, Math.round((Number(scene.durationSec) || 4) * fps));
    const item = { scene, index, startFrame, durationFrames };
    startFrame += durationFrames;
    return item;
  });
};

export const getEpisodeDurationFrames = (plan: EpisodePlan, fps = VIDEO_FPS) =>
  getSceneTimeline(plan, fps).reduce((total, item) => total + item.durationFrames, 0);
