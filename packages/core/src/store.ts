import {
  and,
  eq,
  memories,
  memoryEntities,
  sql,
  type EntityType,
  type Memory,
  type MemoryKind,
  type NewMemory,
  type Sensitivity,
  type SourceKind,
  type UserTx,
} from "@maestro/db";
import type { EmbeddingProvider } from "@maestro/llm";

export const embeddingText = (m: { kind: string; title: string; content: string }) => `${m.kind}: ${m.title}\n${m.content}`;

export interface Provenance {
  sourceId: string | null;
  sourceKind: SourceKind;
  sourceLabel: string;
  conversationId: string | null;
  validFrom: Date;
}

export interface MemoryDraft {
  kind: MemoryKind;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  sensitivity: Sensitivity;
  flags: string[];
  sourceMessageIds: string[];
  entities: { type: EntityType; name: string }[];
}

/** Insert a memory with embedding and entity links (plan §6.4 Index). */
export async function insertMemory(
  tx: UserTx,
  userId: string,
  draft: MemoryDraft,
  prov: Provenance,
  embedding: { vector: number[]; model: string },
): Promise<Memory> {
  const values: NewMemory = {
    userId,
    kind: draft.kind,
    title: draft.title,
    content: draft.content,
    importance: draft.importance,
    confidence: draft.confidence,
    sensitivity: draft.sensitivity,
    flags: draft.flags,
    sourceId: prov.sourceId,
    sourceKind: prov.sourceKind,
    sourceLabel: prov.sourceLabel,
    sourceConversationId: prov.conversationId,
    sourceMessageIds: draft.sourceMessageIds,
    validFrom: prov.validFrom,
    embedding: embedding.vector,
    embeddingModel: embedding.model,
    embeddingDim: embedding.vector.length,
  };
  const [row] = await tx.insert(memories).values(values).returning();
  await linkEntities(tx, userId, row!.id, draft.entities);
  return row!;
}

export async function reembed(tx: UserTx, embedder: EmbeddingProvider, m: Pick<Memory, "id" | "kind" | "title" | "content">) {
  const [vec] = await embedder.embed([embeddingText(m)], "document");
  await tx
    .update(memories)
    .set({ embedding: vec!, embeddingModel: embedder.model, embeddingDim: vec!.length, updatedAt: new Date() })
    .where(eq(memories.id, m.id));
}

/** Upsert entities by (type, name or alias) and link them to the memory. */
export async function linkEntities(
  tx: UserTx,
  userId: string,
  memoryId: string,
  list: { type: EntityType; name: string }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const e of list) {
    const id = await upsertEntity(tx, userId, e.type, e.name);
    ids.push(id);
    await tx.insert(memoryEntities).values({ memoryId, entityId: id, userId }).onConflictDoNothing();
  }
  return ids;
}

export async function upsertEntity(tx: UserTx, userId: string, type: EntityType, name: string): Promise<string> {
  const clean = name.trim().slice(0, 120);
  const existing = await tx.execute<{ id: string }>(sql`
    SELECT id FROM entities
    WHERE user_id = ${userId} AND type = ${type}
      AND (lower(name) = lower(${clean}) OR lower(${clean}) = ANY(SELECT lower(a) FROM unnest(aliases) a))
    LIMIT 1`);
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO entities (user_id, type, name) VALUES (${userId}, ${type}, ${clean})
    ON CONFLICT (user_id, type, lower(name)) DO UPDATE SET name = entities.name
    RETURNING id`);
  return inserted.rows[0]!.id;
}

export async function getMemory(tx: UserTx, userId: string, id: string): Promise<Memory | undefined> {
  const [row] = await tx.select().from(memories).where(and(eq(memories.id, id), eq(memories.userId, userId)));
  return row;
}

const SENS_ORDER: Sensitivity[] = ["normal", "private", "special_category"];
export const maxSensitivity = (a: Sensitivity, b: Sensitivity): Sensitivity =>
  SENS_ORDER[Math.max(SENS_ORDER.indexOf(a), SENS_ORDER.indexOf(b))]!;
