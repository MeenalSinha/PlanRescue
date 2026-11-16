# Phase 4 — Spatial Calendar & Interactive Timeline

**Product:** PlanRescue Spatial  
**Tagline:** Your Day Changed. Reshape It With Your Hands.  
**Track:** Productivity — Meta VR Start Developer Competition 2026  
**Document:** Spatial Timeline, Event Cards, Task Intelligence & Draft Manipulation  
**Date:** November 2026  
**Status:** Implemented & Verified  

---

## 1. Objective

Phase 4 transforms PlanRescue's schedule into a fully interactive 3D spatial calendar. Users explore their day along a physical timeline track, inspect meeting blocks and priorities, review tasks and deadlines, and experiment with safe draft schedule adjustments using natural hand interactions.

---

## 2. Dynamic Backend Integration

Schedule and task records are fetched dynamically via `PlanRescueApiClient.getDashboard(date)`:
- Timezone and calendar offsets (`calendarTimeZone`, `utcOffset`) are respected from backend responses.
- Supports zero-event and zero-task empty states with graceful fallback notices.
- **Zero hardcoding**: no fake events, mock user profiles, or artificial schedules exist in VR code.

---

## 3. Spatial Timeline Architecture (`src/calendar/spatialTimeline.ts`)

- **3D Rail Track**: Centered at `z = -1.45m` with physical hour ticks and timestamps.
- **Proportional Card Placement**: Event block width and position along the track are computed from start time and duration:
  $$\text{posX} = \frac{\text{startMinutes} - \text{dayStart} + \text{duration}/2}{\text{dayTotalMinutes}} \times \text{trackWidth} - \frac{\text{trackWidth}}{2}$$
- **Event Blocks (`SpatialEventBlock`)**:
  - Displays event title, formatted start time, duration, and priority color stripe.
  - Immovable/fixed events display a lock visual badge and reject dragging.
  - Movable events can be hovered, selected, and grabbed.
- **Safe Draft Manipulation**:
  - Grabbing an event card moves it strictly along the timeline X-axis.
  - Releasing snaps the card to the nearest 15-minute increment.
  - **Strict Principle**: Draft movements only update local visual state and emit `onDraftMove`; persisted backend data is never modified by a drag gesture.

---

## 4. Task Intelligence Panel (`src/calendar/taskPanel.ts`)

- Positioned on the left wing (`[-0.95, 1.25, -1.30]`, rotated `+28°` towards the seated user).
- Lists outstanding tasks with effort estimate, due time, priority color, and status.
- Displays empty state notification when all tasks are complete.

---

## 5. Verification & Automated Tests

- `tests/spatialCalendar.test.ts`:
  - Renders events accurately along the 3D timeline track with time markers.
  - Distinguishes fixed vs movable events with lock visual badges.
  - Populates and clears tasks in `SpatialTaskPanel` and verifies empty state notice.
  - Verifies draft drag movements along the timeline axis.
  - 4 tests pass (100% pass rate).
