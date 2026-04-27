import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { GeneratedImage } from "../types.js";
import { openInDefaultPlayer } from "../lib/player.js";

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "21:9"] as const;

export function registerImageTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "generate_image",
    {
      description: "Generate a still image from a text prompt via the configured image-gen provider (Gemini Nano Banana / gemini-3.1-flash-image-preview). Saves it to the local image library. The returned imageId can be passed to animate_image_to_video as { kind: 'image', id } to turn it into a Veo b-roll clip, or used as a thumbnail for save_render_to_treefrog.",
      inputSchema: {
        prompt: z.string().min(1).describe("Cinematic visual description. e.g. 'A weathered dragon perched atop a stone tower at dusk, embers floating in the air, dramatic backlight, fantasy oil painting style'"),
        aspectRatio: z.enum(ASPECT_RATIOS).optional().describe("Output aspect ratio. Default 1:1. Use 9:16 for mobile-portrait video sources, 16:9 for desktop-landscape."),
        imageSize: z.enum(["1K", "2K", "4K"]).optional().describe("Target resolution. Default 2K. 4K may not be supported by all models."),
        description: z.string().optional().describe("Human-readable label for the image library entry. Defaults to the prompt."),
        tags: z.array(z.string()).optional().describe("Tags for filtering in list_images later."),
        autoOpen: z.boolean().optional().describe("Open the saved image in the default OS image viewer. Default false."),
      },
    },
    async (args) => {
      const result = await ctx.imageGen().generate({
        prompt: args.prompt,
        aspectRatio: args.aspectRatio,
        imageSize: args.imageSize,
      });
      const ext = mimeToExt(result.mimeType);
      const id = `img_${randomUUID().slice(0, 8)}`;
      const written = await ctx.storage.writeBlob(`images/${id}.${ext}`, result.image);
      const image: GeneratedImage = {
        id,
        prompt: args.prompt,
        url: written.url,
        mimeType: result.mimeType,
        aspectRatio: result.aspectRatio,
        width: result.width,
        height: result.height,
        model: result.model,
        tags: args.tags ?? ["generated", "gemini-nano-banana"],
        description: args.description ?? args.prompt,
        createdAt: new Date().toISOString(),
      };
      await ctx.index.putImage(image);

      const uri = await ctx.storage.resolveUri(written.url);
      let openedNote = "";
      if (args.autoOpen) {
        try {
          const local = await ctx.storage.resolveLocalPath(written.url);
          const r = openInDefaultPlayer(local);
          openedNote = r.spawned ? `\nopened in default viewer` : `\nfailed to open viewer`;
        } catch (e) { openedNote = `\ncould not open: ${(e as Error).message}`; }
      }

      return {
        content: [
          { type: "text", text:
            `imageId: ${id}\n` +
            `${result.aspectRatio ?? "?"} | ${result.mimeType} | model: ${result.model ?? "?"}\n` +
            `prompt: ${args.prompt}\n` +
            `uri: ${uri}` + openedNote + `\n\n` +
            `Use as animate source: { "kind": "image", "id": "${id}" }`,
          },
          { type: "resource_link", uri, name: `image ${id}`, mimeType: result.mimeType },
        ],
      };
    },
  );

  server.registerTool(
    "list_images",
    {
      description: "List recently generated images (newest first). Filter by tag if provided.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
        tag: z.string().optional().describe("Only return images containing this tag."),
      },
    },
    async ({ limit = 20, tag }) => {
      const all = await ctx.index.listImages();
      const filtered = tag ? all.filter(i => (i.tags ?? []).includes(tag)) : all;
      const slice = filtered.slice(0, limit);
      if (slice.length === 0) return { content: [{ type: "text", text: "No images yet." }] };
      const lines = slice.map(i => `- ${i.id} | ${i.aspectRatio ?? "?"} | "${(i.description ?? i.prompt).slice(0, 70)}${(i.description ?? i.prompt).length > 70 ? "…" : ""}"`);
      return { content: [{ type: "text", text: `${slice.length} image(s)${tag ? ` (tag=${tag})` : ""}:\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "get_image",
    {
      description: "Fetch metadata for a single generated image, optionally opening it in the default OS image viewer.",
      inputSchema: {
        imageId: z.string(),
        openInViewer: z.boolean().optional(),
      },
    },
    async ({ imageId, openInViewer = false }) => {
      const image = await ctx.index.getImage(imageId);
      if (!image) return { content: [{ type: "text", text: `No image with id "${imageId}".` }], isError: true };
      const uri = await ctx.storage.resolveUri(image.url);
      let openedNote = "";
      if (openInViewer) {
        try {
          const local = await ctx.storage.resolveLocalPath(image.url);
          const r = openInDefaultPlayer(local);
          openedNote = r.spawned ? `\nopened in default viewer` : `\nfailed to open viewer`;
        } catch (e) { openedNote = `\ncould not open: ${(e as Error).message}`; }
      }
      return {
        content: [
          { type: "text", text:
            `${image.id} | ${image.aspectRatio ?? "?"} | ${image.mimeType} | model: ${image.model ?? "?"}\n` +
            `description: ${image.description ?? "(none)"}\n` +
            `prompt: ${image.prompt}\n` +
            `tags: ${(image.tags ?? []).join(", ") || "(none)"}\n` +
            `created: ${image.createdAt}\n` +
            `uri: ${uri}` + openedNote,
          },
          { type: "resource_link", uri, name: `image ${image.id}`, mimeType: image.mimeType },
        ],
      };
    },
  );
}

function mimeToExt(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/png": return "png";
    case "image/jpeg":
    case "image/jpg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "png";
  }
}
