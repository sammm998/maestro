import { Hono } from "hono";
import { z } from "zod";
import { MEMORY_KINDS, MEMORY_STATUSES, SENSITIVITIES, withUser } from "@maestro/db";
import {
  deleteMemory,
  formatMemory,
  getProjectContext,
  listEntities,
  listMemories,
  logAccess,
  recall,
  remember,
  sourceName,
  updateMemory,
  upsertSource,
} from "@maestro/core";
import type { AppContext, Env } from "../context";

const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(2000).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  importance: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(SENSITIVITIES).optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
  clearFlags: z.boolean().optional(),
});

export function memoryRoutes(ctx: AppContext) {
  const r = new Hono<Env>();
  const db = ctx.app.db;

  r.get("/memories", async (c) => {
    const status = c.req.query("status");
    const kind = c.req.query("kind");
    const rows = await withUser(db, c.get("userId"), (tx) =>
      listMemories(tx, c.get("userId"), {
        status: status === "all" || (MEMORY_STATUSES as readonly string[]).includes(status ?? "") ? (status as never) : "active",
        kind: (MEMORY_KINDS as readonly string[]).includes(kind ?? "") ? (kind as never) : undefined,
        q: c.req.query("q") || undefined,
        limit: Number(c.req.query("limit") ?? 500),
      }),
    );
    return c.json({ memories: rows.map((m) => ({ ...m, sourceName: sourceName(m) })) });
  });

  r.post("/memories", async (c) => {
    const body = z
      .object({ content: z.string().min(1).max(2000), kind: z.enum(MEMORY_KINDS).optional(), project: z.string().max(120).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body", details: body.error.issues }, 400);
    const userId = c.get("userId");
    const out = await withUser(db, userId, async (tx) => {
      const sourceId = await upsertSource(tx, userId, { kind: "maestro", label: "Maestro" });
      return remember(ctx.deps, tx, userId, body.data, { sourceId, sourceKind: "maestro", sourceLabel: "Maestro" });
    });
    return c.json(out, 201);
  });

  r.patch("/memories/:id", async (c) => {
    const body = Patch.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body", details: body.error.issues }, 400);
    const m = await withUser(db, c.get("userId"), (tx) => updateMemory(ctx.deps, tx, c.get("userId"), c.req.param("id"), body.data));
    return m ? c.json({ memory: m }) : c.json({ error: "not_found" }, 404);
  });

  r.delete("/memories/:id", async (c) => {
    const ok = await withUser(db, c.get("userId"), (tx) => deleteMemory(tx, c.get("userId"), c.req.param("id")));
    return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  r.get("/projects", async (c) => {
    const types = (c.req.query("types") ?? "project").split(",").filter(Boolean);
    const rows = await withUser(db, c.get("userId"), (tx) => listEntities(tx, c.get("userId"), types as never));
    return c.json({ projects: rows });
  });

  r.get("/projects/:id", async (c) => {
    const p = await withUser(db, c.get("userId"), (tx) => getProjectContext(tx, c.get("userId"), c.req.param("id")));
    return p ? c.json(p) : c.json({ error: "not_found" }, 404);
  });

  /** "Testa minnet": run the same recall the MCP tools use, from the dashboard. */
  r.get("/search", async (c) => {
    const q = c.req.query("q") ?? "";
    if (!q.trim()) return c.json({ results: [] });
    const userId = c.get("userId");
    const results = await withUser(db, userId, async (tx) => {
      const hits = await recall(ctx.deps, tx, userId, { query: q, limit: 10 });
      await logAccess(tx, { userId, clientId: null, action: "dashboard_search", memoryIds: hits.map((h) => h.memory.id), query: q });
      return hits;
    });
    return c.json({
      results: results.map((r) => ({
        id: r.memory.id,
        title: r.memory.title,
        content: r.memory.content,
        kind: r.memory.kind,
        sourceName: sourceName(r.memory),
        validFrom: r.memory.validFrom,
        score: r.score,
        signals: r.signals,
        formatted: formatMemory(r.memory),
      })),
    });
  });

  return r;
}
