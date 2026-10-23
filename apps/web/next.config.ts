import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // apps/web is its own npm package (the repo root has a separate lockfile); pin the build root here.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
  poweredByHeader: false,
  // The MCP client is a Node-only package used from route handlers; keep it out of the bundle.
  serverExternalPackages: ['@modelcontextprotocol/client'],
  // Defence in depth for the browser: no framing, no sniffing, no referrer leakage.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default config;
