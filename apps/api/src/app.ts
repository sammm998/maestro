import { Hono } from "hono";
import { logger } from "hono/logger";
import { authRoutes, requireUser } from "./auth";
import type { AppContext, Env } from "./context";
import { accountRoutes } from "./routes/account";
import { importRoutes } from "./routes/imports";
import { memoryRoutes } from "./routes/memories";
import { toolRoutes } from "./routes/tools";
import { oauthConsentRoutes, oauthPublicRoutes } from "./oauth";

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();
  if (process.env.NODE_ENV !== "test") app.use(logger());

  // CSRF: state-changing browser requests must come from our own origin.
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && origin !== ctx.config.publicUrl) return c.json({ error: "bad_origin" }, 403);
    }
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", oauthPublicRoutes(ctx));
  app.route("/api/auth", authRoutes(ctx));

  const api = new Hono<Env>();
  api.use("*", requireUser(ctx));
  api.route("/", memoryRoutes(ctx));
  api.route("/", importRoutes(ctx));
  api.route("/", accountRoutes(ctx));
  api.route("/", toolRoutes(ctx));
  api.route("/", oauthConsentRoutes(ctx));
  app.route("/api", api);

  app.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
