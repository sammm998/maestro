import { Hono } from "hono";
import { and, desc, eq, grants, isNull, oauthClients, oauthTokens, sql, withUser } from "@maestro/db";
import { listAccessLog, logAccess } from "@maestro/core";
import type { AppContext, Env } from "../context";

/** "Anslutna verktyg": grants, revoke with one click, and exactly what each tool read (plan §7 fas 2, §10). */
export function toolRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  r.get("/grants", async (c) => {
    const userId = c.get("userId");
    const rows = await withUser(ctx.app.db, userId, async (tx) => {
      const gs = await tx
        .select({ grant: grants, clientName: oauthClients.name, verified: oauthClients.isVerified })
        .from(grants)
        .innerJoin(oauthClients, eq(oauthClients.id, grants.clientId))
        .where(eq(grants.userId, userId))
        .orderBy(desc(grants.createdAt));
      const stats = await tx.execute<{ client_id: string; reads: number; last_at: string | null; memories_read: number }>(sql`
        SELECT client_id, count(*)::int AS reads, max(created_at) AS last_at,
               coalesce(sum(cardinality(memory_ids)), 0)::int AS memories_read
        FROM access_log WHERE user_id = ${userId} AND client_id IS NOT NULL AND action <> 'grant_created'
        GROUP BY client_id`);
      const by = new Map(stats.rows.map((s) => [s.client_id, s]));
      return gs.map((g) => {
        const s = by.get(g.grant.clientId);
        const active = !g.grant.revokedAt && (!g.grant.expiresAt || g.grant.expiresAt > new Date());
        return {
          ...g.grant,
          clientName: g.clientName,
          verified: g.verified,
          active,
          calls: s?.reads ?? 0,
          memoriesRead: s?.memories_read ?? 0,
          lastUsedAt: s?.last_at ?? null,
        };
      });
    });
    return c.json({ grants: rows });
  });

  r.delete("/grants/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const revoked = await withUser(ctx.app.db, userId, async (tx) => {
      const [g] = await tx
        .update(grants)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(grants.id, id), eq(grants.userId, userId), isNull(grants.revokedAt)))
        .returning();
      if (g) await logAccess(tx, { userId, clientId: g.clientId, action: "grant_revoked" });
      return g;
    });
    if (!revoked) return c.json({ error: "not_found" }, 404);
    // Kill outstanding tokens immediately (MCP also re-checks the grant on every call).
    await ctx.admin.db.update(oauthTokens).set({ revokedAt: sql`now()` }).where(and(eq(oauthTokens.grantId, id), isNull(oauthTokens.revokedAt)));
    return c.json({ ok: true });
  });

  r.get("/access-log", async (c) => {
    const userId = c.get("userId");
    const rows = await withUser(ctx.app.db, userId, (tx) =>
      listAccessLog(tx, userId, { clientId: c.req.query("clientId") || undefined, limit: Number(c.req.query("limit") ?? 100) }),
    );
    return c.json({ entries: rows });
  });

  return r;
}
