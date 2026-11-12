import { memories, memoryEntities, sql, type SQL, type MemoryKind, type Sensitivity, type SourceKind, type UserTx } from "@maestro/db";

import { tokenize } from "./util";

export interface SearchFilters {
  userId: string;
  kinds?: MemoryKind[];
  sourceKinds?: SourceKind[];
  since?: Date;
  sensitivities: Sensitivity[];
  /** Restrict to memories linked to these project entities (grant.projects). */
  projectIds?: string[] | null;
  includeFlagged?: boolean;
  excludeIds?: string[];
}

export function filterSql(f: SearchFilters): SQL {
  const parts: SQL[] = [sql`m.user_id = ${f.userId}`, sql`m.status = 'active'`];
  parts.push(sql`m.sensitivity = ANY(${pgTextArray(f.sensitivities)})`);
  if (f.kinds?.length) parts.push(sql`m.kind = ANY(${pgTextArray(f.kinds)})`);
  if (f.sourceKinds?.length) parts.push(sql`m.source_kind = ANY(${pgTextArray(f.sourceKinds)})`);
  if (f.since) parts.push(sql`m.valid_from >= ${f.since.toISOString()}`);
  if (!f.includeFlagged) parts.push(sql`NOT ('suspected_injection' = ANY(m.flags))`);
  if (f.excludeIds?.length) parts.push(sql`NOT (m.id = ANY(${pgUuidArray(f.excludeIds)}))`);
  if (f.projectIds) {
    parts.push(
      sql`EXISTS (SELECT 1 FROM ${memoryEntities} me WHERE me.memory_id = m.id AND me.entity_id = ANY(${pgUuidArray(f.projectIds)}))`,
    );
  }
  return sql.join(parts, sql` AND `);
}

const pgTextArray = (xs: readonly string[]) => sql`${`{${xs.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`}::text[]`;
const pgUuidArray = (xs: readonly string[]) => sql`${`{${xs.join(",")}}`}::uuid[]`;

export interface Ranked {
  id: string;
  rank: number;
  score: number;
}

/** Nearest neighbours by cosine distance, only among rows embedded with the same model. */
export async function vectorSearch(
  tx: UserTx,
  f: SearchFilters,
  q: { embedding: number[]; model: string; dim: number },
  limit: number,
): Promise<Ranked[]> {
  if (!Number.isInteger(q.dim) || q.dim <= 0 || q.dim > 4096) throw new Error("invalid embedding dim");
  const vec = `[${q.embedding.join(",")}]`;
  const cast = sql.raw(`vector(${q.dim})`);
  const res = await tx.execute<{ id: string; distance: number }>(sql`
    SELECT m.id, (m.embedding::${cast} <=> ${vec}::${cast}) AS distance
    FROM ${memories} m
    WHERE ${filterSql(f)} AND m.embedding_model = ${q.model} AND m.embedding_dim = ${q.dim}
    ORDER BY m.embedding::${cast} <=> ${vec}::${cast}
    LIMIT ${limit}`);
  return res.rows.map((r, i) => ({ id: r.id, rank: i + 1, score: 1 - Number(r.distance) }));
}

/** Full-text search with prefix matching ("video" matches "videoidén"), OR semantics. */
export async function textSearch(tx: UserTx, f: SearchFilters, text: string, limit: number): Promise<Ranked[]> {
  const toks = [...new Set(tokenize(text))].slice(0, 24);
  if (toks.length === 0) return [];
  const tsq = toks.map((t) => `${t.replace(/[^\p{L}\p{N}]/gu, "")}:*`).join(" | ");
  const res = await tx.execute<{ id: string; rank: number }>(sql`
    SELECT m.id, ts_rank_cd(m.tsv, q, 32) AS rank
    FROM ${memories} m, to_tsquery('simple', ${tsq}) q
    WHERE ${filterSql(f)} AND m.tsv @@ q
    ORDER BY rank DESC, m.importance DESC
    LIMIT ${limit}`);
  return res.rows.map((r, i) => ({ id: r.id, rank: i + 1, score: Number(r.rank) }));
}

/** Memories linked to any of the given entities. */
export async function entitySearch(tx: UserTx, f: SearchFilters, entityIds: string[], limit: number): Promise<Ranked[]> {
  if (entityIds.length === 0) return [];
  const res = await tx.execute<{ id: string; hits: number }>(sql`
    SELECT m.id, count(*)::int AS hits
    FROM ${memories} m JOIN ${memoryEntities} me ON me.memory_id = m.id
    WHERE ${filterSql(f)} AND me.entity_id = ANY(${pgUuidArray(entityIds)})
    GROUP BY m.id, m.importance, m.valid_from
    ORDER BY hits DESC, m.importance DESC, m.valid_from DESC
    LIMIT ${limit}`);
  return res.rows.map((r, i) => ({ id: r.id, rank: i + 1, score: Number(r.hits) }));
}

/** Most recent memories (used when the query names a source/time but little content). */
export async function recentSearch(tx: UserTx, f: SearchFilters, limit: number): Promise<Ranked[]> {
  const res = await tx.execute<{ id: string }>(sql`
    SELECT m.id FROM ${memories} m WHERE ${filterSql(f)}
    ORDER BY m.valid_from DESC, m.importance DESC LIMIT ${limit}`);
  return res.rows.map((r, i) => ({ id: r.id, rank: i + 1, score: 0 }));
}

/**
 * Fuzzy lexical match with pg_trgm word_similarity per query token. Catches
 * Swedish compounds ("menyidén" ~ "vintermeny"), inflections and typos that
 * full-text search misses.
 */
export async function trigramSearch(tx: UserTx, f: SearchFilters, text: string, limit: number): Promise<Ranked[]> {
  const toks = [...new Set(tokenize(text))].filter((t) => t.length >= 4).slice(0, 16);
  if (toks.length === 0) return [];
  const res = await tx.execute<{ id: string; score: number }>(sql`
    SELECT m.id, s.score FROM ${memories} m,
      LATERAL (
        SELECT sum(ws) AS score FROM (
          SELECT word_similarity(t, lower(m.title || ' ' || m.content)) AS ws
          FROM unnest(${pgTextArray(toks)}) t
        ) x WHERE ws >= 0.5
      ) s
    WHERE ${filterSql(f)} AND s.score IS NOT NULL
    ORDER BY s.score DESC, m.importance DESC
    LIMIT ${limit}`);
  return res.rows.map((r, i) => ({ id: r.id, rank: i + 1, score: Number(r.score) }));
}
