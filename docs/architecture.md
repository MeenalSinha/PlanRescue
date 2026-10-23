# PlanRescue architecture (Phase 0 to Phase 6)

This document describes what exists in PlanRescue, including the persistent SQLite data layer, the deterministic Recovery Engine, the Next.js web application, the natural-language Phase 5 agent, and Phase 6's persistent plan lifecycle, server-enforced approval workflow, atomic execution engine, and persistent action audit history.

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

## Phase 3: the Recovery Engine

### Request flow

```
MCP client
   │  tools/call analyze_conflicts | propose_recovery_plan | validate_recovery_plan
   ▼
tools/*.ts            validate input (Zod), log, map errors to tool errors
   │  loadPlanningData(): checkPlanningWindow(), then repositories only
   ▼
ScheduleRepository.findOverlapping(range)      TaskRepository.findTasks({deadline in [start, end]})
   │  plain ScheduleEvent[] and Task[]
   ▼
recovery/*.ts         pure functions: no SQL, no I/O, no clock, no randomness
   │  analyzeConflicts()  generateRecoveryPlans()  validateRecoveryPlan()
   ▼
structured result (Zod output schema) + readable text, logged with counts and timing
```

All three tools share the same two repositories (injected through `ServerDeps`, as before) and the same scheduling primitives in `recovery/schedule.ts`: one planning-context builder, one overlap function, one task-capacity function. `server.ts` registers them next to the Phase 2 tools. There is no new HTTP route; everything goes through the MCP endpoint, and all five tools carry read-only annotations.

### The planning context

`buildPlanningContext` validates the interval (explicit offsets, end after start, at most 14 days, at most 500 events), resolves the disruption target, and produces two schedules as arrays of `{id, startMs, endMs}`: the **baseline** (as stored) and the **projected** (target's end extended by the overrun). Both are in-memory copies. Fixed-ness of an event comes from one function, `fixedReasons`: `immovable`, `critical_priority`, `user_protected`, or `disrupted_event`. All comparisons use epoch milliseconds and half-open intervals via the existing `overlaps` helper. Derived timestamps use `isoAtOffsetOf`, which keeps the offset of the event they derive from, so local-time semantics are preserved in output.

### Generation and validation are deliberately separate

```
generateRecoveryPlans ──► placement.ts (greedy, ordered)  ──► candidate payload
                                                                   │
                                                                   ▼
                                              validateRecoveryPlan(payload, {events, tasks})
                                                   │ rebuilds the schedule from stored events + disruption + changes
                                                   ▼
                                       valid ► returned, ranked    invalid ► discarded with the reason
```

The generator hands each candidate to `validateRecoveryPlan` as a plain payload, the same entry point an external caller uses through MCP. The validator imports nothing from `placement.ts` and ignores everything in the plan except its interval, disruption, protected IDs and changes. So a defect in the generator surfaces as a rejected candidate instead of a wrong answer, and a hand-built or tampered plan is checked as thoroughly as a generated one. This independence is enforced by tests: a plan carrying `validation.isValid: true` is rejected when it breaks a rule, and a mutation that makes the validator trust that claim fails the suite.

### Task capacity

`taskCapacity.ts` answers one aggregate question: is there enough unoccupied calendar time before each deadline for the cumulative remaining effort due by then? Details and assumptions are in the README. The disrupted schedule is modelled as "stored schedule with the overrun's minutes paid in full" rather than as the union of overlapping events, because a union double-counts overlapped minutes and would make resolving an overlap look like the plan's fault. Findings carry an origin (`pre_existing`, `disruption`, `plan_introduced`); only a plan-introduced infeasibility is a hard violation.

### Design decisions

- **Greedy, forward-only placement.** It is small, deterministic and explainable, and it reports failure instead of relaxing a rule. It does not search exhaustively and makes no optimality claim. Moving events only later keeps explanations simple ("pushed back by the overrun") and avoids pulling events into time the user may not be available.
- **Strategies are cheap variations, not a solver.** Ordering (chronological or by priority) and buffer size are the only differences; every strategy obeys the same hard constraints.
- **Scores order valid plans; they never decide validity.** Hard violations are compared first, outside the arithmetic.
- **Content-derived plan IDs.** Without a plan table (a later phase), the validator takes the plan in the request, and a SHA-256-derived ID makes candidates comparable across calls.
- **Zod schemas are the single source of truth.** Engine types are inferred from the same schemas the tools advertise, so there are no competing models. `planPayloadSchema` is a loose object, which is why a whole candidate can be submitted unchanged.
- **Typed input errors.** `RecoveryInputError` (with a code) separates unusable requests from internal failures; tools turn it into a clear tool error and the validator turns it into a failed check.

### Seams left for later phases

| Later phase | Where it plugs in |
| --- | --- |
| Approval and applying a plan | A new write path on the repositories plus a plan/action-history migration. The validator is already the gate: an apply tool should re-run `validateRecoveryPlan` against current data immediately before writing, since the calendar may have changed since the proposal. |
| More disruption types | A new member of the disruption schema and a branch in `buildPlanningContext` that produces the projected schedule; placement, validation and scoring already work on slots. |
| Natural-language agent | Calls the same three tools; it maps a sentence to the structured disruption and explains the returned result. It does not choose times. |
| Stored plans | A plan table keyed by the existing `planId`; `validate_recovery_plan` could then accept an ID. |

## Phase 4: the web interface

### Request flow

```
Browser (React client components, apps/web/src/components)
   |  fetch: GET /api/dashboard, POST /api/recovery/analyze | propose | validate
   v
Next.js route handler (apps/web/src/app/api/**)
   |  1. enforce content type and body size, validate the body with Zod (lib/requests.ts)
   |  2. callMcpTool(<fixed tool name>, args, contract schema)   (lib/mcpClient.ts)
   v
Official MCP client  ->  Streamable HTTP  ->  PlanRescue MCP server (Host/Origin guards unchanged)
   v
MCP tool  ->  Recovery Engine  ->  SQLite repositories (read-only)
   ^
   |  structuredContent, checked against the contract, returned with a real activity record
Route handler -> JSON envelope { ok, data | error, activity[] } -> Browser state -> screens
```

`callMcpTool` opens one connection per call, applies a timeout, calls the tool, treats `isError: true` as a tool error (HTTP 422, distinct from an invalid plan), rejects results without valid structured content as malformed (502), maps unreachable and timed-out servers to 503 and 504 with a generic message, and always closes the client in `finally`. Technical detail goes to the server log only.

### Components

| Part | Location | Responsibility |
| --- | --- | --- |
| MCP client helper | `src/lib/mcpClient.ts` | The only code that imports the MCP SDK. Server-side only. |
| Contract | `src/lib/contract.ts` | Loose Zod schemas for tool output. Unknown fields are kept so a candidate reaches the validator unchanged. |
| Request schemas | `src/lib/requests.ts` | Limits mirroring the engine's. Shared by the form and the routes. |
| Config | `src/lib/env.ts` | Validates `PLANRESCUE_*` variables; never exposed to the browser. |
| Route kit | `src/lib/routeKit.ts` | Body limits, uniform envelopes, error-to-status mapping. |
| State | `src/lib/useRecoveryApp.ts` | Moves data between user, routes and screen. Computes no schedule, conflict, score or verdict. Ignores stale responses and marks results out of date when the form changes. |
| Screens | `src/components/*` | Timeline, task list, disruption form, analysis, plan comparison, validation, activity panel. |

### Design decisions

- **The frontend renders; the engine decides.** Conflicts, plans, scores, task-capacity findings and validity are shown exactly as returned. The only arithmetic in the UI is presentation: how far a start time moved, and drawing the reported overrun on the timeline from the user's own input.
- **Server-side MCP client.** Avoids cross-origin access, so the server's Host and Origin checks stay as they were.
- **Allow-listed routes, no generic tool proxy.** Each route calls one fixed tool; extra request fields are rejected.
- **Timestamps are displayed from their own offset**, never converted to the viewer's zone.
- **Failure classes stay distinct.** An invalid plan, a tool-level error, an unreachable server and a malformed result each have their own message and status.
- **The activity panel is evidence, not decoration.** Entries come from records the server created around real calls. A tool never called shows "Not called yet".
- **`apps/web` is a separate npm package** (own `package.json`, lockfile and TypeScript project) so Next's tooling cannot disturb the backend build. The root `tsconfig.json` excludes it.

### Seams left for later phases

- Phase 6 can add approval and apply routes beside the existing ones and a new write-capable MCP tool; the plan-comparison screen already identifies a selected candidate.

## Phase 5: AI agent integration and natural-language orchestration

### Request flow

```
Browser (AgentChat component, apps/web/src/components/AgentChat.tsx)
   │  fetch: POST /api/agent/turn (message, planningWindow, conversation history)
   ▼
Next.js Agent route handler (apps/web/src/app/api/agent/turn/route.ts)
   │  1. Check agent enabled / provider configuration
   │  2. Validate request payload (max size 64KB, max history 10 messages)
   │  3. Call runAgentTurn() in apps/web/src/lib/agent/orchestrator.ts
   ▼
Bounded Orchestrator (src/lib/agent/orchestrator.ts)
   │  Step 1: Retrieve actual events & tasks via MCP (callMcpTool: get_schedule, get_tasks)
   │  Step 2: Pass untrusted calendar data + user prompt to OpenAiProvider
   │  Step 3: Extract structured intent using strict Zod schema (rawExtractedIntentSchema)
   │  Step 4: Deterministic validation:
   │          - Ensure target event ID exists in retrieved events
   │          - Ensure protected event IDs exist in retrieved events
   │          - Ensure overrun minutes are within 1-240
   │          - Check for ambiguity / missing duration -> if needed, return clarification
   │          - Check for unsupported operations -> return polite limitation explanation
   │  Step 5: Call analyze_conflicts via MCP
   │  Step 6: Call propose_recovery_plan via MCP (candidates ranked by engine)
   │  Step 7: Pick top candidate & call validate_recovery_plan via MCP (independent check)
   │  Step 8: Generate grounded explanation from actual tool findings (explanations.ts)
   ▼
JSON response { ok: true, data: AgentTurnData, activity: ActivityRecord[] }
   │
   ▼
Browser (useRecoveryApp.ts updates chat history, analysis, plans, validation, & activity panel)
```

### Key Components

| Part | Location | Responsibility |
| --- | --- | --- |
| Provider Adapter | `src/lib/agent/provider.ts` | Integrates official `openai` SDK (`^7.43.0`) with structured JSON mode and timeouts. Exposes `LlmProvider` interface for dependency injection in tests. |
| Agent Schemas | `src/lib/agent/schemas.ts` | Strict Zod schemas for intent extraction (`supported`, `needs_clarification`, `unsupported`) and route requests. |
| System Prompt | `src/lib/agent/systemPrompt.ts` | Clear role instructions treating event titles and notes as untrusted context; prevents prompt injection; enforces exact event ID resolution. |
| Orchestrator | `src/lib/agent/orchestrator.ts` | Bounded workflow managing tool sequences, timeouts, error cascades, and state transitions. |
| Grounded Explanations | `src/lib/agent/explanations.ts` | Formulates human-readable summaries directly from backend conflict counts, proposed candidate shifts, and validator checks. Never fabricates times. |
| Conversational UI | `src/components/AgentChat.tsx` | Suggested prompt pills, chat message bubbles, status badges, thinking indicators, and smooth scroll to structured controls. |

### Design Decisions & Safety Controls

1. **Separation of Concerns**: The LLM handles natural-language interpretation, event resolution, and user-facing explanations. It never invents calendar slots, moves events, or assesses schedule conflicts.
2. **Explicit Tool Allowlist**: The orchestrator only ever calls the 5 existing read-only tools: `get_schedule`, `get_tasks`, `analyze_conflicts`, `propose_recovery_plan`, and `validate_recovery_plan`.
3. **Untrusted Calendar Data**: Event titles, notes, and task descriptions are explicitly marked as untrusted in the prompt context to prevent indirect prompt injection from calendar entries.
4. **Strict Grounding**: Target event IDs and protected event IDs must match actual records in SQLite returned by `get_schedule`. Hallucinated or invalid IDs trigger clarification or validation errors.
5. **No Mutation / Zero Writes**: The agent workflow is strictly read-only. SQLite is never updated. The UI banner reminds users that the calendar remains unchanged.
6. **Coexistence with Structured Form**: The original `DisruptionForm` remains fully active directly below `AgentChat` with seamless state sharing. If an LLM API key is unconfigured, users receive a clear notice and can use the manual form without interruption.

## Phase 6: Persistent Recovery Plans, Approval Workflow & Safe Execution

Phase 6 turns validated recommendations into persistent, explicitly approved schedule changes with atomic SQLite application and a durable audit trail.

### 1. Plan Lifecycle State Machine

```
              ┌─────────────┐
              │  PROPOSED   │
              └──────┬──────┘
                     │
         ┌───────────┼───────────┐
         │ (reject)  │ (approve) │ (stale detected)
         v           v           v
   ┌───────────┐┌───────────┐┌───────────┐
   │ REJECTED  ││ APPROVED  ││   STALE   │
   └───────────┘└─────┬─────┘└───────────┘
         ^            │ (apply)
         │ (cancel)   │
         └────────────┼───────────┐ (stale detected)
                      v           v
                ┌───────────┐┌───────────┐
                │  APPLIED  ││   STALE   │
                └───────────┘└───────────┘
```

- **PROPOSED**: Candidates generated by the Recovery Engine are validated independently and persisted in `recovery_plans` along with a SHA-256 fingerprint (`snapshot_hash`) of the underlying calendar and tasks.
- **APPROVED**: The user explicitly approves a proposed plan. The server verifies the plan is still current (`snapshot_hash` comparison + re-validation) and transitions status to `approved`. The calendar remains 100% unchanged.
- **APPLIED**: The user explicitly confirms application. The server re-checks preconditions, verifies the snapshot fingerprint, re-validates constraints, and atomically updates event times in SQLite in a single transaction, logging an audit history entry.
- **REJECTED**: A proposed plan is rejected or an approved plan is cancelled before execution. Terminal state; rejected plans can never be applied.
- **STALE**: If any underlying event or task changes before approval or application, fingerprint comparison fails and the plan transitions to `stale`. Outdated plans cannot be applied.

### 2. Database Schema (Migration 2)

Migration 2 adds two `STRICT` SQLite tables:
- `recovery_plans`:
  - `id` (UUID PK), `request_id`, `source_plan_id`, `status` (`proposed`, `approved`, `rejected`, `applied`, `stale`)
  - `plan_json`, `planning_start`, `planning_end`, `snapshot_hash`
  - `created_at`, `updated_at`, `approved_at`, `rejected_at`, `applied_at`
  - Unique index on `(request_id, source_plan_id)` ensuring idempotency
  - Indexes on `status`, `request_id`, `updated_at`
- `action_history`:
  - `id` (UUID PK), `recovery_plan_id` (FK), `action_type` (`plan_saved`, `plan_approved`, `plan_rejected`, `plan_applied`, `plan_stale`, `plan_apply_failed`)
  - `occurred_at`, `actor`, `details_json`
  - Indexes on `recovery_plan_id`, `occurred_at DESC`, `action_type`

### 3. Snapshot Fingerprinting

`computeSnapshotHash(events, tasks)` produces a deterministic SHA-256 hash:
- Sorts events by ID and extracts IDs, titles, start/end timestamps, movability, priority, and categories.
- Sorts tasks by ID and extracts IDs, deadlines, duration, priority, and status.
- Evaluated when plans are saved, re-checked during approval, and re-checked immediately before execution in the write transaction.

### 4. Six New MCP Tools

1. `save_recovery_plans`: Saves candidates from `propose_recovery_plan`, independently validates them, computes snapshot hash, and records `plan_saved` history.
2. `get_recovery_plans`: Queries saved plans with filters (`id`, `status`, `requestId`, `limit`).
3. `approve_recovery_plan`: Checks plan state and snapshot freshness, transitions to `approved`, and logs `plan_approved`. Never modifies calendar events.
4. `reject_recovery_plan`: Rejects proposed plan or cancels pending approval.
5. `apply_approved_plan`: Only tool authorized to modify event times. Requires `approved` status, validates snapshot freshness, verifies before-state times, executes compare-and-swap update in SQLite transaction, sets `applied`, and records `plan_applied` with full before/after timestamps.
6. `get_action_history`: Retrieves chronological audit trail entries.

### 5. Architectural Boundaries & Security

- **LLM Tool Restrictions**: The Phase 5 LLM agent is strictly restricted to read-only tools (`get_schedule`, `get_tasks`, `analyze_conflicts`, `propose_recovery_plan`, `validate_recovery_plan`). Write-capable tools are never exposed to model reasoning.
- **Zero Frontend Authority**: Client claims such as `status: "approved"` are ignored. The MCP server re-reads from SQLite and enforces all business invariants.
- **Atomic Commits**: Schedule updates, `applied` status transition, and audit history entry are committed in a single atomic transaction. Failures roll back completely.

## Phase 7: Comprehensive Hardening, Reliability & Release Readiness

Phase 7 hardens the implementation into a fully verified, resilient, and demonstrably reliable application ready for hackathon evaluation.

### 1. Unified Single-Transaction Atomic Application
- `SqliteRecoveryPlanRepository.applyApprovedPlanAtomically`:
  Encapsulates the entire application workflow in a single synchronous SQLite transaction:
  1. Verifies plan exists and is currently in `approved` status.
  2. Updates all affected rows in `calendar_events` using compare-and-swap statements (`start_time = ? AND end_time = ?`).
  3. Transitions plan status to `applied` with `applied_at` timestamp.
  4. Inserts `plan_applied` entry into `action_history`.
- **Fault-Injection Verified**: If an error occurs at any point (e.g., event state mismatch, inverted time bounds, or synthetic failure), SQLite rolls back the entire transaction. Zero partial writes remain in SQLite, the plan remains `approved`, and no false `plan_applied` audit entry is created. A separate transaction records an `apply_failed` audit entry.

### 2. Comprehensive Stale-Plan Detection
- Snapshot hash SHA-256 fingerprint covers:
  - Events: `id`, `title`, `startTime`, `endTime`, `priority`, `movable`, `category`.
  - Tasks: `id`, `title`, `estimatedDurationMinutes`, `deadline`, `priority`, `status`.
- Verified across:
  - Calendar event alterations (start, end, title, or category).
  - Task alterations (deadline or estimated duration).
- Either modification triggers a snapshot mismatch, rejects the application, marks the plan as `stale`, and logs a `plan_stale` audit entry.

### 3. Concurrency & Idempotency Safeguards
- Duplicate `save_recovery_plans` calls return existing plan IDs and records without duplicating rows.
- Duplicate `approve_recovery_plan` calls return the approved plan state idempotently without duplicate history entries.
- Duplicate `apply_approved_plan` calls detect the `applied` status and return the existing applied state without touching calendar events.
- Racing concurrent application requests are serialized by SQLite write locks and status checks, ensuring exactly one application commits.

### 4. End-to-End Release Smoke Verification
- Full 19-step lifecycle smoke test (`tests/release-smoke.test.ts`) verifies the complete journey against a fresh SQLite database and real MCP server over Streamable HTTP:
  `Propose -> Save -> Approve -> Confirm -> Apply -> Verify DB -> Record History -> Server Restart -> Persistent Verification -> Idempotent Re-apply`.

## Known Limitations

* **Single-User Local Prototype**: The application is designed for local developer evaluation; actor classification is tracked as `local-user` rather than an enterprise multi-tenant IAM system.
* **Local Calendar Target**: Execution modifies the local PlanRescue SQLite calendar database; integration with Google Calendar or Microsoft Graph APIs is intentionally out of scope.
* **Disruption Types**: Focused on `event_overrun` scenarios; travel delays and multi-day replanning remain future extensions.
