# PlanRescue Spatial (apps/vr)

**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Experience Mode:** Virtual Reality & Horizon OS Spatial Studio  

---

## 1. Product Overview

PlanRescue Spatial is an immersive, AI-powered schedule recovery and productivity application designed for Meta Quest headsets. Instead of interacting with schedules through standard flat 2D dashboards, users step into an interactive 3D productivity studio where daily schedules, tasks, deadlines, and disruptions become spatial objects.

Users can:
- Explore their daily schedule in an immersive three-dimensional space.
- Inspect calendar events and tasks positioned along spatial time horizons.
- Report unexpected schedule disruptions (e.g., meeting overruns) naturally.
- Receive deterministic, consequence-aware recovery alternatives powered by the PlanRescue Recovery Engine.
- Compare candidate recovery plans spatially side-by-side.
- Explicitly approve and confirm recovery executions with atomic transactional safety.

---

## 2. Application Architecture

`apps/vr` is architected as an independent, modular client application that interfaces with the existing PlanRescue system through server-side Next.js route handlers.

```
[Meta Quest 3 / WebXR Browser / IWER Desktop Emulator]
                         │
                         ▼
             [apps/vr Application (Three.js & IWSDK)]
             ├── main.ts (DOM & Canvas Mounting)
             ├── app/bootstrap.ts (Validated Coordinated Startup)
             ├── app/lifecycle.ts (State Machine)
             ├── platform/xrCapabilities.ts (Capability Detection)
             ├── platform/xrLifecycle.ts (XRSession Management)
             ├── core/world.ts (Three.js WebGL2 & Spatial Scene)
             ├── config/loader.ts (Priority Configuration Loader)
             ├── logging/logger.ts (Redacted Structured Logging)
             ├── diagnostics/errorBoundary.ts (Error Normalization)
             └── api/client.ts (Typed HTTP API Client)
                         │
        (Authenticated HTTPS over Next.js API Routes)
                         ▼
        [apps/web API Handlers (App Router)]
        ├── /api/dashboard
        ├── /api/recovery/analyze
        ├── /api/recovery/plans
        ├── /api/recovery/plans/[planId]/approve
        └── /api/recovery/plans/[planId]/apply
                         │
        (Server-side Streamable HTTP / Localhost)
                         ▼
        [apps/mcp-server (Model Context Protocol)]
                         │
                         ▼
        [Deterministic Recovery Engine & SQLite Database]
```

---

## 3. Directory Structure

```
apps/vr/
├── public/
│   ├── config.json              # Optional deployment runtime configuration
│   ├── scenes/
│   │   └── main.iwsdk.scene.json# Native starter scene document
│   └── assets/                  # Spatial UI textures, audio, models
├── src/
│   ├── main.ts                  # Application entry point & DOM mounting
│   ├── app/
│   │   ├── bootstrap.ts         # Multi-step validated startup sequence
│   │   └── lifecycle.ts         # Application state machine & transitions
│   ├── core/
│   │   └── world.ts             # Three.js rendering, lighting, ground grid, anchors
│   ├── config/
│   │   ├── schema.ts            # Strict Zod schema for VR configuration
│   │   └── loader.ts            # Priority loader: Window injection > /config.json > Env
│   ├── platform/
│   │   ├── xrCapabilities.ts    # WebXR, WebGL2, and hand-tracking capability detection
│   │   └── xrLifecycle.ts       # XRSession enter/exit, listeners, cleanup
│   ├── api/
│   │   ├── client.ts            # Typed HTTP API client with timeout, cancellation, retries
│   │   ├── contracts.ts         # Zod schemas & interfaces matching server contracts
│   │   └── errors.ts            # Normalized API and network errors
│   ├── logging/
│   │   └── logger.ts            # Structured logger with sensitive data redaction
│   └── diagnostics/
│       └── errorBoundary.ts     # User-safe error presentation & normalization
├── tests/                       # Automated Vitest test suite
│   ├── config.test.ts           # Configuration validation tests
│   ├── capabilities.test.ts     # XR capability detection tests
│   ├── lifecycle.test.ts        # State machine & transition tests
│   ├── apiClient.test.ts        # Typed API client & retry safety tests
│   ├── diagnostics.test.ts      # Logging verbosity & redaction tests
│   └── bootstrap.smoke.test.ts  # End-to-end application bootstrap smoke test
├── iwsdk.config.json            # Manifest-first Meta IWSDK configuration
├── index.html                   # HTML entry point with desktop status HUD
├── package.json                 # Independent package configuration
├── tsconfig.json                # Browser/DOM/WebXR TypeScript configuration
├── vite.config.ts               # Manifest-first Vite configuration
└── vitest.config.ts             # Test runner configuration
```

---

## 4. Technology Stack & Prerequisites

- **Node.js**: `>=22.12.0` (evaluated on Node v22.19.0)
- **Framework**: Meta Immersive Web SDK (IWSDK) manifest-first architecture
- **3D Graphics Engine**: Three.js (`^0.170.0`)
- **Language**: TypeScript (`^5.9` / `^7.0`) in strict mode
- **Bundler & Dev Server**: Vite (`^5.4` / `^6.0`)
- **Schema Validation**: Zod (`^4.6.7`)
- **Test Runner**: Vitest (`^5.0.5`)

---

## 5. Dependency Installation

`apps/vr` is an independent package with its own package configuration and lockfile.

To install dependencies:
```bash
# From workspace root:
npm --prefix apps/vr install

# Or from inside apps/vr:
cd apps/vr
npm install
```

---

## 6. Configuration Management

Configuration is strictly centralized and validated. Hardcoded user data, fixed meeting times, fake schedules, and hardcoded API URLs are strictly forbidden.

### Environment Variables (`.env` / `import.meta.env`)

Copy `.env.example` to `.env`:
```bash
# Runtime environment: development | test | staging | production
VITE_PLANRESCUE_VR_APP_ENV=development

# Backend API Base URL (points to Next.js route handlers)
VITE_PLANRESCUE_VR_API_BASE_URL=http://127.0.0.1:3000

# Client log verbosity: debug | info | warn | error
VITE_PLANRESCUE_VR_LOG_LEVEL=info

# Default API request timeout in milliseconds (1000 - 60000)
VITE_PLANRESCUE_VR_REQUEST_TIMEOUT_MS=15000

# XR feature preferences
VITE_PLANRESCUE_VR_ENABLE_HAND_TRACKING=true
VITE_PLANRESCUE_VR_ENABLE_EMULATION=true
```

### Runtime Configuration Loading Priority

To promote builds across environments without recompilation, configuration is loaded using a 3-tier priority cascade:
1. `window.__PLANRESCUE_VR_CONFIG__`: Injected dynamically at runtime by HTML host.
2. `public/config.json`: Fetched dynamically at runtime if present.
3. `import.meta.env`: Vite build-time environment variables.

---

## 7. Development & Build Commands

### Root Workspace Commands

```bash
# Start VR development server:
npm run vr:dev

# Run VR TypeScript typechecking:
npm run vr:typecheck

# Run VR automated unit & smoke tests:
npm run vr:test

# Build production bundle:
npm run vr:build

# Preview production build:
npm run vr:preview
```

### Local Package Commands (`apps/vr/`)

```bash
cd apps/vr
npm run dev        # Starts Vite on http://127.0.0.1:5173
npm run typecheck  # tsc --noEmit
npm test           # Runs Vitest suite
npm run build      # Production build to apps/vr/dist/
npm run preview    # Serves dist/ locally
```

---

## 8. Desktop Development & XR Emulation

Physical Meta Quest hardware is not required for daily development:
1. **Desktop 3D Fallback**: Starting the dev server (`npm run vr:dev`) opens the application in standard 3D desktop mode. Orbit and spatial anchors are rendered on the WebGL2 canvas.
2. **IWER / WebXR Emulation**: Supported desktop browsers equipped with the Meta WebXR Emulator extension or IWER emulate Meta Quest 3 6DoF controllers and hand tracking joints.
3. **Honest Capability Reporting**: The application runtime strictly detects whether an environment is physical Meta Quest hardware vs. an emulated session. Emulator success is never reported as physical device certification.

---

## 9. Meta Quest Testing Prerequisites

To test on a physical Meta Quest headset:
1. Enable **Developer Mode** on the Meta Quest headset via the Meta Quest mobile app.
2. Connect headset to the same local network as your development workstation.
3. Serve the application over HTTPS (required by WebXR).
4. Navigate to the local server URL using the Meta Quest Browser.
5. Click **Enter VR**. Put on the headset and ensure Hand Tracking is enabled in Quest device settings.

---

## 10. XR Session Lifecycle & Error Handling

The application transitions through explicit states:
- `INITIALIZING`: App startup, configuration validation, capability check.
- `CONFIGURATION_ERROR`: Configuration invalid (missing required fields or malformed URL).
- `UNSUPPORTED_ENVIRONMENT`: Device lacks WebGL2 hardware rendering.
- `READY`: Desktop 3D studio initialized and operational.
- `XR_AVAILABLE`: WebXR immersive-vr supported and ready for entry.
- `XR_SESSION_ACTIVE`: Immersive VR session currently active in headset.
- `XR_SESSION_ENDED`: Immersive session concluded cleanly.
- `ERROR`: Fatal runtime error with user-safe diagnostic notice.

### Error Handling & Data Sanitization
- Technical stack traces, file system paths, and API credentials are never leaked to user interfaces.
- Structured logger automatically redacts `token`, `secret`, `password`, `key`, `cookie`, and `Bearer` headers from all console messages.
- API client safely retries idempotent GET queries on transient 503 errors, but strictly prohibits automatic retries on state-altering write operations (`applyPlan`, `approvePlan`).

---

## 11. Known Limitations

1. **Physical Hardware Verification**: Hardware tests on physical Meta Quest 3 headsets must be conducted on target physical devices over HTTPS; desktop browser emulation validates protocol and ECS flow but does not replace physical hardware QA.
2. **Phase Boundaries**: Complete 3D event cards, interactive timeline manipulation, and spatial AI assistant panels belong to subsequent phases (Phase 2 & 3). Phase 1 provides the verified architectural, rendering, capability, and communication foundation.
