import type { ScheduleEvent, Task } from '../../apps/mcp-server/src/types.js';

/** Synthetic fixtures for the Recovery Engine tests: one day, 22 Oct 2026, Asia/Kolkata (+05:30). */
export const DAY = '2026-10-22';
export const at = (hhmm: string): string => `${DAY}T${hhmm}:00+05:30`;
export const ms = (hhmm: string): number => Date.parse(at(hhmm));

export const WINDOW = { startTime: at('08:00'), endTime: at('18:00') } as const;

export function ev(
  id: string,
  start: string,
  end: string,
  over: Partial<Omit<ScheduleEvent, 'id' | 'startTime' | 'endTime'>> = {},
): ScheduleEvent {
  return {
    id,
    title: over.title ?? `Event ${id}`,
    startTime: at(start),
    endTime: at(end),
    priority: over.priority ?? 'medium',
    movable: over.movable ?? true,
    category: over.category ?? 'meeting',
    ...(over.notes !== undefined ? { notes: over.notes } : {}),
  };
}

export function task(
  id: string,
  minutes: number,
  deadline: string,
  over: Partial<Pick<Task, 'priority' | 'status' | 'title'>> = {},
): Task {
  return {
    id,
    title: over.title ?? `Task ${id}`,
    estimatedDurationMinutes: minutes,
    deadline: deadline.includes('T') ? deadline : at(deadline),
    priority: over.priority ?? 'medium',
    status: over.status ?? 'pending',
    createdAt: '2026-10-21T18:30:00.000Z',
    updatedAt: '2026-10-21T18:30:00.000Z',
  };
}

export const overrun = (eventId: string, overrunMinutes: number) => ({ type: 'event_overrun' as const, eventId, overrunMinutes });

/** Recursively freeze so any accidental mutation by the engine throws (modules run in strict mode). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/**
 * Meeting that overruns into a flexible event with room to spare:
 *   M 10:00-11:00 immovable (overruns), B 11:00-11:30 movable low, C 15:00-16:00 immovable.
 */
export function roomyDay(): ScheduleEvent[] {
  return [
    ev('M', '10:00', '11:00', { title: 'Meeting', priority: 'high', movable: false }),
    ev('B', '11:00', '11:30', { title: 'Break', priority: 'low', category: 'personal' }),
    ev('C', '15:00', '16:00', { title: 'Checkup', priority: 'high', movable: false }),
  ];
}
