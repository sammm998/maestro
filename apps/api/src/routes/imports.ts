import { Hono } from "hono";
import { listImports, runImport } from "@maestro/core";
import { ImportFormatError, parseExport, type ExportKind } from "@maestro/importers";
import type { AppContext, Env } from "../context";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function importRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  r.post("/imports", async (c) => {
    const form = await c.req.formData().catch(() => undefined);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "file_too_large" }, 413);
    const kindParam = form?.get("kind");
    const kind = kindParam === "chatgpt" || kindParam === "claude" ? (kindParam as ExportKind) : undefined;
    let parsed;
    try {
      parsed = parseExport(new Uint8Array(await file.arrayBuffer()), kind);
    } catch (err) {
      if (err instanceof ImportFormatError) return c.json({ error: "invalid_format", message: err.message }, 400);
      throw err;
    }
    const imp = await runImport(ctx.app.db, ctx.enqueue, c.get("userId"), {
      kind: parsed.kind,
      filename: file.name,
      conversations: parsed.conversations,
    });
    return c.json({ import: imp, conversationsFound: parsed.conversations.length }, 201);
  });

  r.get("/imports", async (c) => c.json({ imports: await listImports(ctx.app.db, c.get("userId")) }));

  return r;
}
