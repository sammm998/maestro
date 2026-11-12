-- Runs once when the local docker Postgres is created.
-- maestro      = owner/migrator (bypasses RLS as table owner)
-- maestro_app  = runtime role used by api/mcp/worker; RLS applies.
CREATE ROLE maestro_app LOGIN PASSWORD 'maestro_app' NOBYPASSRLS;
CREATE DATABASE maestro_test OWNER maestro;
GRANT CONNECT ON DATABASE maestro TO maestro_app;
GRANT CONNECT ON DATABASE maestro_test TO maestro_app;
