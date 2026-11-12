import { createDatabase, DEFAULT_DATABASE_ADMIN_URL, DEFAULT_DATABASE_URL } from "@maestro/db";
import { createEmbedder, createLLM } from "@maestro/llm";
import {
  createJobQueue,
  decayImportance,
  markImportProgress,
  offlineHandlers,
  processConversation,
  QUEUES,
  RETRY_LIMIT,
  type CoreDeps,
  type ProcessConversationJob,
} from "@maestro/core";

const app = createDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
const admin = createDatabase(process.env.DATABASE_ADMIN_URL ?? DEFAULT_DATABASE_ADMIN_URL, { max: 2 });
const deps: CoreDeps = { db: app.db, llm: createLLM(process.env, offlineHandlers), embedder: createEmbedder(process.env) };
const queue = await createJobQueue(process.env.QUEUE_DATABASE_URL ?? process.env.DATABASE_ADMIN_URL ?? DEFAULT_DATABASE_ADMIN_URL);

console.log(`[worker] llm=${deps.llm.name} embedder=${deps.embedder.model}`);

await queue.boss.work<ProcessConversationJob>(
  QUEUES.processConversation,
  { localConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 4), batchSize: 1 },
  async ([job]) => {
    if (!job) return;
    const { userId, conversationId, importId } = job.data;
    try {
      const res = await processConversation(deps, userId, conversationId);
      const summary = res.outcomes.reduce<Record<string, number>>((a, o) => ((a[o.action] = (a[o.action] ?? 0) + 1), a), {});
      console.log(`[worker] conversation ${conversationId}: ${res.candidates} candidates`, summary);
      if (importId) await markImportProgress(app.db, userId, importId);
    } catch (err) {
      const final = job.retryCount >= RETRY_LIMIT;
      console.error(`[worker] conversation ${conversationId} failed (attempt ${job.retryCount + 1}${final ? ", giving up" : ""}):`, err);
      if (final && importId) await markImportProgress(app.db, userId, importId);
      throw err;
    }
  },
);

await queue.boss.work(QUEUES.decay, async () => {
  const n = await decayImportance(admin.db);
  console.log(`[worker] decay: lowered importance of ${n} unused memories`);
});
await queue.boss.schedule(QUEUES.decay, "15 3 * * *", null, { tz: "Europe/Stockholm" });

console.log("[worker] ready");

async function shutdown() {
  console.log("[worker] shutting down");
  await queue.stop();
  await app.close();
  await admin.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
