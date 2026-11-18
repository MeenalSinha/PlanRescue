FROM node:22-bookworm-slim
WORKDIR /app

# Install native compilation tools for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json tsconfig*.json ./
COPY apps/web/package*.json ./apps/web/

# Install root and web dependencies
RUN npm install
RUN npm --prefix apps/web install --legacy-peer-deps

# Copy all source files
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Set build-time environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV ENCRYPTION_SECRET=production-planrescue-spatial-cloudrun-secret-2026-secure!
ENV SESSION_SECRET=production-planrescue-spatial-cloudrun-secret-2026-secure!
ENV PLANRESCUE_DEFAULT_DATE=2026-10-22

# Build MCP server and Next.js web application
RUN npm run build
RUN npm run build:web

# Prepare data directory
RUN mkdir -p /app/data

# Ensure entrypoint script has LF line endings and executable permission
RUN sed -i 's/\r$//' /app/scripts/docker-entrypoint.sh && chmod +x /app/scripts/docker-entrypoint.sh

ENV PORT=8080
ENV MCP_HOST=127.0.0.1
ENV MCP_PORT=3001
ENV PLANRESCUE_MCP_URL=http://127.0.0.1:3001/mcp
ENV DATABASE_PATH=/app/data/planrescue.sqlite
ENV SEED_SAMPLE_DATA=true

EXPOSE 8080

CMD ["/app/scripts/docker-entrypoint.sh"]
