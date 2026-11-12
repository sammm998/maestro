import { and, eq, grants, gt, isNull, oauthClients, oauthTokens, sql, type SourceKind } from "@maestro/db";
import { sha256 } from "@maestro/core";
import type { CallerAuth, McpContext } from "./context";

const CANONICAL: Partial<Record<SourceKind, string>> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  cursor: "Cursor",
  gemini: "Gemini",
  lovable: "Lovable",
  higgsfield: "Higgsfield",
};

/** Map a client's name to the tool it is, so memories can say "från ChatGPT". */
export function sourceForClient(name: string): SourceKind {
  const n = name.toLowerCase();
  if (/chatgpt|openai/.test(n)) return "chatgpt";
  if (/claude|anthropic/.test(n)) return "claude";
  if (/cursor/.test(n)) return "cursor";
  if (/gemini|google/.test(n)) return "gemini";
  if (/lovable/.test(n)) return "lovable";
  if (/higgsfield/.test(n)) return "higgsfield";
  return "mcp_client";
}

/**
 * Validate an access token. The grant is re-checked on every call so that
 * "återkalla" in the dashboard takes effect immediately (demo step 4).
 */
export async function authenticate(ctx: McpContext, authorization: string | undefined): Promise<CallerAuth | undefined> {
  const m = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!m) return undefined;
  const [row] = await ctx.admin.db
    .select({ token: oauthTokens, grant: grants, client: oauthClients })
    .from(oauthTokens)
    .innerJoin(grants, eq(grants.id, oauthTokens.grantId))
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(
      and(
        eq(oauthTokens.tokenHash, sha256(m[1]!)),
        eq(oauthTokens.kind, "access"),
        isNull(oauthTokens.revokedAt),
        gt(oauthTokens.expiresAt, sql`now()`),
        isNull(grants.revokedAt),
        sql`(${grants.expiresAt} IS NULL OR ${grants.expiresAt} > now())`,
      ),
    );
  if (!row) return undefined;
  // RFC 8707: the token must have been issued for this resource.
  if (row.token.resource && row.token.resource.replace(/\/$/, "") !== ctx.config.mcpUrl) return undefined;
  const scopes = row.grant.scopes;
  const sensitivities: CallerAuth["access"]["sensitivities"] = ["normal"];
  if (scopes.includes("memory:read:private")) sensitivities.push("private");
  if (scopes.includes("memory:read:special")) sensitivities.push("special_category");
  const kind = sourceForClient(row.client.name);
  return {
    userId: row.token.userId,
    clientId: row.client.id,
    clientName: row.client.name,
    grantId: row.grant.id,
    scopes,
    access: { sensitivities, projectIds: row.grant.projects ?? null },
    sourceKind: kind,
    sourceLabel: CANONICAL[kind] ?? row.client.name,
  };
}

/** Tiny fixed-window rate limiter per grant (single instance; move to Postgres/Redis when scaling out). */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private perMinute: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || now - w.start > 60_000) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= this.perMinute;
  }
}
