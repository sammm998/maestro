import type { z } from "zod";

/**
 * "fast" = cheap high-volume work (extraction), "smart" = harder judgement calls
 * (resolve/merge). Each provider maps tiers to concrete models.
 */
export type Tier = "fast" | "smart";

export interface JsonRequest<T> {
  /** Stable name of the task, e.g. "extract_memories@v1". Used by mocks and logs. */
  task: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  tier?: Tier;
  maxTokens?: number;
}

export interface TextRequest {
  task: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tier?: Tier;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  generateJson<T>(req: JsonRequest<T>): Promise<T>;
  generateText(req: TextRequest): Promise<string>;
}

export interface EmbeddingProvider {
  /** Stored per row (memories.embedding_model) so models can be swapped. */
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], purpose: "document" | "query"): Promise<number[][]>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
