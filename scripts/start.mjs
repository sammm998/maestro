// Production entrypoint (Railway): bootstrap the database, then run web, api,
// mcp and worker in one container. If any process exits, exit so the platform
// restarts the whole service.
import { spawn, spawnSync } from "node:child_process";

const env = { ...process.env, NODE_ENV: "production" };
env.API_PORT ||= "8787";
env.MCP_PORT ||= "8788";
env.API_INTERNAL_URL ||= `http://127.0.0.1:${env.API_PORT}`;
env.MCP_INTERNAL_URL ||= `http://127.0.0.1:${env.MCP_PORT}`;

// Runtime role connection derived from the admin URL unless given explicitly.
if (!env.DATABASE_URL && env.DATABASE_ADMIN_URL && env.MAESTRO_APP_DB_PASSWORD) {
  const u = new URL(env.DATABASE_ADMIN_URL);
  u.username = "maestro_app";
  u.password = env.MAESTRO_APP_DB_PASSWORD;
  env.DATABASE_URL = u.toString();
}

const boot = spawnSync("pnpm", ["--filter", "@maestro/db", "bootstrap"], { env, stdio: "inherit" });
if (boot.status !== 0) process.exit(boot.status ?? 1);

const procs = [
  ["api", ["--filter", "@maestro/api", "start"]],
  ["mcp", ["--filter", "@maestro/mcp", "start"]],
  ["worker", ["--filter", "@maestro/worker", "start"]],
  ["web", ["--filter", "@maestro/web", "exec", "next", "start", "--port", env.PORT || "3000"]],
].map(([name, args]) => {
  const p = spawn("pnpm", args, { env, stdio: "inherit" });
  p.on("exit", (code) => {
    console.error(`[start] ${name} exited with ${code}; stopping`);
    for (const other of procs) if (other !== p) other.kill("SIGTERM");
    process.exit(code || 1);
  });
  return p;
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
