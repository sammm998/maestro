# Maestro

Ett personligt kontextlager som alla dina AI-verktyg delar. Användaren äger minnet, verktygen lånar det.
Källan till sanningen är [MAESTRO_PLAN.md](MAESTRO_PLAN.md).

## Kom igång lokalt

Krav: Node 22.12+, pnpm 10, Postgres 16 med pgvector.

```bash
docker compose up -d          # Postgres + pgvector, skapar roller och testdatabas
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev                      # web :3000, api :8787, mcp :8788, worker
```

Öppna http://localhost:3000, logga in med valfri e-post (i dev visas inloggningslänken direkt) och ladda upp en ChatGPT- eller Claude-export under **Importera**.

Utan API-nycklar körs allt offline: extraktionen använder enkla heuristiker (`packages/core/src/offline.ts`) och embeddings en deterministisk hash-embedder. För riktig kvalitet, sätt `ANTHROPIC_API_KEY` (extraktion med `claude-haiku-5-5`, sammanslagning med `claude-sonnet-5-5`) och `MISTRAL_API_KEY` (`mistral-embed`). Se `.env.example`.

## Kontroller

```bash
pnpm lint
pnpm typecheck
pnpm test        # kräver Postgres (maestro_test-databasen)
pnpm evals       # recall-evals, failar under trösklarna i evals/thresholds.json
```

## Ansluta ett AI-verktyg (MCP)

MCP-endpointen är `MCP_PUBLIC_URL` (lokalt `http://localhost:8788/mcp`). Claude och ChatGPT ansluter bara till publika HTTPS-adresser, så för att testa med dem behöver både dashboarden (OAuth-issuer) och MCP-servern ligga bakom HTTPS, t.ex. via en tunnel. Sätt då `PUBLIC_URL`, `MCP_PUBLIC_URL` och `NEXT_PUBLIC_MCP_URL` till de publika adresserna.

Flödet följer MCP-auktoriseringsspecen: 401 med `WWW-Authenticate` → protected resource metadata (RFC 9728) → auktoriseringsserverns metadata (RFC 8414) → dynamisk klientregistrering (RFC 7591) → authorization code + PKCE S256 → samtycke i dashboarden (`/connect`) → token bunden till MCP-resursen (RFC 8707).

## Demo (plan §9)

`apps/mcp/src/demo.e2e.test.ts` kör demo-manuset automatiskt: två klienter ("ChatGPT" och "Claude") ansluter via OAuth, ChatGPT loggar sneaker-idén, Claude hämtar den med `get_context` och ser källan, åtkomstloggen visar exakt vad Claude läste, och efter återkallning nekas Claude direkt.

## Arkitektur i korthet

- `packages/db` – schema, migrationer, RLS. Runtime-rollen `maestro_app` ser bara rader där `user_id = app.user_id` (satt per transaktion av `withUser`).
- `packages/core` – ingest → extract → resolve (ADD/UPDATE/SUPERSEDE/SKIP) → index → recall. Prompter versionerade i `packages/core/prompts/`.
- `apps/api` – dashboard-API, magisk-länk-inloggning, OAuth 2.1-server, import, export, kontoradering.
- `apps/mcp` – remote MCP-server (Streamable HTTP, stateless): `get_context`, `recall`, `remember`, `log_conversation`, `list_projects`, `forget`, resurserna `maestro://profile` och `maestro://projects/{id}`, prompten `maestro_handoff`.
- `apps/worker` – pg-boss: extraktion per konversation, nattlig decay.
- `apps/web` – Next.js-dashboard: Mitt minne, Importera, Anslutna verktyg, Data & integritet.
