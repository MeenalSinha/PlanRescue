# Phase 6 — Recovery Engine Integration & AI Intelligence

**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Document:** Deterministic Recovery Engine Integration, Scoring, Candidate Persistence & AI Explainability  
**Date:** November 2026  
**Status:** Implemented & Verified  

---

## 1. Objective

Phase 6 connects the VR interaction layer with PlanRescue's deterministic Recovery Engine and independent validator. The application generates candidate plans across three strategies, respects deterministic penalty scoring, persists candidate plans to obtain durable identifiers, and provides grounded AI explanations.

---

## 2. API Contract Parity & Proposal Workflow

- **Full Parity**: `apps/vr/src/api/contracts.ts` and `apps/vr/src/api/client.ts` synchronize with `apps/web/src/lib/contract.ts` and backend MCP tools.
- **Proposal Generation (`POST /api/recovery/propose`)**:
  - Transmits disruption, time interval, protected event IDs, and `saveCandidates: true`.
  - Captures `persistentId` (e.g. `rec-persist-...`) and `savedStatus` directly from the backend.
- **Three Deterministic Strategies**:
  1. `minimal_disruption`: Shifts the fewest possible events to preserve the baseline calendar.
  2. `buffered_transitions`: Inserts transition buffers between shifted blocks to reduce stress.
  3. `priority_first`: Defers lower-priority blocks to guarantee high-priority focus blocks.

---

## 3. Deterministic Penalty Scoring

- Plans are scored by the Recovery Engine using penalty components:
  - Total Penalty (`score.total`)
  - Changed events count (`components.changedEvents`)
  - Priority-weighted delay (`components.priorityWeightedDelay`)
  - Focus-time impact (`components.focusTime`)
  - Tight transitions penalty (`components.tightTransitions`)
  - Task risk penalty (`components.taskRisk`)
- **Key Principle**: Lower penalty score is better. Candidate with rank 1 has lowest score.

---

## 4. Independent Plan Validation & AI Explainability

- Independent validation check via `PlanRescueApiClient.validatePlan(candidate)` -> `/api/recovery/validate`.
- Distinguishes **hard violations** (infeasible constraints) from **warnings**.
- **PlanRescue AI Assistant (`SpatialAssistantPanel`)**:
  - Explains what occurred, why meetings moved, and which meetings are protected.
  - Summarizes task capacity slack and highlights deadlines at risk.
  - **Zero LLM Vulnerability**: Operates truthfully from structured deterministic facts even without external AI keys.

---

## 5. Verification & Automated Tests

- `tests/recoveryEngineIntegration.test.ts`:
  - Verifies proposal generation with candidate persistence tracking (`persistentId`).
  - Verifies strategy ranking and penalty score presentation.
  - Verifies independent validation check integration.
  - Verifies grounded AI explanation rendering and infeasibility handling.
  - 2 tests pass (100% pass rate).
