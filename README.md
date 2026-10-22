# PlanRescue

> Your day changed. Your assistant has a plan.

PlanRescue is a consequence-aware schedule recovery agent. When a meeting runs late or an urgent task appears, a calendar app shows the damage but leaves you to untangle it. PlanRescue is being built to read your calendar and tasks, find the conflicts and threatened deadlines, evaluate alternative schedules, recommend a recovery plan that respects your constraints, explain it, ask for approval, and apply it.

This repository is the submission for the **Amazon Developer Hackathon 2026, Alexa+ track**. That track requires a genuine MCP server over the Streamable HTTP transport, so the first thing built here is exactly that: a real MCP server, exercised by a real MCP client.

## Current scope (Phase 0 to Phase 3)

Implemented and verified:

- A TypeScript project foundation with scripts, environment configuration, tests and CI.
- A real MCP server built on the official TypeScript SDK (v2), served over Streamable HTTP.
- **A persistent SQLite data layer (Phase 2).** Calendar events and tasks live in two separate tables in one local database file. The schema is versioned, created automatically at startup and seeded with a deterministic sample day (22 October 2026, Asia/Kolkata). Data survives restarts.
- Two read-only MCP tools, both backed by SQLite through repository interfaces:
  - `get_schedule`: calendar events overlapping a time interval.
  - `get_tasks`: tasks with deadlines, estimated durations, priorities and statuses, with optional filters.
- **A deterministic Recovery Engine (Phase 3)** behind three more read-only MCP tools: `analyze_conflicts`, `propose_recovery_plan` and `validate_recovery_plan`. Given an event that ran late, it finds the conflicts, generates rescheduling candidates with plain TypeScript logic (no LLM, no external API), and re-validates every candidate with an independent validator. See [Phase 3: the Recovery Engine](#phase-3-the-recovery-engine).
- Strict input validation, structured output plus a readable text rendering, and logs that show what actually happened.
- End-to-end tests that start the built server as a separate process and talk to it with the official MCP client over HTTP, including a stop-and-restart persistence test.

Planned, not implemented (do not read the list below as features):

- Applying a recovery plan: nothing writes to the calendar. Plans are proposals; there is no approval workflow, no `apply_approved_plan` tool and no stored plan history
- Disruption types other than `event_overrun` (cancellations, new urgent tasks, travel delays) and natural-language interpretation of disruptions
- Tools that create, change or delete events and tasks (the database is read-only through MCP today)
- AI agent orchestration and LLM integration
- Approval workflow and applying schedule changes
- Web interface, Google Calendar integration, deployment

## Technology

| Area | Choice |
| --- | --- |
| Runtime | Node.js 22.12 or newer (`engines` in `package.json`; `.nvmrc` pins 22). `better-sqlite3` 13 itself requires Node 22+. |
| Language | TypeScript 7, ES modules |
| MCP | `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/client` 2.3.1, `@modelcontextprotocol/node` 2.1.1 |
| Database | SQLite through `better-sqlite3` 13.0.3 (pinned exactly; bundles SQLite 3.53.4). Synchronous API, transactions, no server process, prebuilt binaries for supported Node versions. |
| Validation | zod 4 (a Standard Schema, as the SDK recommends) |
| Transport | Streamable HTTP, plain `node:http` with the SDK's Node adapter |
| Tests | Vitest 5 plus the official MCP client |
| Packages | npm with a committed `package-lock.json` |

## Quick start

```bash
npm ci                # install exactly what the lockfile pins
npm run dev:mcp       # start the server; creates and seeds ./data/planrescue.sqlite on first run
```

No compiler is needed: `better-sqlite3` ships prebuilt binaries for Linux, macOS and Windows (x64 and arm64). The committed `.npmrc` sets `ignore-scripts=true` so that `npm ci` uses them. Without it, `npm ci` tries to compile the module from source, which needs a C++ toolchain and a download from nodejs.org (see `docs/implementation-report.md`).

In a second terminal:

```bash
npm run demo:client   # connects over MCP, lists tools, calls get_schedule and get_tasks
npm run test:mcp      # builds, starts a real server process, runs the MCP smoke test
```

The server prints its real configuration on startup:

```
PlanRescue MCP Server
Transport: Streamable HTTP
Endpoint: http://127.0.0.1:3001/mcp
Tool registered: get_schedule, get_tasks
Data source: SQLite /…/data/planrescue.sqlite (schema v1, 6 events, 5 tasks)
Database seeding: inserted 6 events, 5 tasks
```

On every later start the last line reads `inserted 0 events, 0 tasks`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev:mcp` | Run the server from source with file watching (`tsx watch`) |
| `npm run build` | Clean and compile to `dist/` |
| `npm run start:mcp` | Run the compiled server (`node dist/index.js`) |
| `npm run typecheck` | Type check sources, tests and scripts without emitting |
| `npm run test:unit` | Fast tests that do not start a server: time handling, seed data, config, metadata, database, repositories, Recovery Engine |
| `npm run test:recovery` | Just the Recovery Engine unit tests (analysis, task capacity, plan generation, plan validation, time helpers) |
| `npm run test:db` | Just the database and repository tests (initialization, seeding, calendar and task repositories) |
| `npm run test:mcp` | Build, then run the end-to-end MCP smoke test |
| `npm run test:persistence` | Build, then run the stop-and-restart persistence test |
| `npm test` | Build, then run every test |
| `npm run check` | Typecheck plus all tests; the same gate CI runs |
| `npm run demo:client` | Demo MCP client against a running server (`MCP_URL` overrides the target) |
| `npm run db:inspect` | Print schema version, row counts and rows of the database, read-only |

To run the smoke test against a server you already started, set `MCP_URL`. The data there must be the untouched seed data:

```bash
npm run start:mcp &
MCP_URL=http://127.0.0.1:3001/mcp npx vitest run tests/mcp-smoke.test.ts
```

Log, shutdown and database-release assertions are skipped in that mode because the test does not own the process.

## Environment configuration

Copy `.env.example` to `.env` to override anything. No secrets are needed in this phase.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_HOST` | `127.0.0.1` | Interface to bind |
| `MCP_PORT` | `3001` | Port (`0` picks a free port) |
| `MCP_PATH` | `/mcp` | MCP endpoint path |
| `APP_ENV` | `development` | `development`, `test` or `production` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `MCP_ALLOWED_HOSTS` | empty | Extra Host header names accepted, needed only when binding beyond loopback |
| `DATABASE_PATH` | `./data/planrescue.sqlite` | SQLite database file. Relative paths resolve against the working directory (the repository root when using the npm scripts), the same place `.env` is read from. `:memory:` is rejected. |

Invalid values stop the server at startup with a message that names the variable.

## MCP endpoint

- Endpoint: `http://127.0.0.1:3001/mcp` (Streamable HTTP)
- Health check: `http://127.0.0.1:3001/healthz` (plain JSON, not part of MCP)
- Protocol: the endpoint serves MCP **2026-07-28** natively and also serves **2025-11-25** through the SDK's stateless 2025-era fallback. Both are exercised by the tests (other 2025-era revisions are handled by the same fallback but are not individually tested). See `docs/implementation-report.md` for the evidence.
- Serving is stateless: no sessions are kept between requests.
- Security defaults: binds to loopback, validates `Host` and `Origin` headers against DNS rebinding, caps request bodies at 4 MiB. There is no authentication yet, so do not expose this server publicly as is.

### The `get_schedule` tool

Reads from the `calendar_events` table. Input (both required):

```json
{
  "startTime": "2026-10-22T12:00:00+05:30",
  "endTime": "2026-10-22T18:00:00+05:30"
}
```

- Timestamps must be ISO 8601 in extended form with an explicit offset (`+05:30`, `-05:00` or `Z`). Offset-free, malformed, impossible dates (such as 30 February) and a missing parameter are rejected, and so is an `endTime` that is not strictly after `startTime`.
- An event overlaps when it starts before `endTime` and ends after `startTime`. An event that ends exactly at `startTime` is excluded.
- Results are in chronological order. Each event has `id`, `title`, `startTime`, `endTime`, `durationMinutes`, `priority`, `movable`, `category` and optional `notes`.
- The result carries `structuredContent` (`calendarTimeZone`, `query`, `count`, `events`) and a readable text version. The contract is unchanged from Phase 1; only the data source moved to SQLite.
- Invalid input is returned as a tool error (`isError: true`) with a message the caller can act on. The SDK reports its own schema validation failures in the same shape, so callers see one consistent error format.

### The `get_tasks` tool

Reads from the `tasks` table. Every parameter is optional and filters combine with AND; with no arguments (or `{}`) every task is returned.

```json
{
  "startDeadline": "2026-10-22T00:00:00+05:30",
  "endDeadline": "2026-10-23T00:00:00+05:30",
  "status": "pending"
}
```

- `startDeadline` is inclusive and `endDeadline` is exclusive, matching the half-open rule of `get_schedule`. Each may be given alone. Both use the same explicit-offset timestamp format, and when both are given `endDeadline` must be strictly after `startDeadline`.
- `status` is one of `pending`, `in_progress`, `completed`.
- Results are ordered by deadline instant, then priority (`critical` first), then id, so the order is deterministic.
- Each task has `id`, `title`, optional `description`, `estimatedDurationMinutes`, `deadline` (as stored, with its UTC offset), `priority`, `status`, `createdAt` and `updatedAt`.
- The result carries `structuredContent` (`taskTimeZone`, `query`, `count`, `tasks`) and a readable text version. `query` echoes only the filters that were applied.
- There is no pagination or result limit: the tool returns every match. That is deliberate for a single user's task list; add paging if lists grow large.
- Invalid status, malformed timestamps and inverted or empty ranges return a tool error (`isError: true`). No match is a normal, non-error result with `count: 0`.

## Phase 3: the Recovery Engine

The five tools now registered are `get_schedule`, `get_tasks`, `analyze_conflicts`, `propose_recovery_plan` and `validate_recovery_plan`. **All five are read-only.** A recovery plan is a proposal: the stored calendar is never modified.

### Architecture

```
MCP client ─► MCP tool (validate input, log) ─► repositories (read) ─► Recovery Engine (pure functions) ─► structured result + text
```

The scheduling logic lives in `apps/mcp-server/src/recovery/` as pure functions that receive events and tasks and return results. They contain no SQL and no I/O; the tool handlers read through the existing `ScheduleRepository` and `TaskRepository` interfaces and pass plain data in. Nothing is random and nothing depends on the clock, so identical inputs always give identical output.

| Module | Role |
| --- | --- |
| `analyzeConflicts.ts` | Overlaps, newly created overlaps, affected events, protected constraints, task findings |
| `generateRecoveryPlans.ts` + `placement.ts` | Candidate generation (three strategies), each validated before it is returned |
| `validateRecoveryPlan.ts` | Independent re-check of any plan |
| `taskCapacity.ts` | Aggregate deadline-capacity assessment |
| `scoring.ts` | Deterministic ranking |
| `schedule.ts`, `types.ts` | Shared primitives, planning context, Zod schemas (one source for engine types and tool schemas) |

### The tools

| Tool | Input | Output |
| --- | --- | --- |
| `analyze_conflicts` | `startTime`, `endTime`; optional `disruption`, `protectedEventIds` | Existing conflicts, conflicts caused by the disruption, affected events, events the planner will not move, per-task deadline findings, warnings, overall assessment, plus a text summary |
| `propose_recovery_plan` | `startTime`, `endTime`, `disruption`; optional `protectedEventIds`, `preferences` | `outcome` (`plans_found`, `no_changes_needed`, `infeasible`), ranked and validated `candidates`, `discardedStrategies` with reasons, `infeasibility` explanation, ranking formula |
| `validate_recovery_plan` | `startTime`, `endTime`, `disruption`, `changes`; optional `protectedEventIds`, `planId` | `isValid`, `checks`, `violations`, `warnings`, recalculated `taskAssessments`, summary |

A candidate returned by `propose_recovery_plan` can be passed to `validate_recovery_plan` exactly as returned: it carries its own `startTime`, `endTime`, `disruption` and `protectedEventIds`, and extra fields are ignored. Timestamps are ISO 8601 with an explicit UTC offset everywhere, and proposed times keep the offset of the event they came from.

**Supported disruption (the only one):** `{ "type": "event_overrun", "eventId": "evt-001", "overrunMinutes": 40 }`. The event keeps its start and its end moves later by 1 to 240 minutes. The change is applied to an in-memory copy of the schedule only. The event that overran is observed, not rescheduled, so it never appears in a plan's `changes`.

### Hard constraints

A candidate is returned only if the validator finds none of these broken:

- Immovable events (`movable: false`), critical events (`priority: critical`) and caller-protected events (`protectedEventIds`) never move. Importance, mobility and protection are separate properties, so a movable critical event is still never moved.
- Every moved event keeps its exact duration. Nothing is shortened as a workaround.
- Overlaps are not allowed; intervals are half-open, so an event ending at 14:00 does not overlap one starting at 14:00.
- Moved events stay inside the planning interval, and only exist if they exist in the calendar.
- The plan must not introduce a task-deadline infeasibility that the overrun alone would not have caused.

If these cannot all be satisfied, the result says so (`outcome: infeasible`) and explains why. The engine never relaxes a constraint silently.

### How candidates are generated

Flexible events (movable, non-critical, unprotected) are placed around the fixed ones. An event that overlaps nothing stays where it is. An event that has to move keeps its duration, moves only later (never earlier than its original start), and takes the earliest slot that clears everything already placed. Three strategies share these rules and differ in ordering and spacing:

- `minimal_disruption`: work through the day in order, moving only what must move.
- `buffered_transitions`: the same, keeping a 10-minute (or failing that 5-minute) gap around each moved event, trading a little extra delay for breathing room.
- `priority_first`: higher-priority events keep their slots where possible; lower-priority events are pushed instead.

A strategy that has no valid placement, or that yields exactly the same changes as an earlier one, is not offered; `discardedStrategies` says why. Plan IDs are derived from the candidate's content (`plan-` and 12 hex characters), so the same candidate always has the same ID.

### How candidates are ranked

Score is a penalty, **lower is better**:

```
total = 100 × changedEvents
      + Σ shiftMinutes × priorityWeight          (critical 8, high 4, medium 2, low 1)
      + Σ shiftMinutes of moved focus events
      + transitionWeight × tightTransitions      (neighbours < 10 min apart, touching a moved or overrunning event; weight 10, or 40 with preferences.optimizeFor = "transition_time")
      + 40 × atRiskTasks + 200 × infeasibleTasks
```

Candidates are ordered by hard-violation count first (any violation disqualifies, and returned candidates always have zero), then total, then fewer changed events, then strategy order, then plan ID. The formula is returned with every result. This is a heuristic ordering of valid candidates. The engine does **not** claim any plan is optimal or that it uses the fewest possible moves.

### How the validator works

`validate_recovery_plan` does not trust the plan. From the plan it takes only the interval, the disruption, the protected IDs and the list of changes. It reloads the stored events and tasks, rebuilds the projected schedule (stored events, the overrun applied, the changes applied) and re-runs ten named checks: `event_existence`, `valid_time_range`, `no_overlaps`, `duration_preservation`, `immovable_events`, `critical_events`, `protected_events`, `deadline_feasibility`, `scope_validity`, `consistency`. Durations come from the stored event, never from the plan's own claims; a plan's claims about its events' original times are checked against the calendar; a `validation.isValid: true` carried by the plan is ignored (and noted as a warning if it was false). A plan that breaks a rule returns `isValid: false` with its violations. Malformed input, such as a timestamp without an offset, is rejected as a tool error. The validator shares no placement code with the generator, so a bug in one is not silently accepted by the other.

### How task capacity is assessed

Tasks have no calendar slot and **none is ever invented**. The engine estimates aggregate capacity instead:

- Pending and in-progress tasks count with their full `estimatedDurationMinutes` as remaining effort (no progress tracking yet). Completed tasks are ignored.
- Free time is the part of `[startTime, deadline)` not covered by any event. Focus and deadline-work blocks occupy time, so they are not counted as capacity: the estimate is conservative.
- Effort is cumulative in deadline order, so the same free minute is never offered to two tasks.
- Verdicts: `infeasible` (not enough free time), `at_risk` (enough, with 30 minutes of margin or less), `feasible`, or `not_assessed` (the deadline is after the planning interval). A near deadline is not called violated if the capacity is there. `feasible` means capacity exists, not that the task has a slot or will be done.
- The disrupted schedule is assessed as the stored schedule with the overrun's minutes paid in full. Each at-risk or infeasible finding carries an `origin`: `pre_existing`, `disruption` (caused by the overrun itself) or `plan_introduced` (caused by the proposed moves). Only `plan_introduced` infeasibility invalidates a plan.
- `startTime` is treated as "now". Only tasks due inside the planning interval are loaded.

### What the engine does not support yet

- Disruptions other than `event_overrun`; the overrunning event itself is never rescheduled.
- Moving events earlier than their original start, shortening or splitting events, and exhaustive search for the best arrangement.
- Placing task work into slots, partial task progress, and travel time between events.
- Planning intervals longer than 14 days or with more than 500 events.
- Approval, applying a plan, plan history, natural-language input.

### Demonstrating the example scenario

```bash
npm run dev:mcp          # terminal 1
npm run demo:client      # terminal 2
```

The demo client reads the seeded day through MCP, analyses a 40-minute Team Meeting overrun, proposes a recovery plan, validates it, and then submits a tampered copy (the doctor's appointment moved, with a false `isValid: true`) to show it being rejected. For the seeded data, the engine computes: Lunch Break 13:10-13:55, Project Review 13:55-14:55, Focus Work 14:55-16:25, with the doctor's appointment (16:30) and Project Deadline Work (18:00-20:00) unchanged. The times come from the algorithm, not from fixtures; the tests check them against arithmetic derived from the data.

To run only the engine's tests: `npm run test:recovery`.

## Data layer (SQLite)

Calendar events and tasks are stored separately because they are different things: an event occupies a fixed time slot, while a task is work with an effort estimate and a deadline that must be fitted around events. The project deadline in the sample data is a task deadline (`task-001`, due 20:00 IST), not a calendar event; the calendar separately holds a "Project Deadline Work" block.

### How it starts

On startup, before anything listens, the server:

1. Opens `DATABASE_PATH`, creating the file and its directory if needed.
2. Applies connection settings (WAL journal mode, foreign keys on, a 5 second busy timeout).
3. Runs pending schema migrations, tracked in SQLite's `user_version`.
4. Inserts any sample records that are missing.
5. Builds the repositories and starts the HTTP server.

If any step fails, the server prints the reason and exits with code 1. It never falls back to an in-memory database. On shutdown (SIGINT or SIGTERM) it stops HTTP first, then closes the database.

### Schema (version 1)

| Table | Columns |
| --- | --- |
| `calendar_events` | `id` (primary key), `title`, `start_time`, `end_time`, `start_ms`, `end_ms`, `priority`, `movable`, `category`, `notes` |
| `tasks` | `id` (primary key), `title`, `description`, `estimated_duration_minutes`, `deadline`, `deadline_ms`, `priority`, `status`, `created_at`, `updated_at` |

Timestamps are stored twice on purpose: the ISO 8601 text with its original offset (returned to callers, so local time is preserved exactly) and an integer epoch-millisecond instant (`*_ms`, what queries compare, sort and index on, so results are right for any offset). CHECK constraints enforce the same enums and limits as the TypeScript types (priorities, categories, task statuses, `end_ms > start_ms`, a positive duration of at most one week). Tables are `STRICT`.

### Sample data and idempotency

Seeding uses `INSERT OR IGNORE` on stable ids (`evt-001`…`evt-006`, `task-001`…`task-005`). Running it again adds nothing and never overwrites a row that has been changed. One consequence: a seed row you delete comes back on the next start.

| Task | Duration | Due (IST, 22 Oct 2026 unless noted) | Priority | Status |
| --- | --- | --- | --- | --- |
| Draft team meeting agenda | 20 min | 11:30 | medium | completed |
| Prepare for project review | 30 min | 13:30 | high | pending |
| Review teammate's deliverable | 45 min | 18:00 | medium | pending |
| Complete project report | 120 min | 20:00 | critical | in_progress |
| Plan next week's sprint | 60 min | 17:00 on 23 Oct | low | pending |

### Inspecting and resetting development data

```bash
npm run db:inspect                              # read-only; safe while the server runs
DATABASE_PATH=/tmp/scratch.sqlite npm run dev:mcp   # work against a throwaway database
```

To reset, stop the server and delete the database file together with its `-wal` and `-shm` companions; the next start recreates and reseeds it:

```bash
rm -f data/planrescue.sqlite data/planrescue.sqlite-wal data/planrescue.sqlite-shm
```

Only do this for the development database. Tests never touch it: each test gets its own temporary database file and removes it afterwards. The `data/` directory and all `*.sqlite*` files are git-ignored.

## Testing

`npm run check` runs the type check, the build and every test. The suites are:

- **Unit and database tests** (`test:unit`): timestamps and overlap rule, seed data, configuration, database initialization and migrations, constraint enforcement, idempotent seeding, and both SQLite repositories (boundaries, ordering, filters, invalid input, database errors).
- **Recovery Engine tests** (`test:recovery`, also part of `test:unit`): conflict analysis, task capacity, plan generation (alternatives, ranking, determinism, infeasibility, no mutation of inputs) and the independent validator against deliberately invalid plans.
- **MCP smoke test** (`test:mcp`): a real server process and the official MCP client over Streamable HTTP, run once per protocol era (2026-07-28 and 2025-11-25) for the two read tools, plus transport hardening, logs and shutdown, plus a Phase 3 end-to-end block that calls the three recovery tools through MCP and proves the SQLite rows are unchanged afterwards.
- **Persistence test** (`test:persistence`): starts a server on a temporary database, reads through MCP, stops it, restarts it on the same file and checks the data is identical and not duplicated, that edits are kept, that changes made to the file are visible live, and that bad `DATABASE_PATH` values stop startup.

Current counts and results are recorded in `docs/implementation-report.md`.

## Folder structure

```
planrescue/
├── apps/
│   └── mcp-server/
│       └── src/
│           ├── index.ts                 Entry point: config, database, startup banner, signals, shutdown
│           ├── config.ts                Environment parsing and validation (incl. DATABASE_PATH)
│           ├── http.ts                  node:http server, Host/Origin guards, health, MCP mounting
│           ├── server.ts                Builds the McpServer and registers tools
│           ├── logger.ts                Small level-based line logger
│           ├── types.ts                 Event and task schemas; ScheduleRepository and TaskRepository interfaces
│           ├── db/
│           │   ├── database.ts          Open, configure, migrate, seed; clear failure reporting
│           │   ├── migrations.ts        Versioned schema (user_version)
│           │   └── seed.ts              Idempotent seeding of events and tasks
│           ├── lib/
│           │   ├── time.ts              Timestamp validation, overlap rule, durations
│           │   ├── validation.ts        Reports tool input validation failures to the log
│           │   └── errors.ts            InvalidQueryError, DatabaseInitError
│           ├── recovery/                Recovery Engine: pure functions, no SQL, no I/O
│           │   ├── types.ts             Zod schemas and types shared by engine and tools
│           │   ├── schedule.ts          Intervals, overlaps, planning context
│           │   ├── placement.ts         Deterministic placement of flexible events
│           │   ├── analyzeConflicts.ts  Conflict and consequence analysis
│           │   ├── generateRecoveryPlans.ts   Candidate generation and ranking
│           │   ├── validateRecoveryPlan.ts    Independent plan validator
│           │   ├── taskCapacity.ts      Aggregate deadline-capacity assessment
│           │   └── scoring.ts           Scoring formula and ranking
│           ├── tools/
│           │   ├── getSchedule.ts       The get_schedule tool
│           │   ├── getTasks.ts          The get_tasks tool
│           │   ├── analyzeConflicts.ts  The analyze_conflicts tool
│           │   ├── proposeRecoveryPlan.ts   The propose_recovery_plan tool
│           │   ├── validateRecoveryPlan.ts  The validate_recovery_plan tool
│           │   └── recoveryShared.ts    Repository access and error mapping for the recovery tools
│           └── data/
│               ├── seedSchedule.ts      Sample events, plus the in-memory repository (kept for unit tests)
│               ├── seedTasks.ts         Sample tasks
│               ├── sqliteScheduleRepository.ts   SQLite ScheduleRepository
│               └── sqliteTaskRepository.ts       SQLite TaskRepository
├── tests/
│   ├── helpers/serverProcess.ts         Starts the built server as a child process on a temp database
│   ├── helpers/tempDatabase.ts          Isolated temporary database files
│   ├── helpers/recoveryFixtures.ts      Synthetic event and task fixtures for engine tests
│   ├── mcp-smoke.test.ts                Real MCP client over Streamable HTTP, all five tools
│   ├── recovery-*.test.ts               Recovery Engine unit tests (analyze, task-capacity, generate, validate, time)
│   ├── persistence.test.ts              Stop/restart persistence through MCP
│   ├── database.test.ts                 Initialization, migrations, seeding, constraints, failures
│   ├── sqlite-schedule-repository.test.ts
│   ├── sqlite-task-repository.test.ts
│   ├── time.test.ts  seed-data.test.ts  config.test.ts  server-meta.test.ts
├── scripts/
│   ├── demo-client.ts                   Demo MCP client (all five tools, MCP only)
│   └── db-inspect.ts                    Read-only database inspector
├── docs/
│   ├── architecture.md
│   └── implementation-report.md         Versions, protocol evidence, test results, known issues
├── .github/workflows/ci.yml
├── .env.example  .gitignore  .npmrc  .nvmrc
├── package.json  package-lock.json
├── tsconfig.json  tsconfig.build.json  vitest.config.ts
├── README.md
└── LICENSE
```

When later phases arrive, a web interface slots in as `apps/web/` and shared code can move to `packages/`, without touching the MCP server.

## Repository seams

The tools, and through them the Recovery Engine, depend only on two interfaces in `types.ts`: `ScheduleRepository.findOverlapping(range)` and `TaskRepository.findTasks(query)`. `index.ts` is the single place that chooses the SQLite implementations. The original in-memory `SeedScheduleRepository` still exists so the overlap semantics can be compared against the SQL implementation in tests.

## License

MIT
