# PlanRescue architecture (Phase 0 to Phase 2)

This document describes what exists today and the seams left for later phases. Anything not listed under "Implemented" is planned and is not in the code. In particular there is no Recovery Engine, no agent or LLM, no approval workflow and no tool that modifies the calendar or tasks.

## Implemented

```
 MCP client (official SDK, or an Alexa+ agent later)
        |
        |  HTTP POST /mcp   (Streamable HTTP, MCP 2026-07-28 or 2025-11-25)
        v
 node:http server (http.ts)
   - Host and Origin guards (DNS rebinding protection)
   - GET /healthz  (operational, not MCP)
   - POST /mcp  -> toNodeHandler(createMcpHandler(factory))   <- official SDK handles the protocol
        |
        |  one McpServer per request (stateless)
        v
 buildPlanRescueServer (server.ts)
   - get_schedule (tools/getSchedule.ts)      - get_tasks (tools/getTasks.ts)
        |                                           |
        v                                           v
 ScheduleRepository (types.ts)              TaskRepository (types.ts)
   SqliteScheduleRepository                   SqliteTaskRepository
   (data/sqliteScheduleRepository.ts)         (data/sqliteTaskRepository.ts)
        \                                           /
         \__________  one better-sqlite3 connection  _____/
                              |
                              v
              SQLite file at DATABASE_PATH (db/database.ts)
                tables: calendar_events, tasks   (schema v1, WAL)
```

The tools know nothing about SQLite. They receive a repository interface and are registered by `server.ts`. `index.ts` is the only place that chooses the SQLite implementations.

### Startup and shutdown (index.ts)

1. `loadConfig()` reads and validates the environment, including `DATABASE_PATH` (resolved to an absolute path against the working directory; `:memory:` and `file:` URIs are rejected).
2. `initializeDatabase(path)` (`db/database.ts`): creates the directory, refuses a path that is a directory, opens the file, applies WAL, `synchronous = NORMAL`, `foreign_keys = ON` and `busy_timeout = 5000`, runs migrations, then seeds. Any failure becomes a `DatabaseInitError`, the file handle is released, and the process exits with code 1. There is no in-memory fallback.
3. The repositories are built from the one connection and passed to `startHttpServer`. `server.ts` registers both tools. A failure to listen closes the database before exiting.
4. Shutdown (SIGINT, SIGTERM, uncaught exception): `running.close()` drains HTTP first, then the database is closed, then "Shutdown complete" is logged. Closing last means no in-flight request can reach a closed connection, and SQLite checkpoints the WAL on close so no `-wal`/`-shm` files remain after a clean stop.

### Schema and migrations (db/migrations.ts)

The schema version is SQLite's `user_version`. Migrations are an append-only ordered list; each pending one runs in a transaction together with its version bump, so a failed migration leaves the previous version intact. Re-running on an up-to-date database does nothing. A database whose version is newer than the build supports is refused rather than modified.

Migration 1 creates two `STRICT` tables:

- `calendar_events`: `id`, `title`, `start_time`, `end_time`, `start_ms`, `end_ms`, `priority`, `movable`, `category`, `notes`; index on `(start_ms, end_ms)`; `CHECK (end_ms > start_ms)`.
- `tasks`: `id`, `title`, `description`, `estimated_duration_minutes`, `deadline`, `deadline_ms`, `priority`, `status`, `created_at`, `updated_at`; indexes on `deadline_ms` and `(status, deadline_ms)`.

The CHECK lists for priority, category and status are generated from the same TypeScript constants the Zod schemas use, so the two cannot drift apart silently.

**Timestamps.** Each instant is stored as ISO 8601 text with its original offset (what callers get back, so the user's local time is preserved exactly) and as an integer epoch-millisecond column (what queries compare, sort and index on). The repositories and the seeder are the only writers and always derive one from the other; the database does not enforce that the two agree.

### Repositories

- **`SqliteScheduleRepository.findOverlapping(range)`** runs `WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, end_ms, id` with bound parameters. That is the same half-open predicate as `overlaps()` in `lib/time.ts`, so touching intervals do not overlap. It validates the range before touching the database and throws `InvalidQueryError` for an inverted, empty or non-finite range. A test compares it with the in-memory repository over 192 ranges.
- **`SqliteTaskRepository.findTasks(query)`** takes optional `status`, `deadlineFromMs` (inclusive) and `deadlineToMs` (exclusive). One prepared statement serves every combination (`@param IS NULL OR …`), so an omitted filter restricts nothing. Order is `deadline_ms`, then priority rank (critical first), then `id`. It validates input and throws `InvalidQueryError`; database failures propagate as ordinary errors.
- Neither repository returns `null` for missing optional fields: `notes` and `description` are omitted when absent, matching the established output shape.

### Seeding (db/seed.ts, data/seedSchedule.ts, data/seedTasks.ts)

Records are validated with the same Zod schemas the API uses, then inserted with `INSERT OR IGNORE` in a single transaction (an invalid seed record rolls back all of it). Stable ids make it idempotent, and existing rows are never overwritten, so modified data survives restarts. A deleted seed row is inserted again on the next start. The seed task deadlines are task constraints, not calendar events.

### Request flow for `get_schedule`

1. The SDK parses the JSON-RPC request and negotiates the protocol revision.
2. The SDK validates `arguments` against the Zod schema (`startTime`, `endTime`: ISO 8601 with an explicit offset). A failure becomes an `isError` tool result; `withValidationReporting` makes sure it is also logged.
3. The handler converts both timestamps to epoch milliseconds, rejects an end that is not after the start, and asks the repository for overlapping events.
4. The repository runs the SQL query. The handler adds `durationMinutes`, returns `structuredContent` and a text rendering, and logs the interval, the match count and the outcome.

### Request flow for `get_tasks`

1. Same protocol handling. All three parameters are optional, so a call with no arguments is valid.
2. Zod validates `startDeadline` and `endDeadline` (same explicit-offset rule) and `status` (enum). Failures are returned and logged as above.
3. The handler rejects a window whose end is not after its start, builds a `TaskQuery` containing only the filters that were supplied, and calls the repository.
4. The result carries `structuredContent` (`taskTimeZone`, `query`, `count`, `tasks`) and a text rendering. An unexpected repository error is logged in full and returned to the caller as a generic internal-error result.

### Design decisions

- **Official SDK for all protocol work.** `createMcpHandler` serves the 2026-07-28 revision and, by default, falls back to stateless 2025-era Streamable HTTP. There is no hand-written JSON-RPC.
- **Stateless serving.** A fresh `McpServer` is built per request, so there is no session store to scale or lose. Repositories and the database connection are created once and shared, which is safe because `better-sqlite3` is synchronous and the server is a single process. The consequence is that features that need server-initiated streams across requests are not available.
- **`better-sqlite3` rather than an ORM or `node:sqlite`.** Two tables and a handful of queries do not justify an ORM. `better-sqlite3` is mature, supports transactions and prepared statements, and ships prebuilt binaries for the supported Node versions, so it installs without compiling. Node's built-in `node:sqlite` was avoided because it is still flagged experimental. The trade-off is a native dependency; the documented requirement is Node 22.12 or newer.
- **Plain `node:http`, no web framework.** One route plus a health check does not justify a framework. The SDK's Node adapter supplies the Host/Origin guards.
- **Half-open interval semantics** (`start < queryEnd && end > queryStart`) are defined once in `overlaps` in `lib/time.ts` and mirrored in the SQL; unit tests check both agree and the MCP tests check the behaviour through the protocol.
- **Instants, not wall-clock strings.** Every comparison is done on epoch milliseconds after parsing the offset, so the same moment written in `+05:30`, `Z` or `-05:00` gives the same answer.
- **Repository seams.** `ScheduleRepository` and `TaskRepository` are all the tools know about storage.
- **Configuration through the environment**, validated at startup with names in the error message. No secrets exist in this phase.

## Seams for later phases

| Later phase | Where it plugs in |
| --- | --- |
| Conflict detection and recovery planning | Pure modules that consume `ScheduleEvent` (already carries `priority` and `movable`) and `Task` (carries duration, deadline, priority, status). They call the two read repositories; they do not need new storage. |
| Writes (approve, apply, history) | New methods on the repositories and new migrations (append to `MIGRATIONS`, bump nothing else). An action-history table is the natural first addition. |
| More tools | New files under `tools/`, registered in `server.ts`. |
| Web UI | `apps/web/`, talking to the same MCP endpoint. |
| Public deployment | Set `MCP_HOST`/`MCP_ALLOWED_HOSTS`, put TLS in front, and add authentication. The SDK ships bearer-auth and OAuth metadata helpers for this. None of it is configured today. The SQLite file must live on a local disk (WAL does not work over network filesystems) and the process is single-writer. |

## Known limits of this phase

- No authentication or authorization.
- Read-only through MCP: nothing can create, edit or delete events or tasks except by editing the database file directly.
- A single user and a single time zone: the calendar and task time zone is a constant (`Asia/Kolkata`) reported in tool output, not stored per user.
- Events and tasks are not linked. The seeded "Project Deadline Work" event and the "Complete project report" task describe the same effort but nothing in the data says so.
- Only extended-format ISO 8601 offsets are accepted (`+05:30`, not `+0530`).
- `get_tasks` has no pagination.
- Deleted seed rows reappear on the next start.
