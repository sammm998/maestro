import { and, asc, conversations, eq, messages, sources, sql, withUser } from "@maestro/db";
import { nowOf, type CoreDeps } from "./deps";
import { extractCandidates } from "./extract";
import { resolveCandidate, type ResolveOptions, type ResolveOutcome } from "./resolve";
import { embeddingText } from "./store";

export interface ProcessResult {
  conversationId: string;
  candidates: number;
  outcomes: ResolveOutcome[];
}

/**
 * Full pipeline for one conversation: extract → resolve → index (plan §6).
 * Extraction (LLM) runs outside the write transaction; the resolve/index
 * phase is one transaction so a conversation is applied all-or-nothing.
 */
export async function processConversation(
  deps: CoreDeps,
  userId: string,
  conversationId: string,
  opts: ResolveOptions = {},
): Promise<ProcessResult> {
  const loaded = await withUser(deps.db, userId, async (tx) => {
    const [conv] = await tx
      .select({ c: conversations, s: sources })
      .from(conversations)
      .innerJoin(sources, eq(sources.id, conversations.sourceId))
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
    if (!conv) return undefined;
    await tx.update(conversations).set({ extractStatus: "extracting" }).where(eq(conversations.id, conversationId));
    const msgs = await tx
      .select({ id: messages.id, role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.position));
    return { ...conv, msgs };
  });
  if (!loaded) throw new Error(`conversation ${conversationId} not found`);
  const { c: conv, s: src, msgs } = loaded;

  try {
    const candidates = await extractCandidates(deps.llm, {
      sourceLabel: src.label,
      title: conv.title,
      startedAt: conv.startedAt,
      messages: msgs,
    });
    const vectors = await deps.embedder.embed(candidates.map(embeddingText), "document");

    const outcomes = await withUser(deps.db, userId, async (tx) => {
      const out: ResolveOutcome[] = [];
      for (let i = 0; i < candidates.length; i++) {
        out.push(
          await resolveCandidate(
            deps,
            tx,
            userId,
            candidates[i]!,
            {
              sourceId: src.id,
              sourceKind: src.kind,
              sourceLabel: src.label,
              conversationId: conv.id,
              validFrom: conv.endedAt ?? conv.startedAt ?? nowOf(deps),
            },
            vectors[i]!,
            opts,
          ),
        );
      }
      await tx
        .update(conversations)
        .set({ extractStatus: "done", extractedAt: sql`now()` })
        .where(eq(conversations.id, conversationId));
      return out;
    });
    return { conversationId, candidates: candidates.length, outcomes };
  } catch (err) {
    await withUser(deps.db, userId, (tx) =>
      tx.update(conversations).set({ extractStatus: "failed" }).where(eq(conversations.id, conversationId)),
    );
    throw err;
  }
}
