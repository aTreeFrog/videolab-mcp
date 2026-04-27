import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { Voiceover } from "../types.js";
import { openInDefaultPlayer } from "../lib/player.js";

export function registerVoiceoverTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "list_voices",
    {
      description: "List available TTS voices from the configured provider (ElevenLabs).",
      inputSchema: {
        nameContains: z.string().optional().describe("Case-insensitive substring filter on voice name"),
      },
    },
    async ({ nameContains }) => {
      const voices = await ctx.tts().listVoices();
      const filtered = nameContains
        ? voices.filter(v => v.name.toLowerCase().includes(nameContains.toLowerCase()))
        : voices;
      const lines = filtered.map(v => {
        const labels = v.labels ? Object.entries(v.labels).map(([k, val]) => `${k}=${val}`).join(" ") : "";
        return `- ${v.voiceId} | ${v.name} | ${v.category ?? "?"} | ${labels}`;
      });
      return { content: [{ type: "text", text: `${filtered.length} voice(s):\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "generate_voiceover",
    {
      description: "Generate a voiceover via the configured TTS provider, save the audio + alignment to the index, and return the voiceoverId. Does not auto-play (use preview_voiceover or assemble_promo).",
      inputSchema: {
        text: z.string().min(1),
        voiceId: z.string().optional().describe("Override default voice. Uses config.defaults.voiceId if omitted."),
        model: z.string().optional().describe("Override default model. Uses config.defaults.ttsModel if omitted."),
        withTimestamps: z.boolean().optional().describe("Request character-level alignment (default true). Used by assemble_promo to sync visual slot durations to VO."),
      },
    },
    async ({ text, voiceId, model, withTimestamps = true }) => {
      const useVoice = voiceId ?? ctx.config.defaults.voiceId;
      const useModel = model ?? ctx.config.defaults.ttsModel;
      const result = await ctx.tts().synthesize({ text, voiceId: useVoice, model: useModel, withTimestamps });
      const id = `vo_${randomUUID().slice(0, 8)}`;
      const relPath = `voiceovers/${id}.mp3`;
      const written = await ctx.storage.writeBlob(relPath, result.audio);
      const vo: Voiceover = {
        id,
        text,
        voiceId: useVoice,
        model: useModel,
        url: written.url,
        durationMs: result.alignment ? result.alignment.endMs.at(-1) : undefined,
        alignment: result.alignment,
        createdAt: new Date().toISOString(),
      };
      await ctx.index.putVoiceover(vo);
      const uri = await ctx.storage.resolveUri(written.url);
      return {
        content: [
          { type: "text", text: `voiceoverId: ${id}\nvoice: ${useVoice} | model: ${useModel} | duration: ${vo.durationMs ?? "?"}ms\nuri: ${uri}` },
          { type: "resource_link", uri, name: `voiceover ${id}`, mimeType: "audio/mpeg" },
        ],
      };
    },
  );

  server.registerTool(
    "preview_voiceover",
    {
      description: "Open a generated voiceover in the default OS audio player.",
      inputSchema: {
        voiceoverId: z.string(),
        openInPlayer: z.boolean().optional(),
      },
    },
    async ({ voiceoverId, openInPlayer = true }) => {
      const vo = await ctx.index.getVoiceover(voiceoverId);
      if (!vo) {
        return { content: [{ type: "text", text: `No voiceover with id "${voiceoverId}".` }], isError: true };
      }
      const uri = await ctx.storage.resolveUri(vo.url);
      let openedNote = "";
      if (openInPlayer) {
        try {
          const local = await ctx.storage.resolveLocalPath(vo.url);
          const r = openInDefaultPlayer(local);
          openedNote = r.spawned ? `\nopened in default player` : `\nfailed to open player`;
        } catch (e) { openedNote = `\ncould not open: ${(e as Error).message}`; }
      }
      return {
        content: [
          { type: "text", text: `${vo.id} | voice ${vo.voiceId} | ${vo.durationMs ?? "?"}ms${openedNote}\ntext: ${vo.text}\nuri: ${uri}` },
          { type: "resource_link", uri, name: `voiceover ${vo.id}`, mimeType: "audio/mpeg" },
        ],
      };
    },
  );

  server.registerTool(
    "list_voiceovers",
    {
      description: "List recently generated voiceovers (newest first).",
      inputSchema: { limit: z.number().int().positive().optional() },
    },
    async ({ limit = 20 }) => {
      const all = await ctx.index.listVoiceovers();
      const slice = all.slice(0, limit);
      if (slice.length === 0) return { content: [{ type: "text", text: "No voiceovers yet." }] };
      const lines = slice.map(v => `- ${v.id} | voice ${v.voiceId} | ${v.durationMs ?? "?"}ms | "${v.text.slice(0, 60)}${v.text.length > 60 ? "…" : ""}"`);
      return { content: [{ type: "text", text: `${slice.length} voiceover(s):\n${lines.join("\n")}` }] };
    },
  );
}
