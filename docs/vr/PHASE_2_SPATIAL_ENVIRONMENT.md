# Phase 2 — Spatial Environment & Visual Design System

**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Document:** Spatial Environment, Studio Architecture & Design System  
**Date:** November 2026  
**Status:** Implemented & Verified  

---

## 1. Objective

Phase 2 transforms the minimal rendering scene into a premium virtual productivity studio: **PLANRESCUE SPATIAL STUDIO**.
The design communicates clarity, intelligence, and control while providing a comfortable seated WebXR experience tailored for Meta Quest.

---

## 2. Spatial Studio Environment Architecture

The environment is anchored around a central Schedule Podium with restrained architectural lighting:

1. **Floor & Grid Hierarchy**:
   - `GridHelper` (10m x 10m) with 0.5m grid divisions (`0x1e293b` major, `0x0f172a` minor).
   - Elevated dark circular user platform (`0x0d111a`) defining the seated workspace boundary.
2. **Anchor Podium**:
   - Centered at `z = -1.45m` with radius `0.7m` and signature PlanRescue cyan trim ring (`0x00e5ff`).
3. **Lighting Scheme**:
   - Ambient light: Deep slate fill (`0x0f172a`, intensity `0.9`).
   - Key light: Directional sunlight overhead (`0xffffff`, intensity `1.2`, position `[2, 4, 2]`).
   - Dual subtle spatial accent point lights: Cyan (`-2, 1.8, -1`) and Purple (`2, 1.8, -1`).

---

## 3. Ergonomic Seated Layout Zones

All panels are arranged within comfortable eye-height (`1.25m`) and field-of-view (FOV) angles:

| Spatial Zone | World Coordinates (x, y, z) | Rotation Y | Purpose |
|---|---|---|---|
| **Daily Timeline** | `[0, 1.25, -1.45]` | `0°` | Central focal point: 3D interactive schedule |
| **Task Panel** | `[-0.95, 1.25, -1.30]` | `+28°` | Left wing: pending tasks, deadlines, effort estimates |
| **PlanRescue AI** | `[0.95, 1.25, -1.30]` | `-28°` | Right wing: assistant insights, conflict analysis, recovery strategies |
| **Comparison Podium** | `[0, 1.15, -1.35]` | `0°` | Foreground staging area for before/after plan comparison |
| **Status HUD** | `[0, 1.82, -1.40]` | `0°` | Overhead non-intrusive status and notification banner |
| **Action Shelf** | `[0, 0.72, -1.25]` | `-15° tilt` | Accessible lower shelf for approvals and execution confirmation |

---

## 4. Centralized Design Token System (`src/ui/tokens.ts`)

- **Palette**: `studioVoid`, `studioFloor`, `panelBackground`, `cardSurface`, `primary` (Cyan `0x00e5ff`), `accentPurple` (`0x8b5cf6`).
- **Priority Mapping**: Aligned with backend Recovery Engine:
  - Critical: `0xef4444` (Red)
  - High: `0xf97316` (Orange)
  - Medium: `0x3b82f6` (Blue)
  - Low: `0x10b981` (Green)
- **Status & Risk**: `statusFeasible`, `statusAtRisk`, `statusInfeasible`, `statusUnchanged`, `statusMoved`.

---

## 5. Reusable Spatial UI Components (`src/ui/components.ts`)

- `SpatialPanel`: Glassmorphic framed panel with cyan header trim and high-DPI text texture.
- `SpatialCard`: Floating 3D box with priority border stripe, title/subtitle, and hover z-elevation.
- `SpatialButton`: Interactable push-button with haptic hover/active feedback.
- `SpatialLoadingIndicator`: Smooth animated torus indicator for async backend calls.
- `SpatialStudioEnvironment`: Assembles lighting, platform, anchor podium, and handles scene-wide cleanup.

---

## 6. Verification & Automated Tests

- `tests/designTokens.test.ts`: Verifies token formats, ergonomic coordinates, and lighting parameters (4 tests pass).
- `tests/spatialComponents.test.ts`: Verifies panel placement, card hover elevation, button triggers, and studio disposal (5 tests pass).
