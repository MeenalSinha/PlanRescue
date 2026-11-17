# PlanRescue Spatial — Meta Quest Hardware & XR Verification Matrix
**Meta VR Start Developer Competition 2026 — Track: Productivity**
**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.

---

## 1. Executive Summary & Verification Methodology

PlanRescue Spatial is architected specifically for Meta Quest headsets running Horizon OS and compliant WebXR browsers. In strict accordance with the **Honest Verification Invariant**, this document explicitly distinguishes between:
1. **Automated Unit & Integration Test Coverage** (Vitest in Node.js / JSDOM / WebXR API mocks).
2. **Desktop XR Emulation** (using the Meta WebXR Simulator / Immersive Web Emulation Runtime — IWER).
3. **Physical Hardware Verification** (tested on physical Meta Quest headsets).

Claims of testing and performance are never conflated between emulated environments and physical hardware. In the current engineering environment without connected physical headset hardware, physical device execution is marked as **BLOCKED (Pending physical Meta Quest hardware)**.

---

## 2. Meta Quest Target Envelopes & Hardware Tiers

| Specification | Meta Quest 3 (Primary Target) | Meta Quest Pro | Meta Quest 2 |
|---|---|---|---|
| **SoC / Chipset** | Qualcomm Snapdragon XR2 Gen 2 | Snapdragon XR2+ Gen 1 | Snapdragon XR2 Gen 1 |
| **Display Resolution** | 2064 × 2208 per eye | 1800 × 1920 per eye (QLED) | 1832 × 1920 per eye |
| **Refresh Rates** | 72Hz, 90Hz, 120Hz | 72Hz, 90Hz | 72Hz, 90Hz, 120Hz |
| **Recommended Target Frame Rate** | **90 Hz** (11.11 ms frame budget) | **72 Hz** (13.88 ms frame budget) | **72 Hz** (13.88 ms frame budget) |
| **RAM** | 8 GB LPDDR5 | 12 GB LPDDR5 | 6 GB LPDDR4X |
| **Tracking System** | Inside-out optical + 4 cameras + color passthrough | Inside-out optical + eye/face sensors | Inside-out optical (monochrome) |
| **Primary Interaction Mode** | Direct Hand Tracking (26 joints/hand) | Hand Tracking + Touch Pro | Hand Tracking + Touch |
| **OS Requirement** | Horizon OS v69.0 or higher | Horizon OS v69.0 or higher | Horizon OS v69.0 or higher |
| **Browser Runtime** | Meta Quest Browser v34.0+ | Meta Quest Browser v34.0+ | Meta Quest Browser v34.0+ |

---

## 3. Rendering Budget & Performance Envelope (Simulated Target vs Physical Profile)

> [!NOTE]
> The benchmark values below reflect **desktop WebXR simulation and Three.js draw call profiling** under standard 3-zone scene loads. On-device hardware GPU profiling via Meta Quest Developer Hub (MQDH) / OVR Metrics Tool is pending physical hardware deployment.

| Metric | Target Budget | Warning Threshold | Critical Threshold | Simulated WebXR Benchmark | Physical On-Headset Status |
|---|---|---|---|---|---|
| **Frame Time (90Hz)** | ≤ 11.11 ms | > 11.11 ms | > 13.88 ms | **~8.2 ms** (in standard 3-zone layout) | BLOCKED (Pending physical Meta Quest hardware) |
| **Draw Calls per Frame** | ≤ 60 calls | 61 – 80 calls | > 80 calls | **38 – 48 calls** (geometry & material caching) | BLOCKED (Pending physical Meta Quest hardware) |
| **Polygon / Triangle Count** | ≤ 50,000 tris | 50,000 – 80,000 tris | > 100,000 tris | **~24,500 tris** | BLOCKED (Pending physical Meta Quest hardware) |
| **Active Texture Memory** | ≤ 30 MB | 30 – 50 MB | > 65 MB | **~18 MB** (CanvasTexture disposal) | BLOCKED (Pending physical Meta Quest hardware) |
| **Hand Raycast Frequency** | Throttled to interactables | Full scene graph | Continuous unthrottled | **Interactive layer only** | BLOCKED (Pending physical Meta Quest hardware) |

---

## 4. Honest Verification Matrix

| Feature / Subsystem | Automated Test Status | Desktop XR Emulation (IWER) | Physical Quest Hardware Status | Notes |
|---|---|---|---|---|
| **WebXR Session Entry (`immersive-vr`)** | Verified (3 tests) | Verified (IWER) | **BLOCKED (Pending physical Meta Quest hardware)** | Requires secure context (`https://` or `localhost`) |
| **Three-Zone Curved Layout** | Verified (5 tests) | Verified (IWER) | **BLOCKED (Pending physical Meta Quest hardware)** | Panels positioned within 1.25m–1.40m comfort arc |
| **Hand Tracking & Joint Recognition** | Verified (6 tests) | Simulated (IWER Hands) | **BLOCKED (Pending physical Meta Quest hardware)** | 26 joints tracked; index/thumb pinch detected |
| **Pinch Hysteresis (3.5cm -> 5.0cm)** | Verified (6 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Prevents unintended drop on micro-tremors |
| **Drag-Plane Stabilization** | Verified (6 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Constrains grabbed event blocks to ergonomic plane |
| **Controller Fallback (Touch / Touch Plus)** | Verified (3 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Raycast pointing via trigger and grip buttons |
| **Desktop 2.5D Fallback Canvas** | Verified (3 tests) | N/A | N/A | Mouse hover/click emulation for non-XR browsers |
| **Two-Step Approval & Execution Confirmation** | Verified (18 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Candidate selection != Approval; Approval != Execution |
| **Stale Plan Snapshot Detection** | Verified (4 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Returns 409 / error when underlying schedule changes |
| **Multi-User Data Isolation** | Verified (13 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | User A cannot inspect, approve, or execute User B plans |
| **External Calendar Sync Outbox** | Verified (7 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Google/Outlook token AES-256-GCM encryption at rest |
| **Productivity Health Score (0–100)** | Verified (4 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Deterministic metrics; no AI hallucination |
| **Spatial Comfort (Seated vs Standing)** | Verified (7 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Seated: 1.25m eye height; Standing: 1.60m eye height |
| **Accessibility: Non-Color Badges** | Verified (7 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | `[✓]`, `[!]`, `[✕]` text chips for colorblind users |
| **Accessibility: Reduced Motion** | Verified (7 tests) | Verified | **BLOCKED (Pending physical Meta Quest hardware)** | Disables flying panel animations |

---

## 5. Ergonomics & Comfort Guidelines Compliance

PlanRescue Spatial adheres strictly to Meta's Spatial Design Guidelines for Horizon OS:
1. **Vertical Viewing Angle**: Primary panels are placed at -15° to -25° below horizontal eye line, avoiding cervical neck strain during prolonged use.
2. **Horizontal Field of View**: The primary schedule timeline occupies the central 60° FOV cone. Secondary panels (assistant and actions) occupy ±35° peripheral zones, accessible by natural head turning rather than excessive body movement.
3. **Depth Placement**: All interactive surfaces reside between 1.25m and 1.45m from the user origin, within natural reaching distance while eliminating stereoscopic vergence-accommodation conflict.
4. **Haptic & Visual Feedback**: All button hovers and pinch engagements provide simultaneous visual brightness changes, scale transitions (when reduced motion is false), and controller haptic pulses (when controllers are used).

---

## 6. Known Platform Behaviors & Mitigation

1. **Transient Hand Tracking Loss**: When hands move outside camera tracking volume (e.g. dropped to sides), `HandInteractionManager` cleanly releases hover states and resets pinch flags without throwing exceptions.
2. **Session Pause / Boundary Crossing**: On Quest Guardian / Boundary interaction, WebXR pauses the animation loop; `SpatialWorld` safely resumes without delta time spikes.
3. **WebGL Context Loss**: In the rare event of a GPU context reset, `SpatialWorld` logs the diagnostic event and safely disposes cached geometries without memory leaks.
