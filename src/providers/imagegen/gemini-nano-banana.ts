import type { ImageGenProvider, ImageGenRequest, ImageGenResult } from "../types.js";
import { logger } from "../../logger.js";
import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_ASPECT = "1:1";
const DEFAULT_SIZE = "2K";

const RETRY_MAX_ATTEMPTS = Number(process.env.IMAGEGEN_RETRY_MAX_ATTEMPTS ?? 3);
const RETRY_BASE_MS = Number(process.env.IMAGEGEN_RETRY_BASE_MS ?? 2_000);

export class GeminiNanoBananaImageGenProvider implements ImageGenProvider {
  readonly kind = "gemini-nano-banana";
  private _client: GoogleGenAI | null = null;
  private readonly defaultModel: string;

  constructor(private readonly apiKey: string) {
    this.defaultModel = process.env.IMAGEGEN_MODEL ?? DEFAULT_MODEL;
  }

  private client(): GoogleGenAI {
    if (!this._client) {
      if (!this.apiKey) throw new Error("Gemini image-gen requires GOOGLE_VEO_API_KEY or GEMINI_API_KEY env var.");
      this._client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this._client;
  }

  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    const model = req.model ?? this.defaultModel;
    const aspectRatio = req.aspectRatio ?? DEFAULT_ASPECT;
    const imageSize = req.imageSize ?? DEFAULT_SIZE;
    logger.info(`gemini-image: generating (model=${model}, aspect=${aspectRatio}, size=${imageSize})`);

    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.client().models.generateContent({
          model,
          contents: req.prompt,
          config: {
            imageConfig: {
              aspectRatio,
              imageSize,
            } as any,
          } as any,
        });
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        for (const part of parts) {
          const inline: any = (part as any).inlineData;
          if (inline?.data) {
            const buf = Buffer.from(inline.data, "base64");
            return {
              image: buf,
              mimeType: inline.mimeType ?? "image/png",
              aspectRatio,
              model,
            };
          }
        }
        throw new Error(`No image data in Gemini response (finishReason=${candidate?.finishReason ?? "?"})`);
      } catch (e) {
        const err = e as Error;
        const msg = err.message ?? String(err);
        const isSafety = /safety|content_policy|rejected|flagged|PROHIBITED/i.test(msg);
        const isTransient = /\b(429|5\d\d|UNAVAILABLE|DEADLINE_EXCEEDED|overload)/i.test(msg);
        if (attempt === RETRY_MAX_ATTEMPTS || (!isSafety && !isTransient)) throw err;
        lastErr = err;
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        const reason = isSafety ? "safety" : "transient";
        logger.warn(`gemini-image: attempt ${attempt}/${RETRY_MAX_ATTEMPTS} failed (${reason}, ${msg.slice(0, 120)}), waiting ${Math.round(delay/1000)}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastErr ?? new Error("gemini-image: all attempts failed");
  }
}
