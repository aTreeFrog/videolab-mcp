import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";

export function registerLibraryResources(server: McpServer, ctx: Context): void {
  server.registerResource(
    "music-library",
    "library://music",
    {
      description: "All music tracks in the library (stock + generated). JSON.",
      mimeType: "application/json",
    },
    async (uri) => {
      const tracks = await ctx.index.listMusic();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ count: tracks.length, tracks }, null, 2) }] };
    },
  );

  server.registerResource(
    "broll-library",
    "library://broll",
    {
      description: "All b-roll clips in the library (stock + Veo-generated + OmniHuman-generated). JSON.",
      mimeType: "application/json",
    },
    async (uri) => {
      const clips = await ctx.index.listBRoll();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ count: clips.length, clips }, null, 2) }] };
    },
  );

  server.registerResource(
    "renders-library",
    "library://renders",
    {
      description: "Recent renders (newest first, max 50). Each entry includes parentId for swap lineage.",
      mimeType: "application/json",
    },
    async (uri) => {
      const all = await ctx.index.listRenders();
      const recent = all.slice(0, 50);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ count: recent.length, renders: recent }, null, 2) }] };
    },
  );

  server.registerResource(
    "voiceovers-library",
    "library://voiceovers",
    {
      description: "Recent voiceovers (newest first, max 50). Each entry includes the original text and ElevenLabs alignment timestamps.",
      mimeType: "application/json",
    },
    async (uri) => {
      const all = await ctx.index.listVoiceovers();
      const recent = all.slice(0, 50);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ count: recent.length, voiceovers: recent }, null, 2) }] };
    },
  );

  server.registerResource(
    "scripts-library",
    "library://scripts",
    {
      description: "Recent scripts (newest first, max 50). Each entry includes slot breakdown and parent (if a revision).",
      mimeType: "application/json",
    },
    async (uri) => {
      const all = await ctx.index.listScripts();
      const recent = all.slice(0, 50);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ count: recent.length, scripts: recent }, null, 2) }] };
    },
  );

  server.registerResource(
    "scenes-library",
    "library://scenes",
    {
      description: "Scene-asset provider description and what's queryable.",
      mimeType: "text/plain",
    },
    async (uri) => {
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: ctx.sceneAssets.describeRefShape() }] };
    },
  );
}
