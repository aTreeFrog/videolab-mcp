import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmRequest, LlmResult } from "../types.js";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

export class AnthropicLlmProvider implements LlmProvider {
  readonly kind = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const system = req.jsonOnly
      ? `${req.system ?? ""}\n\nRespond with valid JSON only — no prose, no markdown fences.`.trim()
      : req.system;

    const msg = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: req.maxTokens ?? 1024,
      system,
      messages: [{ role: "user", content: req.user }],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();
    return { text };
  }
}
