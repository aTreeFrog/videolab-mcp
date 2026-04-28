import { z } from "zod";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as pathResolve, isAbsolute } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { BRollClip, Platform } from "../types.js";
import { logger } from "../logger.js";

export function registerMotionGraphicsTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "render_motion_graphic",
    {
      description: "Render a Remotion composition from the configured motion-graphics project to MP4. Use this for templated motion graphics (kinetic typography, character cards, battle stingers, logo reveals) where you want deterministic, parametrized output. Composition IDs and their props are defined in the Remotion project's src/Root.tsx. Output is registered as a b-roll clip and can be dropped into any timeline slot via { kind: 'broll', id: <newClipId> }. Sync — typically takes 10-60 seconds depending on duration and complexity.",
      inputSchema: {
        compositionId: z.string().describe("Remotion composition id (e.g. 'Combat-Desktop', 'Combat-Mobile'). Must match an id registered in src/Root.tsx."),
        props: z.record(z.unknown()).optional().describe("JSON object passed to the composition as props. Overrides defaultProps. Shape depends on the composition (see its TypeScript Props type)."),
        durationFrames: z.number().int().min(1).optional().describe("Override composition's durationInFrames. Useful for trimming a long composition to a shorter clip without editing Root.tsx."),
        platform: z.enum(["mobile", "desktop"]).optional().describe("Tagging only — used to set the b-roll clip's platform field. The actual aspect ratio is determined by the composition's width/height."),
        description: z.string().optional().describe("Human-readable description for the b-roll library entry."),
        tags: z.array(z.string()).optional().describe("Tags for filtering in list_broll later."),
      },
    },
    async (args) => {
      const projectPath = ctx.config.motionGraphics?.projectPath;
      if (!projectPath) {
        return {
          content: [{ type: "text", text: "render_motion_graphic requires `motionGraphics.projectPath` in your config — set it to the absolute path of your Remotion project root (the dir containing package.json + src/index.ts that calls registerRoot)." }],
          isError: true,
        };
      }
      const absProjectPath = isAbsolute(projectPath) ? projectPath : pathResolve(ctx.configDir, projectPath);
      if (!existsSync(absProjectPath)) {
        return { content: [{ type: "text", text: `Motion-graphics project not found at ${absProjectPath}` }], isError: true };
      }
      const entryPath = pathResolve(absProjectPath, "src", "index.ts");
      if (!existsSync(entryPath)) {
        return { content: [{ type: "text", text: `Remotion entry not found at ${entryPath}. Expected src/index.ts that calls registerRoot.` }], isError: true };
      }

      const id = `broll_mg_${randomUUID().slice(0, 8)}`;
      const outputRel = `broll/${id}.mp4`;
      const outputAbs = await ctx.storage.localPathFor(outputRel);

      const cliArgs: string[] = [
        "remotion",
        "render",
        entryPath,
        args.compositionId,
        outputAbs,
      ];
      if (args.props && Object.keys(args.props).length > 0) {
        cliArgs.push(`--props=${JSON.stringify(args.props)}`);
      }
      if (args.durationFrames) {
        cliArgs.push(`--frames=0-${args.durationFrames - 1}`);
      }

      logger.info(`render_motion_graphic ${id}: ${args.compositionId} → ${outputRel}`);
      const renderResult = await runRemotion(absProjectPath, cliArgs);
      if (!renderResult.ok) {
        return {
          content: [{ type: "text", text: `Remotion render failed (exit ${renderResult.code}):\n${renderResult.stderr.slice(-2000)}` }],
          isError: true,
        };
      }
      if (!existsSync(outputAbs)) {
        return { content: [{ type: "text", text: `Render reported success but output not found at ${outputAbs}` }], isError: true };
      }

      const platform: Platform = args.platform ?? (args.compositionId.toLowerCase().includes("mobile") ? "mobile" : "desktop");
      const description = args.description ?? `Motion graphic: ${args.compositionId}${args.props ? ` (${Object.keys(args.props).join(", ")})` : ""}`;
      const clip: BRollClip = {
        id,
        url: outputRel,
        filename: `${id}.mp4`,
        platform,
        durationSec: 0,
        description,
        source: "remotion",
        tags: args.tags ?? ["generated", "remotion", args.compositionId],
      };
      await ctx.index.putBRoll(clip);

      const uri = await ctx.storage.resolveUri(outputRel);
      return {
        content: [
          { type: "text", text:
            `clipId: ${id}\n` +
            `composition: ${args.compositionId} | platform: ${platform}\n` +
            `${description}\n` +
            `uri: ${uri}\n\n` +
            `Use as a slot source: { "kind": "broll", "id": "${id}" }`,
          },
          { type: "resource_link", uri, name: clip.filename, mimeType: "video/mp4" },
        ],
      };
    },
  );
}

function runRemotion(cwd: string, args: string[]): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", args, {
      cwd,
      shell: process.platform === "win32",
      env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: null, stdout, stderr: stderr + "\nspawn error: " + err.message });
    });
  });
}
