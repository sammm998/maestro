import type { Database, SourceKind } from "@maestro/db";
import type { AccessScope, CoreDeps, Enqueue } from "@maestro/core";

export interface McpConfig {
  /** Public URL of this MCP endpoint, e.g. https://mcp.maestro.eu/mcp (the OAuth resource). */
  mcpUrl: string;
  /** OAuth issuer (dashboard origin). */
  issuer: string;
  /** Max tool calls per grant per minute. */
  rateLimitPerMinute: number;
}

export interface McpContext {
  app: Database;
  admin: Database;
  deps: CoreDeps;
  enqueue: Enqueue;
  config: McpConfig;
}

/** Who is calling, resolved from the bearer token + grant on every request. */
export interface CallerAuth {
  userId: string;
  clientId: string;
  clientName: string;
  grantId: string;
  scopes: string[];
  access: AccessScope;
  sourceKind: SourceKind;
  sourceLabel: string;
}
