import type { Db } from "@maestro/db";
import type { EmbeddingProvider, LLMProvider } from "@maestro/llm";

export interface CoreDeps {
  /** Runtime (RLS-restricted) database. */
  db: Db;
  llm: LLMProvider;
  embedder: EmbeddingProvider;
  now?: () => Date;
}

export const nowOf = (d: Pick<CoreDeps, "now">) => (d.now ? d.now() : new Date());
