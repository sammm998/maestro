/**
 * Production bootstrap (runs on every deploy, idempotent):
 *  - creates the extensions and the RLS-restricted runtime role `maestro_app`
 *  - applies migrations
 * Needs DATABASE_ADMIN_URL (owner/superuser) and MAESTRO_APP_DB_PASSWORD.
 */
import pg from "pg";
import { runMigrations } from "./migrate";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.MAESTRO_APP_DB_PASSWORD;
if (!adminUrl || !appPassword) throw new Error("DATABASE_ADMIN_URL and MAESTRO_APP_DB_PASSWORD are required");

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  const pw = client.escapeLiteral(appPassword);
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'maestro_app'");
  await client.query(
    exists.rowCount ? `ALTER ROLE maestro_app WITH LOGIN NOBYPASSRLS PASSWORD ${pw}` : `CREATE ROLE maestro_app LOGIN NOBYPASSRLS PASSWORD ${pw}`,
  );
  const { rows } = await client.query<{ db: string }>("SELECT current_database() AS db");
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(rows[0]!.db)} TO maestro_app`);
} finally {
  await client.end();
}
// Grants on tables are applied by migration 0002_rls (and default privileges for new tables).
await runMigrations(adminUrl);
// Re-apply grants in case the role was created after the migration first ran.
const c2 = new pg.Client({ connectionString: adminUrl });
await c2.connect();
await c2.query(`GRANT USAGE ON SCHEMA public TO maestro_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO maestro_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO maestro_app`);
await c2.end();
console.log("✓ database bootstrapped");
