# Maestro

Personal context layer shared by all of a user's AI tools. **Source of truth: [MAESTRO_PLAN.md](MAESTRO_PLAN.md)** — read it first, build phase by phase, tick boxes there when done.

## Layout
- `packages/db` – drizzle schema (`src/schema.ts`), migrations (`drizzle/`), `withUser()` for RLS-scoped transactions.
- `packages/llm` – the only place LLM/embedding SDKs are imported (`createLLM`, `createEmbedder`, `MockLLM`, `HashEmbedder`).
- `packages/core` – ingest → extract → resolve → index → recall; prompts in `packages/core/prompts/<name>.<version>.md`.
- `packages/importers` – ChatGPT / Claude export parsers.
- `apps/api` (Hono, :8787), `apps/mcp` (remote MCP, :8788), `apps/worker` (pg-boss), `apps/web` (Next.js, :3000).
- `evals/` – recall evals; run `pnpm evals`.

## Conventions
- Every user-data query goes through `withUser(db, userId, tx => …)` on the runtime (`maestro_app`) connection. The admin connection is only for auth/OAuth lookups, migrations and cross-user maintenance jobs.
- LLM calls only via `@maestro/llm` (lint rule enforces it). New prompt behaviour = new prompt version file; run `pnpm evals` before and after.
- Memories handed to other tools are always wrapped in `<user_memory source=… date=…>` and treated as data, never instructions.
- No secrets in code; document every env var in `.env.example`.
- Tests: `pnpm test` (needs local Postgres, see README). Write tests for `packages/core` alongside changes.
