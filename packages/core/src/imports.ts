import { and, desc, eq, imports, sql, withUser, type Db, type Import } from "@maestro/db";
import { ingestConversation, type IngestMessage } from "./ingest";
import { QUEUES, type Enqueue, type ProcessConversationJob } from "./jobs";

export interface ImportConversation {
  externalId: string;
  title: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  messages: IngestMessage[];
}

/**
 * Plan §2 channel C: ingest a whole ChatGPT/Claude export, then queue one
 * extraction job per conversation that got new messages.
 */
export async function runImport(
  db: Db,
  enqueue: Enqueue,
  userId: string,
  input: { kind: "chatgpt" | "claude"; filename: string | null; conversations: ImportConversation[] },
): Promise<Import> {
  const [imp] = await withUser(db, userId, (tx) =>
    tx.insert(imports).values({ userId, kind: input.kind, filename: input.filename }).returning(),
  );
  const label = input.kind === "chatgpt" ? "ChatGPT" : "Claude";
  const toProcess: string[] = [];
  try {
    for (let i = 0; i < input.conversations.length; i += 50) {
      const batch = input.conversations.slice(i, i + 50);
      const ids = await withUser(db, userId, async (tx) => {
        const out: string[] = [];
        for (const c of batch) {
          const r = await ingestConversation(tx, userId, { source: { kind: input.kind, label }, ...c });
          if (r.newMessages > 0) out.push(r.conversationId);
        }
        return out;
      });
      toProcess.push(...ids);
    }
    const [updated] = await withUser(db, userId, (tx) =>
      tx
        .update(imports)
        .set(
          toProcess.length
            ? { status: "processing", conversationsTotal: toProcess.length }
            : { status: "done", conversationsTotal: 0, finishedAt: new Date() },
        )
        .where(eq(imports.id, imp!.id))
        .returning(),
    );
    for (const conversationId of toProcess) {
      await enqueue<ProcessConversationJob>(QUEUES.processConversation, { userId, conversationId, importId: imp!.id });
    }
    return updated!;
  } catch (err) {
    await withUser(db, userId, (tx) =>
      tx.update(imports).set({ status: "failed", error: String((err as Error).message).slice(0, 500) }).where(eq(imports.id, imp!.id)),
    );
    throw err;
  }
}

/** Called by the worker when a conversation from an import finished (or finally failed). */
export async function markImportProgress(db: Db, userId: string, importId: string) {
  await withUser(db, userId, (tx) =>
    tx.execute(sql`
      UPDATE imports SET
        conversations_done = conversations_done + 1,
        status = CASE WHEN conversations_done + 1 >= conversations_total THEN 'done' ELSE status END,
        finished_at = CASE WHEN conversations_done + 1 >= conversations_total THEN now() ELSE finished_at END
      WHERE id = ${importId} AND user_id = ${userId}`),
  );
}

export async function listImports(db: Db, userId: string) {
  return withUser(db, userId, (tx) =>
    tx.select().from(imports).where(and(eq(imports.userId, userId))).orderBy(desc(imports.createdAt)).limit(20),
  );
}
