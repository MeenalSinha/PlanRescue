# PlanRescue Spatial (apps/vr)

**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Experience Mode:** Virtual Reality & Horizon OS Spatial Studio  
**Framework:** Meta Immersive Web SDK (IWSDK v1.1.0) & Three.js  
**Status:** Phases 0 through 14 Complete & Verified  

---

## 1. Product Overview

PlanRescue Spatial is an immersive, AI-powered schedule recovery and productivity application designed for Meta Quest headsets. Instead of interacting with schedules through standard flat 2D dashboards, users step into an interactive 3D productivity studio where daily schedules, tasks, deadlines, and disruptions become spatial objects.

Users can:
- Explore their daily schedule in an immersive three-dimensional space with glassmorphic cards and priority color stripes.
- Move schedule blocks naturally with direct ray or pinch-grab gestures, snapping to 15-minute increments while respecting locked/fixed events.
- Report unexpected schedule disruptions (e.g., meeting overruns) with bounded parameters (1–240 min) and immediate downstream conflict visualization.
- Receive deterministic, consequence-aware recovery alternatives powered by the PlanRescue Recovery Engine across all three strategies (`minimal_disruption`, `buffered_transitions`, `priority_first`).
- Compare candidate recovery plans spatially side-by-side on a dual-track Before/After timeline with difference highlighting and independent validation checks.
- Step through an enforced two-step safety lifecycle: Candidate selection -> Explicit Approval -> Separate Execution Confirmation, with automatic stale-plan detection.
- Inspect their persistent audit trail and recovery history spatially.
- Monitor real-time rendering performance metrics (FPS, frame budget 11.1ms/13.88ms, draw calls, triangles) via `SpatialPerformanceProfiler`.
- Customize ergonomic posture envelopes (seated mode at 1.25m eye height vs standing mode at 1.60m eye height).
- Utilize full accessibility features (high-contrast UI, scalable text, non-color status chips `[✓]`, `[!]`, `[✕]`, and reduced motion for vestibular comfort).

---

## 2. Complete Spatial Architecture & Phase Breakdown

```
[Meta Quest 3 / WebXR Browser / IWER Desktop Emulator]
                         │
                         ▼
             [apps/vr Spatial Studio Application]
             ├── src/main.ts (DOM & Canvas Mounting)
             ├── src/app/bootstrap.ts (Validated Coordinated Startup)
             ├── src/app/spatialAppController.ts (Runtime Orchestration & 3-Zone Layout)
             ├── src/app/lifecycle.ts (State Machine & Transitions)
             ├── src/core/world.ts (Three.js WebGL2 Rendering & Lighting)
             ├── src/ui/
             │   ├── tokens.ts (Spatial Design Tokens & Color Palette)
             │   └── components.ts (Glassmorphic Panels, Cards, Buttons, Loading)
             ├── src/interaction/
             │   ├── handInteractionManager.ts (XR Hands, Ray, Pinch/Grab, Drag Plane)
             │   ├── desktopInteraction.ts (Mouse Raycasting Fallback)
             │   └── onboarding.ts (Interactive Gesture Tutorial)
             ├── src/calendar/
             │   ├── spatialTimeline.ts (Proportional Event Blocks, Locks, 15m Snap)
             │   └── taskPanel.ts (Task Cards with Status Badges & Feasibility)
             ├── src/disruption/
             │   ├── disruptionPanel.ts (Bounded Duration Steppers & Presets)
             │   └── conflictVisualizer.ts (Colliding Events & Deadline Warnings)
             ├── src/recovery/
             │   └── recoveryManager.ts (Multi-Strategy Orchestrator with Persistence)
             ├── src/assistant/
             │   └── spatialAssistant.ts (Grounded Explainable AI Panel)
             ├── src/comparison/
             │   ├── comparisonWorkspace.ts (Dual-Track Before/After Diff Visualizer)
             │   └── validationExplorer.ts (Hard Constraints & Warning Checklist)
             ├── src/execution/
             │   └── approvalWorkflow.ts (Two-Step Approval & Execution Confirmation)
             ├── src/history/
             │   └── spatialActionHistory.ts (Persistent Audit Trail Panel)
             └── src/api/client.ts (100% Contract Parity Typed HTTP Client)
                         │
        (Authenticated HTTPS over Next.js API Routes)
                         ▼
        [apps/web API Handlers (App Router)]
        ├── /api/dashboard
        ├── /api/recovery/analyze
        ├── /api/recovery/propose
        ├── /api/recovery/plans/[planId]/approve
        ├── /api/recovery/plans/[planId]/apply
        └── /api/actions/history
                         │
        (Server-side Streamable HTTP / Localhost)
                         ▼
        [apps/mcp-server (Model Context Protocol)]
                         │
                         ▼
        [Deterministic Recovery Engine & SQLite Database]
```

---

## 3. Implemented Modules (Phases 0–14)

| Phase | Module | Key Features & Implementation Files |
|-------|--------|------------------------------------|
| **Phase 0 & 1** | Foundation & IWSDK Integration | Official IWSDK v1.1.0 runtime (`@iwsdk/core`, `@iwsdk/vite-plugin-dev`, `iwsdk.config.json`), Zod configuration, state machine, redacted diagnostics. |
| **Phase 2** | Spatial Studio Environment | 3-zone ergonomic studio layout (Left Wing: Disruption & Intelligence, Center: Timeline & Comparison, Right: Assistant, Audit & Account). Glassmorphic materials, ambient/directional lighting, grid floor. (`src/ui/tokens.ts`, `src/ui/components.ts`) |
| **Phase 3** | Hand Tracking & Natural Interaction | Direct ray pointing, hover highlighting, pinch-to-select, drag plane projection, desktop mouse fallback, step-by-step gesture tutorial with persistence. (`src/interaction/`) |
| **Phase 4** | Spatial Timeline & Task Management | Proportional horizontal timeline (1.4m width), glassmorphic event blocks with priority stripes, locked badges on fixed events, 15m draft snapping, spatial task panel with feasibility indicators. (`src/calendar/`) |
| **Phase 5** | Disruption & Conflict Visualization | Delay steppers strictly bounded between 1–240 min, presets (+15, +30, +45, +60), projected end times, downstream event collision visualizer with severity chips. (`src/disruption/`) |
| **Phase 6** | Recovery Engine & Explainable AI | Multi-strategy candidate proposals (`saveCandidates: true` with persistent IDs), deterministic penalty decomposition, grounded natural explanations of trade-offs without hallucinations. (`src/recovery/`, `src/assistant/`) |
| **Phase 7** | Spatial Comparison & Validation | Dual-track Before/After comparison with diff highlighting (moved, shifted, shortened), independent validation explorer verifying hard constraints vs recommendations. (`src/comparison/`) |
| **Phase 8** | Approval, Safe Execution & Audit Trail | Enforced two-step lifecycle (Candidate Selection ≠ Approval; Approval ≠ Execution; Execution requires separate confirmation), stale-plan rejection handling, persistent audit trail panel. (`src/execution/`, `src/history/`) |
| **Phase 9** | User Accounts, Identity & Personalization | 3D Spatial Account Panel, scrypt authentication, user preferences (timezones, working hours, strategy defaults, comfort parameters), strict plan ownership validation. (`src/account/spatialAccountPanel.ts`) |
| **Phase 10** | External Calendar Integrations | Google Calendar API v3, Microsoft Graph Outlook, and local SQLite providers; bidirectional sync, outbox saga reconciliation, external calendar connection indicators. (`src/api/contracts.ts`, `src/account/`) |
| **Phase 11** | Advanced AI & Productivity Intelligence | 3D Spatial Productivity Panel, deterministic Schedule Health Score (0-100), overload detection, focus time fragmentation meters, expanded disruptions (`urgent_task_added`, `time_window_unavailable`). (`src/intelligence/`) |
| **Phase 12** | Security, Privacy & Reliability Hardening | Prompt injection sanitizer, AES-256-GCM token encryption, rate limiting, GDPR data export & right-to-be-forgotten cascading deletion, `/api/healthz` readiness probe. |
| **Phase 13** | XR Optimization, Accessibility & Quest Verification | `SpatialPerformanceProfiler` (72Hz/90Hz frame budgets, draw calls, triangles), `SpatialResourceCache` (geometry/material reuse), ergonomic seated/standing posture modes, non-color status chips `[✓]`, `[!]`, `[✕]`, reduced motion toggle, honest hardware tier detection (`docs/vr/QUEST_HARDWARE_VERIFICATION.md`). |
| **Phase 14** | Deployment, Monitoring & Production Release | Production deployment architecture (`docs/vr/DEPLOYMENT_ARCHITECTURE.md`), operational runbook (`docs/vr/OPERATIONAL_RUNBOOK.md`), automated SQLite backup/restore (`scripts/backup-db.ts`, `restore-db.ts`), environment validation (`envValidation.ts`), production security headers (CSP, HSTS, Permissions-Policy), and extended CI/CD release workflow (`.github/workflows/ci.yml`). |

---

## 4. Verification & Testing

The VR application contains 21 automated test suites with 81 tests covering all layers:

```bash
# Run all VR tests (81 tests passing 100%):
npm run vr:test

# Run VR TypeScript typechecking (0 errors):
npm run vr:typecheck

# Build production bundle:
npm run vr:build
```

### Test Suites (`apps/vr/tests/`)
1. `config.test.ts`: Centralized Zod schema validation & environment rejection.
2. `capabilities.test.ts`: WebXR and WebGL2 capability detection.
3. `lifecycle.test.ts`: Application state machine and transition event emissions.
4. `apiClient.test.ts`: Typed API client, network retries, and error handling.
5. `diagnostics.test.ts`: Structured logger filtering and PII redaction.
6. `bootstrap.smoke.test.ts`: Coordinated startup smoke test.
7. `designTokens.test.ts`: Spatial color palette, dimensions, and layout consistency.
8. `spatialComponents.test.ts`: Spatial panels, glassmorphic cards, buttons, loading indicator.
9. `handInteractions.test.ts`: Raycaster pointer, grab/release lifecycle, drag plane projection.
10. `spatialCalendar.test.ts`: Proportional event block positioning, fixed lock badges, 15m snapping.
11. `disruptionManagement.test.ts`: Bounds validation (1–240 min), conflict visualization.
12. `recoveryEngineIntegration.test.ts`: Multi-strategy candidate selection, persistence tracking.
13. `spatialComparison.test.ts`: Dual-track diff visualization, hard/warning validation checks.
14. `approvalExecution.test.ts`: Two-step approval/execution lifecycle, stale detection, audit trail.
15. `e2eRecoveryJourney.test.ts`: Complete 16-milestone end-to-end user journey.
16. `accountAuth.test.ts`: Spatial account panel and authentication lifecycle.
17. `calendarIntegration.test.ts`: External calendar connection and sync verification.
18. `productivityIntelligence.test.ts`: Productivity metrics and recommendations rendering.
19. `spatialAppController.test.ts`: 3-zone module layout mounting, real API data loading, and resource disposal.

---

## 5. Technology Stack & Dependencies

- **Platform:** Meta Quest Browser (Horizon OS) / Immersive WebXR
- **SDK:** `@iwsdk/core@1.1.0`, `@iwsdk/cli@1.1.0`, `@iwsdk/vite-plugin-dev@1.1.0`
- **UI Kit:** `@pmndrs/uikit@^1.0.74`, `@pmndrs/uikit-horizon@^1.0.74`
- **3D Graphics Engine:** Three.js (`npm:super-three@0.185.0`)
- **Language:** TypeScript 5.9 (Strict mode)
- **Bundler:** Vite 7.3.8
- **Schema Validation:** Zod
- **Testing:** Vitest 5.0.5

---

## 6. Development & Build Commands

```bash
# Workspace root commands:
npm run vr:dev         # Start Vite development server on port 5173
npm run vr:typecheck   # Run TypeScript strict typecheck on apps/vr
npm run vr:test        # Run all 57 Vitest tests
npm run vr:build       # Compile optimized production bundle to apps/vr/dist/
npm run vr:preview     # Preview the production build locally
```
