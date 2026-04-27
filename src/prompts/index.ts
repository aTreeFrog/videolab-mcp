import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";

export function registerPrompts(server: McpServer, ctx: Context): void {
  server.registerPrompt(
    "make-scene-promo",
    {
      description: "Guided flow: pick a scene, generate a script + voiceover, choose music + b-roll, assemble, play, iterate.",
      argsSchema: {
        sceneKey: z.string().describe("Scene key from list_scene_assets / library://scenes"),
        tone: z.string().optional().describe("Default: dramatic"),
        durationSeconds: z.string().optional().describe("Total promo length. Default: 20"),
        platform: z.string().optional().describe("mobile or desktop. Default: mobile"),
      },
    },
    ({ sceneKey, tone, durationSeconds, platform }) => {
      const t = tone ?? "dramatic";
      const d = durationSeconds ?? "20";
      const p = platform ?? ctx.config.defaults.platform;
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Make a promo video for scene "${sceneKey}". Platform: ${p}. Tone: ${t}. Duration: ${d}s.

Walk through it:
1. Call list_scene_assets with { sceneRef: { key: "${sceneKey}" } } to see what visual assets are available.
2. Call generate_script with that context, tone "${t}", and durationSeconds ${d}. Note the scriptId.
3. Call generate_voiceover with the script's full text. Note the voiceoverId.
4. Call list_music (filter by mood/intensity that fits the tone) and pick a track. Or call generate_music with a fitting prompt.
5. Build a timeline: pick 3-5 scene assets, assign each a duration that sums to ~${d}s. Sources are { kind: "scene", id: "<asset-id>" }.
6. Call assemble_promo with the timeline + voiceoverId + musicId. It auto-plays.
7. After watching, ask the user what to change. Use swap_music / swap_voiceover / swap_clip for cheap iteration.

Return the final renderId at the end.`,
          },
        }],
      };
    },
  );

  server.registerPrompt(
    "remix-render",
    {
      description: "Iterate on an existing render. Given a renderId and a free-form instruction, figure out which swap_* tool to call.",
      argsSchema: {
        renderId: z.string(),
        instruction: z.string().describe("e.g. 'punchier music', 'rewrite the hook', 'use the orange shot instead of the magenta one'"),
      },
    },
    ({ renderId, instruction }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Remix render "${renderId}" per this instruction: "${instruction}".

Steps:
1. Call describe_render with renderId "${renderId}" to see the current timeline + audio refs.
2. Decide which swap is right:
   - "different music" / "music feels off" / mood/intensity change \u2192 swap_music (consider list_music or generate_music first)
   - "rewrite the script" / "punchier hook" / VO content change \u2192 rewrite_script + generate_voiceover + swap_voiceover
   - "different shot" / "use X instead" / visual change \u2192 swap_clip (use list_scene_assets or list_broll to find the new source)
   - "shorter slot" / "longer X" \u2192 swap_clip with newDurationMs
3. Run the swap. It auto-plays.
4. Return the new renderId.

Don't re-render from scratch unless the instruction requires it (e.g. complete platform change).`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "compose-music-for-scene",
    {
      description: "Given a scene description, write an evocative ElevenLabs music prompt and generate the track.",
      argsSchema: {
        sceneDescription: z.string().describe("What's happening in the scene. Be sensory and concrete."),
        mood: z.string().optional(),
        intensity: z.string().optional().describe("calm | moderate | intense"),
        durationSeconds: z.string().optional().describe("Default 30"),
      },
    },
    ({ sceneDescription, mood, intensity, durationSeconds }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Compose a music track to underscore this scene.

Scene: ${sceneDescription}
${mood ? `Mood: ${mood}\n` : ""}${intensity ? `Intensity: ${intensity}\n` : ""}Duration: ${durationSeconds ?? "30"}s

Steps:
1. Write a music prompt that's specific and evocative. Reference instrumentation (strings, percussion, synth pads, etc.), tempo, and emotional arc. Avoid generic phrases like "epic music".
2. Call generate_music with that prompt, durationMs ${(parseInt(durationSeconds ?? "30") * 1000)}, instrumental: true.
3. Call preview_music with the new trackId so the user can hear it.
4. If the user wants a variation, write a new prompt and call generate_music again.

Return the final trackId.`,
        },
      }],
    }),
  );
}
