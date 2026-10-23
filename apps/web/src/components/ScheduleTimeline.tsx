import { PRIORITY_LABEL } from '@/lib/labels';
import type { Priority } from '@/lib/contract';
import { wallClockAt } from '@/lib/time';

export type TimelineTone = 'fixed' | 'movable' | 'protected' | 'moved' | 'disrupted' | 'unchanged';

export interface TimelineItem {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  /** When set, the event is drawn running on to this instant (the reported overrun). */
  overrunEndMs?: number;
  timeLabel: string;
  tone: TimelineTone;
  priority: Priority;
  tags: string[];
}

export interface TimelineRange {
  originMs: number;
  endMs: number;
  offset: string;
}

const PX_PER_MIN = 1.25;
const MIN_BLOCK_PX = 44;

/** Shared hour-aligned range covering every item of every timeline that should line up. */
export function computeRange(items: TimelineItem[], offset: string): TimelineRange {
  const starts = items.map((i) => i.startMs);
  const ends = items.map((i) => i.overrunEndMs ?? i.endMs);
  const first = Math.min(...starts);
  const last = Math.max(...ends);
  const hour = 3_600_000;
  // Floor to the hour in the calendar's own offset.
  const [h, m] = offset.slice(1).split(':').map(Number) as [number, number];
  const offMs = (offset.startsWith('-') ? -1 : 1) * (h * 60 + m) * 60_000;
  const originMs = Math.floor((first + offMs) / hour) * hour - offMs;
  const endMs = Math.ceil((last + offMs) / hour) * hour - offMs;
  return { originMs, endMs, offset };
}

interface Placed {
  item: TimelineItem;
  lane: number;
  lanes: number;
}

function placeInLanes(items: TimelineItem[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -Infinity;
  const laneEnds: number[] = [];
  const flush = (): void => {
    for (const p of cluster) p.lanes = Math.max(1, laneEnds.length);
    placed.push(...cluster);
    cluster = [];
    laneEnds.length = 0;
  };
  for (const item of sorted) {
    const visualEnd = Math.max(item.endMs, item.overrunEndMs ?? 0, item.startMs + (MIN_BLOCK_PX / PX_PER_MIN) * 60_000);
    if (item.startMs >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(visualEnd);
    } else laneEnds[lane] = visualEnd;
    cluster.push({ item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return placed;
}

const TONE_LABEL: Record<TimelineTone, string> = {
  fixed: 'Fixed',
  movable: 'Movable',
  protected: 'Protected, unchanged',
  moved: 'Moved',
  disrupted: 'Ran late',
  unchanged: 'Unchanged',
};

export function Timeline({ items, range, label }: { items: TimelineItem[]; range: TimelineRange; label: string }) {
  const totalMin = (range.endMs - range.originMs) / 60_000;
  const height = totalMin * PX_PER_MIN;
  const hours: number[] = [];
  for (let t = range.originMs; t <= range.endMs; t += 3_600_000) hours.push(t);
  const placed = placeInLanes(items);

  return (
    <div className="timeline" style={{ height }} role="list" aria-label={label}>
      {hours.map((t) => (
        <div key={t} className="tl-hour" style={{ top: ((t - range.originMs) / 60_000) * PX_PER_MIN }} aria-hidden="true">
          <span>{wallClockAt(t, range.offset)}</span>
        </div>
      ))}
      <div className="tl-lane-area">
        {placed.map(({ item, lane, lanes }) => {
          const top = ((item.startMs - range.originMs) / 60_000) * PX_PER_MIN;
          const h = Math.max(MIN_BLOCK_PX, ((item.endMs - item.startMs) / 60_000) * PX_PER_MIN);
          const overrunH = item.overrunEndMs ? ((item.overrunEndMs - item.endMs) / 60_000) * PX_PER_MIN : 0;
          return (
            <div
              key={item.id}
              role="listitem"
              className={`tl-event tone-${item.tone}`}
              style={{ top, height: h, left: `${(lane / lanes) * 100}%`, width: `calc(${100 / lanes}% - 4px)` }}
            >
              <div className="tl-title">{item.title}</div>
              <div className="tl-time">{item.timeLabel}</div>
              <div className="tl-tags">
                <span>{TONE_LABEL[item.tone]}</span>
                <span>{PRIORITY_LABEL[item.priority]}</span>
                {item.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              {overrunH > 0 ? (
                <div className="tl-overrun" style={{ height: overrunH }}>
                  <span>Reported overrun</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
