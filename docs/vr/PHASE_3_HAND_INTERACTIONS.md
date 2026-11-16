# Phase 3 — Hand Tracking & Natural Interaction System

**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Document:** Hands-First Interaction System, Raycasting, Gestures & Desktop Fallback  
**Date:** November 2026  
**Status:** Implemented & Verified  

---

## 1. Objective

Phase 3 builds a hands-first natural interaction architecture for PlanRescue Spatial on Meta Quest headsets. Users interact with schedule blocks, buttons, and panels through natural pointing rays, pinch gestures, and near-hand grabbing without requiring physical controllers.

---

## 2. Hand Tracking Lifecycle & Architecture

The interaction subsystem is coordinated by `HandInteractionManager` (`src/interaction/handInteractionManager.ts`):

1. **Input Sources Lifecycle**:
   - Queries `XRSession.inputSources` dynamically to identify left and right hand presence.
   - Detects tracking interruptions (e.g. hand occlusions, user resting hands) and restores ray visualization cleanly.
2. **Raycasting & Spatial Pointer**:
   - Computes ray intersections with interactables with `this.scene.updateMatrixWorld(true)`.
   - Renders a dynamic line indicator (`0x00e5ff`) anchored to the pointer origin pointing to intersection points.
3. **Pinch & Near-Touch Selection**:
   - Hand pinch gesture or controller trigger activates `triggerSelect()` on hovered components.
   - Provides clear hover state transitions (`onHover(true/false)`).
4. **Proximity Grab & Release**:
   - Supports grabbing movable objects (`startGrab()`, `releaseGrab()`).
   - Constrains manipulation to a view-aligned drag plane to keep calendar blocks at a stable, comfortable reading distance.
   - **Strict Safety Rule**: Grabbing only manipulates local draft coordinates. Persisted calendar state is never directly altered.

---

## 3. Desktop Fallback (`src/interaction/desktopInteraction.ts`)

For testing on desktop machines and CI runners:
- Maps 2D mouse movements (`mousemove`) to normalized unprojected 3D camera rays.
- Maps `mousedown` / `mouseup` to grab and click triggers.
- Allows full interactive testing of the spatial workflow without a physical headset.

---

## 4. Interactive Onboarding Tutorial (`src/interaction/onboarding.ts`)

A step-by-step spatial tutorial introduces the gestures:
1. **Welcome**: Introduction to PlanRescue Spatial Studio.
2. **Point**: Ray pointing instruction.
3. **Pinch**: Pinch to select calendar blocks.
4. **Grab**: Pinch and hold to preview schedule adjustments.
5. **Ready**: Release to place draft.
- Tutorial status is stored via `localStorage` (with safe fallback for headless environments).

---

## 5. Verification & Automated Tests

- `tests/handInteractions.test.ts`:
  - Registers/unregisters interactables cleanly.
  - Detects raycast intersection and triggers hover & select callbacks.
  - Manages grab and release lifecycle with event notifications.
  - Verifies desktop mouse event translation via `DesktopInteractionFallback`.
  - Verifies progression and reset of `SpatialOnboardingTutorial`.
  - 5 tests pass (100% pass rate).
