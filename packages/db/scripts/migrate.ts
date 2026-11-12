import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, DEFAULT_DATABASE_ADMIN_URL } from "../src/index";

export async function runMigrations(url: string) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const database = createDatabase(url, { max: 1 });
  try {
    await migrate(database.db, { migrationsFolder: path.join(here, "../drizzle") });
  } finally {
    await database.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_ADMIN_URL ?? DEFAULT_DATABASE_ADMIN_URL;
  await runMigrations(url);
  console.log("✓ migrations applied");
}
