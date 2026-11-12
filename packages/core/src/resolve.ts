import { z } from "zod";
import { eq, inArray, memories, SENSITIVITIES, sql, type Memory, type UserTx } from "@maestro/db";
import type { CoreDeps } from "./deps";
import type { Candidate } from "./extract";
import { loadPrompt } from "./prompts";
import { textSearch, vectorSearch, type SearchFilters } from "./search";
import { embeddingText, insertMemory, linkEntities, maxSensitivity, type Provenance } from "./store";
import { jaccard } from "./util";

export const RESOLVE_PROMPT_VERSION = "v1";

export const ResolutionSchema = z.object({
  action: z.enum(["ADD", "UPDATE", "SUPERSEDE", "SKIP"]),
  target_id: z.string().nullable(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  reason: z.string(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export interface ResolveOutcome {
  action: Resolution["action"];
  memoryId: string | null;
  targetId?: string;
}

export interface ResolveOptions {
  /** Minimum vector similarity for an existing memory to count as "related". */
  similarityThreshold?: number;
  topK?: number;
}

/**
 * Plan §6.3: for each candidate fetch top-k similar memories and let the LLM
 * choose ADD | UPDATE <id> | SUPERSEDE <id> | SKIP. Keeps memory from flooding.
 */
export async function resolveCandidate(
  deps: CoreDeps,
  tx: UserTx,
  userId: string,
  cand: Candidate,
  prov: Provenance,
  embedding: number[],
  opts: ResolveOptions = {},
): Promise<ResolveOutcome> {
  const threshold = opts.similarityThreshold ?? 0.45;
  const topK = opts.topK ?? 5;
  const filters: SearchFilters = { userId, sensitivities: [...SENSITIVITIES], includeFlagged: true };
  const [vec, txt] = await Promise.all([
    vectorSearch(tx, filters, { embedding, model: deps.embedder.model, dim: embedding.length }, topK),
    textSearch(tx, filters, `${cand.title} ${cand.content}`, 3),
  ]);
  const relatedIds = [...new Set([...vec.filter((r) => r.score >= threshold).map((r) => r.id), ...txt.map((r) => r.id)])];
  const related: Memory[] = relatedIds.length
    ? await tx.select().from(memories).where(inArray(memories.id, relatedIds))
    : [];

  const emb = { vector: embedding, model: deps.embedder.model };

  // Cheap shortcuts before spending an LLM call.
  const dup = related.find((m) => m.kind === cand.kind && jaccard(m.content, cand.content) >= 0.9);
  if (dup) return { action: "SKIP", memoryId: dup.id, targetId: dup.id };
  if (related.length === 0) {
    const m = await insertMemory(tx, userId, cand, prov, emb);
    return { action: "ADD", memoryId: m.id };
  }

  const prompt = loadPrompt("resolve_memory", RESOLVE_PROMPT_VERSION);
  const decision = await deps.llm.generateJson({
    task: prompt.id,
    tier: "smart",
    system: prompt.system,
    prompt: prompt.render({
      candidate_kind: cand.kind,
      candidate_source: prov.sourceLabel,
      candidate_date: prov.validFrom.toISOString().slice(0, 10),
      candidate_title: cand.title,
      candidate_content: cand.content,
      existing: related
        .map(
          (m) =>
            `<existing id="${m.id}" kind="${m.kind}" source="${m.sourceLabel}" date="${m.validFrom.toISOString().slice(0, 10)}">\n` +
            `title: ${m.title}\ncontent: ${m.content}\n</existing>`,
        )
        .join("\n"),
    }),
    schema: ResolutionSchema,
    maxTokens: 4000,
  });

  const target = decision.target_id ? related.find((m) => m.id === decision.target_id) : undefined;
  const action = (decision.action === "UPDATE" || decision.action === "SUPERSEDE") && !target ? "ADD" : decision.action;

  switch (action) {
    case "SKIP":
      return { action, memoryId: target?.id ?? null, targetId: target?.id };
    case "ADD": {
      const m = await insertMemory(tx, userId, cand, prov, emb);
      return { action: "ADD", memoryId: m.id };
    }
    case "UPDATE": {
      const t = target!;
      const title = decision.title?.trim() || t.title;
      const content = decision.content?.trim() || `${t.content} ${cand.content}`;
      const [vector] = await deps.embedder.embed([embeddingText({ kind: t.kind, title, content })], "document");
      await tx
        .update(memories)
        .set({
          title,
          content,
          importance: Math.max(t.importance, cand.importance),
          confidence: Math.max(t.confidence, cand.confidence),
          sensitivity: maxSensitivity(t.sensitivity, cand.sensitivity),
          flags: [...new Set([...t.flags, ...cand.flags])],
          sourceMessageIds: [...new Set([...t.sourceMessageIds, ...cand.sourceMessageIds])],
          embedding: vector!,
          embeddingModel: deps.embedder.model,
          embeddingDim: vector!.length,
          updatedAt: sql`now()`,
        })
        .where(eq(memories.id, t.id));
      await linkEntities(tx, userId, t.id, cand.entities);
      return { action, memoryId: t.id, targetId: t.id };
    }
    case "SUPERSEDE": {
      const t = target!;
      const m = await insertMemory(
        tx,
        userId,
        { ...cand, title: decision.title?.trim() || cand.title, content: decision.content?.trim() || cand.content },
        prov,
        emb,
      );
      await tx.update(memories).set({ status: "superseded", supersededBy: m.id, updatedAt: sql`now()` }).where(eq(memories.id, t.id));
      return { action, memoryId: m.id, targetId: t.id };
    }
  }
}
