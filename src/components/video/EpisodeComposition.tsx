"use client";

import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { EpisodePlan, EpisodeScene } from "@/lib/types";
import type { CaptionCue } from "@/lib/video/captions";
import { getSceneTimeline } from "@/lib/video/timeline";

export interface EpisodeCompositionProps {
  plan: EpisodePlan;
  images: Record<string, string>;
  audioUrl?: string;
  musicUrl?: string;
  subtitles?: CaptionCue[];
}

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ink = "#f8fbff";
const typography = '"Cairo Variable", Tahoma, Arial, sans-serif';

const SceneVisual = ({
  scene,
  index,
  count,
  imageUrl,
  durationFrames,
  hasCaptions,
  portrait,
}: {
  scene: EpisodeScene;
  index: number;
  count: number;
  imageUrl?: string;
  durationFrames: number;
  hasCaptions: boolean;
  portrait: boolean;
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = Math.min(1, frame / Math.max(1, durationFrames - 1));
  const fadeFrames = Math.min(12, Math.floor(durationFrames / 4));
  const entrance = fadeFrames > 0 ? interpolate(frame, [0, fadeFrames], [0, 1], clamp) : 1;
  const exit = fadeFrames > 0 ? interpolate(frame, [durationFrames - fadeFrames - 1, durationFrames - 1], [1, 0], clamp) : 1;
  // The Player starts paused on frame 0, so the opening image must be visible immediately.
  const opacity = Math.min(index > 0 && scene.transition === "fade" ? entrance : 1, index === count - 1 ? exit : 1);
  const titleOpacity = interpolate(frame, [7, 21], [0, 1], clamp);
  const slideAmount = index > 0 && scene.transition === "slide" ? (1 - entrance) * width : 0;
  const motion = (() => {
    switch (scene.motion) {
      case "pull-out": return { scale: 1.13 - t * 0.12, x: 0, y: 0 };
      case "pan-left": return { scale: 1.15, x: (0.045 - t * 0.09) * width, y: 0 };
      case "pan-right": return { scale: 1.15, x: (-0.045 + t * 0.09) * width, y: 0 };
      case "float": return { scale: 1.08, x: Math.sin(t * Math.PI * 2) * width * 0.012, y: Math.sin(t * Math.PI) * -height * 0.012 };
      default: return { scale: 1.02 + t * 0.12, x: 0, y: 0 };
    }
  })();

  const edge = portrait ? 66 : 94;
  const mainText = scene.onScreenText || scene.title;
  const titleSize = Math.max(portrait ? 54 : 58, (portrait ? 78 : 86) - Math.max(0, mainText.length - 26) * 1.25);
  const mainBottom = portrait ? (hasCaptions ? 520 : 240) : (hasCaptions ? 300 : 130);

  return (
    <AbsoluteFill style={{ backgroundColor: "#142240", overflow: "hidden", opacity, transform: `translateX(${slideAmount}px)` }}>
      {imageUrl ? (
        <AbsoluteFill style={{ transform: `translate(${motion.x}px, ${motion.y}px) scale(${motion.scale})` }}>
          <Img
            src={imageUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            alt=""
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ backgroundImage: "linear-gradient(135deg, #25386b 0%, #6e77ac 58%, #f6b77d 100%)" }} />
      )}

      {/* Strong contrast is intentional: titles remain readable on arbitrary uploaded artwork. */}
      <AbsoluteFill style={{ backgroundImage: "linear-gradient(180deg, rgba(8,17,33,0.46) 0%, rgba(8,17,33,0.03) 33%, rgba(8,17,33,0.12) 52%, rgba(7,14,29,0.87) 100%)" }} />

      <div style={{ position: "absolute", top: edge, left: edge, right: edge, display: "flex", alignItems: "center", justifyContent: "space-between", color: ink, fontFamily: typography }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 13, height: 45, borderRadius: 12, backgroundColor: "#ffce68" }} />
          <div style={{ fontSize: portrait ? 35 : 30, fontWeight: 800, textShadow: "0 2px 12px rgba(0,0,0,0.35)" }} dir="auto">
            {scene.title}
          </div>
        </div>
        <div style={{ fontSize: portrait ? 28 : 27, fontWeight: 700, letterSpacing: 3, direction: "ltr", textShadow: "0 2px 10px rgba(0,0,0,0.4)" }}>
          {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
        </div>
      </div>

      <div
        dir="auto"
        style={{
          position: "absolute",
          left: edge,
          right: edge,
          bottom: mainBottom,
          color: ink,
          fontFamily: typography,
          fontSize: titleSize,
          fontWeight: 900,
          lineHeight: 1.35,
          textAlign: "center",
          textShadow: "0 4px 20px rgba(0,0,0,0.7)",
          opacity: titleOpacity,
          transform: `translateY(${(1 - titleOpacity) * 28}px)`,
        }}
      >
        {mainText}
      </div>

      <div style={{ position: "absolute", left: edge, right: edge, bottom: portrait ? 105 : 54, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.32)" }}>
        <div style={{ width: `${t * 100}%`, height: "100%", borderRadius: 3, backgroundColor: "#ffce68" }} />
      </div>
    </AbsoluteFill>
  );
};

const Captions = ({ cues, portrait }: { cues: CaptionCue[]; portrait: boolean }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const cue = cues.find((item) => item.startMs <= nowMs && nowMs < item.endMs);
  if (!cue) return null;

  return (
    <div
      dir="auto"
      style={{
        position: "absolute",
        left: portrait ? 62 : 170,
        right: portrait ? 62 : 170,
        bottom: portrait ? 175 : 78,
        padding: portrait ? "22px 34px" : "18px 36px",
        borderRadius: 24,
        backgroundColor: "rgba(7, 17, 33, 0.92)",
        border: "2px solid rgba(255,255,255,0.22)",
        color: "#ffffff",
        fontFamily: typography,
        fontWeight: 800,
        fontSize: portrait ? 50 : 48,
        lineHeight: 1.55,
        textAlign: "center",
        whiteSpace: "pre-line",
        boxShadow: "0 14px 44px rgba(0,0,0,0.25)",
      }}
    >
      {cue.text}
    </div>
  );
};

export const EpisodeComposition = ({ plan, images, audioUrl, musicUrl, subtitles = [] }: EpisodeCompositionProps) => {
  const { fps, durationInFrames } = useVideoConfig();
  const portrait = plan.format === "9:16";
  const timeline = getSceneTimeline(plan, fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#101c34" }}>
      {timeline.map(({ scene, index, startFrame, durationFrames }) => (
        <Sequence
          key={scene.id}
          from={startFrame}
          durationInFrames={durationFrames + (index < timeline.length - 1 && timeline[index + 1].scene.transition !== "cut" ? 12 : 0)}
          name={scene.title}
        >
          <SceneVisual
            scene={scene}
            index={index}
            count={timeline.length}
            imageUrl={images[scene.id]}
            durationFrames={durationFrames}
            hasCaptions={subtitles.length > 0}
            portrait={portrait}
          />
        </Sequence>
      ))}
      {audioUrl && <Audio src={audioUrl} volume={1} durationInFrames={durationInFrames} />}
      {musicUrl && (
        <Audio
          src={musicUrl}
          loop
          durationInFrames={durationInFrames}
          volume={(frame) => Math.min(0.16, frame / 25 * 0.16, (durationInFrames - frame) / 30 * 0.16)}
        />
      )}
      {subtitles.length > 0 && <Captions cues={subtitles} portrait={portrait} />}
    </AbsoluteFill>
  );
};
