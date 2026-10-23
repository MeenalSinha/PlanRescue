import { createHash } from 'node:crypto';
import type { ScheduleEvent, Task } from '../types.js';

/**
 * Deterministically compute a SHA-256 fingerprint for a set of calendar events and tasks.
 * Canonicalization:
 * 1. Sort events by stable id, retaining fields that affect scheduling and constraints.
 * 2. Sort tasks by stable id, retaining fields that affect capacity and deadline assessment.
 * 3. Serialize to deterministic JSON and hash with SHA-256.
 */
export function computeSnapshotHash(events: readonly ScheduleEvent[], tasks: readonly Task[]): string {
  const canonicalEvents = [...events]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      priority: e.priority,
      movable: e.movable,
      category: e.category,
    }));

  const canonicalTasks = [...tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      estimatedDurationMinutes: t.estimatedDurationMinutes,
      deadline: t.deadline,
      priority: t.priority,
      status: t.status,
    }));

  const payload = JSON.stringify({ events: canonicalEvents, tasks: canonicalTasks });
  return createHash('sha256').update(payload).digest('hex');
}
