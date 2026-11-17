# PlanRescue Spatial — Operational Runbook & Release Management
**Meta VR Start Developer Competition 2026 — Track: Productivity**
**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.

---

## 1. Production Deployment Procedure

### 1.1 Pre-Flight Deployment Checklist
Before deploying any release candidate to staging or production, execute and verify:
1. **Typechecks:**
   - Root: `npm run typecheck`
   - Web: `npm run typecheck:web`
   - VR: `npm run vr:typecheck`
2. **Automated Test Suites:**
   - Root: `npm run test:unit`
   - Web: `npm run test:web:unit`
   - VR: `npm run vr:test`
   - Real Backend Integration: `npx vitest run tests/realBackendIntegration.test.ts`
   - Backup/Restore Verification: `npx vitest run tests/backupRestore.test.ts`
3. **Production Builds:**
   - Web: `npm run build:web`
   - VR: `npm run vr:build`
   - MCP Server: `npm run build`
4. **Environment Secrets:**
   - Verify `ENCRYPTION_SECRET` is set with minimum 32 characters of high-entropy random data.
   - Verify `SESSION_SECRET` is set with minimum 32 characters.
   - Verify default placeholder keys are NOT present.

---

## 2. Process Orchestration & Services Architecture

PlanRescue Spatial runs with three cooperating service processes:

| Service | Port | Production Command | Health Check Probe |
|---|---|---|---|
| **PlanRescue MCP Server** | `:3001` | `npm run start:mcp` | `GET http://127.0.0.1:3001/mcp` (SSE / JSON-RPC handshake) |
| **Next.js Web / BFF** | `:3000` | `npm run start:web` | `GET http://127.0.0.1:3000/api/healthz?probe=readiness` |
| **Vite Spatial VR Static Bundle** | `:5173` (or CDN) | `npm run vr:preview` (or static S3/GCS host) | `GET /index.html` (returns 200 OK) |

---

## 3. Health Probes & Monitoring

### 3.1 Kubernetes / Container Liveness & Readiness
- **Liveness Probe**:
  ```http
  GET /api/healthz?probe=liveness
  ```
  Returns `200 OK` with `{ status: "alive", uptimeSeconds: N, timestamp: "..." }`.
  Trigger: Process crash, event loop deadlock.

- **Readiness Probe**:
  ```http
  GET /api/healthz?probe=readiness
  ```
  Returns `200 OK` when SQLite database connection is live, WAL mode is active, and server config is valid:
  ```json
  {
    "ok": true,
    "data": {
      "status": "ready",
      "checks": {
        "database": "ready",
        "walMode": "wal",
        "mcpConfig": "ok"
      },
      "uptimeSeconds": 1420,
      "timestamp": "2026-11-17T08:00:00.000Z",
      "version": "0.1.0"
    }
  }
  ```
  If SQLite is locked or unreachable, returns `503 Service Unavailable`.

### 3.2 Key Operational Metrics & Alert Thresholds
- **WebXR Frame Budget**: Warning if frame delta > 13.88ms (< 72 FPS on Quest 2/3).
- **Draw Calls**: Alert if WebGL draw calls exceed 80 calls/frame in VR studio.
- **MCP Tool Latency**: Alert if `propose_recovery_plan` or `validate_recovery_plan` exceeds 500ms (standard execution is < 15ms).
- **Outbox Pending Queue**: Alert if `external_sync_outbox` has pending records older than 15 minutes.

---

## 4. Database Maintenance & Backup Operations

### 4.1 Automated Online Backup
SQLite WAL mode allows zero-downtime, non-blocking backups:
```bash
npm run db:backup
# Or explicitly targeting a database:
tsx scripts/backup-db.ts data/planrescue.sqlite
tsx scripts/backup-db.ts data/planrescue-auth.sqlite
```
- Forces a `PRAGMA wal_checkpoint(TRUNCATE)` to ensure 100% of committed state is in the main database file.
- Copies the database atomically to `data/backups/`.
- Computes SHA-256 checksum and generates a `.manifest.json`.

### 4.2 Disaster Recovery & Database Restoration
To restore a database from an verified backup:
```bash
npm run db:restore data/backups/planrescue-2026-11-17T08-00-00-000Z.sqlite data/planrescue.sqlite
```
- Validates the backup file against its SHA-256 manifest.
- Replaces the target database file.
- Executes `PRAGMA integrity_check` to verify zero file corruption before accepting connections.

---

## 5. Rollback Procedures

### 5.1 Immediate Web / VR Client Rollback
1. Revert Git tag/commit to previously verified release.
2. Run `npm run build:web && npm run vr:build`.
3. Restart PM2 / systemd / container tasks.
4. Verify `/api/healthz?probe=readiness` returns 200 OK.

### 5.2 Database Rollback
If a faulty migration or operational defect occurred:
1. Stop incoming API traffic (route proxy to maintenance page).
2. Execute `npm run db:restore data/backups/<pre-deployment-backup>.sqlite data/planrescue.sqlite`.
3. Restart MCP server and web BFF.
4. Verify `/api/healthz` readiness.
5. Re-enable traffic.
