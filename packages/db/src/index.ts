import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export type { SQL } from "drizzle-orm";
export { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNull, lt, ne, not, or, sql } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction-scoped handle where `app.user_id` is set and RLS applies. */
export type UserTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a transaction scoped to one user. Every user-data query MUST
 * go through here: RLS policies read `app.user_id`, so a query without user
 * context sees zero rows (plan §4: "Ingen query utan användarkontext").
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("withUser: invalid user id");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const DEFAULT_DATABASE_URL = "postgres://maestro_app:maestro_app@localhost:5432/maestro";
export const DEFAULT_DATABASE_ADMIN_URL = "postgres://maestro:maestro@localhost:5432/maestro";
