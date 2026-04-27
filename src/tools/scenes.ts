import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";

export function registerSceneTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "list_scene_assets",
    {
      description: `List images/videos/portraits associated with a scene. The sceneRef shape is provider-specific: ${ctx.sceneAssets.describeRefShape()}`,
      inputSchema: {
        sceneRef: z.record(z.unknown()).describe("Provider-specific reference. For json-manifest: { key: '<scene-key>' }"),
      },
    },
    async ({ sceneRef }) => {
      const assets = await ctx.sceneAssets.listAssets(sceneRef);
      if (assets.length === 0) {
        return { content: [{ type: "text", text: "No assets for this scene reference." }] };
      }
      const lines = assets.map(a => `- ${a.id} | ${a.type} | ${a.label}`);
      const links = await Promise.all(assets.map(async a => ({
        type: "resource_link" as const,
        uri: await ctx.storage.resolveUri(a.url),
        name: a.label,
        description: a.type,
        mimeType: a.type === "video" ? "video/mp4" : "image/jpeg",
      })));
      return {
        content: [
          { type: "text", text: `${assets.length} asset(s):\n${lines.join("\n")}` },
          ...links,
        ],
      };
    },
  );

  server.registerTool(
    "get_scene_asset",
    {
      description: "Resolve a single scene asset by its ID. Returns metadata + a resource_link to the file.",
      inputSchema: {
        assetId: z.string(),
      },
    },
    async ({ assetId }) => {
      const asset = await ctx.sceneAssets.getAsset(assetId);
      if (!asset) {
        return { content: [{ type: "text", text: `No asset with id "${assetId}".` }], isError: true };
      }
      const uri = await ctx.storage.resolveUri(asset.url);
      return {
        content: [
          { type: "text", text: `${asset.label} [${asset.id}] (${asset.type})\nuri: ${uri}` },
          { type: "resource_link", uri, name: asset.label, mimeType: asset.type === "video" ? "video/mp4" : "image/jpeg" },
        ],
      };
    },
  );
}
