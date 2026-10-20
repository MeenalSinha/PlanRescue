# Implementation report: Phase 0 and Phase 1

Status: complete for the scope below. Verified on Linux with Node 22.22.2 and npm 10.9.7, from a fresh `git clone` followed by `npm ci` and `npm run check`.

## Files and roles

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

## MCP compatibility evidence

- Packages: `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/client` 2.3.1, `@modelcontextprotocol/node` 2.1.1, `zod` 4.6.7. These are the stable v2 line; the package READMEs state that v2 implements the 2026-07-28 specification. Exact versions are pinned by `package-lock.json`.
- Transport: Streamable HTTP, endpoint `http://127.0.0.1:3001/mcp` by default. The smoke test uses a free port on 127.0.0.1 instead.
- The server uses `createMcpHandler`, which serves 2026-07-28 and, by default, stateless 2025-era Streamable HTTP.
- Negotiated versions are read from the client at runtime, not written into the README:
  - Modern: the test client pins `2026-07-28` (`versionNegotiation: { mode: { pin } }`), which fails to connect unless the server offers that revision. The test then asserts `getProtocolEra() === 'modern'` and `getNegotiatedProtocolVersion() === '2026-07-28'`. Tool results in this mode carry the SDK's `io.modelcontextprotocol/serverInfo` metadata.
  - Legacy: a default client performs the 2025 `initialize` handshake and negotiates `2025-11-25`, asserted the same way.
  - Both versions are at or above the required floor of 2025-11-25. The test asserts that comparison explicitly.
- The complete tool suite runs once per era (18 tests each).

## Verification results

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

## Known issues and limits

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

## Readiness for Phase 2

Complete: project foundation, a verified Streamable HTTP MCP server, one working tool, a repository seam, real end-to-end tests, CI configuration.

Next milestone: the data layer and further scheduling tools. Concretely, a SQLite-backed `ScheduleRepository`, a task model and tools to read tasks, plus tool tests through the same MCP smoke harness. The recovery engine, agent, approval flow and UI follow after that.
