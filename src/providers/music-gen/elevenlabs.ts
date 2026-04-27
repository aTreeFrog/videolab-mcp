import type { MusicGenProvider, MusicGenRequest, MusicGenResult } from "../types.js";

const URL_MUSIC = "https://api.elevenlabs.io/v1/music";

export class ElevenLabsMusicGenProvider implements MusicGenProvider {
  readonly kind = "elevenlabs";
  constructor(private readonly apiKey: string) {}

  async compose(req: MusicGenRequest): Promise<MusicGenResult> {
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      music_length_ms: req.durationMs ?? 30000,
      model_id: req.model ?? process.env.ELEVENLABS_MUSIC_MODEL ?? "music_v1",
    };
    if (req.instrumental != null) body.force_instrumental = req.instrumental;

    const res = await fetch(URL_MUSIC, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs music compose failed: ${res.status} ${await res.text()}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, mimeType: "audio/mpeg", durationMs: req.durationMs };
  }
}
