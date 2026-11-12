import { PgBoss } from "pg-boss";
import { QUEUES, type Enqueue } from "./jobs";

export const RETRY_LIMIT = 3;

/**
 * pg-boss on the admin connection (it owns its own `pgboss` schema; no user
 * data lives there — jobs carry only ids).
 */
export async function createJobQueue(connectionString: string): Promise<{ boss: PgBoss; enqueue: Enqueue; stop(): Promise<void> }> {
  const boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("[queue]", err));
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    const exists = await boss.getQueue(name);
    if (!exists) {
      await boss.createQueue(name, { retryLimit: RETRY_LIMIT, retryDelay: 10, retryBackoff: true, expireInSeconds: 15 * 60 });
    }
  }
  const enqueue: Enqueue = async (queue, data) => {
    await boss.send(queue, data as object);
  };
  return { boss, enqueue, stop: () => boss.stop({ graceful: true, timeout: 20_000 }) };
}
