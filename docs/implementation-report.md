# Implementation report

Two milestones are recorded here, newest first. Phase 2 is the SQLite data layer and the `get_tasks` tool. The Phase 0 and Phase 1 record is kept below it as written at that time; where Phase 2 changed something (test totals, in-memory data), the Phase 2 section is authoritative.

## Phase 2: SQLite data layer and read tools

Status: implemented and verified in this environment (Linux, Node 22.22.2, npm 10.9.7) for the scope below. Not implemented, by design: the Recovery Engine, any LLM or agent, approval, and any tool that changes data.

### 1. Pre-flight (Phase 0 and Phase 1), run before any Phase 2 code

All commands were run from the repository root in this session, against the repository as received. Nothing was taken from the older report.

| Check | Result |
| --- | --- |
| Git history | 2 commits (`1b986ba`, `09fe0cd`), clean working tree; kept and built on |
| `npm ci` | Passed: 61 packages, 0 vulnerabilities |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, `dist/` produced |
| `npm run test:unit` | 56 passed (time 33, seed data 12, config 10, metadata 1) |
| `npm run test:mcp` | 43 passed (real server process, official MCP client, both protocol eras) |
| `npm run demo:client` against a running server | Connected, negotiated 2026-07-28, listed `get_schedule`, returned 5 events for 12:00 to 18:00 IST, same events for the UTC-expressed interval, rejected the inverted range |
| Server log | Showed the real tool calls, then `Received SIGTERM`, `Shutdown complete` |
| `npm run check` | Passed: 99 tests |

Failures found: none in code or tests, so nothing was fixed before upgrading. Two items were noted: the README claimed the server needs "Node 20.12 or newer" while `package.json` requires 22.12 (corrected in the new README, and `better-sqlite3` 13 needs Node 22+ anyway); and the repository arrived zipped with the project one directory down (`planrescue/planrescue`), which has no effect on the code.

How the checklist's MCP items were verified: the MCP client negotiates a protocol revision and calls tools through `StreamableHTTPClientTransport`, which would fail against a plain REST route; the tests assert the negotiated versions (2026-07-28 and 2025-11-25); boundaries, ordering, offsets and malformed input are covered by the existing assertions, which all passed unmodified in meaning.

### 2. Files created or modified

| Path | Change |
| --- | --- |
| `apps/mcp-server/src/db/migrations.ts` | New. Versioned schema using `user_version`; migration 1 creates both tables, constraints and indexes |
| `apps/mcp-server/src/db/database.ts` | New. Opens the file, applies settings, migrates, seeds; clear `DatabaseInitError`s; no in-memory fallback |
| `apps/mcp-server/src/db/seed.ts` | New. Idempotent, validated, transactional seeding |
| `apps/mcp-server/src/data/sqliteScheduleRepository.ts` | New. SQLite `ScheduleRepository` |
| `apps/mcp-server/src/data/sqliteTaskRepository.ts` | New. SQLite `TaskRepository` |
| `apps/mcp-server/src/data/seedTasks.ts` | New. Five sample tasks for the same day as the sample calendar |
| `apps/mcp-server/src/tools/getTasks.ts` | New. The `get_tasks` tool |
| `apps/mcp-server/src/lib/errors.ts` | New. `InvalidQueryError`, `DatabaseInitError` |
| `apps/mcp-server/src/types.ts` | Added task schema and constants, `TaskQuery`, `TaskRepository`; `ScheduleRepository` unchanged |
| `apps/mcp-server/src/config.ts` | Added `DATABASE_PATH` (resolved to an absolute path; `:memory:` and `file:` rejected) |
| `apps/mcp-server/src/server.ts` | Registers both tools; takes a task repository; updated server instructions |
| `apps/mcp-server/src/index.ts` | Initializes the database before listening; closes it after HTTP on shutdown |
| `apps/mcp-server/src/data/seedSchedule.ts`, `tools/getSchedule.ts`, `http.ts` | Unchanged (the in-memory repository is kept for comparison tests; the tool is untouched, only its repository changed) |
| `scripts/demo-client.ts` | Rewritten to demonstrate both tools through MCP only |
| `scripts/db-inspect.ts` | New. Read-only database inspector |
| `tests/database.test.ts`, `sqlite-schedule-repository.test.ts`, `sqlite-task-repository.test.ts`, `persistence.test.ts` | New |
| `tests/helpers/tempDatabase.ts` | New. Isolated temporary database files |
| `tests/mcp-smoke.test.ts`, `tests/helpers/serverProcess.ts`, `tests/config.test.ts` | Extended. Existing assertions kept; the server helper now passes a temporary `DATABASE_PATH`; the default-config test now includes `databasePath` |
| `package.json`, `package-lock.json` | Added `better-sqlite3` 13.0.3 and `@types/better-sqlite3` 9.6.0 (exact pins); new scripts `test:db`, `test:persistence`, `db:inspect`; `test:unit` extended |
| `.npmrc` | New. `ignore-scripts=true` so `npm ci` uses `better-sqlite3`'s prebuilt binaries (see section 5) |
| `tests/server-meta.test.ts` | Added one test guarding `.npmrc` (the other assertion is unchanged) |
| `.env.example`, `.gitignore`, `README.md`, `docs/architecture.md`, this file | Updated |

No existing test was deleted, skipped or relaxed. The two edited existing expectations are the default-config assertion (a new field was added to the config object) and the log assertion for the startup tool list (now `get_schedule, get_tasks`, a superset).

### 3. Database architecture

- **Library:** `better-sqlite3` 13.0.3, installed from a prebuilt binary (no compilation was needed here), bundling SQLite 3.53.4. Chosen over `node:sqlite` (experimental), over async drivers (no benefit for a single local file) and over an ORM (two tables). Pinned exactly in `package.json` and the lockfile.
- **Path:** `DATABASE_PATH`, default `./data/planrescue.sqlite`, resolved against the working directory, directory created on demand, git-ignored.
- **Schema:** `calendar_events` and `tasks`, `STRICT` tables with CHECK constraints generated from the TypeScript constants; timestamps stored as offset-preserving text plus epoch-millisecond integers; indexes on the range and deadline columns. Versioned with `user_version`; each migration is transactional; newer-than-supported databases are refused.
- **Repositories:** `SqliteScheduleRepository` implements the unchanged `ScheduleRepository` with the unchanged half-open overlap rule; `SqliteTaskRepository` filters by status and a half-open deadline window and orders by deadline, then priority, then id. All SQL uses bound parameters.
- **Seeding:** `INSERT OR IGNORE` on stable ids inside one transaction, validated with the API's Zod schemas. Repeats add nothing and never overwrite.
- **Persistence:** WAL mode; the database is closed after HTTP drains on shutdown, which also checkpoints the WAL.

### 4. MCP tools

- `get_schedule`: contract unchanged (inputs, validation, ordering, output shape, errors); data now from SQLite.
- `get_tasks`: optional `startDeadline` (inclusive), `endDeadline` (exclusive), `status`; same explicit-offset timestamp rule; end must be after start; deterministic order; `structuredContent` plus text; empty results are normal; invalid input is a tool error; every call is logged. Details are in the README.

### 5. Verification results

All numbers come from commands run in this session.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm run test:unit` (7 files) | 142 passed: time 33, seed data 12, config 15, metadata 2, database 34, calendar repository 21, task repository 25 |
| `npm run test:db` (3 files) | 80 passed |
| `npm run test:mcp` | 84 passed: 38 tool tests per protocol era (18 existing for `get_schedule`, 20 new for `get_tasks` and combined use), 5 transport tests, log, shutdown and database-release tests |
| `npm run test:persistence` | 7 passed: identical data after restart, no growth over four restarts, edits kept and not reseeded, live reads of outside changes, isolated databases, two startup-failure cases |
| `npm run check` | Passed: typecheck, build, 233 tests in 9 files, 0 failed, 0 skipped |
| Smoke test against an external server (`MCP_URL`) | 81 passed, 3 skipped by design (log, shutdown and database-release checks need to own the process) |
| `npm run demo:client` (against a fresh database) | Connected, listed both tools, printed 6 events and the tasks for the day, then the filtered list, the combined summary, the UTC check and two rejected requests |
| `npm run db:inspect` | Worked while the server ran, after a clean stop, and after the server process was killed; reports a missing file with a clear message and exit code 1 |
| Startup failure: `DATABASE_PATH` is a directory | Exit 1, message names the path, nothing listening |
| Startup failure: `DATABASE_PATH=:memory:` | Exit 1, configuration error naming `DATABASE_PATH` |
| Startup failure: parent directory not writable (run as `nobody`) | Exit 1, `Cannot create the database directory … EACCES` |
| Startup failure: existing database file read-only (run as `nobody`) | Exit 1, `attempt to write a readonly database`; no fallback, nothing listening |
| Restart after an unclean kill (WAL files left behind) | Data intact (6 events, 5 tasks), 0 rows seeded, clean shutdown afterwards |
| Mutation check: SQL overlap made inclusive | 20 tests failed; reverted |
| Mutation check: task deadline upper bound made inclusive | 4 tests failed; reverted |
| Mutation check: priority tie-break removed | 1 test failed; reverted |
| Mutation check: seeding changed to `INSERT OR REPLACE` | 5 tests failed; reverted |
| Tests after reverting all mutations | 232 passed (before the `.npmrc` guard test was added, which makes 233) |

| **Fresh clone** (`git clone`, then plain `npm ci`, then `npm run check`), after the `.npmrc` fix | `npm ci` added 64 packages, 0 vulnerabilities; `npm run check` passed with 233 tests in 9 files |
| Default-configuration end to end from that clone (no environment overrides) | Server created `./data/planrescue.sqlite` and seeded 6 events and 5 tasks; the demo client read both tools; after a stop and restart it seeded 0 rows and shut down cleanly; `git status` stayed clean (database ignored) |

Two bugs caught during this work:

1. **`npm ci` failed in a fresh clone.** The first Phase 2 commit installed fine with `npm install` in the working directory, but `npm ci` in a fresh clone failed: `better-sqlite3` ships prebuilt binaries and declares `gypfile: false`, yet a lockfile install does not see that flag and runs an implicit `node-gyp rebuild`, which needs a C++ toolchain and a download from nodejs.org (unreachable here, `ENOTFOUND`). It was reproduced in an empty directory independent of this project: `npm install better-sqlite3@13.0.3` works, `npm ci` from the lockfile it generates does not. Fix: a committed `.npmrc` with `ignore-scripts=true`. Only `esbuild` and `fsevents` have install scripts in the lockfile, and `tsx`, `vitest` and `better-sqlite3` were all confirmed to work without them. A test guards the setting. Note that this means no dependency install script runs; if a future dependency needs one, remove the setting and use `npm rebuild <package>`. This was found by verifying from a fresh clone, which is why the check was run that way.
2. the first `.gitignore` rule for the data directory (`data/`) was unanchored and also ignored `apps/mcp-server/src/data/`, which would have excluded the new repository and seed files from a commit. It is now `/data/`, verified with `git check-ignore`.

### 6. Known limitations

1. **CI has not run.** The workflow is unchanged (Node 22 and 24); it uses `npm ci`, which now relies on the `.npmrc` setting. Only Node 22.22.2 on Linux x64 was exercised here, so the bundled `better-sqlite3` binaries for Node 24, macOS, Windows, arm64 and musl Linux are unverified.
2. **Hang on a pseudo-filesystem path.** `DATABASE_PATH=/proc/nope/db.sqlite` hung in this sandbox. A bare `fs.mkdirSync('/proc/nope', { recursive: true })` hangs the same way without any project code, so it looks like a sandbox quirk, but it was not confirmed on another system, and the server has no timeout around directory creation.
3. **Crash durability is only lightly tested.** Recovery after a killed process was checked manually once; there is no automated test for it.
4. **No write path.** Nothing in MCP can create, change or delete events or tasks. The persistence tests simulate edits by writing to the file directly.
5. **Deleted seed rows come back** on the next start, because seeding inserts anything missing. There is no setting to turn seeding off.
6. **Timestamp consistency is by convention.** The text and `*_ms` columns are written together by the repositories; the database does not enforce that they agree, so a hand edit of one column would desynchronise them.
7. **One time zone.** `Asia/Kolkata` is a constant reported in tool output, not stored data.
8. **`get_tasks` has no pagination or limit.**
9. **Types package.** `@types/better-sqlite3` is at 9.6.0 while the library is 13.0.3; type checking passes, but the typings may lag the library.
10. **WAL needs a local disk.** The database must not live on a network filesystem; the process is a single writer.
11. **Server version** is still 0.1.0 (the metadata test ties it to `package.json`); it was not bumped for Phase 2.
12. Carried over from Phase 1: no authentication, Alexa+ connectivity untested, extended-format offsets only, stateless serving, dev watch-mode reload untested, validation logging depends on the SDK honouring the Standard Schema interface.

### 7. Readiness for Phase 3 (Recovery Engine)

The read side is ready: a recovery engine can obtain events (with `priority` and `movable`) and tasks (with duration, deadline, priority and status) through the two tools or directly through the repositories, with deterministic ordering and consistent instants. Writes will need new migrations and repository methods, but not a storage rewrite.

Data-model gaps that will materially affect conflict detection and plan generation:

- **No link between events and tasks.** The sample "Project Deadline Work" block and the "Complete project report" task are the same effort, but nothing says so; a planner would count the work twice or not at all.
- **No availability model.** Free time cannot be derived without working hours or "do not schedule" windows; gaps between events are not necessarily usable.
- **No earliest-start field on tasks** (the brief left it optional). Consequence-aware placement will probably need it, and possibly a way to split a task.
- **No action history table** for the approve/apply phases.

None of these needs a change to what exists; each is an additive migration.

---

## Phase 0 and Phase 1 (record as written at that milestone)

Status: complete for the scope below. Verified on Linux with Node 22.22.2 and npm 10.9.7, from a fresh `git clone` followed by `npm ci` and `npm run check`.

### Files and roles

| Path | Role |
| --- | --- |
| `apps/mcp-server/src/index.ts` | Entry point: loads config, starts the server, prints the real startup banner, handles SIGINT/SIGTERM and fatal errors |
| `apps/mcp-server/src/config.ts` | Environment parsing with clear errors |
| `apps/mcp-server/src/http.ts` | `node:http` server, Host/Origin guards, `/healthz`, mounts the SDK handler at the MCP path |
| `apps/mcp-server/src/server.ts` | Builds the `McpServer` and registers tools |
| `apps/mcp-server/src/tools/getSchedule.ts` | The `get_schedule` tool |
| `apps/mcp-server/src/data/seedSchedule.ts` | Seeded events and the repository that serves them |
| `apps/mcp-server/src/lib/time.ts` | Offset-required timestamp schema, overlap rule, durations |
| `apps/mcp-server/src/lib/validation.ts` | Makes input validation failures visible in the server log |
| `tests/mcp-smoke.test.ts` | End-to-end test: official MCP client over Streamable HTTP against a spawned server |
| `tests/helpers/serverProcess.ts` | Starts the built server on a free port, or attaches via `MCP_URL` |
| `tests/*.test.ts` | Unit tests for time handling, seed data, config and metadata |
| `scripts/demo-client.ts` | Demo MCP client |

### MCP compatibility evidence

- Packages: `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/client` 2.3.1, `@modelcontextprotocol/node` 2.1.1, `zod` 4.6.7. These are the stable v2 line; the package READMEs state that v2 implements the 2026-07-28 specification. Exact versions are pinned by `package-lock.json`.
- Transport: Streamable HTTP, endpoint `http://127.0.0.1:3001/mcp` by default. The smoke test uses a free port on 127.0.0.1 instead.
- The server uses `createMcpHandler`, which serves 2026-07-28 and, by default, stateless 2025-era Streamable HTTP.
- Negotiated versions are read from the client at runtime, not written into the README:
  - Modern: the test client pins `2026-07-28` (`versionNegotiation: { mode: { pin } }`), which fails to connect unless the server offers that revision. The test then asserts `getProtocolEra() === 'modern'` and `getNegotiatedProtocolVersion() === '2026-07-28'`. Tool results in this mode carry the SDK's `io.modelcontextprotocol/serverInfo` metadata.
  - Legacy: a default client performs the 2025 `initialize` handshake and negotiates `2025-11-25`, asserted the same way.
  - Both versions are at or above the required floor of 2025-11-25. The test asserts that comparison explicitly.
- The complete tool suite runs once per era (18 tests each).

### Verification results

All results below were produced by running the commands, not by reading the code.

| Check | Result |
| --- | --- |
| `npm ci` from a fresh clone | Passed, 0 vulnerabilities reported |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| Unit tests (time 33, seed data 12, config 10, metadata 1) | 56 passed |
| MCP smoke test (36 tool tests across two protocol eras, 5 transport tests, 2 log and shutdown tests) | 43 passed |
| `npm run check` total | 99 passed, 0 failed |
| Smoke test against an already-running server (`MCP_URL`) | 41 passed, 2 skipped by design (log and shutdown checks need to own the process) |
| `npm run dev:mcp` from a fresh clone | Served `/healthz` and a real MCP client call |
| `npm run demo:client` | Connected, negotiated 2026-07-28, listed the tool, returned 5 events for 12:00 to 18:00 IST |
| Port already in use | Exits with code 1 and a message naming `MCP_PORT` |
| Invalid environment value | Exits with code 1 and names the variable |
| SIGINT and SIGTERM | Clean exit code 0 with "Shutdown complete" in the log |
| `MCP_PORT=0` | Binds a free port and prints the real endpoint |
| Mutation check | Changing the overlap rule to inclusive bounds made 11 smoke tests fail; the change was reverted |

What the smoke test covers: initialization and version negotiation; tool discovery with input schema, output schema and annotations; the 12:00 to 18:00 IST afternoon result (order, overlap, durations, exclusion of an event starting exactly at the end); a different interval returning different events; boundary semantics; the same instants in `+05:30`, `Z` and `-05:00`; empty results (a gap and a different day); text plus structured output; seven invalid-input cases; 25 concurrent calls; an unknown tool; `/healthz`; 404 routing; foreign Host and Origin blocked with 403; malformed JSON answered with a 4xx while the server keeps serving; server log lines matching the calls made; clean SIGTERM shutdown.

### Known issues and limits

1. **No authentication.** The server is intended for loopback use. A public deployment needs TLS and auth first.
2. **Alexa+ connectivity is untested.** That needs a public HTTPS endpoint and the Alexa+ developer tooling, which are out of scope for this phase.
3. **Documentation coverage.** The SDK repository README and the v2 API reference index were read. The SDK's deeper guide pages (serving, tools, client) and the MCP introduction page could not be fetched in this session, so the exact APIs were taken from the installed packages' type declarations and doc comments and then confirmed by running them. The Devpost rules page was not read; the 2025-11-25 floor comes from the project brief and should be re-checked against the rules.
4. **Platforms.** Only Node 22.22.2 on Linux was run here. CI is configured for Node 22 and 24 but has not run. Signal handling on Windows is unverified.
5. **TypeScript strictness.** `exactOptionalPropertyTypes` is off because it conflicts with the SDK's published Node adapter types. Other strict flags are on.
6. **Stateless serving.** Per the SDK documentation, GET and DELETE on the MCP path answer 405 in the 2025-era fallback. That behaviour was not tested.
7. **Timestamp format.** Only extended-format offsets are accepted (`+05:30`, not `+0530`).
8. **Dev watch mode.** `dev:mcp` starts and serves, but reload on file change was not exercised.
9. **Validation logging** wraps the Standard Schema's `validate` function. It is covered by log assertions in the smoke test, but it relies on the SDK continuing to honour that interface.
10. The seeded data is temporary development data held in memory.

### Readiness for Phase 2

Complete: project foundation, a verified Streamable HTTP MCP server, one working tool, a repository seam, real end-to-end tests, CI configuration.

Next milestone: the data layer and further scheduling tools. Concretely, a SQLite-backed `ScheduleRepository`, a task model and tools to read tasks, plus tool tests through the same MCP smoke harness. The recovery engine, agent, approval flow and UI follow after that.
