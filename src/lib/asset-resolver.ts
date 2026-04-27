import type { Context } from "./context.js";
import type { SlotSource } from "../types.js";
import { isImagePath } from "./ffmpeg.js";

export type ResolvedAsset = {
  localPath: string;
  isImage: boolean;
  label: string;
};

export async function resolveSlotSource(ctx: Context, source: SlotSource): Promise<ResolvedAsset> {
  if (source.kind === "broll") {
    const clip = await ctx.index.getBRoll(source.id);
    if (!clip) throw new Error(`No b-roll clip with id "${source.id}"`);
    const local = await ctx.storage.resolveLocalPath(clip.url);
    return { localPath: local, isImage: false, label: clip.filename };
  }
  if (source.kind === "scene") {
    const asset = await ctx.sceneAssets.getAsset(source.id);
    if (!asset) throw new Error(`No scene asset with id "${source.id}"`);
    const local = await ctx.storage.resolveLocalPath(asset.url);
    return { localPath: local, isImage: asset.type !== "video", label: asset.label };
  }
  if (source.kind === "url") {
    const local = await ctx.storage.resolveLocalPath(source.url);
    return { localPath: local, isImage: isImagePath(local), label: source.url };
  }
  throw new Error(`Unknown slot source kind: ${JSON.stringify(source)}`);
}

export async function resolveVoiceoverPath(ctx: Context, voiceoverId: string): Promise<{ path: string; durationMs?: number }> {
  const vo = await ctx.index.getVoiceover(voiceoverId);
  if (!vo) throw new Error(`No voiceover with id "${voiceoverId}"`);
  const path = await ctx.storage.resolveLocalPath(vo.url);
  return { path, durationMs: vo.durationMs };
}

export async function resolveMusicPath(ctx: Context, trackId: string): Promise<string> {
  const track = await ctx.index.getMusic(trackId);
  if (!track) throw new Error(`No music track with id "${trackId}"`);
  return ctx.storage.resolveLocalPath(track.url);
}
