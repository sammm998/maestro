import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { eq, users, withUser } from "@maestro/db";
import { exportUserData, purgeRawMessages } from "@maestro/core";
import { SESSION_COOKIE } from "../auth";
import type { AppContext, Env } from "../context";

/** GDPR self-service (plan §10): export everything, delete raw messages, delete account. */
export function accountRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  r.get("/export", async (c) => {
    const userId = c.get("userId");
    const data = await withUser(ctx.app.db, userId, (tx) => exportUserData(tx, userId));
    c.header("content-disposition", `attachment; filename="maestro-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ user: { id: userId, email: c.get("email") }, ...data });
  });

  r.post("/purge-messages", async (c) => {
    const userId = c.get("userId");
    const n = await withUser(ctx.app.db, userId, (tx) => purgeRawMessages(tx, userId));
    return c.json({ deletedMessages: n });
  });

  r.delete("/account", async (c) => {
    // Cascades to every user-data table, sessions and OAuth tokens.
    await ctx.admin.db.delete(users).where(eq(users.id, c.get("userId")));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  return r;
}
