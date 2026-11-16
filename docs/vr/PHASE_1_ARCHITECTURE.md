# Phase 1 Architecture Document: PlanRescue Spatial

**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Document:** VR Application Foundation & Architecture  
**Date:** November 2026  
**Status:** Implemented & Verified  

---

## 1. System Architecture Overview

PlanRescue Spatial extends the PlanRescue consequence-aware schedule recovery engine into a spatial computing application for Meta Quest headsets. Phase 1 establishes an independent, production-oriented application foundation under `apps/vr/`.

```
+-----------------------------------------------------------------------------------+
|                            PLANRESCUE SPATIAL ARCHITECTURE                        |
+-----------------------------------------------------------------------------------+

 [ Meta Quest 3 / Horizon OS Browser / IWER Desktop Emulator ]
                            |
                            v
       +-----------------------------------------+
       |           apps/vr (Vite + IWSDK)        |
       |  +-----------------------------------+  |
       |  | App Lifecycle Manager             |  |
       |  | (INITIALIZING -> READY / XR_AVAIL)|  |
       |  +-----------------+-----------------+  |
       |                    |                    |
       |     +--------------+--------------+     |
       |     |                             |     |
       |     v                             v     |
       |  +---------------------+  +----------+  |
       |  | SpatialWorld        |  | XrLife-  |  |
       |  | (Three.js WebGL2,   |  | cycle    |  |
       |  |  Scene, Lights,     |  | Manager  |  |
       |  |  Podium Anchor)     |  |          |  |
       |  +---------------------+  +----------+  |
       |     |                             |     |
       |     +--------------+--------------+     |
       |                    |                    |
       |                    v                    |
       |  +-----------------------------------+  |
       |  | Typed PlanRescueApiClient         |  |
       |  | (Timeout, AbortSignal, Backoff)   |  |
       |  +-----------------+-----------------+  |
       +--------------------|--------------------+
                            |
                (HTTPS REST API Boundary)
                            |
                            v
       +-----------------------------------------+
       |      apps/web (Next.js Route Handlers)  |
       |  /api/dashboard                         |
       |  /api/recovery/analyze                  |
       |  /api/recovery/plans                    |
       |  /api/recovery/plans/[id]/approve       |
       |  /api/recovery/plans/[id]/apply         |
       +--------------------+--------------------+
                            |
                 (Streamable HTTP / Localhost)
                            |
                            v
       +-----------------------------------------+
       |  apps/mcp-server (PlanRescue MCP Server)|
       +--------------------+--------------------+
                            |
                 (Internal Function Calls)
                            |
                            v
       +-----------------------------------------+
       |   Deterministic Recovery Engine         |
       |   (Conflict Analyzer, Placement,        |
       |    Independent Validator, Scorer)       |
       +--------------------+--------------------+
                            |
                     (better-sqlite3)
                            |
                            v
       +-----------------------------------------+
       |       Persistent SQLite Database        |
       +-----------------------------------------+
```

---

## 2. Application Bootstrap Flow

The bootstrap sequence (`apps/vr/src/app/bootstrap.ts`) executes a deterministic, multi-stage initialization pipeline:

```
[Start bootstrapApplication()]
              |
              v
 [Stage 1: Initialize AppLifecycleManager]
   -> Set state = INITIALIZING
              |
              v
 [Stage 2: Configuration Loader]
   -> Resolve priority: window.__PLANRESCUE_VR_CONFIG__ > /config.json > import.meta.env
   -> Validate with Zod vrConfigSchema
   -> On failure: transitionTo(CONFIGURATION_ERROR) & throw
              |
              v
 [Stage 3: Initialize Logger & Diagnostics]
   -> Apply validated logLevel
   -> Register redaction filter for credentials & tokens
              |
              v
 [Stage 4: Detect Runtime Capabilities]
   -> Check window.isSecureContext
   -> Check navigator.xr availability
   -> Query navigator.xr.isSessionSupported('immersive-vr')
   -> Verify WebGL2 hardware rendering
   -> Check XRHand input joint presence
   -> Check desktop emulation signatures
              |
              v
 [Stage 5: Initialize 3D World]
   -> Create Three.js Scene, Camera, Lighting, Ground Grid, Podium Anchor
   -> Attach WebGLRenderer (with renderer.xr.enabled = true)
   -> Setup ResizeObserver for responsive canvas scaling
              |
              v
 [Stage 6: Initialize XR Lifecycle Manager]
   -> Bind input source change & visibility listeners
   -> Hook into Three.js XR animation loop
              |
              v
 [Stage 7: Initialize Typed API Client]
   -> Configure baseUrl from validated config
   -> Configure default timeouts and safe retry policies
              |
              v
 [Stage 8: Determine Final Application State]
   -> If canEnterImmersiveVr: transitionTo(XR_AVAILABLE)
   -> Else if WebGL2 ready: transitionTo(READY)
   -> Else: transitionTo(UNSUPPORTED_ENVIRONMENT)
```

---

## 3. Meta IWSDK & Manifest-First Integration

`apps/vr` adheres strictly to Meta's modern manifest-first architecture:
- **Project Manifest (`iwsdk.config.json`)**:
  - Serves as the single declarative authority for project identity, active scene, world features, and emulation defaults.
  - Declares `world.xr.mode: "vr"` and `world.xr.features.handTracking: { "required": true }`.
  - Enables interaction features (`world.features.grabbing: true`).
- **Native Scene (`public/scenes/main.iwsdk.scene.json`)**:
  - Declares starter spatial environment with ambient lighting, directional key light, and Schedule Horizon Anchor Podium.
- **Vite Integration (`vite.config.ts`)**:
  - Uses manifest-first plugin exposing `virtual:iwsdk-project` directly from `iwsdk.config.json`.
  - Configures `@/` module alias pointing to `src/`.
  - Avoids conflicting legacy inline plugin options.

---

## 4. XR Lifecycle Management & State Machine

The XR lifecycle (`apps/vr/src/platform/xrLifecycle.ts`) guarantees robust session management:
1. **Entry Protection**: `requestSession('immersive-vr')` checks whether a session is already requesting or active, preventing duplicate session requests.
2. **Input Source Tracking**: Listens for `inputsourceschange` events, mapping controller profiles, handedness, and hand joint presence without assuming physical hardware.
3. **Visibility & Backgrounding**: Listens for `visibilitychange`. Transitions to `SUSPENDED` when the user opens the Quest system menu (`visible-blurred` or `hidden`) and resumes to `ACTIVE` when focus returns (`visible`).
4. **Clean Termination**: `endSession()` removes all event listeners, detaches Three.js session references, and cleans up resources without memory leaks.
5. **Re-entry Capability**: Transitions through `ended` back to `idle`, enabling users to seamlessly enter and exit VR repeatedly within the same page session.

---

## 5. Centralized Configuration & Zero Hardcoding

In accordance with Critical Development Principle A, no application data, API endpoints, user profiles, or meeting dates are hardcoded.

```
+---------------------------------------------------------------------------------+
|                       CONFIGURATION SCHEMA (src/config/schema.ts)               |
+---------------------------------------------------------------------------------+
| appEnv           | enum: 'development' | 'test' | 'staging' | 'production'      |
| apiBaseUrl       | string: valid HTTP/HTTPS URL (e.g. http://127.0.0.1:3000)    |
| logLevel         | enum: 'debug' | 'info' | 'warn' | 'error'                    |
| requestTimeoutMs | int: 1000 - 60000 (default: 15000)                           |
| xr.sessionMode   | enum: 'immersive-vr' | 'inline'                              |
| xr.enableHandTr. | boolean (default: true)                                      |
| xr.enableEmulat. | boolean (default: true)                                      |
+---------------------------------------------------------------------------------+
```

### Promotion Across Environments
- In local development: loads `import.meta.env` from `.env`.
- In staging/production: `public/config.json` can be rewritten or mounted dynamically without recompiling JavaScript bundles.
- In containerized deployments: `window.__PLANRESCUE_VR_CONFIG__` can be injected directly into `index.html`.

---

## 6. Typed API Client & Boundary Security

`PlanRescueApiClient` (`apps/vr/src/api/client.ts`) enforces strict architectural boundaries:
- **No Direct SQLite Access**: The VR client has zero database libraries or direct SQLite bindings.
- **No Direct MCP Access**: The VR client never directly connects to `apps/mcp-server` over port 3001. All calls are mediated by Next.js server route handlers.
- **Contract Enforcement**: Incoming payloads are validated against Zod contracts (`dashboardDataSchema`, `conflictAnalysisSchema`, `recoveryPlanSetSchema`).
- **Cancellation & Timeout**: Every call supports `AbortSignal` and enforces a strict configurable timeout.
- **Idempotency Safeguard**: Safe retries with exponential backoff are permitted **only** on idempotent `GET` requests (e.g. `getDashboard`). State-altering `POST` calls (`approvePlan`, `applyPlan`) are **never** retried automatically to prevent duplicate or conflicting execution.

---

## 7. Diagnostics, Error Handling & Data Redaction

- **Error Normalization**: `normalizeError()` categorizes all exceptions into `configuration`, `initialization`, `xr_unsupported`, `xr_session`, `rendering`, `api_transport`, or `runtime_unexpected`.
- **User Safety**: Technical messages are sanitized. Absolute filesystem paths (e.g., `C:\...`) and stack traces are stripped from user-facing prompts.
- **Sensitive Data Redaction**: The structured logger filters out sensitive keys matching `/token/i`, `/secret/i`, `/password/i`, `/auth/i`, `/key/i`, `/credential/i`, and `/bearer/i`.

---

## 8. Automated Testing Architecture

`apps/vr` includes a dedicated Vitest testing suite (`apps/vr/tests/`):
- `tests/config.test.ts`: Tests schema validation, URL constraints, timeout limits, and environment variable parsing.
- `tests/capabilities.test.ts`: Tests WebXR availability checks, missing API handling, and input source summaries.
- `tests/lifecycle.test.ts`: Tests state machine transitions, subscriber notifications, and repeated start protection.
- `tests/apiClient.test.ts`: Tests JSON parsing, server error mapping, contract validation failures, timeout abortion, and retry safety.
- `tests/diagnostics.test.ts`: Tests log level filtering, token redaction, and error normalization.
- `tests/bootstrap.smoke.test.ts`: End-to-end smoke test validating the full application initialization and disposal in a headless environment.

All 6 test files and 26 tests pass with 100% success.

---

## 9. Readiness for Subsequent Phases

Phase 1 provides the complete foundation required for:
- **Phase 2 — Spatial Environment & Visual Design System**: Studio environment rendering, lighting design, spatial calendar layout, and design tokens.
- **Phase 3 — Interactive Spatial Calendar & Hand Manipulation**: Movable schedule blocks, ray/poke hand interactions, and grab-and-drop mechanics.
- **Phase 4 — Disruption Reporting & Spatial AI Assistant**: 3D spatial conversational panels, AI turnaround, and grounded recovery options.
- **Phase 5 — Spatial Plan Comparison & Decision Inspection**: Side-by-side alternative schedule comparison in virtual space.
- **Phase 6 — Approval Workflow & Spatial Schedule Execution**: Two-step physical approval gesture, atomic execution, and schedule animation.
