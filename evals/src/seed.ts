import { eq, memories, withUser, type Db } from "@maestro/db";
import type { EmbeddingProvider } from "@maestro/llm";
import { embeddingText, insertMemory, upsertSource } from "@maestro/core";
import { SOURCE_LABELS, type Fixture } from "./fixtures";

/** Insert a fixture's memories directly (bypasses extraction) and return label → id. */
export async function seedFixture(db: Db, embedder: EmbeddingProvider, userId: string, fx: Fixture, now: Date) {
  const vectors = await embedder.embed(fx.memories.map((m) => embeddingText(m)), "document");
  const ids = new Map<string, string>();
  await withUser(db, userId, async (tx) => {
    for (const [i, m] of fx.memories.entries()) {
      const label = SOURCE_LABELS[m.source] ?? m.source;
      const sourceId = await upsertSource(tx, userId, { kind: m.source, label });
      const row = await insertMemory(
        tx,
        userId,
        {
          kind: m.kind,
          title: m.title,
          content: m.content,
          importance: m.importance,
          confidence: 0.9,
          sensitivity: m.sensitivity ?? "normal",
          flags: [],
          sourceMessageIds: [],
          entities: (m.entities ?? []).map(([type, name]) => ({ type, name })),
        },
        { sourceId, sourceKind: m.source, sourceLabel: label, conversationId: null, validFrom: new Date(now.getTime() - m.daysAgo * 86400e3) },
        { vector: vectors[i]!, model: embedder.model },
      );
      if (m.status === "superseded") await tx.update(memories).set({ status: "superseded" }).where(eq(memories.id, row.id));
      ids.set(m.label, row.id);
    }
  });
  return ids;
}
