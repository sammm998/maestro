/**
 * Recall evals (plan §8). Seeds synthetic users, runs each query through the
 * same recall/get_context code the MCP tools use, and reports:
 *   recall@5, MRR, precision@k (k = #expected), stale rate (forbidden or
 *   superseded memories in top 5) and get_context latency p50/p95.
 *
 *   pnpm evals                 # offline (hash embedder), used in CI
 *   EMBEDDING_PROVIDER=mistral pnpm evals   # with real embeddings
 *   pnpm evals -- --user alva --verbose
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { users, eq, withUser } from "@maestro/db";
import { setupTestDb } from "@maestro/db/testing";
import { createEmbedder, MockLLM } from "@maestro/llm";
import { getContext, recall, type CoreDeps } from "@maestro/core";
import { loadFixtures } from "./fixtures";
import { seedFixture } from "./seed";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const verbose = flag("verbose");
const here = path.dirname(fileURLToPath(import.meta.url));

const NOW = new Date("2026-11-12T12:00:00Z");
const t = await setupTestDb();
const embedder = createEmbedder(process.env.EMBEDDING_PROVIDER ? process.env : { EMBEDDING_PROVIDER: "hash" });
const deps: CoreDeps = { db: t.app.db, llm: new MockLLM(), embedder, now: () => NOW };

interface Row {
  user: string;
  q: string;
  recallAt5: number;
  rr: number;
  precisionAtK: number;
  stale: boolean;
  ms: number;
  top: string[];
}
const rows: Row[] = [];

for (const fx of loadFixtures(opt("user"))) {
  const [u] = await t.admin.db.insert(users).values({ email: `eval-${fx.user}-${crypto.randomUUID()}@evals.local` }).returning();
  try {
    const ids = await seedFixture(t.app.db, embedder, u!.id, fx, NOW);
    const labelOf = new Map([...ids].map(([l, id]) => [id, l]));
    const superseded = new Set(fx.memories.filter((m) => m.status === "superseded").map((m) => m.label));

    for (const q of fx.queries) {
      const hits = await withUser(t.app.db, u!.id, (tx) => recall(deps, tx, u!.id, { query: q.q, limit: 5 }));
      const top = hits.map((h) => labelOf.get(h.memory.id) ?? "?");
      const found = q.expect.filter((l) => top.includes(l));
      const firstRank = top.findIndex((l) => q.expect.includes(l));
      const k = q.expect.length;
      const forbidden = new Set([...(q.forbid ?? []), ...superseded]);

      const started = performance.now();
      await withUser(t.app.db, u!.id, (tx) => getContext(deps, tx, u!.id, { task: q.q }));
      const ms = performance.now() - started;

      rows.push({
        user: fx.user,
        q: q.q,
        recallAt5: found.length / k,
        rr: firstRank >= 0 ? 1 / (firstRank + 1) : 0,
        precisionAtK: top.slice(0, k).filter((l) => q.expect.includes(l)).length / k,
        stale: top.some((l) => forbidden.has(l)),
        ms,
        top,
      });
      if (verbose || found.length < k) {
        const mark = found.length === k ? "✓" : "✗";
        console.log(`${mark} [${fx.user}] ${q.q}\n    expected ${q.expect.join(", ")}  got ${top.join(", ")}`);
      }
    }
  } finally {
    await t.admin.db.delete(users).where(eq(users.id, u!.id));
  }
}
await t.close();

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const summary = {
  embedder: embedder.model,
  queries: rows.length,
  recallAt5: avg(rows.map((r) => r.recallAt5)),
  mrr: avg(rows.map((r) => r.rr)),
  precisionAtK: avg(rows.map((r) => r.precisionAtK)),
  staleRate: avg(rows.map((r) => (r.stale ? 1 : 0))),
  getContextP50Ms: pct(rows.map((r) => r.ms), 50),
  getContextP95Ms: pct(rows.map((r) => r.ms), 95),
};

console.log("\nRecall eval");
console.table(
  Object.fromEntries(
    [...new Set(rows.map((r) => r.user))].map((u) => {
      const rs = rows.filter((r) => r.user === u);
      return [u, { "recall@5": avg(rs.map((r) => r.recallAt5)).toFixed(2), mrr: avg(rs.map((r) => r.rr)).toFixed(2), stale: rs.filter((r) => r.stale).length }];
    }),
  ),
);
console.log(
  `embedder=${summary.embedder} queries=${summary.queries}  recall@5=${summary.recallAt5.toFixed(3)}  MRR=${summary.mrr.toFixed(3)}  ` +
    `precision@k=${summary.precisionAtK.toFixed(3)}  stale=${(summary.staleRate * 100).toFixed(1)}%  ` +
    `get_context p50=${summary.getContextP50Ms.toFixed(0)}ms p95=${summary.getContextP95Ms.toFixed(0)}ms`,
);

mkdirSync(path.join(here, "../results"), { recursive: true });
writeFileSync(path.join(here, `../results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ summary, rows }, null, 2));

const th = JSON.parse(readFileSync(path.join(here, "../thresholds.json"), "utf8")) as Record<string, number>;
const failures = [
  summary.recallAt5 < th.recallAt5! && `recall@5 ${summary.recallAt5.toFixed(3)} < ${th.recallAt5}`,
  summary.mrr < th.mrr! && `MRR ${summary.mrr.toFixed(3)} < ${th.mrr}`,
  summary.staleRate > th.staleRate! && `stale rate ${summary.staleRate} > ${th.staleRate}`,
  summary.getContextP95Ms > th.getContextP95Ms! && `get_context p95 ${summary.getContextP95Ms.toFixed(0)}ms > ${th.getContextP95Ms}ms`,
].filter(Boolean);
if (failures.length && !flag("no-fail")) {
  console.error(`\nEval thresholds not met:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
