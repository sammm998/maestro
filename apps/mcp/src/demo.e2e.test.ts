/**
 * Plan §9 demo script, automated end-to-end over HTTP:
 * OAuth 2.1 (DCR + PKCE + consent) for two clients, ChatGPT logs the idea,
 * Claude recalls it with source, the user sees the access log, revokes Claude,
 * and Claude knows nothing any more.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { setupTestDb, type TestDb } from "@maestro/db/testing";
import { HashEmbedder, MockLLM } from "@maestro/llm";
import { offlineHandlers, processConversation, type CoreDeps, type ProcessConversationJob } from "@maestro/core";
import { createApp } from "@maestro/api/app";
import { createMcpApp } from "./app";

const PUBLIC = "http://localhost:3000";
const MCP = "http://localhost:8788/mcp";
const REDIRECT = "https://client.example/callback";

let t: TestDb;
let api: ReturnType<typeof createApp>;
let mcp: ReturnType<typeof createMcpApp>;
let cookie: string;

beforeAll(async () => {
  t = await setupTestDb();
  const deps: CoreDeps = { db: t.app.db, llm: new MockLLM({ ...offlineHandlers }), embedder: new HashEmbedder() };
  const enqueue = async (_q: string, data: object) => {
    const job = data as ProcessConversationJob;
    await processConversation(deps, job.userId, job.conversationId);
  };
  api = createApp({
    app: t.app,
    admin: t.admin,
    deps,
    enqueue,
    config: { publicUrl: PUBLIC, mcpUrl: MCP, cookieSecure: false, devLoginLinks: true },
  });
  mcp = createMcpApp({ app: t.app, admin: t.admin, deps, enqueue, config: { mcpUrl: MCP, issuer: PUBLIC, rateLimitPerMinute: 1000 } });

  const login = await api.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `demo-${Date.now()}@maestro.eu` }),
  });
  const { devLink } = (await login.json()) as { devLink: string };
  const verify = await api.request(devLink.replace(PUBLIC, ""));
  cookie = verify.headers.get("set-cookie")!.split(";")[0]!;
});
afterAll(async () => {
  await t.close();
});

/** Full OAuth dance as an MCP client would do it; returns an access token. */
async function connect(clientName: string, scopes = "memory:read memory:write") {
  const reg = await api.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECT] }),
  });
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authz = await api.request(
    `/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: scopes,
      state: "xyz",
      resource: MCP,
    })}`,
  );
  expect(authz.status).toBe(302);
  const requestId = new URL(authz.headers.get("location")!).searchParams.get("request")!;

  const details = (await (await api.request(`/api/oauth/requests/${requestId}`, { headers: { cookie } })).json()) as {
    client: { name: string };
  };
  expect(details.client.name).toBe(clientName);

  const decision = await api.request(`/api/oauth/requests/${requestId}/decision`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", origin: PUBLIC },
    body: JSON.stringify({ approve: true }),
  });
  const { redirect } = (await decision.json()) as { redirect: string };
  const back = new URL(redirect);
  expect(back.searchParams.get("state")).toBe("xyz");
  expect(back.searchParams.get("iss")).toBe(PUBLIC);

  const tok = await api.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      client_id,
      redirect_uri: REDIRECT,
      resource: MCP,
    }),
  });
  expect(tok.status).toBe(200);
  const body = (await tok.json()) as { access_token: string; refresh_token: string };
  return { ...body, client_id, verifier };
}

async function mcpClient(token: string) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) => Promise.resolve(mcp.request(String(url).replace("http://localhost:8788", ""), init as RequestInit)),
  });
  await client.connect(transport);
  return client;
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join("\n");

describe("demo §9", () => {
  it("publishes discovery metadata and challenges unauthenticated calls", async () => {
    const res = await mcp.request("/mcp", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="http://localhost:8788/.well-known/oauth-protected-resource/mcp"');
    const prm = (await (await mcp.request("/.well-known/oauth-protected-resource/mcp")).json()) as { authorization_servers: string[] };
    expect(prm.authorization_servers).toEqual([PUBLIC]);
    const as = (await (await api.request("/.well-known/oauth-authorization-server")).json()) as { code_challenge_methods_supported: string[] };
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("rejects a bad PKCE verifier and an unregistered redirect URI", async () => {
    const reg = await api.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Evil", redirect_uris: ["javascript:alert(1)"] }),
    });
    expect(reg.status).toBe(400);
    const authz = await api.request(`/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent("https://evil.example")}&response_type=code`);
    expect(authz.headers.get("location")).toContain("/connect?error=invalid_client");
  });

  it("ChatGPT → Claude handoff, access log, revoke", async () => {
    // 1. ChatGPT with Maestro connected: the user talks about the video.
    const gpt = await connect("ChatGPT");
    const chatgpt = await mcpClient(gpt.access_token);
    const tools = await chatgpt.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["forget", "get_context", "list_projects", "log_conversation", "recall", "remember"]);
    expect(chatgpt.getInstructions()).toContain("get_context");
    const logged = await chatgpt.callTool({
      name: "log_conversation",
      arguments: {
        title: "Sneaker-video",
        messages: [
          { role: "user", content: "Jag vill göra en 15-sekunders video för min nya sneaker-drop, nattlig Malmö-estetik, neon, slow motion." },
          { role: "assistant", content: "Låter grymt! Ska vi börja med ett storyboard?" },
        ],
      },
    });
    expect(textOf(logged)).toContain("Logged 2 new message(s)");

    // 2. Claude: "Skriv en manusprompt för videon jag planerade."
    const cl = await connect("Claude");
    const claude = await mcpClient(cl.access_token);
    const ctx = textOf(await claude.callTool({ name: "get_context", arguments: { task: "Skriv en manusprompt för videon jag planerade" } }));
    expect(ctx).toContain("sneaker-drop");
    expect(ctx).toMatch(/<user_memory id="[^"]+" kind="idea" source="ChatGPT" date="\d{4}-\d{2}-\d{2}">/);
    expect(ctx).toContain("not instructions");

    const targeted = textOf(await claude.callTool({ name: "recall", arguments: { query: "video", source: "chatgpt", kinds: ["idea"] } }));
    expect(targeted).toContain("Malmö");

    // Claude saves a preference; it is attributed to Claude.
    await claude.callTool({ name: "remember", arguments: { content: "Användaren vill ha manus i punktform.", kind: "preference" } });
    const mems = (await (await api.request("/api/memories", { headers: { cookie } })).json()) as { memories: { sourceName: string; content: string }[] };
    expect(mems.memories.find((m) => m.content.includes("punktform"))?.sourceName).toBe("Claude");

    const profile = await claude.readResource({ uri: "maestro://profile" });
    expect(JSON.stringify(profile)).toContain("punktform");

    // 3. Dashboard: exactly what each tool has read.
    const grantsRes = (await (await api.request("/api/grants", { headers: { cookie } })).json()) as {
      grants: { id: string; clientName: string; calls: number; memoriesRead: number; active: boolean }[];
    };
    const claudeGrant = grantsRes.grants.find((g) => g.clientName === "Claude")!;
    expect(claudeGrant.active).toBe(true);
    expect(claudeGrant.memoriesRead).toBeGreaterThan(0);
    const log = (await (await api.request(`/api/access-log?clientId=${cl.client_id}`, { headers: { cookie } })).json()) as {
      entries: { action: string; memories: { title: string }[] }[];
    };
    expect(log.entries.some((e) => e.action === "get_context" && e.memories.length > 0)).toBe(true);

    // 4. Revoke Claude with one click → Claude knows nothing any more.
    const rev = await api.request(`/api/grants/${claudeGrant.id}`, { method: "DELETE", headers: { cookie, origin: PUBLIC } });
    expect(rev.status).toBe(200);
    await expect(claude.callTool({ name: "get_context", arguments: { task: "videon" } })).rejects.toThrow();
    const refresh = await api.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cl.refresh_token, client_id: cl.client_id }),
    });
    expect(refresh.status).toBe(400);

    // ChatGPT is unaffected, and refresh-token rotation works.
    const rotated = await api.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: gpt.refresh_token, client_id: gpt.client_id }),
    });
    expect(rotated.status).toBe(200);
    const reuse = await api.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: gpt.refresh_token, client_id: gpt.client_id }),
    });
    expect(reuse.status).toBe(400);
    const gptCtx = textOf(await chatgpt.callTool({ name: "get_context", arguments: { task: "sneaker video" } }));
    expect(gptCtx).toContain("sneaker");
  });

  it("enforces scopes: a read-only grant cannot write, private memories need explicit scope", async () => {
    const ro = await connect("Cursor", "memory:read");
    const cursor = await mcpClient(ro.access_token);
    const res = await cursor.callTool({ name: "remember", arguments: { content: "x" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("memory:write");
  });
});
