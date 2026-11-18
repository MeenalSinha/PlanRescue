import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // apps/web is its own npm package (the repo root has a separate lockfile); pin the build root here.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
  poweredByHeader: false,
  // The MCP client and SQLite are Node-only packages used from route handlers; keep them out of the bundle.
  serverExternalPackages: ['@modelcontextprotocol/client', 'better-sqlite3'],
  experimental: {
    // Disable automatic agent upgrade prompts during CI builds
    agentUpgrade: false,
  },
  // Defence in depth for the browser: no framing, no sniffing, no referrer leakage, WebXR permissions.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'xr-spatial-tracking=(self), camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
