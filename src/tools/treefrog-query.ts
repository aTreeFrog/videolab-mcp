import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 50;

export function registerTreeFrogQueryTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "treefrog_find",
    {
      description: "Read-only MongoDB find against your TreeFrog DB. Use for any lookup that isn't already covered by list_music/list_broll/list_scene_assets. Examples: find a campaign's coverImageUrl by displayName, look up an NPC by name, etc. Supports filter (Mongo query syntax), projection, sort, limit, skip.",
      inputSchema: {
        collection: z.string().describe("e.g. 'campaigns', 'scenes', 'npcs', 'enemies', 'pointofinterests', 'campaignmusics', 'brollclips', 'campaignimages', 'campaignportraits'"),
        filter: z.record(z.unknown()).optional().describe('Mongo query. Examples: { "displayName": { "$regex": "dawn", "$options": "i" } }, { "campaignName": "main-campaign" }, { "questId": "Main-1", "sceneNumber": 1 }'),
        projection: z.record(z.unknown()).optional().describe('Fields to include/exclude. Example: { "displayName": 1, "coverImageUrl": 1, "imageUrl": 1 }'),
        sort: z.record(z.unknown()).optional().describe('Sort order. Example: { "createdAt": -1 }'),
        limit: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Max results. Default ${DEFAULT_LIMIT}, hard cap ${MAX_LIMIT}.`),
        skip: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => {
      const db = await ctx.treefrogDb();
      const limit = args.limit ?? DEFAULT_LIMIT;
      const cursor = db.collection(args.collection).find(args.filter ?? {});
      if (args.projection) cursor.project(args.projection as Record<string, 0 | 1>);
      if (args.sort) cursor.sort(args.sort as Record<string, 1 | -1>);
      if (args.skip) cursor.skip(args.skip);
      cursor.limit(limit);
      const docs = await cursor.toArray();
      const summary = `${docs.length} doc(s) from "${args.collection}"${docs.length === limit ? ` (hit limit ${limit})` : ""}`;
      const sanitized = docs.map(serializeDoc);
      return {
        content: [
          { type: "text", text: `${summary}\n\n${JSON.stringify(sanitized, null, 2)}` },
        ],
      };
    },
  );

  server.registerTool(
    "treefrog_count",
    {
      description: "Count documents in a TreeFrog collection matching an optional filter.",
      inputSchema: {
        collection: z.string(),
        filter: z.record(z.unknown()).optional(),
      },
    },
    async (args) => {
      const db = await ctx.treefrogDb();
      const n = await db.collection(args.collection).countDocuments(args.filter ?? {});
      return { content: [{ type: "text", text: `${args.collection}: ${n} document(s)` }] };
    },
  );

  server.registerTool(
    "treefrog_list_collections",
    {
      description: "List all collections in the TreeFrog DB. Useful for discovering what's queryable.",
      inputSchema: {},
    },
    async () => {
      const db = await ctx.treefrogDb();
      const cols = await db.listCollections().toArray();
      const names = cols.map(c => c.name).sort();
      return { content: [{ type: "text", text: `${names.length} collection(s):\n${names.map(n => "- " + n).join("\n")}` }] };
    },
  );
}

function serializeDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v && typeof v === "object" && "toString" in v && v.constructor?.name === "ObjectId") {
      out[k] = String(v);
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (Array.isArray(v)) {
      out[k] = v.map(item => (item && typeof item === "object") ? serializeDoc(item as Record<string, unknown>) : item);
    } else if (v && typeof v === "object") {
      out[k] = serializeDoc(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
