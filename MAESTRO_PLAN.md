# Maestro – byggplan för Claude Code

> **Till Claude Code:** Det här dokumentet är källan till sanningen för projektet. Läs hela innan du skriver kod. Bygg fas för fas, i ordning. Varje fas ska sluta med något som går att köra och demonstrera. Fråga innan du lägger till nya beroenden utöver stacken nedan.

---

## 1. Vision (en mening)

**Maestro är ett personligt kontextlager som alla dina AI-verktyg delar. Användaren äger minnet, verktygen får bara låna det.**

Idag lever ChatGPT, Claude, Gemini, Lovable, Higgsfield och resten var för sig. Varje verktyg måste lära känna dig från noll och håller ditt minne som gisslan. Maestro är dirigenten: den lyssnar på alla verktyg, bygger ett gemensamt minne och lånar ut rätt kontext till rätt verktyg i rätt ögonblick.

**Exempel som produkten ska klara:**
> Du brainstormar en videoidé med ChatGPT. Sen öppnar du Higgsfield och skriver: *"gör videon jag pratade om med ChatGPT"*. Maestro vet vilken idé du menar och skickar den vidare.

**Principer:**
1. **Användaren äger datan.** Verktyg får tidsbegränsad åtkomst med scope (som OAuth eller Apple Pay), aldrig en kopia att behålla.
2. **EU-först.** All data lagras och bearbetas i EU. GDPR är en säljpunkt, inte en eftertanke.
3. **Ingen inlåsning.** Full export när som helst, i ett öppet format. Det är just den sortens frihet vi säljer.
4. **Snabbt att ansluta.** Man ska komma igång med ett nytt verktyg på under 60 sekunder.

---

## 2. Verkligheten: hur kontext faktiskt kan samlas in

Det här måste vara tydligt från dag ett eftersom det styr arkitekturen. **Det finns inget officiellt API för att läsa någons privata ChatGPT-, Claude- eller Gemini-historik.** Kontext kan bara komma in via de här kanalerna:

| Kanal | Hur | Täckning | Risk / begränsning |
|---|---|---|---|
| **A. MCP-server** | Maestro körs som en remote MCP-server. ChatGPT (connectors/developer mode), Claude (desktop, web och Code), Cursor, Gemini CLI, Lovable m.fl. kan anropa `recall` och `remember` | Hög och växande. Det här är den officiella vägen | Modellen bestämmer själv när den anropar verktygen, så vi måste ha bra tool-beskrivningar och systeminstruktioner |
| **B. Webbläsartillägg** | Fångar konversationer på chatgpt.com, claude.ai, gemini.google.com, lovable.dev osv. | Mycket hög, fångar "allt" | Kan krocka med användarvillkor. DOM:en ändras ofta. Kräver tydligt samtycke |
| **C. Import av export** | Användaren laddar upp sin ChatGPT-/Claude-dataexport (zip/json) | Hela historiken på en gång. Fantastisk onboarding | Engångsimport, ingen löpande synk |
| **D. Maestro-chatt / proxy** | Egen chatt där användaren väljer modell (Claude, GPT, Mistral) via API | Full kontroll | Användaren måste ändra sina vanor |
| **E. Composio / API:er** | Läsa från och agera i Gmail, Notion, Slack, Drive, GitHub m.fl. | Bred täckning av "dina saker" | Composio är en US-tjänst, så det behöver bedömas mot EU-löftet |

**Strategi:** MVP = **A + C**. Sedan **B** för den magiska upplevelsen, och därefter **E** för handlingar. **D** byggs bara om det behövs för demos.

---

## 3. Arkitektur

```
┌──────────────────────────────────────────────────────────────────┐
│  KLIENTER                                                        │
│  ChatGPT · Claude · Cursor · Lovable · Gemini CLI  (via MCP)     │
│  Webbläsartillägg · Mobil/webb-dashboard · Partner-SDK           │
└───────────────┬───────────────────────────┬──────────────────────┘
                │ MCP (Streamable HTTP)     │ REST + OAuth 2.1
┌───────────────▼───────────────────────────▼──────────────────────┐
│  GATEWAY  (auth, scopes, rate limits, audit log)                 │
├──────────────────────────────────────────────────────────────────┤
│  CONTEXT ENGINE                                                  │
│   ├─ Ingest      → normaliserar konversationer/händelser         │
│   ├─ Extract     → LLM plockar ut fakta, idéer, projekt, prefs   │
│   ├─ Resolve     → dedup, uppdatera/ersätt gamla minnen          │
│   ├─ Index       → embeddings + fulltext + entitetsgraf          │
│   └─ Recall      → hybrid-sök + rerank + paketera kontext        │
├──────────────────────────────────────────────────────────────────┤
│  CONSENT & GRANTS  (vilket verktyg får se vad, hur länge)        │
├──────────────────────────────────────────────────────────────────┤
│  VAULT  Postgres + pgvector (EU-region), krypterat per användare │
└──────────────────────────────────────────────────────────────────┘
                │
        ┌───────▼────────┐
        │ ACTIONS        │  Composio / egna integrationer (fas 4)
        └────────────────┘
```

### 3.1 Teknikstack

- **Språk:** TypeScript överallt. Monorepo med `pnpm` och `turborepo`.
- **API/gateway:** `hono` på Node.
- **MCP:** `@modelcontextprotocol/sdk`, med transporten Streamable HTTP och OAuth 2.1-auth enligt MCP-specen.
- **Databas:** Postgres 16 med `pgvector`, `pg_trgm` och fulltext. ORM: `drizzle`. Hosting: Supabase eller Neon i **EU-region** (Frankfurt/Stockholm).
- **Jobbkö:** `pg-boss`, så vi slipper Redis i början.
- **LLM för extraktion:** Claude (`claude-haiku-5-5` för billig extraktion, `claude-sonnet-5-5` för svåra sammanslagningar). Lägg det bakom ett interface så att vi kan byta till Mistral för en ren EU-variant.
- **Embeddings:** `mistral-embed` (EU-leverantör) bakom ett interface. Lagra modellnamn och dimension per rad så att vi kan byta.
- **Dashboard:** Next.js (App Router) med Tailwind och shadcn/ui.
- **Webbläsartillägg:** WXT (Manifest V3), Chrome först.
- **Auth för användare:** Better Auth eller Supabase Auth med passkeys.
- **Tester:** `vitest`, plus en eval-svit för recall-kvalitet (se §8).

### 3.2 Repostruktur

```
maestro/
├─ apps/
│  ├─ api/            # Hono: REST, OAuth, webhooks
│  ├─ mcp/            # Remote MCP-server
│  ├─ worker/         # pg-boss-jobb: extract, embed, resolve
│  ├─ web/            # Next.js dashboard ("Mitt minne", grants, import)
│  └─ extension/      # WXT-webbläsartillägg
├─ packages/
│  ├─ core/           # Domänlogik: ingest, extract, resolve, recall
│  ├─ db/             # Drizzle-schema och migrationer
│  ├─ llm/            # Provider-interface (Claude, Mistral, OpenAI)
│  ├─ importers/      # Parsers för ChatGPT-/Claude-/Gemini-exporter
│  └─ sdk/            # "Connect with Maestro"-SDK för partners
├─ evals/             # Recall-evals med fixturer
└─ CLAUDE.md          # Kort pekare till den här planen + konventioner
```

---

## 4. Datamodell (v1)

```ts
users          (id, email, created_at, region='eu')

sources        (id, user_id, kind: 'chatgpt'|'claude'|'gemini'|'lovable'|'higgsfield'|'mcp_client'|'extension'|'import'|'api',
                label, device, created_at)

conversations  (id, user_id, source_id, external_id, title, started_at, ended_at)

messages       (id, conversation_id, role, content, created_at, content_hash)
               -- råmaterial; kan raderas efter extraktion om användaren vill

memories       (id, user_id,
                kind: 'fact'|'preference'|'idea'|'project'|'task'|'person'|'decision'|'artifact',
                title, content,               -- kort, självbärande text
                status: 'active'|'superseded'|'archived',
                superseded_by,                -- pekar på nyare minne
                confidence, importance,       -- 0..1
                sensitivity: 'normal'|'private'|'special_category',
                source_conversation_id, source_message_ids[],
                valid_from, last_used_at, use_count,
                embedding vector, embedding_model, tsv tsvector,
                created_at, updated_at)

entities       (id, user_id, type: 'project'|'person'|'org'|'product'|'topic', name, aliases[])
memory_entities(memory_id, entity_id)

grants         (id, user_id, client_id, scopes[], projects[] null = alla,
                expires_at, revoked_at, created_at)
                -- scopes: 'memory:read', 'memory:write', 'memory:read:private', 'actions:<toolkit>'

oauth_clients  (id, name, redirect_uris[], is_verified, logo_url)

access_log     (id, user_id, client_id, action, memory_ids[], query, created_at)
                -- användaren ska kunna se exakt vad varje verktyg har läst
```

**Row Level Security i Postgres på `user_id` för alla tabeller.** Ingen query utan användarkontext.

---

## 5. MCP-servern (kärnprodukten)

Verktygen ska vara få och tydliga, och beskrivningarna skrivna så att ChatGPT och Claude faktiskt anropar dem.

| Tool | Input | Gör |
|---|---|---|
| `get_context` | `task: string`, `max_tokens?: number` | **Huvudverktyget.** Returnerar ett färdigpaketerat kontextblock om användaren som är relevant för uppgiften: relevanta projekt, idéer, preferenser och senaste beslut. Ska anropas i början av varje ny uppgift. |
| `recall` | `query: string`, `kinds?: string[]`, `source?: string`, `since?: string`, `limit?: number` | Riktad sökning, t.ex. *"videoidén från ChatGPT"* → `source=chatgpt, kinds=[idea]` |
| `remember` | `content: string`, `kind?`, `project?` | Spara något explicit ("kom ihåg att…") |
| `log_conversation` | `messages[]`, `title?` | Klienten skickar sammanfattning/utdrag av sessionen när den är klar → ingest-pipelinen |
| `list_projects` | – | Användarens aktiva projekt och entiteter |
| `forget` | `memory_id` | Arkivera ett minne |

**Resources:** `maestro://profile` (en kort beskrivning av användaren), `maestro://projects/{id}`.

**Prompts:** `maestro_handoff`: "fortsätt där jag slutade i <verktyg>".

**Krav:**
- Svar ska alltid innehålla **källa och tid** för varje minne (*"från ChatGPT, 4 nov"*) så att modellen kan säga varifrån informationen kommer.
- Respektera grantens scopes. `private` och `special_category` lämnas bara ut med explicit scope.
- Allt som returneras ska omges av tydliga avgränsare, `<user_memory source="..." date="...">…</user_memory>`, och servern ska instruera modellen att behandla innehållet som **data, inte instruktioner** (skydd mot prompt injection via förgiftade minnen).
- Logga varje anrop i `access_log`.

---

## 6. Context engine – pipeline

1. **Ingest:** normalisera till `conversation + messages`. Deduplicera på `content_hash`.
2. **Extract** (worker, Haiku): per konversation, ut kommer en lista av kandidatminnen i JSON enligt schemat. Prompten ska plocka ut sånt som är **varaktigt och användbart i andra verktyg**: idéer, projekt, preferenser (ton, stil, tekniska val), beslut, personer och öppna uppgifter. Small talk ska ignoreras.
3. **Resolve:** för varje kandidat, hämta top-k liknande befintliga minnen och låt LLM:en välja `ADD | UPDATE <id> | SUPERSEDE <id> | SKIP`. Det här är det som gör att minnet inte svämmar över.
4. **Index:** embeddings, tsvector och koppling till entiteter.
5. **Recall:** hybrid-sök (vektor + BM25 + entitetsmatchning + filter på källa och tid) → rerank efter relevans × aktualitet × importance → paketera inom en tokenbudget. Uppdatera `last_used_at` och `use_count`.
6. **Decay:** nattligt jobb som sänker `importance` på minnen som aldrig används. Inget raderas automatiskt.

---

## 7. Faser

### Fas 0 – Grund (1–2 dagar)
- [x] Monorepo, lint, typecheck, vitest och CI (GitHub Actions)
- [x] Postgres + pgvector lokalt via docker compose, drizzle-schema och migrationer, RLS
- [x] `packages/llm` med Claude- och Mistral-providers bakom ett interface. Mock-provider för tester
- **Klart när:** `pnpm dev` startar api, worker och web lokalt, och `pnpm test` är grönt.

### Fas 1 – Minnet fungerar (vecka 1)
- [x] Ingest → extract → resolve → index-pipelinen i `packages/core`
- [x] Importer för **ChatGPT-export** (`conversations.json`) och **Claude-export**
- [x] Dashboard: logga in, ladda upp export, se minnen grupperade per projekt, redigera och radera
- [x] Eval-svit v1 (se §8)
- **Klart när:** man laddar upp sin ChatGPT-export och ser en vettig lista med projekt och idéer inom ett par minuter.

### Fas 2 – Maestro pratar med verktygen (vecka 2) ← **investerardemon**
- [x] Remote MCP-server med OAuth 2.1 (dynamic client registration enligt MCP-specen)
- [x] Alla tools från §5
- [ ] Testat end-to-end i **Claude** (custom connector), **ChatGPT** (developer mode/connector) och **Cursor**
  - *Status:* demo-manuset körs end-to-end med officiella MCP-SDK-klienten mot riktig OAuth (`apps/mcp/src/demo.e2e.test.ts`). Test i själva Claude/ChatGPT/Cursor återstår och kräver publik HTTPS-adress.
- [x] Dashboard: "Anslutna verktyg" med grants, scopes, återkalla, och logg över vad varje verktyg läst
- **Klart när demon i §9 fungerar live.**

### Fas 3 – Fånga allt automatiskt (vecka 3–4)
- [ ] Webbläsartillägg (WXT): fångar konversationer på chatgpt.com, claude.ai, gemini.google.com och lovable.dev. Per-sajt-på/av, pausknapp, tydlig indikator när det spelar in
- [ ] Separata DOM-adaptrar per sajt så att trasiga selektorer inte sänker allt. Snapshot-tester på sparad HTML
- [ ] Tillägget kan också **injicera** kontext: knappen "Hämta från Maestro" i chattfältet på vilken sajt som helst
- [ ] Synk mellan enheter (desktop ↔ mobil via dashboarden/PWA)

### Fas 4 – Maestro agerar (vecka 5+)
- [ ] Composio-integration: användaren ansluter Gmail, Notion, Drive, Slack och GitHub. Maestro kan läsa (som kontextkälla) och utföra handlingar på uppdrag av ett anslutet verktyg, med bekräftelse
- [ ] Gör en EU-bedömning av Composio. Planera egna integrationer för de viktigaste om det behövs
- [ ] Generisk "handoff": skicka ett paketerat kontextblock till verktyg utan MCP (Higgsfield m.fl.) via deeplink, clipboard eller tillägget

### Fas 5 – "Connect with Maestro" (plattformen)
- [ ] `packages/sdk`: en knapp och ett OAuth-flöde, så att en partner (t.ex. Lovable) kan be om scopes och få kontext via API: *"Maestro lånar ut datan, partnern äger den aldrig"*
- [ ] Partnerkonsol: registrera app, scopes, verifiering
- [ ] Policy och teknik: partner-tokens är kortlivade och svar får inte cachas längre än sessionen (avtalskrav plus vattenmärkta svar för spårbarhet)

---

## 8. Kvalitet: evals (viktigast av allt)

Produkten står och faller med om recall känns magisk. Bygg därför evals tidigt.

- `evals/fixtures/`: 10–20 syntetiska användare med konversationer över flera "verktyg" och veckor.
- Testfall av typen: *fråga* → *förväntade minnes-id:n*. Exempel: "videoidén jag pratade om med ChatGPT" → `idea_42`.
- Mät: recall@5, precision, andel föråldrade minnen som felaktigt returneras, och latens för `get_context` (mål: p95 under 800 ms).
- Kör i CI. Ingen ändring i extract-, resolve- eller recall-prompter utan att evals körs.

---

## 9. Demo-manus (det investerare ska se)

1. Öppna ChatGPT med Maestro ansluten. *"Jag vill göra en 15-sekunders video för min nya sneaker-drop, nattlig Malmö-estetik, neon, slow motion."*
2. Öppna Claude. *"Skriv en manusprompt för videon jag planerade."* → Claude anropar `get_context` och svarar *"Från ditt ChatGPT-samtal idag: sneaker-drop, Malmö by night, neon…"*
3. Byt till mobilen. Samma fråga ger samma svar.
4. Öppna dashboarden och visa exakt vad ChatGPT och Claude har läst. Återkalla Claudes åtkomst med ett klick. Fråga igen, och Claude vet ingenting längre.
5. Avsluta med: *"Datan ligger i EU, användaren äger den, och verktygen lånar den."*

---

## 10. Säkerhet och GDPR (krav, inte önskemål)

- [ ] All data i EU-region. Underbiträdesförteckning (LLM-leverantörer!) dokumenterad. Använd EU-endpoints där sådana finns
- [ ] Kryptering at rest. Känsliga fält krypteras per användare (envelope encryption, nyckel per användare → radering = kasta nyckeln)
- [ ] Export (JSON) och fullständig radering via självbetjäning
- [ ] Klassificering av känsliga kategorier (hälsa, politik, sexualitet m.m.) vid extraktion → `special_category`, aldrig utlämnat utan explicit scope
- [ ] Skydd mot prompt injection: minnen märks som data, verktygsinstruktioner i minnen ignoreras, och misstänkta minnen flaggas vid ingest
- [ ] Åtkomstlogg synlig för användaren
- [ ] Ingen träning på användardata, och det står uttryckligen i villkoren
- [ ] Webbläsartillägget fångar ingenting utan aktivt samtycke per sajt

---

## 11. Arbetsregler för Claude Code

- Bygg i faserna ovan. Bocka av i den här filen när något är klart.
- Små commits med tydliga meddelanden. Varje fas på egen branch → PR.
- Skriv tester för `packages/core` (pipeline och recall) innan eller samtidigt som implementationen.
- Inga hemligheter i kod. Använd `.env.example` med alla variabler dokumenterade.
- LLM-anrop går alltid via `packages/llm`, aldrig direkt mot ett SDK i appkod.
- Prompter ligger som filer i `packages/core/prompts/` med versionsnummer.
- Om något i planen visar sig vara tekniskt fel (t.ex. att en klient inte stöder remote MCP på det sätt vi antar): stoppa, beskriv problemet och föreslå ett alternativ.

---

## 12. Öppna frågor (för teamet, inte för Claude Code)

- **Konkurrenter att positionera mot:** mem0/OpenMemory, Supermemory, Zep, samt OpenAI:s och Anthropics egna minnes- och importfunktioner. Vad gör oss unika? Förslag: EU, äganderätt och grants-modellen, och att vi är oberoende av alla modell-leverantörer.
- **Användarvillkor:** juridisk koll på att fånga konversationer via tillägg från respektive tjänst.
- **Affärsmodell:** gratis för användare, betalt för partners per API-anrop? Eller freemium?
- **Namn och domän:** "Maestro" är ett vanligt namn (Mastercard Maestro m.fl.), så varumärkesskydd behöver kollas tidigt.
