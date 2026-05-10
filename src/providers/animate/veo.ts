import type { AnimateProvider, AnimateRequest, AnimateResult, ExtendVideoRequest } from "../types.js";
import { logger } from "../../logger.js";
import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "veo-3.1-generate-preview";
const DEFAULT_PROMPT = "subtle camera movement, ambient motion, cinematic atmosphere";

const POLL_INTERVAL_MS = Number(process.env.VEO_POLL_INTERVAL_MS ?? 10_000);
const POLL_TIMEOUT_MS = Number(process.env.VEO_POLL_TIMEOUT_MS ?? 600_000);
const RETRY_MAX_ATTEMPTS = Number(process.env.VEO_RETRY_MAX_ATTEMPTS ?? 5);
const RETRY_BASE_MS = Number(process.env.VEO_RETRY_BASE_MS ?? 8_000);

export class VeoAnimateProvider implements AnimateProvider {
  readonly kind = "veo";
  private readonly model: string;
  private _client: GoogleGenAI | null = null;

  constructor(private readonly apiKey: string) {
    this.model = process.env.VEO_MODEL ?? DEFAULT_MODEL;
  }

  private client(): GoogleGenAI {
    if (!this._client) {
      if (!this.apiKey) throw new Error("Veo provider requires GOOGLE_VEO_API_KEY or GEMINI_API_KEY env var.");
      this._client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this._client;
  }

  async imageToVideo(req: AnimateRequest): Promise<AnimateResult> {
    const aspect = req.aspectRatio ?? "9:16";
    const referenceImages = (req.referenceImages ?? []).map((ref) => ({
      image: {
        imageBytes: ref.imageBytes.toString("base64"),
        mimeType: ref.imageMimeType,
      },
      referenceType: ref.referenceType ?? "asset",
    }));
    logger.info(`veo: imageToVideo (model=${this.model}, aspect=${aspect}, refs=${referenceImages.length})`);
    const payload: any = {
      model: this.model,
      prompt: req.prompt ?? DEFAULT_PROMPT,
      image: {
        imageBytes: req.imageBytes.toString("base64"),
        mimeType: req.imageMimeType,
      },
      config: {
        numberOfVideos: 1,
        aspectRatio: aspect,
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      },
    };
    const operation = await withRetry(() => this.client().models.generateVideos(payload), "veo generateVideos");
    const generated = await this.pollUntilDone(operation, "imageToVideo");
    const videoBytes = await this.downloadVideo(generated);
    return {
      videoBytes,
      mimeType: "video/mp4",
      durationSeconds: req.durationSeconds,
      videoRef: generated.video,
      model: this.model,
    };
  }

  async extendVideo(req: ExtendVideoRequest): Promise<AnimateResult> {
    if (!req.previousVideoRef) throw new Error("extendVideo requires previousVideoRef");
    logger.info(`veo: extendVideo (model=${this.model})`);
    const operation = await withRetry(() => this.client().models.generateVideos({
      model: this.model,
      prompt: req.prompt ?? DEFAULT_PROMPT,
      config: {
        numberOfVideos: 1,
      },
      video: req.previousVideoRef,
    } as any), "veo extendVideos");
    const generated = await this.pollUntilDone(operation, "extendVideo");
    const videoBytes = await this.downloadVideo(generated);
    return {
      videoBytes,
      mimeType: "video/mp4",
      videoRef: generated.video,
      model: this.model,
    };
  }

  private async pollUntilDone(operation: any, label: string): Promise<{ video: any }> {
    const start = Date.now();
    let polls = 0;
    let op = operation;
    while (!op.done && Date.now() - start < POLL_TIMEOUT_MS) {
      polls++;
      await sleep(POLL_INTERVAL_MS);
      op = await this.client().operations.getVideosOperation({ operation: op });
      if (!op.done) logger.debug(`veo ${label}: poll ${polls}, still running...`);
    }
    if (!op.done) {
      throw new Error(`Veo ${label} timed out after ${POLL_TIMEOUT_MS}ms (${polls} polls).`);
    }
    if (op.error) {
      throw new Error(`Veo ${label} failed: ${op.error.message ?? JSON.stringify(op.error)}`);
    }
    const generated = op.response?.generatedVideos?.[0];
    if (!generated) {
      throw new Error(`Veo ${label} returned no video. Response: ${JSON.stringify(op.response).slice(0, 600)}`);
    }
    logger.info(`veo ${label}: done after ${polls} polls (~${Math.round((Date.now() - start) / 1000)}s)`);
    return generated;
  }

  private async downloadVideo(generated: any): Promise<Buffer> {
    if (generated?.video?.uri) {
      const uri = decodeURIComponent(generated.video.uri);
      const sep = uri.includes("?") ? "&" : "?";
      const url = uri.includes("key=") ? uri : `${uri}${sep}key=${encodeURIComponent(this.apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Veo video download failed: ${res.status} ${await res.text()}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (generated?.video?.videoBytes) {
      return Buffer.from(generated.video.videoBytes, "base64");
    }
    throw new Error("Veo response missing video URI and inline bytes");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as Error;
      const msg = err.message ?? String(err);
      const isTransient = /\b(429|5\d\d|UNAVAILABLE|DEADLINE_EXCEEDED|overload)/i.test(msg);
      const isProcessing = /has been processed|INVALID_ARGUMENT/i.test(msg);
      if (attempt === RETRY_MAX_ATTEMPTS || (!isTransient && !isProcessing)) throw err;
      lastErr = err;
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      logger.warn(`${label}: attempt ${attempt}/${RETRY_MAX_ATTEMPTS} failed (${msg.slice(0, 120)}), waiting ${Math.round(delay/1000)}s...`);
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error(`${label} failed after ${RETRY_MAX_ATTEMPTS} attempts`);
}
