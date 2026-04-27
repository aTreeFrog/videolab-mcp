import { z } from "zod";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { Platform } from "../types.js";

export function registerTreeFrogSaveTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "save_music_to_treefrog",
    {
      description: "Upload a local music track to Azure Blob (campaign-assets/promos/music/) and insert a CampaignMusic document into the game's MongoDB. The track will then appear in the game's promo music library.",
      inputSchema: {
        trackId: z.string().describe("Local music track id from list_music"),
        campaignName: z.string().describe("CampaignMusic.campaignName (e.g. the campaign or library bucket this track belongs to)"),
        trackType: z.enum(["music", "sfx"]).optional(),
        variant: z.enum(["exploration", "battle"]).optional(),
        forceInstrumental: z.boolean().optional(),
        creatorId: z.string().optional(),
      },
    },
    async (args) => {
      const track = await ctx.index.getMusic(args.trackId);
      if (!track) return { content: [{ type: "text", text: `No local music track with id "${args.trackId}".` }], isError: true };
      const localPath = await ctx.storage.resolveLocalPath(track.url);
      const buffer = readFileSync(localPath);
      const filename = `${track.id}.mp3`;
      const blobPath = `promos/music/${filename}`;
      const blobUrl = await ctx.blobUploader().uploadBuffer(blobPath, buffer, "audio/mpeg");

      const db = await ctx.treefrogDb();
      const doc = {
        campaignName: args.campaignName,
        audioUrl: blobUrl,
        displayName: track.displayName,
        prompt: track.displayName,
        description: track.displayName,
        trackType: args.trackType ?? "music",
        variant: args.variant ?? "exploration",
        tags: track.tags ?? ["promo", "mcp-generated"],
        mood: track.mood,
        genre: track.genre,
        intensity: track.intensity,
        themes: track.themes,
        isShared: true,
        isGlobalLibrary: false,
        durationMs: track.durationMs,
        forceInstrumental: args.forceInstrumental ?? true,
        blobContainer: ctx.config.treefrog.azureContainer,
        blobPath,
        creatorId: args.creatorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await db.collection(ctx.config.treefrog.musicCollection ?? "campaignmusics").insertOne(doc);
      return {
        content: [{
          type: "text",
          text: `saved to TreeFrog\n_id: ${String(result.insertedId)}\ncampaign: ${args.campaignName}\nblob: ${blobUrl}`,
        }],
      };
    },
  );

  server.registerTool(
    "save_broll_to_treefrog",
    {
      description: "Upload a local b-roll clip to Azure Blob (campaign-assets/promos/b_roll/) and insert a BRollClip document into MongoDB. The clip will appear in the game's b-roll library.",
      inputSchema: {
        clipId: z.string().describe("Local b-roll clip id from list_broll"),
        clipStart: z.number().default(0).describe("BRollClip.clipStart (seconds in source). Use 0 for generated clips."),
        clipEnd: z.number().optional().describe("BRollClip.clipEnd (seconds in source). Defaults to durationSec."),
        sourceLabel: z.string().optional().describe("BRollClip.source. Defaults to clip.source or 'mcp-generated'."),
      },
    },
    async (args) => {
      const clip = await ctx.index.getBRoll(args.clipId);
      if (!clip) return { content: [{ type: "text", text: `No local b-roll clip with id "${args.clipId}".` }], isError: true };
      const localPath = await ctx.storage.resolveLocalPath(clip.url);
      const buffer = readFileSync(localPath);
      const filename = clip.filename || `${clip.id}.mp4`;
      const blobPath = `promos/b_roll/${filename}`;
      const blobUrl = await ctx.blobUploader().uploadBuffer(blobPath, buffer, "video/mp4");

      const db = await ctx.treefrogDb();
      const doc = {
        blobUrl,
        blobPath,
        filename,
        platform: clip.platform,
        duration: clip.durationSec,
        description: clip.description,
        source: args.sourceLabel ?? clip.source ?? "mcp-generated",
        clipStart: args.clipStart,
        clipEnd: args.clipEnd ?? clip.durationSec,
        tags: clip.tags ?? [],
        firstFrameUrl: clip.firstFrameUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const collection = ctx.config.treefrog.brollCollection ?? "brollclips";
      const existing = await db.collection(collection).findOne({ blobUrl });
      let id: string;
      if (existing) {
        await db.collection(collection).updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: new Date() } });
        id = String(existing._id);
      } else {
        const result = await db.collection(collection).insertOne(doc);
        id = String(result.insertedId);
      }
      return {
        content: [{
          type: "text",
          text: `saved to TreeFrog\n_id: ${id}\nblob: ${blobUrl}`,
        }],
      };
    },
  );

  server.registerTool(
    "save_render_to_treefrog",
    {
      description: "Upload a finished promo render to Azure Blob and append it to the matching Scene's promoVideos array. This is the final step that makes the promo visible in the game's world-builder UI. Also uploads the voiceover (if present) so future music remixes work. Thumbnail is auto-picked from the Scene's existing titleCards[] (primary card, or most recent) — same logic as the world-builder UI. Override with thumbnailLocalPath if you want to upload a fresh one.",
      inputSchema: {
        renderId: z.string(),
        campaignName: z.string(),
        questId: z.string().describe("e.g. 'Main-1'"),
        sceneNumber: z.number().int().nonnegative(),
        focus: z.enum(["game", "quest"]).default("game"),
        platformOverride: z.enum(["mobile", "desktop"]).optional().describe("Override the render's platform if needed"),
        thumbnailLocalPath: z.string().optional().describe("Optional path to a thumbnail PNG to upload alongside the video"),
        useDefaultScript: z.boolean().optional(),
      },
    },
    async (args) => {
      const render = await ctx.index.getRender(args.renderId);
      if (!render) return { content: [{ type: "text", text: `No render with id "${args.renderId}".` }], isError: true };

      const platform: Platform = args.platformOverride ?? render.platform;
      const sanitizedCampaign = args.campaignName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");

      const db = await ctx.treefrogDb();
      const sceneCol = db.collection(ctx.config.treefrog.sceneCollection ?? "scenes");
      const scene = await sceneCol.findOne({
        campaignName: args.campaignName, questId: args.questId, sceneNumber: args.sceneNumber,
      });
      if (!scene) {
        return { content: [{ type: "text", text: `No Scene found for { campaignName: "${args.campaignName}", questId: "${args.questId}", sceneNumber: ${args.sceneNumber} }. Aborting upload to avoid orphan blobs.` }], isError: true };
      }

      const videoLocal = await ctx.storage.resolveLocalPath(render.outputPath);
      const videoBuffer = readFileSync(videoLocal);
      const videoBlobPath = `promos/${sanitizedCampaign}/final_promo_video/quest_${args.questId}_scene_${args.sceneNumber}_${platform}_self_promo.mp4`;
      const finalVideoUrl = await ctx.blobUploader().uploadBuffer(videoBlobPath, videoBuffer, "video/mp4");

      let voiceoverUrl: string | null = null;
      if (render.voiceoverId) {
        const vo = await ctx.index.getVoiceover(render.voiceoverId);
        if (vo) {
          const voLocal = await ctx.storage.resolveLocalPath(vo.url);
          const voBuffer = readFileSync(voLocal);
          const voBlobPath = `promos/${sanitizedCampaign}/voiceovers/quest_${args.questId}_scene_${args.sceneNumber}_${platform}_voice.mp3`;
          voiceoverUrl = await ctx.blobUploader().uploadBuffer(voBlobPath, voBuffer, "audio/mpeg");
        }
      }

      let thumbnailUrl: string | null = null;
      let titleCardId: string | null = null;
      let thumbnailSource = "none";
      if (args.thumbnailLocalPath) {
        const thumbBuf = readFileSync(args.thumbnailLocalPath);
        const ext = args.thumbnailLocalPath.split(".").pop()?.toLowerCase() ?? "png";
        const thumbBlobPath = `title-cards/quest_${args.questId}_scene_${args.sceneNumber}/mcp_${Date.now()}.${ext}`;
        const ct = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
        thumbnailUrl = await ctx.blobUploader().uploadBuffer(thumbBlobPath, thumbBuf, ct);
        thumbnailSource = "uploaded from thumbnailLocalPath";
      } else {
        const cards: any[] = Array.isArray((scene as any).titleCards) ? (scene as any).titleCards : [];
        if (cards.length > 0) {
          const primary = cards.find(c => c.isPrimary)
            ?? [...cards].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
          if (primary?.url) {
            thumbnailUrl = primary.url;
            titleCardId = primary._id ? String(primary._id) : null;
            thumbnailSource = primary.isPrimary
              ? `existing titleCard (primary, ${titleCardId ?? "no id"})`
              : `existing titleCard (most recent, ${titleCardId ?? "no id"})`;
          }
        }
      }

      const totalMs = render.timeline.slots.reduce((s, x) => s + x.durationMs, 0);
      const promoEntry = {
        url: finalVideoUrl,
        thumbnailUrl,
        titleCardId,
        platform,
        focus: args.focus,
        assemblyMode: "self",
        voiceoverUrl,
        useDefaultScript: !!args.useDefaultScript,
        videoDuration: Math.round(totalMs / 1000),
        createdAt: new Date(),
      };
      await sceneCol.updateOne(
        { _id: scene._id },
        { $set: { promoVideoUrl: finalVideoUrl }, $push: { promoVideos: promoEntry } } as any,
      );

      return {
        content: [
          { type: "text", text:
            `saved render ${render.renderId} to TreeFrog\n` +
            `Scene._id: ${String(scene._id)}\n` +
            `video: ${finalVideoUrl}\n` +
            (voiceoverUrl ? `voiceover: ${voiceoverUrl}\n` : "") +
            `thumbnail: ${thumbnailUrl ?? "(none)"} [${thumbnailSource}]\n` +
            `appended to Scene.promoVideos (${platform}, focus: ${args.focus}, ${promoEntry.videoDuration}s)`,
          },
        ],
      };
    },
  );
}
