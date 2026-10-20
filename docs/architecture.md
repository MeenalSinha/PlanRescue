# PlanRescue architecture (Phase 0 and Phase 1)

This document describes what exists today and the seams left for later phases. Anything not listed under "Implemented" is planned and is not in the code.

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
   - registers get_schedule (tools/getSchedule.ts)
        |
        v
 ScheduleRepository (types.ts)  <-  SeedScheduleRepository (data/seedSchedule.ts)
```

### Request flow for `get_schedule`

1. The SDK parses the JSON-RPC request and negotiates the protocol revision.
2. The SDK validates `arguments` against the zod schema (`startTime`, `endTime`: ISO 8601 with an explicit offset). A failure becomes an `isError` tool result; `withValidationReporting` makes sure it is also logged.
3. The handler converts both timestamps to epoch milliseconds, rejects an end that is not after the start, and asks the repository for overlapping events.
4. The handler returns `structuredContent` and a text rendering, and logs the interval, the match count and the outcome.

### Design decisions

- **Official SDK for all protocol work.** `createMcpHandler` serves the 2026-07-28 revision and, by default, falls back to stateless 2025-era Streamable HTTP. There is no hand-written JSON-RPC.
- **Stateless serving.** A fresh `McpServer` is built per request, so there is no session store to scale or lose. This also makes the server straightforward to run behind a load balancer later. The consequence is that features that need server-initiated streams across requests are not available.
- **Plain `node:http`, no web framework.** One route plus a health check does not justify a framework. The SDK's Node adapter supplies the Host/Origin guards.
- **Half-open interval semantics** (`start < queryEnd && end > queryStart`) live in one function, `overlaps` in `lib/time.ts`, and are covered by unit tests and by the MCP smoke test.
- **Instants, not wall-clock strings.** Every comparison is done on epoch milliseconds after parsing the offset, so the same moment written in `+05:30`, `Z` or `-05:00` gives the same answer.
- **Repository seam.** `ScheduleRepository.findOverlapping` is the only thing the tool knows about storage.
- **Configuration through the environment**, validated at startup with names in the error message. No secrets exist in this phase.

## Seams for later phases

| Later phase | Where it plugs in |
| --- | --- |
| SQLite data layer | A new `ScheduleRepository` implementation, passed in `index.ts`. Tasks and history would add sibling interfaces in `types.ts`. |
| More tools (tasks, apply changes) | New files under `tools/`, registered in `server.ts`. |
| Recovery Engine | A pure module the tools call. It should consume the same `ScheduleEvent` shape, which already carries `priority` and `movable`. |
| Web UI | `apps/web/`, talking to the same MCP endpoint. |
| Public deployment | Set `MCP_HOST`/`MCP_ALLOWED_HOSTS`, put TLS in front, and add authentication. The SDK ships bearer-auth and OAuth metadata helpers for this. None of it is configured today. |

## Known limits of this phase

- No authentication or authorization.
- No persistence; the seeded data is in memory and read-only.
- A single tool.
- Only extended-format ISO 8601 offsets are accepted (`+05:30`, not `+0530`).
