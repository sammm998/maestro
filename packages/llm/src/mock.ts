import { LLMError, type EmbeddingProvider, type JsonRequest, type LLMProvider, type TextRequest } from "./types";

export type MockJsonHandler = (req: JsonRequest<unknown>) => unknown | Promise<unknown>;

/**
 * Deterministic provider for tests and offline dev. Responses come from
 * handlers keyed by task name (prefix before '@', e.g. "extract_memories").
 */
export class MockLLM implements LLMProvider {
  readonly name = "mock";
  readonly calls: { task: string; prompt: string }[] = [];
  constructor(
    private handlers: Record<string, MockJsonHandler> = {},
    private textHandler: (req: TextRequest) => string = () => "mock",
  ) {}

  setHandler(task: string, handler: MockJsonHandler) {
    this.handlers[task] = handler;
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    this.calls.push({ task: req.task, prompt: req.prompt });
    const key = req.task.split("@")[0]!;
    const handler = this.handlers[req.task] ?? this.handlers[key];
    if (!handler) throw new LLMError(`MockLLM: no handler for task "${req.task}"`, this.name);
    const parsed = req.schema.safeParse(await handler(req as JsonRequest<unknown>));
    if (!parsed.success) throw new LLMError(`MockLLM: handler output failed schema: ${parsed.error.message}`, this.name);
    return parsed.data;
  }

  async generateText(req: TextRequest): Promise<string> {
    this.calls.push({ task: req.task, prompt: req.messages.at(-1)?.content ?? "" });
    return this.textHandler(req);
  }
}

/**
 * Deterministic embedder using feature hashing over word tokens, word prefixes
 * and character trigrams. Similar texts get similar vectors, which makes it a
 * useful offline stand-in (and keeps CI evals free of network calls).
 */
export class HashEmbedder implements EmbeddingProvider {
  readonly model: string;
  constructor(readonly dimensions = 1024) {
    this.model = `hash-v1-${dimensions}`;
  }

  async embed(texts: string[], _purpose?: "document" | "query"): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const v = new Float64Array(this.dimensions);
    const tokens = text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const tok of tokens) {
      add(v, tok, 1.0);
      if (tok.length > 5) add(v, `p:${tok.slice(0, 5)}`, 0.6);
      const padded = `#${tok}#`;
      for (let i = 0; i + 3 <= padded.length; i++) add(v, `t:${padded.slice(i, i + 3)}`, 0.25);
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return Array.from(v, (x) => x / norm);
  }
}

function add(v: Float64Array, feature: string, weight: number) {
  const h = fnv1a(feature);
  const idx = h % v.length;
  const sign = (h >>> 31) & 1 ? -1 : 1;
  v[idx] = (v[idx] ?? 0) + sign * weight;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
