import { serve } from "@hono/node-server";
import { createDatabase, DEFAULT_DATABASE_ADMIN_URL, DEFAULT_DATABASE_URL } from "@maestro/db";
import { createEmbedder, createLLM } from "@maestro/llm";
import { createJobQueue, offlineHandlers } from "@maestro/core";
import { createMcpApp } from "./app";
import type { McpContext } from "./context";

const app = createDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
const admin = createDatabase(process.env.DATABASE_ADMIN_URL ?? DEFAULT_DATABASE_ADMIN_URL, { max: 4 });
const queue = await createJobQueue(process.env.QUEUE_DATABASE_URL ?? process.env.DATABASE_ADMIN_URL ?? DEFAULT_DATABASE_ADMIN_URL);

const ctx: McpContext = {
  app,
  admin,
  deps: { db: app.db, llm: createLLM(process.env, offlineHandlers), embedder: createEmbedder(process.env) },
  enqueue: queue.enqueue,
  config: {
    mcpUrl: (process.env.MCP_PUBLIC_URL || "http://localhost:8788/mcp").replace(/\/$/, ""),
    issuer: (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, ""),
    rateLimitPerMinute: Number(process.env.MCP_RATE_LIMIT_PER_MINUTE || 120),
  },
};

const port = Number(process.env.MCP_PORT || 8788);
serve({ fetch: createMcpApp(ctx).fetch, port }, () => console.log(`[mcp] listening on http://localhost:${port}${new URL(ctx.config.mcpUrl).pathname}`));

const shutdown = async () => {
  await queue.stop();
  await app.close();
  await admin.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
