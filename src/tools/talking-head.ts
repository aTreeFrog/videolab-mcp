import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { BRollClip, Platform } from "../types.js";

const ImageSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scene"), id: z.string() }),
  z.object({ kind: z.literal("url"), url: z.string() }),
]);

const AudioSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("voiceover"), voiceoverId: z.string() }),
  z.object({ kind: z.literal("music"), trackId: z.string() }),
  z.object({ kind: z.literal("url"), url: z.string() }),
]);

export function registerTalkingHeadTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "generate_talking_head",
    {
      description: "Animate a portrait image to lip-sync with an audio track via the configured talking-head provider (Fal OmniHuman). Output is a video where the face in the image speaks/moves in sync with the audio. Saves the result as a b-roll clip so it can be dropped into any timeline slot via { kind: 'broll', id: <newClipId> }. Async — typically takes 30-90 seconds. Audio max ~30s.",
      inputSchema: {
        imageSource: ImageSourceSchema.describe("Portrait image. scene = scene asset (NPC portrait, character art), url = file:// or local path."),
        audioSource: AudioSourceSchema.describe("Audio to lip-sync. voiceover = generated voiceover from index, music = music track from index, url = file:// or local path."),
        platform: z.enum(["mobile", "desktop"]).optional().describe("Platform tag for the resulting b-roll clip. Defaults to config.defaults.platform."),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const platform = (args.platform ?? ctx.config.defaults.platform) as Platform;
      const { imageBytes, imageMimeType, imageLabel } = await loadImageBytes(ctx, args.imageSource);
      const { audioBytes, audioMimeType, audioLabel } = await loadAudioBytes(ctx, args.audioSource);

      const result = await ctx.talkingHead().generate({
        imageBytes,
        imageMimeType,
        audioBytes,
        audioMimeType,
      });

      const id = `broll_omni_${randomUUID().slice(0, 8)}`;
      const written = await ctx.storage.writeBlob(`broll/${id}.mp4`, result.videoBytes);
      const clip: BRollClip = {
        id,
        url: written.url,
        filename: `${id}.mp4`,
        platform,
        durationSec: result.durationSeconds ?? 0,
        description: args.description ?? `OmniHuman talking head: ${imageLabel} + ${audioLabel}`,
        source: "fal-omnihuman",
        tags: args.tags ?? ["generated", "omnihuman", "talking-head"],
      };
      await ctx.index.putBRoll(clip);

      const uri = await ctx.storage.resolveUri(written.url);
      return {
        content: [
          { type: "text", text:
            `clipId: ${id}\n` +
            `${platform} | ${clip.durationSec.toFixed(1)}s | image: ${imageLabel} | audio: ${audioLabel}\n` +
            `${clip.description}\n` +
            `uri: ${uri}\n\n` +
            `Use as a slot source: { "kind": "broll", "id": "${id}" }`,
          },
          { type: "resource_link", uri, name: clip.filename, mimeType: "video/mp4" },
        ],
      };
    },
  );
}

type ImageSource =
  | { kind: "scene"; id: string }
  | { kind: "url"; url: string };

type AudioSource =
  | { kind: "voiceover"; voiceoverId: string }
  | { kind: "music"; trackId: string }
  | { kind: "url"; url: string };

async function loadImageBytes(ctx: Context, source: ImageSource): Promise<{ imageBytes: Buffer; imageMimeType: string; imageLabel: string }> {
  if (source.kind === "scene") {
    const asset = await ctx.sceneAssets.getAsset(source.id);
    if (!asset) throw new Error(`No scene asset with id "${source.id}"`);
    if (asset.type === "video") throw new Error(`Scene asset "${source.id}" is a video, not a portrait image.`);
    const local = await ctx.storage.resolveLocalPath(asset.url);
    return { imageBytes: readFileSync(local), imageMimeType: mimeFromPath(local, "image"), imageLabel: asset.label };
  }
  const local = await ctx.storage.resolveLocalPath(source.url);
  return { imageBytes: readFileSync(local), imageMimeType: mimeFromPath(local, "image"), imageLabel: source.url };
}

async function loadAudioBytes(ctx: Context, source: AudioSource): Promise<{ audioBytes: Buffer; audioMimeType: string; audioLabel: string }> {
  if (source.kind === "voiceover") {
    const vo = await ctx.index.getVoiceover(source.voiceoverId);
    if (!vo) throw new Error(`No voiceover with id "${source.voiceoverId}"`);
    const local = await ctx.storage.resolveLocalPath(vo.url);
    return { audioBytes: readFileSync(local), audioMimeType: mimeFromPath(local, "audio"), audioLabel: `voiceover ${vo.id}` };
  }
  if (source.kind === "music") {
    const track = await ctx.index.getMusic(source.trackId);
    if (!track) throw new Error(`No music track with id "${source.trackId}"`);
    const local = await ctx.storage.resolveLocalPath(track.url);
    return { audioBytes: readFileSync(local), audioMimeType: mimeFromPath(local, "audio"), audioLabel: `music ${track.displayName}` };
  }
  const local = await ctx.storage.resolveLocalPath(source.url);
  return { audioBytes: readFileSync(local), audioMimeType: mimeFromPath(local, "audio"), audioLabel: source.url };
}

function mimeFromPath(p: string, kind: "image" | "audio"): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "image") {
    switch (ext) {
      case "png": return "image/png";
      case "jpg":
      case "jpeg": return "image/jpeg";
      case "webp": return "image/webp";
      case "gif": return "image/gif";
      default: return "application/octet-stream";
    }
  }
  switch (ext) {
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "m4a": return "audio/mp4";
    case "aac": return "audio/aac";
    case "ogg": return "audio/ogg";
    default: return "application/octet-stream";
  }
}
