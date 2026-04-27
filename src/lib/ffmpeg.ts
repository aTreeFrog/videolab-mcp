import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../logger.js";

export type FfmpegSettings = {
  binary: string;
  videoCodec: string;
  preset: string;
  crf: number;
  audioCodec: string;
  audioBitrate: string;
};

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "bmp", "gif"]);

export function isImagePath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXT.has(ext);
}

async function runFfmpeg(args: string[], binary: string): Promise<void> {
  logger.debug(`ffmpeg ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e) => reject(new Error(`ffmpeg spawn failed: ${e.message}. Is the binary on PATH? (configured: ${binary})`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

function ensureDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export type SlotInput = {
  sourcePath: string;
  isImage: boolean;
  durationMs: number;
};

export async function buildSlotIntermediate(opts: {
  slot: SlotInput;
  width: number;
  height: number;
  outputPath: string;
  settings: FfmpegSettings;
}): Promise<void> {
  const { slot, width, height, outputPath, settings } = opts;
  const durationSec = (slot.durationMs / 1000).toFixed(3);
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `setsar=1`,
    `fps=30`,
  ].join(",");

  ensureDir(outputPath);

  const args: string[] = ["-y"];
  if (slot.isImage) {
    args.push("-loop", "1", "-t", durationSec, "-i", slot.sourcePath);
  } else {
    args.push("-stream_loop", "-1", "-t", durationSec, "-i", slot.sourcePath);
  }
  args.push(
    "-vf", vf,
    "-an",
    "-c:v", settings.videoCodec,
    "-preset", settings.preset,
    "-crf", String(settings.crf),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  );
  await runFfmpeg(args, settings.binary);
}

export async function concatSlots(opts: {
  slotPaths: string[];
  outputPath: string;
  settings: FfmpegSettings;
}): Promise<void> {
  const { slotPaths, outputPath, settings } = opts;
  if (slotPaths.length === 0) throw new Error("concatSlots requires at least one slot");
  ensureDir(outputPath);

  if (slotPaths.length === 1) {
    await runFfmpeg(["-y", "-i", slotPaths[0], "-c", "copy", outputPath], settings.binary);
    return;
  }

  const inputArgs: string[] = [];
  for (const p of slotPaths) inputArgs.push("-i", p);
  const filterParts = slotPaths.map((_, i) => `[${i}:v]`).join("");
  const filter = `${filterParts}concat=n=${slotPaths.length}:v=1:a=0[outv]`;
  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex", filter,
    "-map", "[outv]",
    "-c:v", settings.videoCodec,
    "-preset", settings.preset,
    "-crf", String(settings.crf),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runFfmpeg(args, settings.binary);
}

export async function buildAudioMix(opts: {
  voiceoverPath?: string;
  musicPath?: string;
  durationMs: number;
  voiceoverVolume: number;
  musicVolume: number;
  outputPath: string;
  settings: FfmpegSettings;
}): Promise<void> {
  const { voiceoverPath, musicPath, durationMs, voiceoverVolume, musicVolume, outputPath, settings } = opts;
  const durationSec = (durationMs / 1000).toFixed(3);
  ensureDir(outputPath);

  if (!voiceoverPath && !musicPath) {
    throw new Error("buildAudioMix requires at least one of voiceoverPath or musicPath");
  }

  const inputArgs: string[] = [];
  const filterChains: string[] = [];
  let outLabel: string;

  if (voiceoverPath && musicPath) {
    inputArgs.push("-i", voiceoverPath, "-stream_loop", "-1", "-i", musicPath);
    filterChains.push(`[0:a]volume=${voiceoverVolume},apad[v]`);
    filterChains.push(`[1:a]volume=${musicVolume}[m]`);
    filterChains.push(`[v][m]amix=inputs=2:duration=first:dropout_transition=0[mix]`);
    outLabel = "[mix]";
  } else if (voiceoverPath) {
    inputArgs.push("-i", voiceoverPath);
    filterChains.push(`[0:a]volume=${voiceoverVolume},apad[mix]`);
    outLabel = "[mix]";
  } else {
    inputArgs.push("-stream_loop", "-1", "-i", musicPath!);
    filterChains.push(`[0:a]volume=${musicVolume}[mix]`);
    outLabel = "[mix]";
  }

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex", filterChains.join(";"),
    "-map", outLabel,
    "-t", durationSec,
    "-ac", "2",
    "-ar", "44100",
    "-c:a", settings.audioCodec,
    "-b:a", settings.audioBitrate,
    outputPath,
  ];
  await runFfmpeg(args, settings.binary);
}

export async function burnSubtitles(opts: {
  videoPath: string;
  assPath: string;
  outputPath: string;
  settings: FfmpegSettings;
}): Promise<void> {
  const { videoPath, assPath, outputPath, settings } = opts;
  ensureDir(outputPath);
  // ffmpeg subtitles filter: forward slashes, escape colon (Windows drive letter), and escape single quotes.
  const escaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const args = [
    "-y",
    "-i", videoPath,
    "-vf", `subtitles='${escaped}'`,
    "-c:v", settings.videoCodec,
    "-preset", settings.preset,
    "-crf", String(settings.crf),
    "-pix_fmt", "yuv420p",
    "-an",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runFfmpeg(args, settings.binary);
}

export async function muxVideoAudio(opts: {
  videoPath: string;
  audioPath?: string;
  outputPath: string;
  settings: FfmpegSettings;
}): Promise<void> {
  const { videoPath, audioPath, outputPath, settings } = opts;
  ensureDir(outputPath);
  const args: string[] = ["-y", "-i", videoPath];
  if (audioPath) {
    args.push("-i", audioPath, "-c:v", "copy", "-c:a", settings.audioCodec, "-b:a", settings.audioBitrate, "-shortest");
  } else {
    args.push("-c:v", "copy", "-an");
  }
  args.push("-movflags", "+faststart", outputPath);
  await runFfmpeg(args, settings.binary);
}
