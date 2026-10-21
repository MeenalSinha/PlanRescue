import type { Task } from '../types.js';

/**
 * Creation/modification time recorded on seeded tasks: midnight at the start of the seeded
 * day in Asia/Kolkata (2026-10-22T00:00+05:30). A fixed value keeps seeding deterministic.
 */
export const SEED_TASK_TIMESTAMP = '2026-10-21T18:30:00.000Z';

/**
 * Sample tasks for the same Thursday 22 October 2026 (Asia/Kolkata) as the seeded calendar.
 * Deadlines are tasks' own constraints, not calendar events. They line up with the events:
 *
 *  - The project report (120 min, due 20:00) is what the 18:00-20:00 "Project Deadline Work" block is for.
 *  - Preparing for the project review must finish before it starts at 13:30.
 *  - Reviewing a teammate's deliverable (45 min) can use the Focus Work block or the gap before 18:00.
 *  - A completed task and a next-day task give the status and deadline filters something to separate.
 *
 * Temporary development data, inserted only when absent (see seedDatabase).
 */
export const seedTasks: readonly Task[] = [
  {
    id: 'task-001',
    title: 'Complete project report',
    description: 'Finish and submit the final project report; the deliverable is due at 20:00 IST today.',
    estimatedDurationMinutes: 120,
    deadline: '2026-10-22T20:00:00+05:30',
    priority: 'critical',
    status: 'in_progress',
    createdAt: SEED_TASK_TIMESTAMP,
    updatedAt: SEED_TASK_TIMESTAMP,
  },
  {
    id: 'task-002',
    title: 'Prepare for project review',
    description: 'Collect milestone progress and open questions before the review with the project lead.',
    estimatedDurationMinutes: 30,
    deadline: '2026-10-22T13:30:00+05:30',
    priority: 'high',
    status: 'pending',
    createdAt: SEED_TASK_TIMESTAMP,
    updatedAt: SEED_TASK_TIMESTAMP,
  },
  {
    id: 'task-003',
    title: "Review teammate's deliverable",
    description: 'Read through the draft and leave written feedback.',
    estimatedDurationMinutes: 45,
    deadline: '2026-10-22T18:00:00+05:30',
    priority: 'medium',
    status: 'pending',
    createdAt: SEED_TASK_TIMESTAMP,
    updatedAt: SEED_TASK_TIMESTAMP,
  },
  {
    id: 'task-004',
    title: 'Draft team meeting agenda',
    description: 'Outline discussion points for the weekly team sync.',
    estimatedDurationMinutes: 20,
    deadline: '2026-10-22T11:30:00+05:30',
    priority: 'medium',
    status: 'completed',
    createdAt: SEED_TASK_TIMESTAMP,
    updatedAt: SEED_TASK_TIMESTAMP,
  },
  {
    id: 'task-005',
    title: "Plan next week's sprint",
    description: 'Prioritise the backlog and pick sprint goals.',
    estimatedDurationMinutes: 60,
    deadline: '2026-10-23T17:00:00+05:30',
    priority: 'low',
    status: 'pending',
    createdAt: SEED_TASK_TIMESTAMP,
    updatedAt: SEED_TASK_TIMESTAMP,
  },
];
