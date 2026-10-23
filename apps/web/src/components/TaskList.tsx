import type { Task } from '@/lib/contract';
import { formatMinutes, offsetOf, dateTimeLabel } from '@/lib/time';
import { PriorityTag } from './ui';

const STATUS_LABEL = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' } as const;

export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <ul className="task-list" aria-label="Tasks and deadlines">
      {tasks.map((t) => (
        <li key={t.id} className={`task ${t.status === 'completed' ? 'task-done' : ''}`}>
          <div className="task-main">
            <span className="task-title">{t.title}</span>
            <span className={`tag status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
          </div>
          <div className="task-meta">
            <span>Due {dateTimeLabel(t.deadline)} (UTC{offsetOf(t.deadline)})</span>
            <span>Estimated {formatMinutes(t.estimatedDurationMinutes)}</span>
            <PriorityTag priority={t.priority} />
          </div>
        </li>
      ))}
    </ul>
  );
}
