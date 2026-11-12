import {
  accessLog,
  and,
  conversations,
  desc,
  entities,
  eq,
  getTableColumns,
  grants,
  inArray,
  memories,
  memoryEntities,
  messages,
  oauthClients,
  sources,
  sql,
  type EntityType,
  type Memory,
  type MemoryKind,
  type Sensitivity,
  type UserTx,
} from "@maestro/db";
import type { CoreDeps } from "./deps";
import type { Candidate } from "./extract";
import { nowOf } from "./deps";
import { resolveCandidate, type ResolveOutcome } from "./resolve";
import { looksLikeInjection } from "./safety";
import { embeddingText, reembed, upsertEntity, type Provenance } from "./store";

// ─────────────────────────── explicit memories ───────────────────────────

export interface RememberInput {
  content: string;
  kind?: MemoryKind;
  title?: string;
  project?: string;
  sensitivity?: Sensitivity;
}

/** `remember` (plan §5): store something explicitly. Goes through resolve so repeats merge. */
export async function remember(
  deps: CoreDeps,
  tx: UserTx,
  userId: string,
  input: RememberInput,
  prov: Omit<Provenance, "validFrom" | "conversationId">,
): Promise<ResolveOutcome> {
  const content = input.content.trim().slice(0, 2000);
  if (!content) throw new Error("content is empty");
  const title = (input.title?.trim() || content.split(/\s+/).slice(0, 8).join(" ")).slice(0, 200);
  const cand: Candidate = {
    kind: input.kind ?? "fact",
    title,
    content,
    importance: 0.7,
    confidence: 1,
    sensitivity: input.sensitivity ?? "normal",
    entities: input.project ? [{ type: "project", name: input.project }] : [],
    sourceMessageIds: [],
    flags: looksLikeInjection(content) ? ["suspected_injection"] : [],
  };
  const [vec] = await deps.embedder.embed([embeddingText(cand)], "document");
  return resolveCandidate(deps, tx, userId, cand, { ...prov, conversationId: null, validFrom: nowOf(deps) }, vec!);
}

/** `forget` (plan §5): archive, never hard-delete via tools. */
export async function forget(tx: UserTx, userId: string, memoryId: string): Promise<boolean> {
  const res = await tx
    .update(memories)
    .set({ status: "archived", updatedAt: sql`now()` })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return res.length > 0;
}

// ───────────────────────────── dashboard ─────────────────────────────

export interface ListFilter {
  status?: Memory["status"] | "all";
  kind?: MemoryKind;
  q?: string;
  limit?: number;
  offset?: number;
}

export type MemoryView = Omit<Memory, "embedding" | "tsv"> & { entities: { id: string; type: string; name: string }[] };

export async function listMemories(tx: UserTx, userId: string, f: ListFilter = {}): Promise<MemoryView[]> {
  const conds = [eq(memories.userId, userId)];
  if (f.status !== "all") conds.push(eq(memories.status, f.status ?? "active"));
  if (f.kind) conds.push(eq(memories.kind, f.kind));
  if (f.q) conds.push(sql`(${memories.title} ILIKE ${`%${f.q}%`} OR ${memories.content} ILIKE ${`%${f.q}%`})`);
  const rows = await tx
    .select(viewColumns())
    .from(memories)
    .where(and(...conds))
    .orderBy(desc(memories.importance), desc(memories.validFrom))
    .limit(Math.min(f.limit ?? 200, 1000))
    .offset(f.offset ?? 0);
  return attachEntities(tx, rows);
}

function viewColumns() {
  const { embedding: _e, tsv: _t, ...cols } = getTableColumns(memories);
  void _e;
  void _t;
  return cols;
}

export async function getMemoryView(tx: UserTx, userId: string, id: string): Promise<MemoryView | undefined> {
  const rows = await tx.select(viewColumns()).from(memories).where(and(eq(memories.id, id), eq(memories.userId, userId)));
  return (await attachEntities(tx, rows))[0];
}

async function attachEntities(tx: UserTx, rows: Omit<Memory, "embedding" | "tsv">[]): Promise<MemoryView[]> {
  if (rows.length === 0) return [];
  const links = await tx
    .select({ memoryId: memoryEntities.memoryId, id: entities.id, type: entities.type, name: entities.name })
    .from(memoryEntities)
    .innerJoin(entities, eq(entities.id, memoryEntities.entityId))
    .where(inArray(memoryEntities.memoryId, rows.map((r) => r.id)));
  const by = new Map<string, MemoryView["entities"]>();
  for (const l of links) {
    const arr = by.get(l.memoryId) ?? [];
    arr.push({ id: l.id, type: l.type, name: l.name });
    by.set(l.memoryId, arr);
  }
  return rows.map((r) => ({ ...r, entities: by.get(r.id) ?? [] }));
}

export interface MemoryPatch {
  title?: string;
  content?: string;
  kind?: MemoryKind;
  importance?: number;
  sensitivity?: Sensitivity;
  status?: Memory["status"];
  /** User reviewed a flagged memory and says it is fine. */
  clearFlags?: boolean;
}

export async function updateMemory(deps: CoreDeps, tx: UserTx, userId: string, id: string, patch: MemoryPatch) {
  const [cur] = await tx.select().from(memories).where(and(eq(memories.id, id), eq(memories.userId, userId)));
  if (!cur) return undefined;
  const set: Partial<Memory> = {};
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 200);
  if (patch.content !== undefined) set.content = patch.content.trim().slice(0, 2000);
  if (patch.kind) set.kind = patch.kind;
  if (patch.importance !== undefined) set.importance = Math.max(0, Math.min(1, patch.importance));
  if (patch.sensitivity) set.sensitivity = patch.sensitivity;
  if (patch.status) set.status = patch.status;
  if (patch.clearFlags) set.flags = [];
  await tx.update(memories).set({ ...set, updatedAt: new Date() }).where(eq(memories.id, id));
  if (set.title !== undefined || set.content !== undefined || set.kind) {
    await reembed(tx, deps.embedder, { id, kind: set.kind ?? cur.kind, title: set.title ?? cur.title, content: set.content ?? cur.content });
  }
  return getMemoryView(tx, userId, id);
}

export async function deleteMemory(tx: UserTx, userId: string, id: string): Promise<boolean> {
  const res = await tx.delete(memories).where(and(eq(memories.id, id), eq(memories.userId, userId))).returning({ id: memories.id });
  return res.length > 0;
}

export interface ProjectView {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  memoryCount: number;
  lastActivity: Date | null;
}

/** `list_projects` (plan §5) and the dashboard's grouping. */
export async function listEntities(tx: UserTx, userId: string, types: EntityType[] = ["project"]): Promise<ProjectView[]> {
  const res = await tx.execute<{ id: string; type: EntityType; name: string; aliases: string[]; memory_count: number; last_activity: string | null }>(sql`
    SELECT e.id, e.type, e.name, e.aliases,
           count(m.id)::int AS memory_count, max(m.valid_from) AS last_activity
    FROM entities e
    LEFT JOIN memory_entities me ON me.entity_id = e.id
    LEFT JOIN memories m ON m.id = me.memory_id AND m.status = 'active'
    WHERE e.user_id = ${userId} AND e.type = ANY(${`{${types.join(",")}}`}::text[])
    GROUP BY e.id
    HAVING count(m.id) > 0
    ORDER BY max(m.valid_from) DESC NULLS LAST`);
  return res.rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    aliases: r.aliases,
    memoryCount: r.memory_count,
    lastActivity: r.last_activity ? new Date(r.last_activity) : null,
  }));
}

export async function getProjectContext(tx: UserTx, userId: string, entityId: string) {
  const [entity] = await tx.select().from(entities).where(and(eq(entities.id, entityId), eq(entities.userId, userId)));
  if (!entity) return undefined;
  const ids = await tx.select({ id: memoryEntities.memoryId }).from(memoryEntities).where(eq(memoryEntities.entityId, entityId));
  const mems = ids.length
    ? await tx
        .select()
        .from(memories)
        .where(and(inArray(memories.id, ids.map((i) => i.id)), eq(memories.status, "active")))
        .orderBy(desc(memories.importance), desc(memories.validFrom))
    : [];
  return { entity, memories: mems };
}

// ───────────────────────────── access log ─────────────────────────────

export async function logAccess(
  tx: UserTx,
  e: { userId: string; clientId: string | null; action: string; memoryIds?: string[]; query?: string | null },
) {
  await tx.insert(accessLog).values({
    userId: e.userId,
    clientId: e.clientId,
    action: e.action,
    memoryIds: e.memoryIds ?? [],
    query: e.query?.slice(0, 1000) ?? null,
  });
}

export async function listAccessLog(tx: UserTx, userId: string, opts: { clientId?: string; limit?: number } = {}) {
  const conds = [eq(accessLog.userId, userId)];
  if (opts.clientId) conds.push(eq(accessLog.clientId, opts.clientId));
  const rows = await tx
    .select({ log: accessLog, clientName: oauthClients.name })
    .from(accessLog)
    .leftJoin(oauthClients, eq(oauthClients.id, accessLog.clientId))
    .where(and(...conds))
    .orderBy(desc(accessLog.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
  const memIds = [...new Set(rows.flatMap((r) => r.log.memoryIds))];
  const titles = memIds.length
    ? await tx.select({ id: memories.id, title: memories.title }).from(memories).where(inArray(memories.id, memIds))
    : [];
  const titleOf = new Map(titles.map((t) => [t.id, t.title]));
  return rows.map((r) => ({
    ...r.log,
    clientName: r.clientName,
    memories: r.log.memoryIds.map((id) => ({ id, title: titleOf.get(id) ?? "(raderat minne)" })),
  }));
}

// ───────────────────────────── GDPR export ─────────────────────────────

/** Full export in an open JSON format (plan §1.3, §10). */
export async function exportUserData(tx: UserTx, userId: string) {
  const strip = <T extends { embedding?: unknown; tsv?: unknown }>(m: T) => {
    const { embedding: _e, tsv: _t, ...rest } = m;
    void _e;
    void _t;
    return rest;
  };
  const [src, conv, msg, mem, ent, links, grantRows, log] = await Promise.all([
    tx.select().from(sources).where(eq(sources.userId, userId)),
    tx.select().from(conversations).where(eq(conversations.userId, userId)),
    tx.select().from(messages).where(eq(messages.userId, userId)),
    tx.select().from(memories).where(eq(memories.userId, userId)),
    tx.select().from(entities).where(eq(entities.userId, userId)),
    tx.select().from(memoryEntities).where(eq(memoryEntities.userId, userId)),
    tx.select().from(grants).where(eq(grants.userId, userId)),
    tx.select().from(accessLog).where(eq(accessLog.userId, userId)),
  ]);
  return {
    format: "maestro-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    sources: src,
    conversations: conv,
    messages: msg,
    memories: mem.map(strip),
    entities: ent,
    memoryEntities: links,
    grants: grantRows,
    accessLog: log,
  };
}

/** Delete raw messages after extraction (user setting, plan §4 messages comment). */
export async function purgeRawMessages(tx: UserTx, userId: string) {
  const res = await tx.delete(messages).where(eq(messages.userId, userId)).returning({ id: messages.id });
  return res.length;
}

// ───────────────────────────── decay ─────────────────────────────

/**
 * Nightly decay (plan §6.6): lower importance of memories that are never used.
 * Nothing is deleted. Runs with the admin connection across users.
 */
export async function decayImportance(
  db: { execute: UserTx["execute"] },
  opts: { idleDays?: number; factor?: number; floor?: number } = {},
): Promise<number> {
  const idle = opts.idleDays ?? 30;
  const factor = opts.factor ?? 0.97;
  const floor = opts.floor ?? 0.05;
  const res = await db.execute(sql`
    UPDATE memories SET importance = greatest(${floor}::real, importance * ${factor}::real)
    WHERE status = 'active' AND importance > ${floor}
      AND created_at < now() - make_interval(days => ${idle})
      AND (last_used_at IS NULL OR last_used_at < now() - make_interval(days => ${idle}))`);
  return res.rowCount ?? 0;
}

export { upsertEntity };
