import { jsonSchemaOf, parseJsonOutput, postJson } from "./http";
import type { EmbeddingProvider, JsonRequest, LLMProvider, TextRequest, Tier } from "./types";

/** Mistral (EU provider, Paris) — the "pure EU" option for both chat and embeddings. */
const BASE = "https://api.mistral.ai/v1";
const DEFAULT_MODELS: Record<Tier, string> = { fast: "mistral-small-latest", smart: "mistral-large-latest" };

type ChatResponse = { choices: { message: { content: string } }[] };

export class MistralProvider implements LLMProvider {
  readonly name = "mistral";
  private models: Record<Tier, string>;
  constructor(private apiKey: string, models: Partial<Record<Tier, string>> = {}) {
    this.models = { ...DEFAULT_MODELS, ...models };
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const system = `${req.system}\n\nRespond with a single JSON object that conforms to this JSON schema:\n${JSON.stringify(jsonSchemaOf(req.schema))}`;
    const res = (await postJson(this.name, `${BASE}/chat/completions`, this.apiKey, {
      model: this.models[req.tier ?? "fast"],
      max_tokens: req.maxTokens ?? 8000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: req.prompt },
      ],
    })) as ChatResponse;
    return parseJsonOutput(this.name, req.task, res.choices[0]?.message.content ?? "", req.schema);
  }

  async generateText(req: TextRequest): Promise<string> {
    const res = (await postJson(this.name, `${BASE}/chat/completions`, this.apiKey, {
      model: this.models[req.tier ?? "fast"],
      max_tokens: req.maxTokens ?? 8000,
      messages: [{ role: "system", content: req.system }, ...req.messages],
    })) as ChatResponse;
    return res.choices[0]?.message.content ?? "";
  }
}

export class MistralEmbedder implements EmbeddingProvider {
  readonly model = "mistral-embed";
  readonly dimensions = 1024;
  constructor(private apiKey: string) {}

  async embed(texts: string[], _purpose?: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const res = (await postJson("mistral", `${BASE}/embeddings`, this.apiKey, {
        model: this.model,
        input: texts.slice(i, i + 64),
      })) as { data: { embedding: number[] }[] };
      out.push(...res.data.map((d) => d.embedding));
    }
    return out;
  }
}
