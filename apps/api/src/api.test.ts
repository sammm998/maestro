import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "@maestro/db/testing";
import { HashEmbedder, MockLLM } from "@maestro/llm";
import { markImportProgress, offlineHandlers, processConversation, type ProcessConversationJob } from "@maestro/core";
import { createApp } from "./app";
import type { AppContext } from "./context";

let t: TestDb;
let ctx: AppContext;
let app: ReturnType<typeof createApp>;
const PUBLIC = "http://localhost:3000";

beforeAll(async () => {
  t = await setupTestDb();
  const deps = { db: t.app.db, llm: new MockLLM({ ...offlineHandlers }), embedder: new HashEmbedder() };
  ctx = {
    app: t.app,
    admin: t.admin,
    deps,
    // Run jobs inline, as the worker would.
    enqueue: async (_q, data) => {
      const job = data as unknown as ProcessConversationJob;
      await processConversation(deps, job.userId, job.conversationId);
      if (job.importId) await markImportProgress(t.app.db, job.userId, job.importId);
    },
    config: { publicUrl: PUBLIC, mcpUrl: "http://localhost:8788/mcp", cookieSecure: false, devLoginLinks: true },
  };
  app = createApp(ctx);
});
afterAll(async () => {
  await t.close();
});

async function login(email: string): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PUBLIC },
    body: JSON.stringify({ email }),
  });
  const { devLink } = (await res.json()) as { devLink: string };
  const verify = await app.request(devLink.replace(PUBLIC, ""));
  expect(verify.status).toBe(302);
  const cookie = verify.headers.get("set-cookie")!;
  return cookie.split(";")[0]!;
}

describe("phase 1 flow over HTTP", () => {
  it("rejects unauthenticated requests and cross-origin writes", async () => {
    expect((await app.request("/api/memories")).status).toBe(401);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ email: "a@b.se" }),
    });
    expect(res.status).toBe(403);
  });

  it("login → upload ChatGPT export → see memories → edit → export → delete account", async () => {
    const cookie = await login(`user-${Date.now()}@example.eu`);
    const fixture = readFileSync(new URL("../../../packages/importers/src/__fixtures__/chatgpt-conversations.json", import.meta.url));
    const form = new FormData();
    form.set("file", new File([fixture], "conversations.json", { type: "application/json" }));
    const up = await app.request("/api/imports", { method: "POST", headers: { cookie, origin: PUBLIC }, body: form });
    expect(up.status).toBe(201);
    const upJson = (await up.json()) as { conversationsFound: number };
    expect(upJson.conversationsFound).toBe(1);

    const imps = (await (await app.request("/api/imports", { headers: { cookie } })).json()) as { imports: { status: string }[] };
    expect(imps.imports[0]!.status).toBe("done");

    const list = (await (await app.request("/api/memories", { headers: { cookie } })).json()) as {
      memories: { id: string; content: string; sourceName: string }[];
    };
    expect(list.memories.length).toBeGreaterThan(0);
    expect(list.memories[0]!.sourceName).toBe("ChatGPT");
    expect(list.memories.some((m) => m.content.includes("sneaker-drop"))).toBe(true);

    const id = list.memories[0]!.id;
    const patched = await app.request(`/api/memories/${id}`, {
      method: "PATCH",
      headers: { cookie, origin: PUBLIC, "content-type": "application/json" },
      body: JSON.stringify({ title: "Redigerad titel" }),
    });
    expect(((await patched.json()) as { memory: { title: string } }).memory.title).toBe("Redigerad titel");

    const search = (await (await app.request("/api/search?q=video%20neon", { headers: { cookie } })).json()) as {
      results: { title: string }[];
    };
    expect(search.results.length).toBeGreaterThan(0);

    const exp = (await (await app.request("/api/export", { headers: { cookie } })).json()) as { memories: unknown[]; format: string };
    expect(exp.format).toBe("maestro-export");
    expect(exp.memories.length).toBe(list.memories.length);
    expect(JSON.stringify(exp)).not.toContain("embedding\":[");

    const del = await app.request("/api/account", { method: "DELETE", headers: { cookie, origin: PUBLIC } });
    expect(del.status).toBe(200);
    expect((await app.request("/api/memories", { headers: { cookie } })).status).toBe(401);
  });
});
