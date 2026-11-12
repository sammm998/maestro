import { and, conversations, eq, messages, sources, sql, type SourceKind, type UserTx } from "@maestro/db";
import { sha256 } from "./util";

export interface IngestMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt?: Date | null;
}

export interface IngestConversation {
  source: { kind: SourceKind; label: string; device?: string };
  externalId: string;
  title?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  messages: IngestMessage[];
}

export interface IngestResult {
  conversationId: string;
  sourceId: string;
  newMessages: number;
}

export async function upsertSource(
  tx: UserTx,
  userId: string,
  src: { kind: SourceKind; label: string; device?: string },
): Promise<string> {
  const [row] = await tx
    .insert(sources)
    .values({ userId, kind: src.kind, label: src.label, device: src.device ?? null })
    .onConflictDoUpdate({
      target: [sources.userId, sources.kind, sources.label],
      set: { device: sql`coalesce(excluded.device, ${sources.device})` },
    })
    .returning({ id: sources.id });
  return row!.id;
}

/**
 * Normalise a conversation into conversation + messages (plan §6.1).
 * Idempotent: re-importing the same export only inserts new messages
 * (dedup on content_hash), and marks the conversation for re-extraction
 * only if something new arrived.
 */
export async function ingestConversation(tx: UserTx, userId: string, input: IngestConversation): Promise<IngestResult> {
  const sourceId = await upsertSource(tx, userId, input.source);
  const msgs = input.messages.filter((m) => m.content.trim().length > 0);
  const firstAt = input.startedAt ?? msgs.find((m) => m.createdAt)?.createdAt ?? null;
  const lastAt = input.endedAt ?? [...msgs].reverse().find((m) => m.createdAt)?.createdAt ?? firstAt;

  const [conv] = await tx
    .insert(conversations)
    .values({
      userId,
      sourceId,
      externalId: input.externalId,
      title: input.title ?? null,
      startedAt: firstAt,
      endedAt: lastAt,
    })
    .onConflictDoUpdate({
      target: [conversations.userId, conversations.sourceId, conversations.externalId],
      set: { title: sql`coalesce(excluded.title, ${conversations.title})`, endedAt: sql`greatest(excluded.ended_at, ${conversations.endedAt})` },
    })
    .returning({ id: conversations.id });
  const conversationId = conv!.id;

  const [{ maxPos } = { maxPos: -1 }] = await tx
    .select({ maxPos: sql<number>`coalesce(max(${messages.position}), -1)::int` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));

  let newMessages = 0;
  if (msgs.length > 0) {
    const rows = msgs.map((m, i) => ({
      userId,
      conversationId,
      role: m.role,
      content: m.content,
      position: maxPos + 1 + i,
      createdAt: m.createdAt ?? null,
      contentHash: sha256(`${m.role}\n${m.createdAt?.toISOString() ?? ""}\n${m.content}`),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const inserted = await tx
        .insert(messages)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing({ target: [messages.conversationId, messages.contentHash] })
        .returning({ id: messages.id });
      newMessages += inserted.length;
    }
  }
  if (newMessages > 0) {
    await tx
      .update(conversations)
      .set({ extractStatus: "pending" })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  }
  return { conversationId, sourceId, newMessages };
}
