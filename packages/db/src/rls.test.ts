import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, memories, sources, withUser } from "./index";
import { createTestUser, setupTestDb, type TestDb } from "./testing";

let t: TestDb;
beforeAll(async () => { t = await setupTestDb(); });
afterAll(async () => { await t.close(); });

describe("row level security", () => {
  it("isolates user data between users", async () => {
    const alice = await createTestUser(t.admin);
    const bob = await createTestUser(t.admin);

    await withUser(t.app.db, alice.id, async (tx) => {
      const [src] = await tx.insert(sources).values({ userId: alice.id, kind: "chatgpt", label: "ChatGPT" }).returning();
      await tx.insert(memories).values({
        userId: alice.id, kind: "idea", title: "Alice idea", content: "secret", sourceId: src!.id,
        sourceKind: "chatgpt", sourceLabel: "ChatGPT",
      });
    });

    const bobSees = await withUser(t.app.db, bob.id, (tx) => tx.select().from(memories));
    expect(bobSees).toHaveLength(0);
    const aliceSees = await withUser(t.app.db, alice.id, (tx) => tx.select().from(memories).where(eq(memories.userId, alice.id)));
    expect(aliceSees).toHaveLength(1);
  });

  it("returns nothing without user context", async () => {
    const rows = await t.app.db.select().from(memories);
    expect(rows).toHaveLength(0);
  });

  it("rejects writes for another user", async () => {
    const alice = await createTestUser(t.admin);
    const bob = await createTestUser(t.admin);
    await expect(
      withUser(t.app.db, bob.id, (tx) => tx.insert(sources).values({ userId: alice.id, kind: "claude", label: "x" })),
    ).rejects.toThrow();
  });
});
