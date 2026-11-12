/**
 * Maestro data model v1 (MAESTRO_PLAN.md §4).
 *
 * Two kinds of tables:
 *  - SYSTEM tables (users, auth, oauth): no RLS, only reached through the admin
 *    connection in narrowly scoped auth code paths.
 *  - USER-DATA tables: every row has user_id and Row Level Security is enabled
 *    (see drizzle/0002_rls.sql). Reached through `withUser()` only.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Untyped pgvector column: dimension is stored per row (embedding_dim) so models can be swapped. */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return JSON.parse(value) as number[];
  },
});

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const SOURCE_KINDS = [
  "chatgpt",
  "claude",
  "gemini",
  "lovable",
  "higgsfield",
  "cursor",
  "mcp_client",
  "extension",
  "import",
  "api",
  "maestro",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const MEMORY_KINDS = ["fact", "preference", "idea", "project", "task", "person", "decision", "artifact"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = ["active", "superseded", "archived"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const SENSITIVITIES = ["normal", "private", "special_category"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const ENTITY_TYPES = ["project", "person", "org", "product", "topic"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const SCOPES = ["memory:read", "memory:write", "memory:read:private", "memory:read:special"] as const;

// ───────────────────────────── SYSTEM TABLES ─────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  region: text("region").notNull().default("eu"),
  createdAt: createdAt(),
});

/** Dashboard login sessions (cookie holds the raw token, we store sha256). */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

/** One-time magic-link login tokens. */
export const loginTokens = pgTable("login_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  isVerified: boolean("is_verified").notNull().default(false),
  logoUrl: text("logo_url"),
  /** Dynamic client registration metadata (RFC 7591) as received. */
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/** Authorization requests waiting for the user's consent in the dashboard. */
export const oauthRequests = pgTable("oauth_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes").array().notNull(),
  state: text("state"),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantId: uuid("grant_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    clientId: text("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id").notNull(),
    resource: text("resource"),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_tokens_grant_idx").on(t.grantId)],
);

// ──────────────────────────── USER-DATA TABLES ────────────────────────────

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
    label: text("label").notNull(),
    device: text("device"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sources_user_kind_label_uq").on(t.userId, t.kind, t.label)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    /** pending → extracting → done | failed */
    extractStatus: text("extract_status").notNull().default("pending"),
    extractedAt: ts("extracted_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("conversations_source_external_uq").on(t.userId, t.sourceId, t.externalId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
    content: text("content").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: ts("created_at"),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [uniqueIndex("messages_conversation_hash_uq").on(t.conversationId, t.contentHash)],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    kind: text("kind", { enum: MEMORY_KINDS }).notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status", { enum: MEMORY_STATUSES }).notNull().default("active"),
    supersededBy: uuid("superseded_by"),
    confidence: real("confidence").notNull().default(0.8),
    importance: real("importance").notNull().default(0.5),
    sensitivity: text("sensitivity", { enum: SENSITIVITIES }).notNull().default("normal"),
    /** e.g. 'suspected_injection' — set at ingest, shown in dashboard. */
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    /** Denormalised so recall can filter/label without joins ("från ChatGPT, 4 nov"). */
    sourceKind: text("source_kind", { enum: SOURCE_KINDS }).notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceConversationId: uuid("source_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    sourceMessageIds: uuid("source_message_ids").array().notNull().default(sql`'{}'::uuid[]`),
    validFrom: ts("valid_from").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    useCount: integer("use_count").notNull().default(0),
    embedding: vector("embedding"),
    embeddingModel: text("embedding_model"),
    embeddingDim: integer("embedding_dim"),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("memories_user_status_idx").on(t.userId, t.status),
    index("memories_user_kind_idx").on(t.userId, t.kind),
    index("memories_tsv_idx").using("gin", t.tsv),
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    type: text("type", { enum: ENTITY_TYPES }).notNull(),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("entities_user_type_name_uq").on(t.userId, t.type, sql`lower(${t.name})`)],
);

export const memoryEntities = pgTable(
  "memory_entities",
  {
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    userId: userId(),
  },
  (t) => [primaryKey({ columns: [t.memoryId, t.entityId] }), index("memory_entities_entity_idx").on(t.entityId)],
);

export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull(),
    /** null = all projects; otherwise entity ids of type 'project'. */
    projects: uuid("projects").array(),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("grants_user_client_idx").on(t.userId, t.clientId)],
);

export const accessLog = pgTable(
  "access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    clientId: text("client_id"),
    action: text("action").notNull(),
    memoryIds: uuid("memory_ids").array().notNull().default(sql`'{}'::uuid[]`),
    query: text("query"),
    createdAt: createdAt(),
  },
  (t) => [index("access_log_user_created_idx").on(t.userId, t.createdAt)],
);

/** Uploaded export files and their processing progress (dashboard "Import"). */
export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userId(),
  kind: text("kind", { enum: ["chatgpt", "claude"] }).notNull(),
  filename: text("filename"),
  status: text("status", { enum: ["parsing", "processing", "done", "failed"] }).notNull().default("parsing"),
  conversationsTotal: integer("conversations_total").notNull().default(0),
  conversationsDone: integer("conversations_done").notNull().default(0),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: ts("finished_at"),
});

export type User = typeof users.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type Grant = typeof grants.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type AccessLogEntry = typeof accessLog.$inferSelect;
export type Import = typeof imports.$inferSelect;

/** Tables that carry user_id and get RLS. Keep in sync with drizzle/0002_rls.sql. */
export const RLS_TABLES = [
  "sources",
  "conversations",
  "messages",
  "memories",
  "entities",
  "memory_entities",
  "grants",
  "access_log",
  "imports",
] as const;
