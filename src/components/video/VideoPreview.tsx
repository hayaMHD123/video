"use client";

import { Player } from "@remotion/player";
import type { EpisodePlan } from "@/lib/types";
import type { CaptionCue } from "@/lib/video/captions";
import { normalizeCaptions } from "@/lib/video/captions";
import { getEpisodeDurationFrames, getVideoDimensions, VIDEO_FPS } from "@/lib/video/timeline";
import { EpisodeComposition } from "./EpisodeComposition";

export interface VideoPreviewProps {
  plan: EpisodePlan;
  images: Record<string, string>;
  audioUrl?: string;
  musicUrl?: string;
  subtitles?: string | CaptionCue[];
  className?: string;
}

export const VideoPreview = ({ plan, images, audioUrl, musicUrl, subtitles, className }: VideoPreviewProps) => {
  const { width, height } = getVideoDimensions(plan.format);
  const durationInFrames = Math.max(1, getEpisodeDurationFrames(plan));

  return (
    <div className={className} style={{ width: "100%", aspectRatio: `${width} / ${height}`, overflow: "hidden", borderRadius: 18, background: "#101c34" }}>
      <Player
        component={EpisodeComposition}
        inputProps={{ plan, images, audioUrl, musicUrl, subtitles: normalizeCaptions(subtitles) }}
        durationInFrames={durationInFrames}
        fps={VIDEO_FPS}
        compositionWidth={width}
        compositionHeight={height}
        controls
        autoPlay={false}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
