# Architecture Decision Records (ADRs): PlanRescue Spatial

**Project:** PlanRescue Spatial  
**Scope:** Phase 0 (Audit & Foundation) & Phase 1 (VR Foundation & Architecture)  
**Date:** November 2026  
**Status:** Approved & Implemented  

---

## ADR-001: Independent Package Isolation for `apps/vr`

### Context
PlanRescue currently contains an MCP backend (`apps/mcp-server`) and a Next.js web application (`apps/web`). The repository is structured as independent packages rather than an npm workspace monorepo. Root `package.json` manages backend dependencies, scripts, and Vitest test suites, while `apps/web/package.json` independently manages Next.js, React, Testing Library, and its own Vitest config. Root `tsconfig.json` uses NodeNext resolution and strictly excludes `apps/web`.

Introducing the Meta Immersive Web SDK (IWSDK) requires Vite, Three.js (`super-three`), WebXR DOM libraries, and browser/graphics tooling.

### Alternatives Considered
1. **Convert repository to an npm / pnpm workspace monorepo**: Hoists dependencies to root node_modules and unifies scripts under workspaces.
2. **Merge VR dependencies into root `package.json`**: Bundles Three.js and Vite alongside better-sqlite3 and @modelcontextprotocol/server.
3. **Independent package in `apps/vr/` with its own `package.json` and isolated `tsconfig.json`**: Mirrors the proven pattern established by `apps/web`.

### Decision
Option 3: Maintain `apps/vr` as an independent package with its own `package.json`, isolated lockfile, independent `tsconfig.json`, and dedicated Vite configuration. Add root scripts (`npm run vr:dev`, `npm run vr:build`, `npm run vr:typecheck`, `npm run vr:test`, `npm run vr:preview`) using `--prefix apps/vr`. Add `apps/vr` to root `tsconfig.json` `exclude` array to prevent browser-specific DOM/WebXR source files from polluting backend NodeNext compilation.

### Consequences & Implications
- **Preservation of Existing Systems**: Backend and Next.js dependency resolutions and lockfiles remain completely undisturbed.
- **Strict Separation of Concerns**: Browser/WebXR typings cannot leak into Node.js server code, and Node.js native dependencies (`better-sqlite3`) cannot leak into the VR bundle.
- **Independent CI/CD**: The VR application can be built, type-checked, and tested independently or as part of repository-wide checks.

---

## ADR-002: Server-Side API Boundary for VR Integration

### Context
PlanRescue possesses a deterministic Recovery Engine and SQLite database accessed via a Streamable HTTP MCP server (`apps/mcp-server`). The existing Next.js web application (`apps/web`) communicates with the MCP server exclusively through server-side route handlers (`/api/dashboard`, `/api/recovery/analyze`, `/api/recovery/plans`, `/api/recovery/plans/[planId]/approve`, etc.). The VR application needs access to schedules, tasks, disruption analysis, recovery proposals, approvals, and execution.

### Alternatives Considered
1. **Direct SQLite connection from VR client**: Browser/WebXR code opens a SQLite connection or WASM SQLite in the headset.
2. **Direct MCP connection over WebSockets or HTTP to `apps/mcp-server` from the browser**: WebXR client connects directly to `http://localhost:3001/mcp`.
3. **Consuming Next.js Route Handlers as Authenticated HTTPS API Boundary**: VR client connects via typed fetch client to Next.js routes, which mediate calls to the MCP server via `callMcpTool`.

### Decision
Option 3: VR client communicates exclusively with the existing Next.js API route handlers over an authenticated/configurable HTTPS boundary. 

### Invariants Enforced
- **Zero SQLite Access**: Browser code never connects directly to SQLite.
- **Zero Direct MCP Exposure**: Browser code never connects directly to internal `/mcp`. Host/Origin guards on MCP server remain uncompromised.
- **Zero Secret Leakage**: AI provider credentials (OpenAI API keys, AWS credentials) remain strictly server-side.
- **Zero Logic Duplication**: Deterministic scheduling calculations, conflict algorithms, scoring penalties, snapshot hashes, and validation rules remain strictly inside the Recovery Engine.
- **Preserved Approval & Atomic Execution**: Plan approval and execution protections remain atomic and server-enforced.

---

## ADR-003: Manifest-First Meta IWSDK Architecture with `iwsdk.config.json`

### Context
Meta's Immersive Web SDK (IWSDK) represents the modern standard for WebXR and Horizon OS spatial development. Earlier WebXR workflows relied on manual boilerplate, custom WebXR render loops, or legacy Vite plugin options. Current official IWSDK guidelines mandate a manifest-first approach using `iwsdk.config.json` and the `iwsdkDev()` Vite plugin.

### Alternatives Considered
1. **Raw Three.js WebXR Implementation**: Writing manual `XRSession.requestSession` and custom animation loops from scratch without an SDK framework.
2. **Legacy Inline Plugin Configuration**: Passing emulator, AI, and scene configurations directly into Vite plugin arguments.
3. **Official Manifest-First IWSDK Architecture**: Using `iwsdk.config.json` as the single source of truth for scenes, XR features (hand-tracking, grabbing), and emulator configuration, combined with bare `iwsdkDev()` in `vite.config.ts`.

### Decision
Option 3: Adopt the official manifest-first IWSDK architecture.
- `iwsdk.config.json` configures the active native scene (`public/scenes/main.iwsdk.scene.json`), world XR features (VR mode, required hand tracking), and interaction features (grabbing).
- `vite.config.ts` utilizes bare `iwsdkDev()` without conflicting legacy inline options.
- Application bootstrap leverages IWSDK ECS runtime and systems.

### Consequences & Implications
- **Meta Quest Compatibility**: Aligns directly with Meta Horizon OS guidelines and Meta VR Start Developer Competition 2026 standards.
- **Desktop IWER Emulation**: Enables full headset-free development on desktop browsers with simulated hand and 6DoF controller input.
- **Asset Optimization**: Builds automatically optimize bundle payloads based on manifest-toggled features (e.g. omitting unused physics engines).

---

## ADR-004: Centralized Strict Configuration Schema with Runtime Injection Support

### Context
Critical Development Principle A strictly forbids hardcoding application data (API URLs, user identifiers, calendar dates, meeting names, credentials, timezones). Configuration must be environment-driven and validate schema at initialization. Furthermore, single-page application builds should support promotion across environments without rebuilding JavaScript bundles.

### Alternatives Considered
1. **Compile-time `import.meta.env` with hardcoded fallback strings scattered in code**: Standard Vite approach, prone to silent fallback failures and hardcoding.
2. **External unvalidated runtime JSON file (`config.json`)**: Allows runtime modification but lacks schema validation, resulting in runtime runtime exceptions.
3. **Dual-Layer Validated Configuration Architecture**:
   - Centralized Zod schema (`config/schema.ts`).
   - Priority loader: Runtime Window injection (`window.__PLANRESCUE_VR_CONFIG__`) > Runtime fetch (`/config.json`) > Vite build-time environment variables (`import.meta.env`).
   - Strict validation failing fast at bootstrap with clear diagnostic error if required parameters are missing or invalid.

### Decision
Option 3: Implement a Dual-Layer Validated Configuration System.
- Define `VrConfig` schema using Zod.
- Support `PLANRESCUE_VR_APP_ENV`, `PLANRESCUE_VR_API_BASE_URL`, `PLANRESCUE_VR_LOG_LEVEL`, `PLANRESCUE_VR_REQUEST_TIMEOUT_MS`.
- Provide zero hardcoded fake schedules, dates, or credentials.
- Fail explicitly with `ConfigurationError` during bootstrap if configuration is invalid.

---

## ADR-005: Strict Capability Detection vs. Emulation Truthfulness

### Context
Developers frequently conflate "configured capability" with "runtime available capability" or mistake browser desktop emulation for physical headset verification. The application must accurately detect WebXR, secure context, WebGL2, and actual input sources.

### Alternatives Considered
1. **Assume capability based on manifest**: If manifest specifies `handTracking: true`, report hand tracking as active.
2. **Strict Runtime Capability Detection**: Programmatically query `navigator.xr.isSessionSupported('immersive-vr')`, `window.isSecureContext`, WebGL context support, and actual active `XRInputSourceArray` joints at runtime.

### Decision
Option 2: Implement a dedicated `XrCapabilityDetector` module.
- Accurately categorize capability into:
  1. *Configured*: Declared in project manifest.
  2. *Supported*: Browser API support (`isSessionSupported`).
  3. *Available*: Hardware/input active (`XRInputSource.hand != null`).
  4. *Active*: Initialized in active session.
- Desktop emulation is explicitly identified as simulated development mode, never reported as physical Meta Quest hardware verification.

---

## ADR-006: Structured Diagnostics and Sensitive Data Redaction

### Context
Debugging spatial interactions and network requests requires rich logging. However, calendar entries, user names, auth tokens, and sensitive headers must never be leaked into client console logs or diagnostics files.

### Alternatives Considered
1. **Ad-hoc `console.log` statements**: High risk of credential/PII leakage, impossible to toggle verbosity.
2. **Centralized Structured Logger with Redaction Filter**: Configurable log levels (`debug`, `info`, `warn`, `error`), structured log entries with timestamps, and automated redaction of sensitive keys (`token`, `key`, `password`, `secret`, `authorization`, `notes`, `description`).

### Decision
Option 2: Implement centralized `VrLogger` and `VrDiagnostics` modules with built-in redaction, structured event tracking, and error normalization.

---

## ADR-007: Three-Zone Spatial Studio Layout and Design Token Architecture

### Context
Users entering VR need an ergonomic, distraction-free environment that accommodates schedule management, disruption modeling, AI assistance, and comparative evaluation without overwhelming visual clutter or neck fatigue.

### Decision
Adopt a 3-zone ergonomic layout positioned within standard Quest reach and gaze envelopes (1.2m–2.2m distance, -15° to +20° vertical gaze, ±45° horizontal azimuth):
1. **Left Wing (-30° to -45° azimuth)**: Disruption & Scenario Management Panel.
2. **Center Stage (0° azimuth, 1.4m distance)**: Interactive Spatial Timeline, Task Panel, and Dual-Track Comparison Workspace.
3. **Right Wing (+30° to +45° azimuth)**: PlanRescue AI Assistant, Independent Validation Explorer, and Action History / Audit Trail.
All styling is centralized in `src/ui/tokens.ts` (colors, glassmorphic transparencies, bevels, dimensions, animation durations).

---

## ADR-008: Direct Pointer Ray & Proportional Drag-Plane Hand Interaction

### Context
Meta Quest supports both optical hand tracking and 6DoF Touch controllers. Users need natural, intuitive ways to select calendar events, grab cards, drag them to new positions, and press spatial buttons.

### Decision
Implement `HandInteractionManager` and `DesktopInteractionFallback`:
- Query `XRInputSourceArray` for hand joints and target rays.
- Use direct raycasting for point/click triggers with hover highlighting.
- For grabbing movable cards, project onto a virtual drag plane perpendicular to the camera gaze or along the timeline axis.
- Provide desktop mouse raycasting fallback (`DesktopInteractionFallback`) for browser development without a physical headset.
- Provide an interactive, persistent gesture onboarding tutorial (`SpatialOnboardingTutorial`) teaching gaze, ray pointing, pinch selection, and grab-drag movements.

---

## ADR-009: Proportional Spatial Timeline with 15-Minute Snapping and Fixed-Event Locks

### Context
A 2D calendar grid does not translate well to VR. Events need physical presence representing duration, priority, and fixed vs. movable status.

### Decision
Implement `SpatialTimeline` and `SpatialEventBlock`:
- Timeline bar spanning 1.4m width represents the daily planning window (e.g. 08:00 to 20:00).
- Event blocks are placed horizontally proportional to their start time and duration, with depth (0.015m) and glassmorphic materials.
- Fixed events display an explicit lock badge and cannot be moved or dragged.
- Movable draft events snap to 15-minute increments along the timeline bar during drag interactions.
- Priority color stripes (Critical/Red, High/Orange, Medium/Blue, Low/Green) provide immediate visual hierarchy.

---

## ADR-010: Boundary-Constrained Disruption Definition & Conflict Visualization

### Context
Users must model delays, emergencies, and extended meetings without fabricating data or submitting invalid bounds.

### Decision
Implement `SpatialDisruptionPanel` and `SpatialConflictVisualizer`:
- Delay durations are strictly bounded between 1 and 240 minutes with quick presets (+15m, +30m, +45m, +60m) and fine steppers (+5m / -5m).
- Projected end times are calculated deterministically from the selected event's start time and current duration.
- Colliding downstream events and at-risk task deadlines are visualized on `SpatialConflictVisualizer` with clear severity badges prior to proposal generation.

---

## ADR-011: Server-Grounded Multi-Strategy Recovery Engine Integration

### Context
AI schedule recovery must never hallucinate options or invent scheduling scores on the client. It must execute the deterministic backend engine across all three strategies (`minimal_disruption`, `buffered_transitions`, `priority_first`).

### Decision
Implement `SpatialRecoveryManager` and `SpatialAssistantPanel`:
- Direct integration with `PlanRescueApiClient.proposeRecovery()` passing `saveCandidates: true`.
- Captures backend `persistentId` and `savedStatus` directly from the server.
- Visualizes server-generated trade-offs, objective function scores, and penalty decompositions (delay penalty, moved count, overflow).
- AI assistant formulates grounded, factual explanations of trade-offs and protected constraints without LLM hallucinations.

---

## ADR-012: Dual-Track Comparative Workspace & Validation Explorer

### Context
Users must clearly see what changes between their current schedule and proposed recovery before committing.

### Decision
Implement `SpatialComparisonWorkspace` and `SpatialValidationExplorer`:
- Visualizes Before (Current) and After (Proposed) tracks synchronously on vertical parallel tracks (0.16m vertical separation).
- Highlights displaced, shortened, or shifted events with glow borders and delta indicators.
- Displays comprehensive independent validation results (hard constraints vs warning recommendations) across time-window bounds, fixed-event immutability, break minimums, and task feasibility.

---

## ADR-013: Server-Enforced Two-Step Approval/Execution Separation & Audit Trail

### Context
Critical Development Principle: Candidate selection is not approval; approval alone does NOT mutate the calendar; execution requires a separate, explicit confirmation step. Stale plans must be rejected.

### Decision
Implement `SpatialApprovalWorkflow` and `SpatialActionHistoryPanel`:
- Step 1: User explicitly clicks "Approve Plan Proposal" -> calls `POST /api/recovery/plans/[planId]/approve`. State moves to `approved`. The schedule is NOT yet mutated.
- Step 2: Separate "Confirm & Execute Schedule Changes" action button becomes active. Clicking triggers `POST /api/recovery/plans/[planId]/apply`. The backend atomically commits changes within a SQLite transaction.
- If the backend rejects application due to schedule staleness (e.g. concurrent update or hash mismatch), the workflow detects the error, displays a stale warning, and guides the user to recalculate.
- After execution, `SpatialActionHistoryPanel` renders the persistent audit trail fetched from `GET /api/actions/history`.
