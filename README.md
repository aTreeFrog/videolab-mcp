# videolab-mcp

An MCP server that turns Claude (or any MCP host) into a hands-on video editor for short-form videos. Browse a music library or generate new tracks. Animate stills with Veo or lip-sync portraits with OmniHuman. Write and rewrite scripts. Synthesize voiceover with ElevenLabs. Stitch the timeline with FFmpeg, play the result, then iterate cheaply by swapping the music, voiceover, or any single clip — without re-rendering from scratch.

It also ships a **text-to-documentary** skill that converts long-form text (PDFs, books, papers) into structured documentary videos with AI-generated voiceover, captions, and b-roll.

Standalone, portable, configurable. Bring your own API keys.

## What's in the box

**Tools** across the workflow:

| Category | Tools |
|---|---|
| Music | `list_music`, `preview_music`, `generate_music` |
| B-roll | `list_broll`, `preview_broll` |
| Scene assets | `list_scene_assets`, `get_scene_asset` |
| Images | `generate_image`, `list_images`, `get_image` |
| Voiceover (ElevenLabs) | `list_voices`, `generate_voiceover`, `preview_voiceover`, `list_voiceovers` |
| Script (Anthropic) | `generate_script`, `rewrite_script`, `get_script`, `list_scripts` |
| Video stitching (FFmpeg) | `assemble_promo`, `swap_music`, `swap_voiceover`, `swap_clip`, `play_render`, `list_recent_renders`, `describe_render` |
| Animation (Veo) | `animate_image_to_video` |
| Talking heads (Fal OmniHuman) | `generate_talking_head` |
| Documentary | `extract_pdf`, `split_chapters`, `plan_documentary_scenes`, `validate_attention` |
| Diagnostics | `ping`, `describe_capabilities` |

**Resources** for browsing without burning tool calls: `library://music`, `library://broll`, `library://renders`, `library://voiceovers`, `library://scripts`, `library://scenes`.

**Prompts** for guided multi-step flows: `make-scene-promo`, `remix-render`, `compose-music-for-scene`.

**Skills** in [`skills/`](./skills): `text-to-documentary` — PDF/book → chaptered documentary videos with structured narrative arcs.

## Requirements

- Node.js 18+
- FFmpeg on your PATH (or set `ffmpeg.binary` to an absolute path in the config)
- API keys for whichever providers you use (none are required upfront — lazy-init only on first call)

## Quickstart

```bash
git clone <this-repo> videolab-mcp
cd videolab-mcp
npm install
npm run build
cp videolab.config.example.json videolab.config.json
cp .env.example .env  # then fill in keys you have
```

Wire it into Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%AppData%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "videolab": {
      "command": "node",
      "args": ["C:\\path\\to\\videolab-mcp\\build\\index.js"],
      "env": {
        "ELEVENLABS_API_KEY": "...",
        "ANTHROPIC_API_KEY": "...",
        "GOOGLE_VEO_API_KEY": "...",
        "FAL_KEY": "...",
        "VIDEOLAB_CONFIG": "C:\\path\\to\\videolab-mcp\\videolab.config.json"
      }
    }
  }
}
```

Restart Claude Desktop. Open a chat and call `ping` to confirm the connection.

## Configuration

Two files. `.env` for secrets only:

```
ELEVENLABS_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_VEO_API_KEY=
FAL_KEY=
```

`videolab.config.json` for everything else (storage, providers, FFmpeg flags, defaults). The example file is sensible and zero-dependency: local storage, JSON index, ElevenLabs/Anthropic/Veo/Fal providers, mobile (9:16) defaults.

## Walkthrough — make a promo from scratch

In Claude Desktop, with the MCP server connected:

```
User: Make a 20-second mobile promo for the test scene.

Claude:
  → list_scene_assets({ sceneRef: { key: "test-scene" } })
     → 3 assets: magenta, cyan, orange

  → generate_script({
      context: "Test scene with three coloured backdrops",
      durationSeconds: 20, tone: "punchy"
    })
     → scriptId: script_a3f, slot breakdown shown

  → generate_voiceover({ text: "<the script>" })
     → voiceoverId: vo_8d2

  → generate_music({
      prompt: "driving electronic, slow build, retro synth pad",
      durationMs: 20000
    })
     → trackId: music_4e1

  → assemble_promo({
      timeline: {
        platform: "mobile",
        slots: [
          { source: { kind: "scene", id: "asset-test-magenta" }, durationMs: 7000 },
          { source: { kind: "scene", id: "asset-test-cyan" },    durationMs: 7000 },
          { source: { kind: "scene", id: "asset-test-orange" },  durationMs: 6000 }
        ]
      },
      voiceoverId: "vo_8d2",
      musicId: "music_4e1"
    })
     → renderId: render_94c, autoplays in default video player

User: Make the music more chill.

Claude:
  → generate_music({ prompt: "soft ambient pad, gentle rhythm", durationMs: 20000 })
     → trackId: music_c70
  → swap_music({ renderId: "render_94c", newMusicId: "music_c70" })
     → renderId: render_d11 (rev of render_94c) — only re-mixes audio (~2s)

User: Replace the orange shot with a Veo animation of the magenta image zooming in.

Claude:
  → animate_image_to_video({
      imageSource: { kind: "scene", id: "asset-test-magenta" },
      prompt: "slow camera push-in, dust particles drifting"
    })
     → clipId: broll_veo_a8b
  → swap_clip({
      renderId: "render_d11",
      slotIndex: 2,
      newSource: { kind: "broll", id: "broll_veo_a8b" }
    })
     → renderId: render_2f9 (rev of render_d11)
```

## The iteration loop

This is the part that makes the workflow feel good:

- **`assemble_promo`** writes per-slot intermediates (`slot_*.mp4`), a silent `visuals.mp4`, the audio mix, and the final `output.mp4` — all under `media/renders/<renderId>/`.
- **`swap_music`** / **`swap_voiceover`** reuse the parent's `visuals.mp4` and only re-mix audio. Typical wall time: ~2 seconds.
- **`swap_clip`** rebuilds the visuals stream + remixes audio. Typical wall time: ~5–10 seconds.
- Every render is a new `renderId` linked via `parentId` — you never lose an earlier version.

## Text-to-documentary mode

The [`skills/text-to-documentary/`](./skills/text-to-documentary) skill turns a PDF, book, or pasted long-form text into a series of ~5-minute documentary videos — one per chapter. Each video has a structured narrative arc (Hook → CoreIdea → Examples → PatternInterrupts → MicroRecaps → Cliffhanger), karaoke captions from ElevenLabs alignment timestamps, and AI-generated b-roll.

Tools used: `extract_pdf`, `split_chapters`, `plan_documentary_scenes`, `validate_attention`, `generate_voiceover`, `generate_image`, `animate_image_to_video`, `generate_music`, `assemble_promo`.

If you're using Claude Code or another host that supports skills, the skill auto-loads when triggered ("turn this PDF into a documentary", "make videos from this book", etc.). Otherwise read [`skills/text-to-documentary/SKILL.md`](./skills/text-to-documentary/SKILL.md) for the full step list and call the tools directly.

## Custom scene-asset provider

The server is provider-agnostic for scene assets. The shipped `json-manifest` provider reads from a JSON file. Anything more elaborate (your CMS, a database, an API) gets implemented as a `SceneAssetProvider`:

```ts
export interface SceneAssetProvider {
  readonly kind: string;
  describeRefShape(): string;  // shows up in the tool description so the host knows what to send
  listAssets(ref: SceneRef): Promise<SceneAsset[]>;
  getAsset(id: string): Promise<SceneAsset | null>;
}
```

Drop your implementation into `src/providers/scene-assets/<your-name>.ts`, register it in `src/providers/factory.ts` under `buildSceneAssets`, and add it to the config schema in `src/config.ts`. Same pattern works for storage backends (S3, Azure) — see `src/providers/types.ts:StorageProvider`.

## Provider matrix

| What | Default provider | Env var | Config field |
|---|---|---|---|
| Storage | local | — | `storage.kind` |
| Index (asset metadata) | json | — | `index.kind` |
| Music generation | ElevenLabs Music | `ELEVENLABS_API_KEY` | `providers.musicGen` |
| TTS | ElevenLabs | `ELEVENLABS_API_KEY` | `providers.tts` |
| Script LLM | Anthropic Claude | `ANTHROPIC_API_KEY` | `providers.llm` |
| Image generation | Gemini Nano Banana | `GOOGLE_VEO_API_KEY` | `providers.imageGen` |
| Image-to-video | Google Veo | `GOOGLE_VEO_API_KEY` | `providers.animate` |
| Talking-head | Fal OmniHuman | `FAL_KEY` | `providers.talkingHead` |
| Scene assets | json-manifest | — | `providers.sceneAssets` |

Optional model overrides via env: `ANTHROPIC_MODEL`, `ELEVENLABS_MUSIC_MODEL`, `VEO_MODEL`, `VEO_ENDPOINT`, `VEO_POLL_INTERVAL_MS`, `VEO_POLL_TIMEOUT_MS`, `FAL_OMNIHUMAN_MODEL`, `PROMO_VIDEO_LOG_LEVEL`.

## License

MIT — see [LICENSE](./LICENSE).
