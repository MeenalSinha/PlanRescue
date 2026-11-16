import type { ScheduleEvent, Task } from '../contract';
import { toEpochMs } from '../time';

export interface ProductivityMetrics {
  healthScore: number; // 0 - 100
  totalScheduledMinutes: number;
  totalWorkingMinutes: number;
  focusTimeMinutes: number;
  fragmentedMinutes: number;
  backToBackCount: number;
  overloadPercentage: number;
  contextSwitches: number;
}

export interface ProductivityRecommendation {
  id: string;
  type: 'buffer_needed' | 'consolidate_focus' | 'reduce_overload' | 'task_protection';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  suggestedAction: string;
}

export interface ProductivityInsights {
  date: string;
  metrics: ProductivityMetrics;
  recommendations: ProductivityRecommendation[];
  summary: string;
}

export interface AnalyzeOptions {
  workingHoursStart?: string; // '09:00'
  workingHoursEnd?: string;   // '18:00'
  preferredBufferMinutes?: number; // 10
}

/**
 * Productivity Intelligence Engine (Spatial Phase 11)
 *
 * Deterministically analyzes daily schedule density, focus fragmentation,
 * and cognitive fatigue. Calculates a grounded Schedule Health Score (0-100)
 * and generates actionable recommendations without hallucination.
 */
export function analyzeProductivity(
  date: string,
  events: readonly ScheduleEvent[],
  tasks: readonly Task[],
  options: AnalyzeOptions = {},
): ProductivityInsights {
  const startHour = Number((options.workingHoursStart || '09:00').slice(0, 2));
  const endHour = Number((options.workingHoursEnd || '18:00').slice(0, 2));
  const workingMinutes = Math.max(60, (endHour - startHour) * 60);

  // Filter events active on this date and sort chronologically
  const dayEvents = events
    .filter((e) => e.startTime.slice(0, 10) === date || e.endTime.slice(0, 10) === date)
    .sort((a, b) => toEpochMs(a.startTime) - toEpochMs(b.startTime));

  let totalScheduledMinutes = 0;
  for (const e of dayEvents) {
    totalScheduledMinutes += e.durationMinutes;
  }

  // Detect gaps, back-to-back transitions, and focus blocks
  let focusTimeMinutes = 0;
  let fragmentedMinutes = 0;
  let backToBackCount = 0;
  let contextSwitches = 0;

  for (let i = 0; i < dayEvents.length - 1; i++) {
    const current = dayEvents[i]!;
    const next = dayEvents[i + 1]!;
    const currentEnd = toEpochMs(current.endTime);
    const nextStart = toEpochMs(next.startTime);
    const gapMinutes = Math.round((nextStart - currentEnd) / 60000);

    if (gapMinutes <= 0) {
      backToBackCount++;
    } else if (gapMinutes < 30) {
      fragmentedMinutes += gapMinutes;
    } else {
      focusTimeMinutes += gapMinutes;
    }

    if (current.category !== next.category || current.priority !== next.priority) {
      contextSwitches++;
    }
  }

  // Calculate Overload Factor
  const overloadPercentage = Math.round((totalScheduledMinutes / workingMinutes) * 100);

  // Calculate Health Score (Baseline 100)
  let healthScore = 100;

  // Penalty 1: Overload (> 85% scheduled)
  if (overloadPercentage > 100) {
    healthScore -= Math.min(35, Math.round((overloadPercentage - 100) * 0.7));
  } else if (overloadPercentage > 85) {
    healthScore -= 10;
  }

  // Penalty 2: Back-to-back fatigue (8 pts per instance, capped at 24)
  healthScore -= Math.min(24, backToBackCount * 8);

  // Penalty 3: Focus fragmentation (4 pts per fragmented slot, capped at 20)
  const fragmentedSlots = Math.round(fragmentedMinutes / 15);
  healthScore -= Math.min(20, fragmentedSlots * 4);

  // Penalty 4: High context switching (> 4 switches)
  if (contextSwitches > 4) {
    healthScore -= Math.min(15, (contextSwitches - 4) * 3);
  }

  healthScore = Math.max(10, Math.min(100, Math.round(healthScore)));

  // Generate grounded, explainable recommendations
  const recommendations: ProductivityRecommendation[] = [];

  if (backToBackCount > 0) {
    recommendations.push({
      id: 'rec_buffer',
      type: 'buffer_needed',
      severity: backToBackCount >= 2 ? 'high' : 'medium',
      title: 'Back-to-Back Meeting Fatigue',
      description: `You have ${backToBackCount} consecutive meetings without transition buffers.`,
      suggestedAction: `Use the Buffered Transitions strategy to insert ${options.preferredBufferMinutes || 10}-min mental breathers between meetings.`,
    });
  }

  if (fragmentedMinutes >= 30) {
    recommendations.push({
      id: 'rec_focus',
      type: 'consolidate_focus',
      severity: 'medium',
      title: 'Fragmented Focus Time',
      description: `${fragmentedMinutes} minutes of your day are split into micro-gaps under 30 minutes, preventing deep work.`,
      suggestedAction: 'Consolidate small schedule gaps into an uninterrupted focus block.',
    });
  }

  if (overloadPercentage > 95) {
    recommendations.push({
      id: 'rec_overload',
      type: 'reduce_overload',
      severity: 'high',
      title: 'Schedule Density Critical',
      description: `Your calendar commitments represent ${overloadPercentage}% of your total working hours.`,
      suggestedAction: 'Consider delegating low-priority tasks or shifting optional meetings.',
    });
  }

  // Check pending task deadlines vs focus time
  const urgentTasks = tasks.filter((t) => t.status !== 'completed' && (t.priority === 'critical' || t.priority === 'high'));
  if (urgentTasks.length > 0 && focusTimeMinutes < 60) {
    recommendations.push({
      id: 'rec_task_protect',
      type: 'task_protection',
      severity: 'high',
      title: 'Urgent Task Protection At Risk',
      description: `You have ${urgentTasks.length} high-priority tasks due, but only ${focusTimeMinutes} minutes of quality focus time available today.`,
      suggestedAction: 'Run recovery planning to protect a 2-hour focus block before end-of-day.',
    });
  }

  const summary =
    healthScore >= 80
      ? `Healthy Schedule: ${healthScore}/100. Good balance between meetings and focus time.`
      : healthScore >= 60
        ? `Moderate Schedule Strain: ${healthScore}/100. ${backToBackCount} back-to-back meetings and ${fragmentedMinutes}m fragmented time.`
        : `Severe Schedule Overload: ${healthScore}/100. Immediate recovery adjustments recommended.`;

  return {
    date,
    metrics: {
      healthScore,
      totalScheduledMinutes,
      totalWorkingMinutes: workingMinutes,
      focusTimeMinutes,
      fragmentedMinutes,
      backToBackCount,
      overloadPercentage,
      contextSwitches,
    },
    recommendations,
    summary,
  };
}
