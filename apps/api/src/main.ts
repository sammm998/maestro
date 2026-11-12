import { serve } from "@hono/node-server";
import { createDatabase, DEFAULT_DATABASE_ADMIN_URL, DEFAULT_DATABASE_URL } from "@maestro/db";
import { createEmbedder, createLLM } from "@maestro/llm";
import { createJobQueue, offlineHandlers } from "@maestro/core";
import { createApp } from "./app";
import { configFromEnv, type AppContext } from "./context";

const app = createDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
const admin = createDatabase(process.env.DATABASE_ADMIN_URL ?? DEFAULT_DATABASE_ADMIN_URL, { max: 4 });
const queue = await createJobQueue(process.env.QUEUE_DATABASE_URL ?? process.env.DATABASE_ADMIN_URL ?? DEFAULT_DATABASE_ADMIN_URL);

const ctx: AppContext = {
  app,
  admin,
  deps: { db: app.db, llm: createLLM(process.env, offlineHandlers), embedder: createEmbedder(process.env) },
  enqueue: queue.enqueue,
  config: configFromEnv(),
};

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: createApp(ctx).fetch, port }, () => console.log(`[api] listening on http://localhost:${port}`));

const shutdown = async () => {
  await queue.stop();
  await app.close();
  await admin.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
