#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = pathResolve(__dirname, "..");
dotenvConfig({ path: pathResolve(PACKAGE_ROOT, ".env") });
if (!process.env.VIDEOLAB_CONFIG && !process.env.PROMO_VIDEO_CONFIG) {
  process.env.VIDEOLAB_CONFIG = pathResolve(PACKAGE_ROOT, "videolab.config.json");
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { buildContext } from "./lib/context.js";
import { registerMusicTools } from "./tools/music.js";
import { registerBRollTools } from "./tools/broll.js";
import { registerSceneTools } from "./tools/scenes.js";
import { registerVoiceoverTools } from "./tools/voiceover.js";
import { registerScriptTools } from "./tools/script.js";
import { registerVideoTools } from "./tools/video.js";
import { registerAnimateTools } from "./tools/animate.js";
import { registerTalkingHeadTools } from "./tools/talking-head.js";
import { registerImageTools } from "./tools/images.js";
import { registerDocumentaryTools } from "./tools/documentary.js";
import { registerTreeFrogSaveTools } from "./tools/treefrog-save.js";
import { registerTreeFrogQueryTools } from "./tools/treefrog-query.js";
import { registerMotionGraphicsTools } from "./tools/motion-graphics.js";
import { registerLibraryResources } from "./resources/library.js";
import { registerPrompts } from "./prompts/index.js";

async function main() {
  const loaded = loadConfig();
  const { config, configPath } = loaded;
  const ctx = buildContext(loaded);

  const server = new McpServer({
    name: "videolab-mcp",
    version: "0.1.0",
  });

  registerMusicTools(server, ctx);
  registerBRollTools(server, ctx);
  registerSceneTools(server, ctx);
  registerVoiceoverTools(server, ctx);
  registerScriptTools(server, ctx);
  registerVideoTools(server, ctx);
  registerAnimateTools(server, ctx);
  registerTalkingHeadTools(server, ctx);
  registerImageTools(server, ctx);
  registerDocumentaryTools(server, ctx);
  registerTreeFrogSaveTools(server, ctx);
  registerTreeFrogQueryTools(server, ctx);
  registerMotionGraphicsTools(server, ctx);
  registerLibraryResources(server, ctx);
  registerPrompts(server, ctx);

  server.registerTool(
    "ping",
    {
      description: "Health check — confirms the server is running and config is loaded. Returns config summary.",
      inputSchema: {},
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: [
              "videolab-mcp is alive.",
              `config: ${configPath}`,
              `storage: ${config.storage.kind}`,
              `index: ${config.index.kind}`,
              `providers: musicGen=${config.providers.musicGen} tts=${config.providers.tts} llm=${config.providers.llm} animate=${config.providers.animate}`,
              `defaults: platform=${config.defaults.platform} voiceId=${config.defaults.voiceId}`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "describe_capabilities",
    {
      description: "Show the build phase roadmap and what's done vs upcoming.",
      inputSchema: {},
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: PHASE_ROADMAP,
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("videolab-mcp ready on stdio");
}

const PHASE_ROADMAP = `videolab-mcp roadmap (current build = v0.1.0, all phases complete)

[done] Phase 0 — Scaffold, config, ping
[done] Phase 1 — Local library tools
  tools: list_music, preview_music, list_broll, preview_broll, list_scene_assets, get_scene_asset
[done] Phase 2 — AI generation
  tools: list_voices, generate_voiceover, preview_voiceover, list_voiceovers,
         generate_music, generate_script, rewrite_script, get_script, list_scripts
[done] Phase 3 — Stitch + iterate (FFmpeg)
  tools: assemble_promo, swap_music, swap_voiceover, swap_clip,
         play_render, list_recent_renders, describe_render
[done] Phase 4 — Veo image-to-video animation
  tools: animate_image_to_video (registers result as a b-roll clip)
[done] Phase 5 — Fal OmniHuman talking-head animation
  tools: generate_talking_head (image + audio \u2192 lip-synced video, registers as b-roll clip)
[done] Phase 6 — Resources + prompts + publish prep
  resources: library://music, library://broll, library://renders,
             library://voiceovers, library://scripts, library://scenes
  prompts: make-scene-promo, remix-render, compose-music-for-scene
[done] Phase 7 — TreeFrog Mongo libraries (read) + Azure write-back
  read providers: TreeFrogMongoMusicLibrary, TreeFrogMongoBRollLibrary, TreeFrogMongoSceneAssetProvider
  write tools: save_music_to_treefrog, save_broll_to_treefrog, save_render_to_treefrog
`;

main().catch((err) => {
  logger.error("fatal", err instanceof Error ? { message: err.message, stack: err.stack } : err);
  process.exit(1);
});
