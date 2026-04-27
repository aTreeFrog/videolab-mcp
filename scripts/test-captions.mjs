// Standalone test: burn captions onto render_a2f53cbb's cached visuals.mp4
// then re-mux with the same VO + music. Outputs a new render_*.mp4.
import { config as dotenvConfig } from "dotenv";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = pathResolve(__dirname, "..");
dotenvConfig({ path: pathResolve(PACKAGE_ROOT, ".env") });
if (!process.env.VIDEOLAB_CONFIG && !process.env.PROMO_VIDEO_CONFIG) {
  process.env.VIDEOLAB_CONFIG = pathResolve(PACKAGE_ROOT, "videolab.config.json");
}

const { loadConfig } = await import("../build/config.js");
const { buildContext } = await import("../build/lib/context.js");
const { buildAssSubtitles } = await import("../build/lib/subtitle-builder.js");
const { burnSubtitles, buildAudioMix, muxVideoAudio } = await import("../build/lib/ffmpeg.js");
const { resolveVoiceoverPath, resolveMusicPath } = await import("../build/lib/asset-resolver.js");
const { openInDefaultPlayer } = await import("../build/lib/player.js");

const loaded = loadConfig();
const ctx = buildContext(loaded);
const settings = ctx.config.ffmpeg;

const PARENT_RENDER_ID = "render_a2f53cbb";
const parent = await ctx.index.getRender(PARENT_RENDER_ID);
if (!parent) { console.error("parent render not found"); process.exit(1); }

console.log(`parent: ${parent.renderId} (${parent.platform}, ${parent.timeline.slots.length} slots)`);

const vo = await ctx.index.getVoiceover(parent.voiceoverId);
if (!vo?.alignment) { console.error("voiceover missing alignment"); process.exit(1); }
console.log(`voiceover: ${vo.id} | ${vo.alignment.characters.length} chars of alignment`);

const totalMs = parent.timeline.slots.reduce((s, x) => s + x.durationMs, 0);
const renderId = `render_${randomUUID().slice(0, 8)}`;
const renderDirRel = `renders/${renderId}`;
const renderDirAbs = await ctx.storage.localPathFor(renderDirRel + "/.keep");
mkdirSync(dirname(renderDirAbs), { recursive: true });

// 1. Build ASS
const ass = buildAssSubtitles(vo.alignment, {
  platform: parent.platform,
  totalDurationMs: totalMs,
  includeReady: false,
});
const assLocal = await ctx.storage.localPathFor(`${renderDirRel}/captions.ass`);
writeFileSync(assLocal, ass, "utf8");
console.log(`wrote ASS: ${assLocal} (${ass.length} chars)`);

// 2. Burn captions on cached visuals
const visualsLocal = await ctx.storage.resolveLocalPath(parent.visualsPath);
const captionedLocal = await ctx.storage.localPathFor(`${renderDirRel}/visuals_captioned.mp4`);
console.log(`burning subtitles from ${visualsLocal} -> ${captionedLocal}`);
await burnSubtitles({ videoPath: visualsLocal, assPath: assLocal, outputPath: captionedLocal, settings });

// 3. Mix audio (VO + music)
const { path: voPath } = await resolveVoiceoverPath(ctx, parent.voiceoverId);
const musicPath = await resolveMusicPath(ctx, parent.musicId);
const mixLocal = await ctx.storage.localPathFor(`${renderDirRel}/mix.aac`);
await buildAudioMix({
  voiceoverPath: voPath, musicPath,
  durationMs: totalMs,
  voiceoverVolume: ctx.config.defaults.voiceoverVolume,
  musicVolume: ctx.config.defaults.musicBedVolume,
  outputPath: mixLocal, settings,
});

// 4. Mux video + audio
const outputRel = `${renderDirRel}/output.mp4`;
const outputLocal = await ctx.storage.localPathFor(outputRel);
await muxVideoAudio({ videoPath: captionedLocal, audioPath: mixLocal, outputPath: outputLocal, settings });

// 5. Persist manifest
const manifest = {
  renderId,
  parentId: parent.renderId,
  createdAt: new Date().toISOString(),
  platform: parent.platform,
  timeline: parent.timeline,
  voiceoverId: parent.voiceoverId,
  musicId: parent.musicId,
  outputPath: outputRel,
  visualsPath: parent.visualsPath,
};
await ctx.index.putRender(manifest);

console.log(`\nrender done: ${renderId}`);
console.log(`output: ${outputLocal}`);
const r = openInDefaultPlayer(outputLocal);
console.log(`opened in player: ${r.spawned}`);
