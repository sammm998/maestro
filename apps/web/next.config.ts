import type { NextConfig } from "next";

const api = process.env.API_INTERNAL_URL ?? "http://localhost:8787";

// The dashboard is the single public origin: /api, /oauth and /.well-known are
// proxied to apps/api so session cookies stay first-party.
const config: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/oauth/:path*", destination: `${api}/oauth/:path*` },
      { source: "/.well-known/:path*", destination: `${api}/.well-known/:path*` },
    ];
  },
};
export default config;
