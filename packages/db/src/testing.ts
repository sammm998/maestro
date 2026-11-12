/**
 * Test helpers: a migrated test database plus fresh users.
 * TEST_DATABASE_URL (runtime role) and TEST_DATABASE_ADMIN_URL (owner) default to
 * the local docker-compose setup.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, users, type Database } from "./index";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://maestro_app:maestro_app@localhost:5432/maestro_test";
export const TEST_DATABASE_ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://maestro:maestro@localhost:5432/maestro_test";

let migrated: Promise<void> | undefined;

export function migrateTestDb(): Promise<void> {
  migrated ??= (async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const admin = createDatabase(TEST_DATABASE_ADMIN_URL, { max: 1 });
    try {
      await migrate(admin.db, { migrationsFolder: path.join(here, "../drizzle") });
    } finally {
      await admin.close();
    }
  })();
  return migrated;
}

export interface TestDb {
  app: Database;
  admin: Database;
  close(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  await migrateTestDb();
  const app = createDatabase(TEST_DATABASE_URL);
  const admin = createDatabase(TEST_DATABASE_ADMIN_URL);
  return { app, admin, close: async () => { await app.close(); await admin.close(); } };
}

export async function createTestUser(admin: Database, email?: string) {
  const [u] = await admin.db
    .insert(users)
    .values({ email: email ?? `test-${crypto.randomUUID()}@example.eu` })
    .returning();
  return u!;
}
