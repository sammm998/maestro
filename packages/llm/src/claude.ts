import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LLMError, type JsonRequest, type LLMProvider, type TextRequest, type Tier } from "./types";

export interface ClaudeOptions {
  apiKey?: string;
  /** Model per tier. Defaults per plan §3.1: Haiku for extraction, Sonnet for merges. */
  models?: Partial<Record<Tier, string>>;
  /** Optional inference geography (Anthropic `inference_geo`), for data-residency setups. */
  inferenceGeo?: string;
}

const DEFAULT_MODELS: Record<Tier, string> = {
  fast: "claude-haiku-5-5",
  smart: "claude-sonnet-5-5",
};

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  private client: Anthropic;
  private models: Record<Tier, string>;

  constructor(private opts: ClaudeOptions = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.models = { ...DEFAULT_MODELS, ...opts.models };
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    try {
      const res = await this.client.messages.parse({
        model: this.models[req.tier ?? "fast"],
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        // zod/v4 schema → JSON-schema structured output; parsed_output is validated.
        output_config: { format: zodOutputFormat(req.schema as never) },
        ...(this.opts.inferenceGeo ? { inference_geo: this.opts.inferenceGeo } : {}),
      });
      if (res.stop_reason === "refusal") {
        throw new LLMError(`${req.task}: model refused (${res.stop_details?.category ?? "unknown"})`, this.name);
      }
      if (res.stop_reason === "max_tokens") {
        throw new LLMError(`${req.task}: output truncated at max_tokens`, this.name, true);
      }
      if (res.parsed_output == null) throw new LLMError(`${req.task}: no parsable output`, this.name, true);
      return res.parsed_output as T;
    } catch (err) {
      throw wrap(err, req.task);
    }
  }

  async generateText(req: TextRequest): Promise<string> {
    try {
      const res = await this.client.messages.create({
        model: this.models[req.tier ?? "fast"],
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: req.messages,
        ...(this.opts.inferenceGeo ? { inference_geo: this.opts.inferenceGeo } : {}),
      });
      if (res.stop_reason === "refusal") throw new LLMError(`${req.task}: model refused`, this.name);
      return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    } catch (err) {
      throw wrap(err, req.task);
    }
  }
}

function wrap(err: unknown, task: string): Error {
  if (err instanceof LLMError) return err;
  if (err instanceof Anthropic.RateLimitError) return new LLMError(`${task}: rate limited`, "claude", true);
  if (err instanceof Anthropic.InternalServerError) return new LLMError(`${task}: server error`, "claude", true);
  if (err instanceof Anthropic.APIConnectionError) return new LLMError(`${task}: connection error`, "claude", true);
  if (err instanceof Anthropic.APIError) return new LLMError(`${task}: API error ${err.status}: ${err.message}`, "claude");
  return err instanceof Error ? err : new Error(String(err));
}
