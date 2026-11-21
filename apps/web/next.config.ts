import type { NextConfig } from "next";

const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8787";
const mcp = process.env.MCP_INTERNAL_URL ?? "http://127.0.0.1:8788";

// The dashboard is the single public origin: /api, /oauth and /.well-known go to
// apps/api (session cookies stay first-party); /mcp and its protected-resource
// metadata go to apps/mcp.
const config: NextConfig = {
  async rewrites() {
    return [
      { source: "/mcp", destination: `${mcp}/mcp` },
      { source: "/.well-known/oauth-protected-resource", destination: `${mcp}/.well-known/oauth-protected-resource` },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: `${mcp}/.well-known/oauth-protected-resource/:path*` },
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/oauth/:path*", destination: `${api}/oauth/:path*` },
      { source: "/.well-known/:path*", destination: `${api}/.well-known/:path*` },
    ];
  },
};
export default config;
