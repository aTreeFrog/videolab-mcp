import { fal } from "@fal-ai/client";
import type { TalkingHeadProvider, TalkingHeadRequest, TalkingHeadResult } from "../types.js";
import { logger } from "../../logger.js";

const DEFAULT_MODEL = "fal-ai/bytedance/omnihuman";

export class FalOmniHumanProvider implements TalkingHeadProvider {
  readonly kind = "fal-omnihuman";
  private readonly model: string;
  private configured = false;

  constructor(private readonly apiKey: string) {
    this.model = process.env.FAL_OMNIHUMAN_MODEL ?? DEFAULT_MODEL;
  }

  private ensureConfigured() {
    if (this.configured) return;
    fal.config({ credentials: this.apiKey });
    this.configured = true;
  }

  async generate(req: TalkingHeadRequest): Promise<TalkingHeadResult> {
    this.ensureConfigured();

    const imageBlob = new Blob([new Uint8Array(req.imageBytes)], { type: req.imageMimeType });
    const audioBlob = new Blob([new Uint8Array(req.audioBytes)], { type: req.audioMimeType });

    logger.info(`fal-omnihuman: starting (model=${this.model}, image=${req.imageBytes.length}B, audio=${req.audioBytes.length}B)`);
    const t0 = Date.now();

    const result = await fal.subscribe(this.model, {
      input: {
        image_url: imageBlob,
        audio_url: audioBlob,
      },
    }) as { data?: { video?: { url?: string }; duration?: number } };

    const elapsed = Math.round((Date.now() - t0) / 1000);
    const videoUrl = result?.data?.video?.url;
    if (!videoUrl) {
      throw new Error(`Fal OmniHuman response missing video.url. Got: ${JSON.stringify(result).slice(0, 800)}`);
    }
    logger.info(`fal-omnihuman: completed in ${elapsed}s, downloading video from ${videoUrl}`);

    const dl = await fetch(videoUrl);
    if (!dl.ok) {
      throw new Error(`Fal OmniHuman video download failed: ${dl.status} ${await dl.text()}`);
    }
    const videoBytes = Buffer.from(await dl.arrayBuffer());

    return {
      videoBytes,
      mimeType: dl.headers.get("content-type") ?? "video/mp4",
      durationSeconds: typeof result.data?.duration === "number" ? result.data.duration : undefined,
    };
  }
}
