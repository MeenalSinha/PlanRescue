# PlanRescue

> Your day changed. Your assistant has a plan.

PlanRescue is a consequence-aware schedule recovery agent. When a meeting runs late or an urgent task appears, a calendar app shows the damage but leaves you to untangle it. PlanRescue is being built to read your calendar and tasks, find the conflicts and threatened deadlines, evaluate alternative schedules, recommend a recovery plan that respects your constraints, explain it, ask for approval, and apply it.

This repository is the submission for the **Amazon Developer Hackathon 2026, Alexa+ track**. That track requires a genuine MCP server over the Streamable HTTP transport, so the first thing built here is exactly that: a real MCP server, exercised by a real MCP client.

## Current scope (Phase 0 and Phase 1)

Implemented and verified:

- A TypeScript project foundation with scripts, environment configuration, tests and CI.
- A real MCP server built on the official TypeScript SDK (v2), served over Streamable HTTP.
- One tool, `get_schedule`, that returns calendar events overlapping a time interval, from a small deterministic seeded schedule (22 October 2026, Asia/Kolkata).
- Strict input validation, structured output plus a readable text rendering, and logs that show what actually happened.
- An end-to-end smoke test that starts the built server as a separate process and talks to it with the official MCP client over HTTP.

Planned, not implemented (do not read the list below as features):

- Data layer (SQLite) and additional scheduling tools (Phase 2)
- Recovery Engine: conflict detection, alternative schedule generation, plan validation
- AI agent orchestration and LLM integration
- Approval workflow and applying schedule changes
- Web interface, Google Calendar integration, deployment

## Technology

| Area | Choice |
| --- | --- |
| Runtime | Node.js 22 or newer for development and tests (`.nvmrc` pins 22). The server itself needs Node 20.12 or newer. |
| Language | TypeScript 7, ES modules |
| MCP | `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/client` 2.3.1, `@modelcontextprotocol/node` 2.1.1 |
| Validation | zod 4 (a Standard Schema, as the SDK recommends) |
| Transport | Streamable HTTP, plain `node:http` with the SDK's Node adapter |
| Tests | Vitest 5 plus the official MCP client |
| Packages | npm with a committed `package-lock.json` |

## Quick start

```bash
npm ci                # install exactly what the lockfile pins
npm run dev:mcp       # start the server with the TypeScript sources
```

In a second terminal:

```bash
npm run demo:client   # connects over MCP, lists tools, calls get_schedule
npm run test:mcp      # builds, starts a real server process, runs the MCP smoke test
```

The server prints its real configuration on startup:

```
PlanRescue MCP Server
Transport: Streamable HTTP
Endpoint: http://127.0.0.1:3001/mcp
Tool registered: get_schedule
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev:mcp` | Run the server from source with file watching (`tsx watch`) |
| `npm run build` | Clean and compile to `dist/` |
| `npm run start:mcp` | Run the compiled server (`node dist/index.js`) |
| `npm run typecheck` | Type check sources, tests and scripts without emitting |
| `npm run test:unit` | Fast unit tests (time handling, seed data, config, metadata) |
| `npm run test:mcp` | Build, then run the end-to-end MCP smoke test |
| `npm test` | Build, then run every test |
| `npm run check` | Typecheck plus all tests; the same gate CI runs |
| `npm run demo:client` | Demo MCP client against a running server (`MCP_URL` overrides the target) |

To run the smoke test against a server you already started, set `MCP_URL`:

```bash
npm run start:mcp &
MCP_URL=http://127.0.0.1:3001/mcp npx vitest run tests/mcp-smoke.test.ts
```

Log assertions and the shutdown test are skipped in that mode because the test does not own the process.

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

Invalid values stop the server at startup with a message that names the variable.

## MCP endpoint

- Endpoint: `http://127.0.0.1:3001/mcp` (Streamable HTTP)
- Health check: `http://127.0.0.1:3001/healthz` (plain JSON, not part of MCP)
- Protocol: the endpoint serves MCP **2026-07-28** natively and also serves **2025-11-25** through the SDK's stateless 2025-era fallback. Both are exercised by the tests (other 2025-era revisions are handled by the same fallback but are not individually tested). See `docs/implementation-report.md` for the evidence.
- Serving is stateless: no sessions are kept between requests.
- Security defaults: binds to loopback, validates `Host` and `Origin` headers against DNS rebinding, caps request bodies at 4 MiB. There is no authentication yet, so do not expose this server publicly as is.

### The `get_schedule` tool

Input (both required):

```json
{
  "startTime": "2026-10-22T12:00:00+05:30",
  "endTime": "2026-10-22T18:00:00+05:30"
}
```

- Timestamps must be ISO 8601 in extended form with an explicit offset (`+05:30`, `-05:00` or `Z`). Offset-free, malformed, impossible dates (such as 30 February) and a missing parameter are rejected, and so is an `endTime` that is not strictly after `startTime`.
- An event overlaps when it starts before `endTime` and ends after `startTime`. An event that ends exactly at `startTime` is excluded.
- Results are in chronological order. Each event has `id`, `title`, `startTime`, `endTime`, `durationMinutes`, `priority`, `movable`, `category` and optional `notes`.
- The result carries `structuredContent` (`calendarTimeZone`, `query`, `count`, `events`) and a readable text version.
- Invalid input is returned as a tool error (`isError: true`) with a message the caller can act on. The SDK reports its own schema validation failures in the same shape, so callers see one consistent error format.

## Folder structure

```
planrescue/
├── apps/
│   └── mcp-server/
│       └── src/
│           ├── index.ts              Entry point: config, startup banner, signals, shutdown
│           ├── config.ts             Environment parsing and validation
│           ├── http.ts               node:http server, Host/Origin guards, health, MCP mounting
│           ├── server.ts             Builds the McpServer and registers tools
│           ├── logger.ts             Small level-based line logger
│           ├── types.ts              Event schemas and the ScheduleRepository interface
│           ├── lib/
│           │   ├── time.ts           Timestamp validation, overlap rule, durations
│           │   └── validation.ts     Reports tool input validation failures to the log
│           ├── tools/
│           │   └── getSchedule.ts    The get_schedule tool
│           └── data/
│               └── seedSchedule.ts   Seeded events and the repository that serves them
├── tests/
│   ├── helpers/serverProcess.ts      Starts the built server as a child process
│   ├── mcp-smoke.test.ts             Real MCP client over Streamable HTTP
│   ├── time.test.ts
│   ├── seed-data.test.ts
│   ├── config.test.ts
│   └── server-meta.test.ts
├── scripts/demo-client.ts            Demo MCP client
├── docs/
│   ├── architecture.md
│   └── implementation-report.md      Versions, protocol evidence, test results, known issues
├── .github/workflows/ci.yml
├── .env.example  .gitignore  .nvmrc
├── package.json  package-lock.json
├── tsconfig.json  tsconfig.build.json  vitest.config.ts
├── README.md
└── LICENSE
```

When later phases arrive, a web interface slots in as `apps/web/` and shared code can move to `packages/`, without touching the MCP server.

## Replacing the seeded data

The server reads events through the `ScheduleRepository` interface in `types.ts`. To move to a database, implement `findOverlapping(range)` and pass the new repository to `startHttpServer` in `index.ts`. The tool, the server and the tests that go through MCP do not change.

## License

MIT
