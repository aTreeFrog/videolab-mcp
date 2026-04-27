import type { VoiceoverAlignment, Platform } from "../types.js";

export type CaptionOptions = {
  platform: Platform;
  totalDurationMs: number;
  wordsPerLine?: number;
  includeReady?: boolean;
};

type Word = { text: string; startSec: number; endSec: number };

export function buildAssSubtitles(alignment: VoiceoverAlignment, opts: CaptionOptions): string {
  const words = groupWords(alignment);
  if (words.length === 0) return "";

  const wordsPerLine = opts.wordsPerLine ?? 3;
  const lines: Word[][] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine));
  }

  const isDesktop = opts.platform === "desktop";
  const resX = isDesktop ? 1920 : 1080;
  const resY = isDesktop ? 1080 : 1920;
  const fontSize = isDesktop ? 42 : 52;
  const readySize = isDesktop ? 64 : 80;
  const marginV = isDesktop ? 80 : 550;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${resX}`,
    `PlayResY: ${resY}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H0000CCFF,&H00000000,&HB0BE2F7B,1,0,0,0,100,100,2,0,3,2,0,2,60,60,${marginV},1`,
    `Style: Ready,Arial,${readySize},&H00FFFFFF,&H00FFFFFF,&H00000000,&HB0BE2F7B,1,0,0,0,100,100,2,0,3,3,0,5,60,60,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const dialogues = lines.map(chunk => {
    const lineStart = chunk[0].startSec;
    const lineEnd = chunk[chunk.length - 1].endSec;
    const karaoke = chunk.map(w => {
      const durCs = Math.max(1, Math.round((w.endSec - w.startSec) * 100));
      return `{\\kf${durCs}}${w.text}`;
    }).join(" ");
    return `Dialogue: 0,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Default,,0,0,0,,${karaoke}`;
  });

  if (opts.includeReady) {
    const totalSec = opts.totalDurationMs / 1000;
    const readyStart = Math.max(0, totalSec - 3);
    const readyEnd = readyStart + 1;
    dialogues.push(`Dialogue: 0,${formatAssTime(readyStart)},${formatAssTime(readyEnd)},Ready,,0,0,0,,Ready?`);
  }

  return header + "\n" + dialogues.join("\n") + "\n";
}

function groupWords(alignment: VoiceoverAlignment): Word[] {
  const { characters, startMs, endMs } = alignment;
  const words: Word[] = [];
  let cur = "";
  let wordStartMs: number | null = null;
  let wordEndMs: number | null = null;
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    if (c === " " || c === "\n") {
      if (cur && wordStartMs !== null && wordEndMs !== null) {
        words.push({ text: cur, startSec: wordStartMs / 1000, endSec: wordEndMs / 1000 });
      }
      cur = "";
      wordStartMs = null;
      wordEndMs = null;
    } else {
      if (wordStartMs === null) wordStartMs = startMs[i];
      cur += c;
      wordEndMs = endMs[i];
    }
  }
  if (cur && wordStartMs !== null && wordEndMs !== null) {
    words.push({ text: cur, startSec: wordStartMs / 1000, endSec: wordEndMs / 1000 });
  }
  return words;
}

function formatAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
