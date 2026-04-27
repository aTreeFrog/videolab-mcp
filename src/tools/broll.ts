import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import { openInDefaultPlayer } from "../lib/player.js";

export function registerBRollTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "list_broll",
    {
      description: "List b-roll clips in the library, with optional filters. Returns metadata + resource_link to each clip.",
      inputSchema: {
        tags: z.array(z.string()).optional().describe("All tags must be present on the clip"),
        platform: z.enum(["mobile", "desktop"]).optional(),
        minDurationSec: z.number().optional(),
        maxDurationSec: z.number().optional(),
      },
    },
    async (args) => {
      const clips = await ctx.index.listBRoll(args);
      if (clips.length === 0) {
        return { content: [{ type: "text", text: "No b-roll clips match the filter." }] };
      }
      const lines = clips.map(c =>
        `- ${c.id} | ${c.platform} | ${c.durationSec.toFixed(1)}s | tags: ${c.tags.join(",")} | ${c.description}`
      );
      const links = await Promise.all(clips.map(async c => ({
        type: "resource_link" as const,
        uri: await ctx.storage.resolveUri(c.url),
        name: c.filename,
        description: c.description,
        mimeType: "video/mp4",
      })));
      return {
        content: [
          { type: "text", text: `${clips.length} clip(s):\n${lines.join("\n")}` },
          ...links,
        ],
      };
    },
  );

  server.registerTool(
    "preview_broll",
    {
      description: "Open a b-roll clip in the default OS video player and return its file URI plus first-frame thumbnail.",
      inputSchema: {
        clipId: z.string(),
        openInPlayer: z.boolean().optional(),
      },
    },
    async ({ clipId, openInPlayer = true }) => {
      const clip = await ctx.index.getBRoll(clipId);
      if (!clip) {
        return { content: [{ type: "text", text: `No clip with id "${clipId}".` }], isError: true };
      }
      const uri = await ctx.storage.resolveUri(clip.url);
      let openedNote = "";
      if (openInPlayer) {
        try {
          const localPath = await ctx.storage.resolveLocalPath(clip.url);
          const result = openInDefaultPlayer(localPath);
          openedNote = result.spawned ? `\nopened in default player (${result.command})` : `\nfailed to open player`;
        } catch (e) {
          openedNote = `\ncould not open in player: ${(e as Error).message}`;
        }
      }
      const content: any[] = [
        { type: "text", text: `${clip.filename} [${clip.id}] ${clip.durationSec.toFixed(1)}s\n${clip.description}${openedNote}\nuri: ${uri}` },
        { type: "resource_link", uri, name: clip.filename, mimeType: "video/mp4" },
      ];
      if (clip.firstFrameUrl) {
        const thumbUri = await ctx.storage.resolveUri(clip.firstFrameUrl);
        content.push({ type: "resource_link", uri: thumbUri, name: `${clip.filename} (thumbnail)`, mimeType: "image/jpeg" });
      }
      return { content };
    },
  );
}
