# Phase 8 — Approval, Execution & Spatial Audit Trail

**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Document:** Plan Review, Explicit Approval, Separate Execution Confirmation & Spatial Audit Trail  
**Date:** November 2026  
**Status:** Implemented & Verified  

---

## 1. Objective

Phase 8 completes the full PlanRescue lifecycle in spatial computing. Users review the proposed schedule, explicitly approve the proposal via persistent plan ID, separately confirm execution, and watch the schedule update with ACID guarantees in SQLite while inspecting the recorded action history.

---

## 2. Two-Step Approval and Execution Workflow (`src/execution/approvalWorkflow.ts`)

To guarantee safety and prevent accidental calendar mutations:
1. **Plan Review**:
   - Inspects the chosen strategy, penalty score, proposed shifted meetings, and preserved critical appointments.
2. **Step 1: Explicit Approval (`POST /api/recovery/plans/[planId]/approve`)**:
   - Uses the durable plan ID (`persistentId` returned from `save_recovery_plans`).
   - Advances plan state machine: `proposed` → `approved`.
   - **Strict Principle**: Approval alone does NOT modify stored calendar events.
3. **Step 2: Separate Confirmation Action (`POST /api/recovery/plans/[planId]/apply`)**:
   - Requires a distinct user confirmation press ("Confirm Schedule Execution").
   - Transmits execution request to the server-side MCP boundary.
   - Enforces snapshot hash freshness, stale-plan rejection, and atomic transaction execution in SQLite.

---

## 3. Stale Plan Detection & Recovery

- If calendar records change between proposal and execution:
  - Backend rejects application with `stale` status code.
  - Spatial workflow transitions to `stale_rejected`.
  - Notifies user that the schedule snapshot is outdated and prompts them to refresh and recalculate a fresh recovery scenario.

---

## 4. Spatial Action History & Audit Trail (`src/history/spatialActionHistory.ts`)

- Queries `GET /api/actions/history` via `PlanRescueApiClient.getActionHistory()`.
- Renders 3D cards displaying:
  - Timestamp
  - Action Type (`plan_saved`, `plan_approved`, `plan_applied`, `plan_stale`)
  - Actor
  - Summary and changes applied

---

## 5. Verification & Automated Tests

- `tests/approvalExecution.test.ts`:
  - Verifies two-step workflow (approval then separate execution confirmation).
  - Verifies durable persistent IDs are transmitted to backend route handlers.
  - Verifies stale plan rejection handling.
  - Verifies persistent audit history rendering in `SpatialActionHistoryPanel`.
  - 3 tests pass (100% pass rate).
