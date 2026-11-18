#!/bin/sh
set -e

echo "[PlanRescue] Starting PlanRescue MCP Server on port 3001..."
MCP_HOST="127.0.0.1" MCP_PORT="3001" DATABASE_PATH="${DATABASE_PATH:-/app/data/planrescue.sqlite}" SEED_SAMPLE_DATA="true" node dist/index.js &
MCP_PID=$!

echo "[PlanRescue] Waiting for MCP Server health..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:3001/healthz > /dev/null 2>&1; then
    echo "[PlanRescue] MCP Server is healthy and listening on port 3001"
    break
  fi
  sleep 0.2
done

echo "[PlanRescue] Starting Next.js Web API on port ${PORT:-8080}..."
cd /app/apps/web
exec npx next start --hostname 0.0.0.0 --port "${PORT:-8080}"
