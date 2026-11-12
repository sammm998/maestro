import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, RateLimiter } from "./auth";
import type { McpContext } from "./context";
import { buildServer } from "./server";

export function createMcpApp(ctx: McpContext) {
  const app = new Hono();
  const limiter = new RateLimiter(ctx.config.rateLimitPerMinute);
  const resourcePath = new URL(ctx.config.mcpUrl).pathname; // e.g. /mcp
  const origin = new URL(ctx.config.mcpUrl).origin;
  const prmUrl = `${origin}/.well-known/oauth-protected-resource${resourcePath}`;

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "last-event-id"],
      exposeHeaders: ["www-authenticate", "mcp-session-id"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    }),
  );

  // RFC 9728 protected resource metadata: tells MCP clients where to get a token.
  const prm = (c: { json: (b: unknown) => Response }) =>
    c.json({
      resource: ctx.config.mcpUrl,
      authorization_servers: [ctx.config.issuer],
      scopes_supported: ["memory:read", "memory:write", "memory:read:private", "memory:read:special"],
      bearer_methods_supported: ["header"],
      resource_name: "Maestro",
      resource_documentation: `${ctx.config.issuer}/tools`,
    });
  app.get("/.well-known/oauth-protected-resource", prm);
  app.get(`/.well-known/oauth-protected-resource${resourcePath}`, prm);
  app.get("/health", (c) => c.json({ ok: true }));

  app.all(resourcePath, async (c) => {
    const auth = await authenticate(ctx, c.req.header("authorization"));
    if (!auth) {
      return c.json({ error: "invalid_token", error_description: "Connect Maestro to get access." }, 401, {
        "WWW-Authenticate": `Bearer resource_metadata="${prmUrl}", scope="memory:read memory:write"`,
      });
    }
    if (!limiter.allow(auth.grantId)) return c.json({ error: "rate_limited" }, 429, { "retry-after": "60" });

    // Stateless Streamable HTTP: a fresh server + transport per request.
    const server = buildServer(ctx, auth);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });

  app.onError((err, c) => {
    console.error("[mcp]", err);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
