export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

const parseTimecode = (value: string): number | null => {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, "0"));
  if (minutes > 59 || seconds > 59) return null;

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
};

/** SRT parsing is intentionally local, so user subtitles never need to leave the device. */
export const parseSrt = (raw: string): CaptionCue[] => {
  const blocks = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/);

  return blocks.flatMap((block) => {
    const lines = block.split("\n").map((line) => line.trim());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) return [];

    const [startRaw, endRaw] = lines[timingIndex].split(/\s*-->\s*/);
    const startMs = parseTimecode(startRaw ?? "");
    const endMs = parseTimecode((endRaw ?? "").split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (startMs === null || endMs === null || endMs <= startMs || !text) return [];

    return [{ startMs, endMs, text }];
  }).sort((a, b) => a.startMs - b.startMs);
};

export const normalizeCaptions = (input?: string | CaptionCue[]): CaptionCue[] =>
  typeof input === "string" ? parseSrt(input) : (input ?? []);
