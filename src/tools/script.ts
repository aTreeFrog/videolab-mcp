import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { ScriptDoc, ScriptSlot } from "../types.js";

const DEFAULT_SLOTS = ["hook", "atmosphere", "game-desc", "cta"];

const SYSTEM = `You write short-form promo video scripts for video games. Style: punchy, sensory, present tense. Avoid clichés. Match the voiceover length to the requested duration (assume ~2.4 words per second for natural pacing). Do not narrate stage directions. Output only the spoken words for each slot.`;

export function registerScriptTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "generate_script",
    {
      description: "Generate a promo voiceover script broken into named slots. Returns scriptId + slot breakdown. Use the slot text as input to generate_voiceover (concatenate slots, or generate one VO per slot).",
      inputSchema: {
        context: z.string().describe("What the promo is about — the scene, the game, the moment. Be concrete."),
        durationSeconds: z.number().int().positive().default(20),
        platform: z.enum(["mobile", "desktop"]).optional(),
        tone: z.string().optional().describe("e.g. 'dramatic', 'chill', 'mysterious', 'punchy action'"),
        hook: z.string().optional().describe("Optional pre-written first line"),
        slots: z.array(z.string()).optional().describe(`Slot names in order. Default: ${DEFAULT_SLOTS.join(", ")}`),
      },
    },
    async (args) => {
      const slots = args.slots && args.slots.length > 0 ? args.slots : DEFAULT_SLOTS;
      const platform = args.platform ?? ctx.config.defaults.platform;
      const tone = args.tone ?? "dramatic";
      const targetWords = Math.round(args.durationSeconds * 2.4);
      const wordsPerSlot = Math.max(2, Math.floor(targetWords / slots.length));

      const user = [
        `Write a ${args.durationSeconds}-second promo voiceover for a ${platform} short.`,
        `Context: ${args.context}`,
        `Tone: ${tone}`,
        args.hook ? `Mandatory opening line for the "hook" slot: "${args.hook}"` : "",
        `Break the script into these ordered slots: ${slots.join(", ")}.`,
        `Each slot should be roughly ${wordsPerSlot} words (~${(wordsPerSlot / 2.4).toFixed(1)}s when spoken).`,
        ``,
        `Respond with JSON of shape: {"slots":[{"name":"<slot>","text":"<spoken words>"}]}`,
      ].filter(Boolean).join("\n");

      const llm = ctx.llm();
      const { text } = await llm.complete({ system: SYSTEM, user, jsonOnly: true, maxTokens: 800 });

      const parsed = parseScriptJson(text, slots);
      const fullText = parsed.slots.map(s => s.text).join(" ");
      const id = `script_${randomUUID().slice(0, 8)}`;
      const doc: ScriptDoc = {
        id,
        text: fullText,
        slots: parsed.slots,
        context: args.context,
        platform,
        durationSeconds: args.durationSeconds,
        tone,
        createdAt: new Date().toISOString(),
      };
      await ctx.index.putScript(doc);

      const slotLines = doc.slots!.map(s => `  [${s.name}] ${s.text}`);
      return {
        content: [
          { type: "text", text: `scriptId: ${id}\n\n${slotLines.join("\n")}\n\nfull: ${fullText}` },
        ],
      };
    },
  );

  server.registerTool(
    "rewrite_script",
    {
      description: "Revise an existing script with a natural-language instruction. Creates a new scriptId linked to the parent.",
      inputSchema: {
        scriptId: z.string(),
        instruction: z.string().describe("What to change. e.g. 'punchier hook', 'less dramatic', 'add a CTA about wishlisting'"),
      },
    },
    async ({ scriptId, instruction }) => {
      const parent = await ctx.index.getScript(scriptId);
      if (!parent) {
        return { content: [{ type: "text", text: `No script with id "${scriptId}".` }], isError: true };
      }
      const slotNames = parent.slots?.map(s => s.name) ?? DEFAULT_SLOTS;
      const user = [
        `Revise this promo voiceover script per the instruction.`,
        `Original context: ${parent.context ?? "(none)"}`,
        `Tone: ${parent.tone ?? "dramatic"} | Platform: ${parent.platform ?? "mobile"} | Duration: ${parent.durationSeconds ?? "?"}s`,
        `Slots: ${slotNames.join(", ")}`,
        ``,
        `Instruction: ${instruction}`,
        ``,
        `Original script:`,
        ...(parent.slots ?? []).map(s => `  [${s.name}] ${s.text}`),
        ``,
        `Respond with JSON of shape: {"slots":[{"name":"<slot>","text":"<spoken words>"}]}`,
      ].join("\n");

      const llm = ctx.llm();
      const { text } = await llm.complete({ system: SYSTEM, user, jsonOnly: true, maxTokens: 800 });
      const parsed = parseScriptJson(text, slotNames);
      const fullText = parsed.slots.map(s => s.text).join(" ");
      const id = `script_${randomUUID().slice(0, 8)}`;
      const doc: ScriptDoc = {
        id,
        text: fullText,
        slots: parsed.slots,
        context: parent.context,
        platform: parent.platform,
        durationSeconds: parent.durationSeconds,
        tone: parent.tone,
        parentId: parent.id,
        createdAt: new Date().toISOString(),
      };
      await ctx.index.putScript(doc);
      const slotLines = doc.slots!.map(s => `  [${s.name}] ${s.text}`);
      return {
        content: [
          { type: "text", text: `scriptId: ${id} (parent: ${parent.id})\n\n${slotLines.join("\n")}\n\nfull: ${fullText}` },
        ],
      };
    },
  );

  server.registerTool(
    "get_script",
    {
      description: "Fetch a script by ID, including slot breakdown and parent (if a revision).",
      inputSchema: { scriptId: z.string() },
    },
    async ({ scriptId }) => {
      const doc = await ctx.index.getScript(scriptId);
      if (!doc) return { content: [{ type: "text", text: `No script with id "${scriptId}".` }], isError: true };
      const slotLines = (doc.slots ?? []).map(s => `  [${s.name}] ${s.text}`);
      return {
        content: [{
          type: "text",
          text: `${doc.id}${doc.parentId ? ` (parent: ${doc.parentId})` : ""}\ncontext: ${doc.context ?? "?"}\ntone: ${doc.tone ?? "?"} | platform: ${doc.platform ?? "?"} | ${doc.durationSeconds ?? "?"}s\n\n${slotLines.join("\n")}\n\nfull: ${doc.text}`,
        }],
      };
    },
  );

  server.registerTool(
    "list_scripts",
    {
      description: "List recent scripts (newest first).",
      inputSchema: { limit: z.number().int().positive().optional() },
    },
    async ({ limit = 20 }) => {
      const all = await ctx.index.listScripts();
      const slice = all.slice(0, limit);
      if (slice.length === 0) return { content: [{ type: "text", text: "No scripts yet." }] };
      const lines = slice.map(s => `- ${s.id}${s.parentId ? ` (rev of ${s.parentId})` : ""} | ${s.durationSeconds ?? "?"}s | "${s.text.slice(0, 70)}${s.text.length > 70 ? "…" : ""}"`);
      return { content: [{ type: "text", text: `${slice.length} script(s):\n${lines.join("\n")}` }] };
    },
  );
}

function parseScriptJson(text: string, expectedSlots: string[]): { slots: ScriptSlot[] } {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) cleaned = fence[1].trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new Error(`LLM did not return valid JSON. Raw output:\n${text}`); }
  const obj = parsed as { slots?: Array<{ name?: string; text?: string }> };
  if (!Array.isArray(obj.slots)) {
    throw new Error(`LLM JSON missing "slots" array. Got: ${JSON.stringify(parsed).slice(0, 300)}`);
  }
  const slots: ScriptSlot[] = obj.slots.map(s => ({
    name: String(s.name ?? "unnamed"),
    text: String(s.text ?? "").trim(),
  })).filter(s => s.text.length > 0);
  if (slots.length === 0) throw new Error(`LLM produced empty script.`);
  return { slots };
}
