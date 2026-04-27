import type { TtsProvider, TtsRequest, TtsResult } from "../types.js";
import type { Voice, VoiceoverAlignment } from "../../types.js";

const BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly kind = "elevenlabs";
  constructor(private readonly apiKey: string) {}

  async listVoices(): Promise<Voice[]> {
    const res = await fetch(`${BASE}/voices`, {
      headers: { "xi-api-key": this.apiKey, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs listVoices failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as { voices: Array<{
      voice_id: string; name: string; category?: string;
      labels?: Record<string, string>; preview_url?: string;
    }>};
    return data.voices.map(v => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
      previewUrl: v.preview_url,
    }));
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const model = req.model ?? "eleven_multilingual_v2";
    if (req.withTimestamps) {
      const url = `${BASE}/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ text: req.text, model_id: model }),
      });
      if (!res.ok) {
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
      }
      const data = await res.json() as {
        audio_base64: string;
        alignment?: {
          characters: string[];
          character_start_times_seconds: number[];
          character_end_times_seconds: number[];
        };
      };
      const audio = Buffer.from(data.audio_base64, "base64");
      const alignment: VoiceoverAlignment | undefined = data.alignment ? {
        characters: data.alignment.characters,
        startMs: data.alignment.character_start_times_seconds.map(s => Math.round(s * 1000)),
        endMs: data.alignment.character_end_times_seconds.map(s => Math.round(s * 1000)),
      } : undefined;
      return { audio, mimeType: "audio/mpeg", alignment };
    }
    const url = `${BASE}/text-to-speech/${encodeURIComponent(req.voiceId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({ text: req.text, model_id: model }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, mimeType: "audio/mpeg" };
  }
}
