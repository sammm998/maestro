import type { Database } from "@maestro/db";
import type { CoreDeps, Enqueue } from "@maestro/core";

export interface Config {
  /** Public origin of the dashboard (also the OAuth issuer; /api, /oauth are proxied to this service). */
  publicUrl: string;
  /** Public URL of the MCP endpoint (the OAuth "resource"). */
  mcpUrl: string;
  cookieSecure: boolean;
  /** Return magic links in the API response (local dev only — never in production). */
  devLoginLinks: boolean;
}

export interface AppContext {
  app: Database;
  admin: Database;
  deps: CoreDeps;
  enqueue: Enqueue;
  config: Config;
}

export type Env = { Variables: { userId: string; email: string } };

export function configFromEnv(env = process.env): Config {
  const publicUrl = (env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    publicUrl,
    mcpUrl: (env.MCP_PUBLIC_URL ?? "http://localhost:8788/mcp").replace(/\/$/, ""),
    cookieSecure: publicUrl.startsWith("https://"),
    devLoginLinks: env.NODE_ENV !== "production" && env.AUTH_DEV_LINKS !== "0",
  };
}
