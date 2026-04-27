import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { MusicTrack } from "../types.js";
import { openInDefaultPlayer } from "../lib/player.js";

export function registerMusicTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "list_music",
    {
      description: "List music tracks in the library, with optional filters. Returns metadata + resource_link to each file.",
      inputSchema: {
        mood: z.string().optional().describe("Filter by mood (e.g. 'epic', 'calm', 'tense')"),
        genre: z.string().optional().describe("Filter by genre (e.g. 'orchestral', 'electronic')"),
        intensity: z.enum(["calm", "moderate", "intense"]).optional(),
        tags: z.array(z.string()).optional().describe("All tags must be present on the track"),
        source: z.enum(["stock", "generated"]).optional(),
      },
    },
    async (args) => {
      const tracks = await ctx.index.listMusic(args);
      if (tracks.length === 0) {
        return { content: [{ type: "text", text: "No music tracks match the filter." }] };
      }
      const lines = tracks.map(t =>
        `- ${t.id} | "${t.displayName}" | ${t.intensity ?? "?"} | ${t.mood ?? "?"} | ${t.genre ?? "?"}`
      );
      const links = await Promise.all(tracks.map(async t => ({
        type: "resource_link" as const,
        uri: await ctx.storage.resolveUri(t.url),
        name: t.displayName,
        description: `${t.mood ?? ""} ${t.genre ?? ""} ${t.intensity ?? ""}`.trim(),
        mimeType: "audio/mpeg",
      })));
      return {
        content: [
          { type: "text", text: `${tracks.length} track(s):\n${lines.join("\n")}` },
          ...links,
        ],
      };
    },
  );

  server.registerTool(
    "preview_music",
    {
      description: "Open a music track in the default OS audio player and return its file URI. Use this for the iteration loop — generate/select → preview → swap.",
      inputSchema: {
        trackId: z.string().describe("ID of the track from list_music"),
        openInPlayer: z.boolean().optional().describe("If true (default), opens the file in the OS default audio player"),
      },
    },
    async ({ trackId, openInPlayer = true }) => {
      const track = await ctx.index.getMusic(trackId);
      if (!track) {
        return { content: [{ type: "text", text: `No track with id "${trackId}".` }], isError: true };
      }
      const uri = await ctx.storage.resolveUri(track.url);
      let openedNote = "";
      if (openInPlayer) {
        try {
          const localPath = await ctx.storage.resolveLocalPath(track.url);
          const result = openInDefaultPlayer(localPath);
          openedNote = result.spawned ? `\nopened in default player (${result.command})` : `\nfailed to open player`;
        } catch (e) {
          openedNote = `\ncould not open in player: ${(e as Error).message}`;
        }
      }
      return {
        content: [
          { type: "text", text: `${track.displayName} [${track.id}]${openedNote}\nuri: ${uri}` },
          { type: "resource_link", uri, name: track.displayName, mimeType: "audio/mpeg" },
        ],
      };
    },
  );

  server.registerTool(
    "generate_music",
    {
      description: "Compose a new music track via the configured music-gen provider (ElevenLabs Music). Saves to the library, returns the new trackId. Does not auto-play.",
      inputSchema: {
        prompt: z.string().min(3).describe("Description of the desired track. e.g. 'epic orchestral, slow build to triumphant brass, dark fantasy battle'"),
        durationMs: z.number().int().positive().optional().describe("Length in ms. Default 30000."),
        instrumental: z.boolean().optional().describe("Force instrumental (no vocals). Default true for promos."),
        displayName: z.string().optional(),
        mood: z.string().optional(),
        genre: z.string().optional(),
        intensity: z.enum(["calm", "moderate", "intense"]).optional(),
        themes: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const result = await ctx.musicGen().compose({
        prompt: args.prompt,
        durationMs: args.durationMs,
        instrumental: args.instrumental ?? true,
      });
      const id = `music_${randomUUID().slice(0, 8)}`;
      const written = await ctx.storage.writeBlob(`music/${id}.mp3`, result.audio);
      const track: MusicTrack = {
        id,
        displayName: args.displayName ?? args.prompt.slice(0, 60),
        url: written.url,
        durationMs: result.durationMs,
        mood: args.mood,
        genre: args.genre,
        intensity: args.intensity,
        themes: args.themes,
        tags: args.tags ?? ["generated"],
        source: "generated",
      };
      await ctx.index.putMusic(track);
      const uri = await ctx.storage.resolveUri(written.url);
      return {
        content: [
          { type: "text", text: `trackId: ${id}\n"${track.displayName}"\nprompt: ${args.prompt}\nduration: ${track.durationMs ?? "?"}ms\nuri: ${uri}\n\nUse preview_music to listen, or pass to assemble_promo.` },
          { type: "resource_link", uri, name: track.displayName, mimeType: "audio/mpeg" },
        ],
      };
    },
  );
}
