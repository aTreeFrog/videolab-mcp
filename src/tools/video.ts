import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolve as pathResolve } from "node:path";
import { writeFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { Slot, SlotSource, Timeline, RenderManifest, Platform } from "../types.js";
import { PLATFORM_DIMENSIONS } from "../types.js";
import { openInDefaultPlayer } from "../lib/player.js";
import {
  buildSlotIntermediate, concatSlots, buildAudioMix, muxVideoAudio, burnSubtitles,
  type FfmpegSettings,
} from "../lib/ffmpeg.js";
import { resolveSlotSource, resolveVoiceoverPath, resolveMusicPath } from "../lib/asset-resolver.js";
import { buildAssSubtitles } from "../lib/subtitle-builder.js";
import { logger } from "../logger.js";

const SlotSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("broll"), id: z.string() }),
  z.object({ kind: z.literal("scene"), id: z.string() }),
  z.object({ kind: z.literal("url"), url: z.string() }),
]);

const SlotSchema = z.object({
  source: SlotSourceSchema,
  durationMs: z.number().int().positive(),
});

const TimelineSchema = z.object({
  platform: z.enum(["mobile", "desktop"]).optional(),
  slots: z.array(SlotSchema).min(1),
});

export function registerVideoTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "assemble_promo",
    {
      description: "Stitch a timeline of visual slots + voiceover + optional music bed into an MP4 via FFmpeg. Burns karaoke-style captions over the video when the voiceover has alignment data (default on). Auto-opens the result in the default video player. Returns renderId for use with swap_music/swap_voiceover/swap_clip.",
      inputSchema: {
        timeline: TimelineSchema.describe("Visual slot sequence. Each slot specifies a source (broll/scene/url) and durationMs."),
        voiceoverId: z.string().optional().describe("Voiceover to overlay. Generated via generate_voiceover."),
        musicId: z.string().optional().describe("Music bed. Generated via generate_music or selected from list_music."),
        outputName: z.string().optional().describe("Friendly name for the output file."),
        autoPlay: z.boolean().optional().describe("Open the rendered file in the default player. Default true."),
        captions: z.boolean().optional().describe("Burn karaoke voiceover captions on top of the video. Default true. Requires the voiceover to have been generated with withTimestamps=true (the default)."),
        captionsWordsPerLine: z.number().int().min(1).max(10).optional().describe("Words shown per caption line (1-10). Default 3. Lower = more lines/faster cuts; higher = denser blocks."),
        captionsIncludeReady: z.boolean().optional().describe("Append a large 'Ready?' card 3s before the end. Default false."),
      },
    },
    async (args) => {
      const platform = (args.timeline.platform ?? ctx.config.defaults.platform) as Platform;
      const timeline: Timeline = { platform, slots: args.timeline.slots as Slot[] };
      const result = await assembleRender(ctx, {
        timeline,
        voiceoverId: args.voiceoverId,
        musicId: args.musicId,
        autoPlay: args.autoPlay ?? true,
        captions: args.captions ?? true,
        captionsWordsPerLine: args.captionsWordsPerLine ?? 3,
        captionsIncludeReady: args.captionsIncludeReady ?? false,
      });
      return summarizeRender(result.manifest, result.fileUri, result.openedInPlayer);
    },
  );

  server.registerTool(
    "swap_music",
    {
      description: "Replace the music on an existing render. Reuses the cached silent video stream — only re-mixes audio and re-muxes (~2s instead of full re-render). Pass newMusicId=null to drop music entirely. Creates a new renderId linked to the parent.",
      inputSchema: {
        renderId: z.string(),
        newMusicId: z.string().nullable().optional().describe("New music track id, or null to drop music"),
        autoPlay: z.boolean().optional(),
        captionsWordsPerLine: z.number().int().min(1).max(10).optional().describe("Override caption words-per-line for this render (1-10). Default 3."),
      },
    },
    async ({ renderId, newMusicId, autoPlay = true, captionsWordsPerLine }) => {
      const parent = await ctx.index.getRender(renderId);
      if (!parent) {
        return { content: [{ type: "text", text: `No render with id "${renderId}".` }], isError: true };
      }
      const result = await swapAudio(ctx, parent, {
        voiceoverId: parent.voiceoverId,
        musicId: newMusicId === null ? undefined : (newMusicId ?? parent.musicId),
        autoPlay,
        captionsWordsPerLine: captionsWordsPerLine ?? 3,
      });
      return summarizeRender(result.manifest, result.fileUri, result.openedInPlayer);
    },
  );

  server.registerTool(
    "swap_voiceover",
    {
      description: "Replace the voiceover on an existing render. Reuses cached silent video stream. Pass newVoiceoverId=null to drop voiceover. Creates a new renderId linked to the parent.",
      inputSchema: {
        renderId: z.string(),
        newVoiceoverId: z.string().nullable().optional(),
        autoPlay: z.boolean().optional(),
        captionsWordsPerLine: z.number().int().min(1).max(10).optional().describe("Override caption words-per-line for this render (1-10). Default 3."),
      },
    },
    async ({ renderId, newVoiceoverId, autoPlay = true, captionsWordsPerLine }) => {
      const parent = await ctx.index.getRender(renderId);
      if (!parent) {
        return { content: [{ type: "text", text: `No render with id "${renderId}".` }], isError: true };
      }
      const result = await swapAudio(ctx, parent, {
        voiceoverId: newVoiceoverId === null ? undefined : (newVoiceoverId ?? parent.voiceoverId),
        musicId: parent.musicId,
        autoPlay,
        captionsWordsPerLine: captionsWordsPerLine ?? 3,
      });
      return summarizeRender(result.manifest, result.fileUri, result.openedInPlayer);
    },
  );

  server.registerTool(
    "swap_clip",
    {
      description: "Replace one slot's source (or duration) on an existing render. Re-renders that slot, re-concats visuals, re-mixes audio. Creates a new renderId linked to the parent.",
      inputSchema: {
        renderId: z.string(),
        slotIndex: z.number().int().nonnegative(),
        newSource: SlotSourceSchema.optional(),
        newDurationMs: z.number().int().positive().optional(),
        autoPlay: z.boolean().optional(),
        captionsWordsPerLine: z.number().int().min(1).max(10).optional().describe("Override caption words-per-line for this render (1-10). Default 3."),
      },
    },
    async ({ renderId, slotIndex, newSource, newDurationMs, autoPlay = true, captionsWordsPerLine }) => {
      const parent = await ctx.index.getRender(renderId);
      if (!parent) {
        return { content: [{ type: "text", text: `No render with id "${renderId}".` }], isError: true };
      }
      if (slotIndex >= parent.timeline.slots.length) {
        return { content: [{ type: "text", text: `slotIndex ${slotIndex} out of range (timeline has ${parent.timeline.slots.length} slots).` }], isError: true };
      }
      if (!newSource && newDurationMs == null) {
        return { content: [{ type: "text", text: "Must specify newSource and/or newDurationMs." }], isError: true };
      }
      const newSlots = parent.timeline.slots.map((s, i) => {
        if (i !== slotIndex) return s;
        return {
          source: (newSource as SlotSource | undefined) ?? s.source,
          durationMs: newDurationMs ?? s.durationMs,
        };
      });
      const newTimeline: Timeline = { platform: parent.timeline.platform, slots: newSlots };
      const result = await assembleRender(ctx, {
        timeline: newTimeline,
        voiceoverId: parent.voiceoverId,
        musicId: parent.musicId,
        autoPlay,
        parentId: parent.renderId,
        captions: true,
        captionsWordsPerLine: captionsWordsPerLine ?? 3,
        captionsIncludeReady: false,
      });
      return summarizeRender(result.manifest, result.fileUri, result.openedInPlayer);
    },
  );

  server.registerTool(
    "play_render",
    {
      description: "Open a previously-rendered video in the default player.",
      inputSchema: { renderId: z.string() },
    },
    async ({ renderId }) => {
      const r = await ctx.index.getRender(renderId);
      if (!r) return { content: [{ type: "text", text: `No render with id "${renderId}".` }], isError: true };
      const local = await ctx.storage.resolveLocalPath(r.outputPath);
      const opened = openInDefaultPlayer(local);
      const uri = await ctx.storage.resolveUri(r.outputPath);
      return {
        content: [
          { type: "text", text: `${r.renderId}${opened.spawned ? " (opened in player)" : " (failed to open player)"}\nuri: ${uri}` },
          { type: "resource_link", uri, name: `render ${r.renderId}`, mimeType: "video/mp4" },
        ],
      };
    },
  );

  server.registerTool(
    "list_recent_renders",
    {
      description: "List recent renders, newest first. Each entry shows id, parent, slot count, audio refs.",
      inputSchema: { limit: z.number().int().positive().optional() },
    },
    async ({ limit = 20 }) => {
      const renders = (await ctx.index.listRenders()).slice(0, limit);
      if (renders.length === 0) return { content: [{ type: "text", text: "No renders yet." }] };
      const lines = renders.map(r => `- ${r.renderId}${r.parentId ? ` (rev of ${r.parentId})` : ""} | ${r.platform} | ${r.timeline.slots.length} slots | vo:${r.voiceoverId ?? "-"} music:${r.musicId ?? "-"}`);
      return { content: [{ type: "text", text: `${renders.length} render(s):\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "describe_render",
    {
      description: "Show the full manifest for a render — timeline, audio refs, output path, parent.",
      inputSchema: { renderId: z.string() },
    },
    async ({ renderId }) => {
      const r = await ctx.index.getRender(renderId);
      if (!r) return { content: [{ type: "text", text: `No render with id "${renderId}".` }], isError: true };
      const uri = await ctx.storage.resolveUri(r.outputPath);
      const slotLines = r.timeline.slots.map((s, i) => `  [${i}] ${describeSource(s.source)} | ${s.durationMs}ms`);
      return {
        content: [
          { type: "text", text:
            `${r.renderId}${r.parentId ? ` (rev of ${r.parentId})` : ""}\n` +
            `created: ${r.createdAt}\n` +
            `platform: ${r.platform}\n` +
            `voiceover: ${r.voiceoverId ?? "-"}\n` +
            `music: ${r.musicId ?? "-"}\n` +
            `output: ${uri}\n` +
            `slots:\n${slotLines.join("\n")}`,
          },
          { type: "resource_link", uri, name: `render ${r.renderId}`, mimeType: "video/mp4" },
        ],
      };
    },
  );
}

function describeSource(s: SlotSource): string {
  switch (s.kind) {
    case "broll": return `broll:${s.id}`;
    case "scene": return `scene:${s.id}`;
    case "url": return `url:${s.url}`;
  }
}

type AssembleArgs = {
  timeline: Timeline;
  voiceoverId?: string;
  musicId?: string;
  autoPlay: boolean;
  parentId?: string;
  captions: boolean;
  captionsWordsPerLine: number;
  captionsIncludeReady: boolean;
};

type AssembleResult = {
  manifest: RenderManifest;
  fileUri: string;
  openedInPlayer: boolean;
};

async function assembleRender(ctx: Context, args: AssembleArgs): Promise<AssembleResult> {
  const settings = ctx.config.ffmpeg as FfmpegSettings;
  const dims = PLATFORM_DIMENSIONS[args.timeline.platform];
  const renderId = `render_${randomUUID().slice(0, 8)}`;

  logger.info(`assemble_promo ${renderId} platform=${args.timeline.platform} slots=${args.timeline.slots.length} vo=${args.voiceoverId ?? "-"} music=${args.musicId ?? "-"}`);

  const renderDirRel = `renders/${renderId}`;
  const slotIntermediates: string[] = [];

  for (let i = 0; i < args.timeline.slots.length; i++) {
    const slot = args.timeline.slots[i];
    const resolved = await resolveSlotSource(ctx, slot.source);
    const slotRel = `${renderDirRel}/slot_${String(i).padStart(2, "0")}.mp4`;
    const slotLocal = await ctx.storage.localPathFor(slotRel);
    await buildSlotIntermediate({
      slot: { sourcePath: resolved.localPath, isImage: resolved.isImage, durationMs: slot.durationMs },
      width: dims.width,
      height: dims.height,
      outputPath: slotLocal,
      settings,
    });
    slotIntermediates.push(slotLocal);
  }

  const visualsRel = `${renderDirRel}/visuals.mp4`;
  const visualsLocal = await ctx.storage.localPathFor(visualsRel);
  await concatSlots({ slotPaths: slotIntermediates, outputPath: visualsLocal, settings });

  const totalMs = args.timeline.slots.reduce((sum, s) => sum + s.durationMs, 0);

  const captionedVisualsLocal = await maybeBurnCaptions(ctx, {
    visualsLocal,
    voiceoverId: args.voiceoverId,
    captions: args.captions,
    captionsWordsPerLine: args.captionsWordsPerLine,
    captionsIncludeReady: args.captionsIncludeReady,
    platform: args.timeline.platform,
    totalMs,
    renderDirRel,
    settings,
  });

  const outputRel = `${renderDirRel}/output.mp4`;
  const outputLocal = await ctx.storage.localPathFor(outputRel);
  await muxAndMix(ctx, {
    visualsPath: captionedVisualsLocal,
    outputPath: outputLocal,
    voiceoverId: args.voiceoverId,
    musicId: args.musicId,
    durationMs: totalMs,
    settings,
    renderDirRel,
  });

  const manifest: RenderManifest = {
    renderId,
    parentId: args.parentId,
    createdAt: new Date().toISOString(),
    platform: args.timeline.platform,
    timeline: args.timeline,
    voiceoverId: args.voiceoverId,
    musicId: args.musicId,
    outputPath: outputRel,
    visualsPath: visualsRel,
  };
  await ctx.index.putRender(manifest);

  const fileUri = await ctx.storage.resolveUri(outputRel);
  let opened = false;
  if (args.autoPlay) {
    const r = openInDefaultPlayer(outputLocal);
    opened = r.spawned;
  }
  return { manifest, fileUri, openedInPlayer: opened };
}

async function swapAudio(ctx: Context, parent: RenderManifest, args: {
  voiceoverId?: string; musicId?: string; autoPlay: boolean; captionsWordsPerLine: number;
}): Promise<AssembleResult> {
  const settings = ctx.config.ffmpeg as FfmpegSettings;
  const renderId = `render_${randomUUID().slice(0, 8)}`;
  const renderDirRel = `renders/${renderId}`;

  if (!parent.visualsPath) {
    throw new Error(`Parent render ${parent.renderId} has no cached visuals. Cannot swap audio. Re-render with assemble_promo first.`);
  }
  const visualsLocal = await ctx.storage.resolveLocalPath(parent.visualsPath);
  const totalMs = parent.timeline.slots.reduce((sum, s) => sum + s.durationMs, 0);

  const outputRel = `${renderDirRel}/output.mp4`;
  const outputLocal = await ctx.storage.localPathFor(outputRel);

  const captionedVisualsLocal = await maybeBurnCaptions(ctx, {
    visualsLocal,
    voiceoverId: args.voiceoverId,
    captions: true,
    captionsWordsPerLine: args.captionsWordsPerLine,
    captionsIncludeReady: false,
    platform: parent.platform,
    totalMs,
    renderDirRel,
    settings,
  });

  await muxAndMix(ctx, {
    visualsPath: captionedVisualsLocal,
    outputPath: outputLocal,
    voiceoverId: args.voiceoverId,
    musicId: args.musicId,
    durationMs: totalMs,
    settings,
    renderDirRel,
  });

  const manifest: RenderManifest = {
    renderId,
    parentId: parent.renderId,
    createdAt: new Date().toISOString(),
    platform: parent.platform,
    timeline: parent.timeline,
    voiceoverId: args.voiceoverId,
    musicId: args.musicId,
    outputPath: outputRel,
    visualsPath: parent.visualsPath,
  };
  await ctx.index.putRender(manifest);

  const fileUri = await ctx.storage.resolveUri(outputRel);
  let opened = false;
  if (args.autoPlay) {
    const r = openInDefaultPlayer(outputLocal);
    opened = r.spawned;
  }
  return { manifest, fileUri, openedInPlayer: opened };
}

async function maybeBurnCaptions(ctx: Context, args: {
  visualsLocal: string;
  voiceoverId?: string;
  captions: boolean;
  captionsWordsPerLine: number;
  captionsIncludeReady: boolean;
  platform: Platform;
  totalMs: number;
  renderDirRel: string;
  settings: FfmpegSettings;
}): Promise<string> {
  if (!args.captions || !args.voiceoverId) return args.visualsLocal;
  const vo = await ctx.index.getVoiceover(args.voiceoverId);
  if (!vo?.alignment) {
    logger.warn(`captions: voiceover ${args.voiceoverId} has no alignment data; skipping caption burn. Re-generate with withTimestamps=true.`);
    return args.visualsLocal;
  }
  const ass = buildAssSubtitles(vo.alignment, {
    platform: args.platform,
    totalDurationMs: args.totalMs,
    wordsPerLine: args.captionsWordsPerLine,
    includeReady: args.captionsIncludeReady,
  });
  if (!ass) return args.visualsLocal;
  const assRel = `${args.renderDirRel}/captions.ass`;
  const assLocal = await ctx.storage.localPathFor(assRel);
  writeFileSync(assLocal, ass, "utf8");
  const captionedRel = `${args.renderDirRel}/visuals_captioned.mp4`;
  const captionedLocal = await ctx.storage.localPathFor(captionedRel);
  await burnSubtitles({
    videoPath: args.visualsLocal,
    assPath: assLocal,
    outputPath: captionedLocal,
    settings: args.settings,
  });
  return captionedLocal;
}

async function muxAndMix(ctx: Context, args: {
  visualsPath: string;
  outputPath: string;
  voiceoverId?: string;
  musicId?: string;
  durationMs: number;
  settings: FfmpegSettings;
  renderDirRel: string;
}): Promise<void> {
  let voPath: string | undefined;
  let musicPath: string | undefined;
  if (args.voiceoverId) ({ path: voPath } = await resolveVoiceoverPath(ctx, args.voiceoverId));
  if (args.musicId) musicPath = await resolveMusicPath(ctx, args.musicId);

  if (!voPath && !musicPath) {
    await muxVideoAudio({ videoPath: args.visualsPath, outputPath: args.outputPath, settings: args.settings });
    return;
  }

  const mixRel = `${args.renderDirRel}/mix.aac`;
  const mixLocal = await ctx.storage.localPathFor(mixRel);
  await buildAudioMix({
    voiceoverPath: voPath,
    musicPath,
    durationMs: args.durationMs,
    voiceoverVolume: ctx.config.defaults.voiceoverVolume,
    musicVolume: ctx.config.defaults.musicBedVolume,
    outputPath: mixLocal,
    settings: args.settings,
  });
  await muxVideoAudio({
    videoPath: args.visualsPath,
    audioPath: mixLocal,
    outputPath: args.outputPath,
    settings: args.settings,
  });
}

function summarizeRender(m: RenderManifest, uri: string, opened: boolean) {
  const totalMs = m.timeline.slots.reduce((s, x) => s + x.durationMs, 0);
  const slotLine = m.timeline.slots.map((s, i) => `[${i}] ${describeSource(s.source)} ${s.durationMs}ms`).join(" → ");
  return {
    content: [
      { type: "text" as const, text:
        `renderId: ${m.renderId}${m.parentId ? ` (rev of ${m.parentId})` : ""}\n` +
        `${m.platform} | ${totalMs}ms total | vo:${m.voiceoverId ?? "-"} music:${m.musicId ?? "-"}\n` +
        `${slotLine}\n` +
        (opened ? "opened in default player\n" : "") +
        `uri: ${uri}`,
      },
      { type: "resource_link" as const, uri, name: `render ${m.renderId}`, mimeType: "video/mp4" },
    ],
  };
}
