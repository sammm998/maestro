/**
 * OAuth 2.1 authorization server for MCP clients (plan §5, MCP authorization spec):
 *  - RFC 8414 metadata, RFC 7591 dynamic client registration (public clients)
 *  - authorization code + PKCE (S256 only), RFC 8707 resource indicators
 *  - refresh tokens with rotation, RFC 7009 revocation
 * Consent happens in the dashboard (/connect), which creates a *grant*:
 * the user-visible, revocable permission ("ChatGPT may read my memory for 90 days").
 * Tokens are opaque; only sha256 hashes are stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  and,
  eq,
  grants,
  gt,
  isNull,
  oauthClients,
  oauthCodes,
  oauthRequests,
  oauthTokens,
  sql,
  withUser,
  type OAuthClient,
} from "@maestro/db";
import { logAccess, sha256 } from "@maestro/core";
import type { AppContext, Env } from "./context";

export const SUPPORTED_SCOPES = ["memory:read", "memory:write", "memory:read:private", "memory:read:special"] as const;
const DEFAULT_SCOPES = ["memory:read", "memory:write"];
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 86400;
const CODE_TTL_S = 300;
const REQUEST_TTL_S = 15 * 60;

const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function parseScopes(raw: string | undefined | null): string[] {
  const requested = (raw ?? "").split(/\s+/).filter(Boolean);
  const valid = requested.filter((s) => (SUPPORTED_SCOPES as readonly string[]).includes(s));
  return valid.length ? [...new Set(valid)] : DEFAULT_SCOPES;
}

function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    // Loopback for native/dev clients (RFC 8252); custom schemes for desktop apps (e.g. cursor://).
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["javascript:", "data:", "file:", "vbscript:"].includes(u.protocol);
  } catch {
    return false;
  }
}

export function authServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SUPPORTED_SCOPES,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/tools`,
  };
}

function oauthError(c: { json: (b: unknown, s: 400 | 401) => Response }, error: string, description?: string, status: 400 | 401 = 400) {
  return c.json({ error, ...(description ? { error_description: description } : {}) }, status);
}

/** Public endpoints: /.well-known/*, /oauth/* (called by MCP clients, cross-origin). */
export function oauthPublicRoutes(ctx: AppContext) {
  const r = new Hono();
  const issuer = ctx.config.publicUrl;
  r.use("*", cors({ origin: "*", allowHeaders: ["authorization", "content-type", "mcp-protocol-version"], allowMethods: ["GET", "POST", "OPTIONS"] }));

  const meta = (c: { json: (b: unknown) => Response }) => c.json(authServerMetadata(issuer));
  r.get("/.well-known/oauth-authorization-server", meta);
  r.get("/.well-known/oauth-authorization-server/*", meta);
  r.get("/.well-known/openid-configuration", meta);

  // RFC 7591 dynamic client registration (public clients only).
  r.post("/oauth/register", async (c) => {
    const body = z
      .object({
        redirect_uris: z.array(z.string()).min(1).max(10),
        client_name: z.string().max(100).optional(),
        token_endpoint_auth_method: z.string().optional(),
        logo_uri: z.string().url().optional(),
        client_uri: z.string().url().optional(),
        grant_types: z.array(z.string()).optional(),
        response_types: z.array(z.string()).optional(),
        scope: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return oauthError(c, "invalid_client_metadata", body.error.issues[0]?.message);
    const bad = body.data.redirect_uris.find((u) => !validRedirectUri(u));
    if (bad) return oauthError(c, "invalid_redirect_uri", `Redirect URI not allowed: ${bad}`);
    const id = `mcp_${randomBytes(16).toString("base64url")}`;
    const name = body.data.client_name?.trim() || new URL(body.data.redirect_uris[0]!).hostname || "MCP client";
    await ctx.admin.db.insert(oauthClients).values({
      id,
      name,
      redirectUris: body.data.redirect_uris,
      logoUrl: body.data.logo_uri ?? null,
      metadata: body.data as Record<string, unknown>,
    });
    return c.json(
      {
        client_id: id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: body.data.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  });

  r.get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    const [client] = q.client_id ? await ctx.admin.db.select().from(oauthClients).where(eq(oauthClients.id, q.client_id)) : [];
    // Never redirect to an unverified URI: show an error page instead.
    if (!client || !q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) {
      return c.redirect(`${issuer}/connect?error=invalid_client`);
    }
    const back = (params: Record<string, string>) => {
      const u = new URL(q.redirect_uri!);
      for (const [k, v] of Object.entries({ ...params, ...(q.state ? { state: q.state } : {}), iss: issuer })) u.searchParams.set(k, v);
      return c.redirect(u.toString());
    };
    if (q.response_type !== "code") return back({ error: "unsupported_response_type" });
    if (!q.code_challenge || (q.code_challenge_method ?? "plain") !== "S256") {
      return back({ error: "invalid_request", error_description: "PKCE with S256 is required" });
    }
    if (q.resource && q.resource.replace(/\/$/, "") !== ctx.config.mcpUrl) {
      return back({ error: "invalid_target", error_description: "Unknown resource" });
    }
    const [req] = await ctx.admin.db
      .insert(oauthRequests)
      .values({
        clientId: client.id,
        redirectUri: q.redirect_uri,
        scopes: parseScopes(q.scope),
        state: q.state ?? null,
        codeChallenge: q.code_challenge,
        resource: q.resource ?? ctx.config.mcpUrl,
        expiresAt: new Date(Date.now() + REQUEST_TTL_S * 1000),
      })
      .returning();
    return c.redirect(`${issuer}/connect?request=${req!.id}`);
  });

  r.post("/oauth/token", async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, string>);
    const f = form as Record<string, string | undefined>;
    if (f.grant_type === "authorization_code") {
      if (!f.code || !f.code_verifier || !f.client_id) return oauthError(c, "invalid_request", "code, code_verifier and client_id are required");
      const [code] = await ctx.admin.db
        .update(oauthCodes)
        .set({ usedAt: sql`now()` })
        .where(and(eq(oauthCodes.codeHash, sha256(f.code)), isNull(oauthCodes.usedAt), gt(oauthCodes.expiresAt, sql`now()`)))
        .returning();
      if (!code || code.clientId !== f.client_id) return oauthError(c, "invalid_grant", "Invalid or expired code");
      if (f.redirect_uri && f.redirect_uri !== code.redirectUri) return oauthError(c, "invalid_grant", "redirect_uri mismatch");
      if (s256(f.code_verifier) !== code.codeChallenge) return oauthError(c, "invalid_grant", "PKCE verification failed");
      if (f.resource && f.resource.replace(/\/$/, "") !== (code.resource ?? ctx.config.mcpUrl)) return oauthError(c, "invalid_target");
      return c.json(await issueTokens(ctx, code));
    }
    if (f.grant_type === "refresh_token") {
      if (!f.refresh_token) return oauthError(c, "invalid_request", "refresh_token is required");
      const [old] = await ctx.admin.db
        .update(oauthTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(oauthTokens.tokenHash, sha256(f.refresh_token)),
            eq(oauthTokens.kind, "refresh"),
            isNull(oauthTokens.revokedAt),
            gt(oauthTokens.expiresAt, sql`now()`),
          ),
        )
        .returning();
      if (!old || (f.client_id && f.client_id !== old.clientId)) return oauthError(c, "invalid_grant", "Invalid refresh token");
      if (!(await grantActive(ctx, old.grantId))) return oauthError(c, "invalid_grant", "Access was revoked by the user");
      return c.json(await issueTokens(ctx, old));
    }
    return oauthError(c, "unsupported_grant_type");
  });

  r.post("/oauth/revoke", async (c) => {
    const f = (await c.req.parseBody().catch(() => ({}))) as Record<string, string | undefined>;
    if (f.token) await ctx.admin.db.update(oauthTokens).set({ revokedAt: sql`now()` }).where(eq(oauthTokens.tokenHash, sha256(f.token)));
    return c.body(null, 200);
  });

  return r;
}

async function grantActive(ctx: AppContext, grantId: string) {
  const [g] = await ctx.admin.db
    .select({ id: grants.id })
    .from(grants)
    .where(and(eq(grants.id, grantId), isNull(grants.revokedAt), sql`(${grants.expiresAt} IS NULL OR ${grants.expiresAt} > now())`));
  return !!g;
}

async function issueTokens(ctx: AppContext, src: { clientId: string; userId: string; grantId: string; resource: string | null }) {
  const access = token("mat");
  const refresh = token("mrt");
  const [g] = await ctx.admin.db.select({ scopes: grants.scopes }).from(grants).where(eq(grants.id, src.grantId));
  const base = { clientId: src.clientId, userId: src.userId, grantId: src.grantId, resource: src.resource ?? ctx.config.mcpUrl };
  await ctx.admin.db.insert(oauthTokens).values([
    { ...base, kind: "access", tokenHash: sha256(access), expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000) },
    { ...base, kind: "refresh", tokenHash: sha256(refresh), expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000) },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: (g?.scopes ?? []).join(" ") };
}

/** Session-authenticated consent endpoints used by the dashboard's /connect page. */
export function oauthConsentRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  const loadRequest = async (id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const [row] = await ctx.admin.db
      .select({ req: oauthRequests, client: oauthClients })
      .from(oauthRequests)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthRequests.clientId))
      .where(and(eq(oauthRequests.id, id), gt(oauthRequests.expiresAt, sql`now()`)));
    return row;
  };

  r.get("/oauth/requests/:id", async (c) => {
    const row = await loadRequest(c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      client: { id: row.client.id, name: row.client.name, verified: row.client.isVerified, logoUrl: row.client.logoUrl },
      redirectHost: new URL(row.req.redirectUri).host,
      scopes: row.req.scopes,
    });
  });

  r.post("/oauth/requests/:id/decision", async (c) => {
    const body = z
      .object({
        approve: z.boolean(),
        scopes: z.array(z.enum(SUPPORTED_SCOPES)).optional(),
        projects: z.array(z.uuid()).nullable().optional(),
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const row = await loadRequest(c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    await ctx.admin.db.delete(oauthRequests).where(eq(oauthRequests.id, row.req.id));

    const redirect = new URL(row.req.redirectUri);
    if (row.req.state) redirect.searchParams.set("state", row.req.state);
    redirect.searchParams.set("iss", ctx.config.publicUrl);
    if (!body.data.approve) {
      redirect.searchParams.set("error", "access_denied");
      return c.json({ redirect: redirect.toString() });
    }
    // The user may narrow (never widen) what the client asked for.
    const scopes = (body.data.scopes ?? row.req.scopes).filter((s) => row.req.scopes.includes(s) || s === "memory:read");
    const userId = c.get("userId");
    const grant = await withUser(ctx.app.db, userId, async (tx) => {
      // Re-consenting the same client replaces its previous grant.
      await tx
        .update(grants)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(grants.userId, userId), eq(grants.clientId, row.client.id), isNull(grants.revokedAt)));
      const [g] = await tx
        .insert(grants)
        .values({
          userId,
          clientId: row.client.id,
          scopes,
          projects: body.data.projects ?? null,
          expiresAt: body.data.expiresInDays ? new Date(Date.now() + body.data.expiresInDays * 86400e3) : null,
        })
        .returning();
      await logAccess(tx, { userId, clientId: row.client.id, action: "grant_created", query: scopes.join(" ") });
      return g!;
    });
    const code = token("mac");
    await ctx.admin.db.insert(oauthCodes).values({
      codeHash: sha256(code),
      clientId: row.client.id,
      userId,
      grantId: grant.id,
      redirectUri: row.req.redirectUri,
      codeChallenge: row.req.codeChallenge,
      resource: row.req.resource,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
    });
    redirect.searchParams.set("code", code);
    return c.json({ redirect: redirect.toString() });
  });

  return r;
}

export type { OAuthClient };
