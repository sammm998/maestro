import { ClaudeProvider } from "./claude";
import { HashEmbedder, MockLLM, type MockJsonHandler } from "./mock";
import { MistralEmbedder, MistralProvider } from "./mistral";
import { OpenAIEmbedder, OpenAIProvider } from "./openai";
import type { EmbeddingProvider, LLMProvider } from "./types";

export * from "./types";
export { ClaudeProvider } from "./claude";
export { MistralEmbedder, MistralProvider } from "./mistral";
export { OpenAIEmbedder, OpenAIProvider } from "./openai";
export { HashEmbedder, MockLLM, type MockJsonHandler } from "./mock";

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required for the selected provider (see .env.example)`);
  return v;
}

/**
 * LLM_PROVIDER = claude | mistral | openai | mock (default: claude if
 * ANTHROPIC_API_KEY is set, else mock). Mock uses `mockHandlers`.
 */
export function createLLM(env: Env = process.env, mockHandlers: Record<string, MockJsonHandler> = {}): LLMProvider {
  const provider = env.LLM_PROVIDER || (env.ANTHROPIC_API_KEY ? "claude" : "mock");
  switch (provider) {
    case "claude":
      return new ClaudeProvider({
        models: stripUndefined({ fast: env.LLM_MODEL_FAST, smart: env.LLM_MODEL_SMART }),
        inferenceGeo: env.ANTHROPIC_INFERENCE_GEO || undefined,
      });
    case "mistral":
      return new MistralProvider(required(env, "MISTRAL_API_KEY"), stripUndefined({ fast: env.LLM_MODEL_FAST, smart: env.LLM_MODEL_SMART }));
    case "openai":
      return new OpenAIProvider(env.OPENAI_API_KEY || "proxy-injected", {
        fast: env.LLM_MODEL_FAST || "gpt-4.1-mini",
        smart: env.LLM_MODEL_SMART || "gpt-4.1",
      });
    case "mock":
      return new MockLLM(mockHandlers);
    default:
      throw new Error(`Unknown LLM_PROVIDER "${provider}"`);
  }
}

/** EMBEDDING_PROVIDER = mistral | openai | hash (default: mistral if MISTRAL_API_KEY set, else hash). */
export function createEmbedder(env: Env = process.env): EmbeddingProvider {
  const provider = env.EMBEDDING_PROVIDER || (env.MISTRAL_API_KEY ? "mistral" : "hash");
  switch (provider) {
    case "mistral":
      return new MistralEmbedder(required(env, "MISTRAL_API_KEY"));
    case "openai":
      return new OpenAIEmbedder(env.OPENAI_API_KEY || "proxy-injected", env.EMBEDDING_MODEL || "text-embedding-3-small");
    case "hash":
      return new HashEmbedder(1024);
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER "${provider}"`);
  }
}

function stripUndefined<T extends Record<string, string | undefined>>(o: T): Partial<Record<keyof T, string>> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Partial<Record<keyof T, string>>;
}
