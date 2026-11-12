-- Row Level Security (plan §4): user-data tables only show rows whose user_id
-- matches the transaction-local setting app.user_id (set by withUser()).
-- The table owner (migrator/admin) is not subject to RLS; the runtime role is.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sources','conversations','messages','memories','entities','memory_entities','grants','access_log','imports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY user_isolation ON %I
      USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Search indexes not expressible in drizzle schema.
CREATE INDEX IF NOT EXISTS memories_title_trgm_idx ON memories USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memories_content_trgm_idx ON memories USING gin (content gin_trgm_ops);
--> statement-breakpoint
-- ANN index per embedding dimension (vector column is untyped so models can change).
CREATE INDEX IF NOT EXISTS memories_embedding_1024_idx ON memories
  USING hnsw ((embedding::vector(1024)) vector_cosine_ops) WHERE embedding_dim = 1024;
--> statement-breakpoint
-- Runtime role grants (role is created by ops / packages/db/init).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maestro_app') THEN
    GRANT USAGE ON SCHEMA public TO maestro_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO maestro_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO maestro_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO maestro_app;
  END IF;
END $$;
