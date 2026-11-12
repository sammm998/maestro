import { randomBytes } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { and, eq, gt, isNull, loginTokens, sessions, sql, users } from "@maestro/db";
import { sha256 } from "@maestro/core";
import type { AppContext, Env } from "./context";

export const SESSION_COOKIE = "maestro_session";
const SESSION_DAYS = 30;
const LOGIN_TOKEN_MINUTES = 15;

export const newToken = () => randomBytes(32).toString("base64url");

/** Resolve the dashboard session cookie to a user (admin connection: auth happens before user context exists). */
export async function userFromSession(ctx: AppContext, token: string | undefined) {
  if (!token) return undefined;
  const [row] = await ctx.admin.db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, sql`now()`)));
  return row;
}

export function requireUser(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = await userFromSession(ctx, getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", user.id);
    c.set("email", user.email);
    await next();
  };
}

export async function createSession(ctx: AppContext, userId: string) {
  const token = newToken();
  await ctx.admin.db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400e3),
  });
  return token;
}

/**
 * Passwordless e-mail login (magic link). Passkeys are the planned next step
 * (plan §3.1); the session layer here is independent of how the user proves
 * who they are.
 */
export function authRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  r.post("/login", async (c) => {
    const body = z.object({ email: z.email(), next: z.string().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_email" }, 400);
    const email = body.data.email.trim().toLowerCase();
    const token = newToken();
    await ctx.admin.db.insert(loginTokens).values({
      email,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60e3),
    });
    const next = body.data.next?.startsWith("/") && !body.data.next.startsWith("//") ? body.data.next : "/";
    const link = `${ctx.config.publicUrl}/api/auth/verify?token=${token}&next=${encodeURIComponent(next)}`;
    // TODO(fas 1+): send via an EU e-mail provider. Until then the link is logged.
    console.log(`[auth] login link for ${email}: ${link}`);
    return c.json({ ok: true, ...(ctx.config.devLoginLinks ? { devLink: link } : {}) });
  });

  r.get("/verify", async (c) => {
    const token = c.req.query("token") ?? "";
    const nextParam = c.req.query("next") ?? "/";
    const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
    const [lt] = await ctx.admin.db
      .update(loginTokens)
      .set({ usedAt: sql`now()` })
      .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, sql`now()`)))
      .returning();
    if (!lt) return c.redirect(`${ctx.config.publicUrl}/login?error=expired`);
    const [user] = await ctx.admin.db
      .insert(users)
      .values({ email: lt.email })
      .onConflictDoUpdate({ target: users.email, set: { email: lt.email } })
      .returning();
    const session = await createSession(ctx, user!.id);
    setCookie(c, SESSION_COOKIE, session, {
      httpOnly: true,
      secure: ctx.config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    });
    return c.redirect(`${ctx.config.publicUrl}${next}`);
  });

  r.post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await ctx.admin.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  r.get("/me", async (c) => {
    const user = await userFromSession(ctx, getCookie(c, SESSION_COOKIE));
    return user ? c.json({ user }) : c.json({ user: null }, 401);
  });

  return r;
}
