export type VideoFormat = "16:9" | "9:16";

export type MotionStyle =
  | "push-in"
  | "pull-out"
  | "pan-left"
  | "pan-right"
  | "float";

export type TransitionStyle = "fade" | "slide" | "cut";

export interface EpisodeScene {
  id: string;
  title: string;
  durationSec: number;
  narration: string;
  onScreenText: string;
  imagePrompt: string;
  motion: MotionStyle;
  transition: TransitionStyle;
}

export interface EpisodePlan {
  title: string;
  description: string;
  visualBible: string;
  youtubeTitle: string;
  youtubeDescription: string;
  youtubeTags: string[];
  format: VideoFormat;
  ageGroup: string;
  language: string;
  artStyle: string;
  scenes: EpisodeScene[];
}

export interface PlanRequest {
  description: string;
  ageGroup: string;
  format: VideoFormat;
  durationSec: number;
  artStyle: string;
  language: string;
}

export interface PlanResponse {
  plan: EpisodePlan;
  source: "gemini" | "ollama" | "template";
  notice?: string;
}
