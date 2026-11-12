import { jsonSchemaOf, parseJsonOutput, postJson } from "./http";
import type { EmbeddingProvider, JsonRequest, LLMProvider, TextRequest, Tier } from "./types";

/** OpenAI — optional provider (US). Not the default; see EU notes in docs/subprocessors.md. */
const BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

type ChatResponse = { choices: { message: { content: string | null } }[] };

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  constructor(private apiKey: string, private models: Record<Tier, string>) {}

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const res = (await postJson(this.name, `${BASE}/chat/completions`, this.apiKey, {
      model: this.models[req.tier ?? "fast"],
      max_completion_tokens: req.maxTokens ?? 16000,
      response_format: {
        type: "json_schema",
        json_schema: { name: req.task.replace(/[^a-zA-Z0-9_-]/g, "_"), schema: jsonSchemaOf(req.schema), strict: false },
      },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
    })) as ChatResponse;
    return parseJsonOutput(this.name, req.task, res.choices[0]?.message.content ?? "", req.schema);
  }

  async generateText(req: TextRequest): Promise<string> {
    const res = (await postJson(this.name, `${BASE}/chat/completions`, this.apiKey, {
      model: this.models[req.tier ?? "fast"],
      max_completion_tokens: req.maxTokens ?? 16000,
      messages: [{ role: "system", content: req.system }, ...req.messages],
    })) as ChatResponse;
    return res.choices[0]?.message.content ?? "";
  }
}

export class OpenAIEmbedder implements EmbeddingProvider {
  readonly dimensions = 1024;
  constructor(private apiKey: string, readonly model = "text-embedding-3-small") {}

  async embed(texts: string[], _purpose?: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 128) {
      const res = (await postJson("openai", `${BASE}/embeddings`, this.apiKey, {
        model: this.model,
        input: texts.slice(i, i + 128),
        dimensions: this.dimensions,
      })) as { data: { embedding: number[]; index: number }[] };
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}
