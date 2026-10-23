/** Human-readable names for the enumerations the MCP tools return. Presentation only. */
import type { CapacityStatus, Priority, RecoveryPlan, RiskOrigin, ScheduleEvent } from './contract';

export const STRATEGY_LABEL: Record<RecoveryPlan['strategy'], string> = {
  minimal_disruption: 'Minimal disruption',
  buffered_transitions: 'Buffered transitions',
  priority_first: 'Priority first',
};

export const CATEGORY_LABEL: Record<ScheduleEvent['category'], string> = {
  meeting: 'Meeting',
  focus: 'Focus',
  medical: 'Medical',
  deadline_work: 'Deadline work',
  personal: 'Personal',
};

export const PRIORITY_LABEL: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export const CAPACITY_LABEL: Record<CapacityStatus, string> = {
  feasible: 'Feasible',
  at_risk: 'Deadline at risk',
  infeasible: 'Infeasible',
  not_assessed: 'Not assessed',
};

export const ORIGIN_LABEL: Record<RiskOrigin, string> = {
  none: '',
  pre_existing: 'Pre-existing risk',
  disruption: 'Caused by the disruption',
  plan_introduced: 'Introduced by this plan',
};

export const PROTECTION_REASON_LABEL: Record<string, string> = {
  immovable: 'Immovable event',
  critical_priority: 'Critical priority',
  user_protected: 'Protected by you',
  disrupted_event: 'The event that overran',
};

export const IMPACT_LABEL: Record<string, string> = {
  direct_overlap: 'Overlaps the extended event',
  cascade: 'Displaced by another change',
  existing_conflict: 'Already in conflict',
};

export const ASSESSMENT_LABEL: Record<string, string> = {
  no_conflicts: 'No conflicts',
  conflicts_resolvable: 'Conflicts that can be resolved',
  conflicts_unresolvable: 'Conflicts that cannot be resolved',
};

export const CHECK_LABEL: Record<string, string> = {
  event_existence: 'Events exist in the calendar',
  valid_time_range: 'Valid time ranges',
  no_overlaps: 'No overlapping events',
  duration_preservation: 'Durations preserved',
  immovable_events: 'Immovable events unchanged',
  critical_events: 'Critical events unchanged',
  protected_events: 'Protected events unchanged',
  deadline_feasibility: 'Task deadlines still feasible',
  scope_validity: 'Inside the planning window',
  consistency: 'Plan is internally consistent',
};

export const OUTCOME_LABEL: Record<string, string> = {
  plans_found: 'Candidate plans found',
  no_changes_needed: 'No changes needed',
  infeasible: 'No feasible plan',
};

export const SCORE_COMPONENT_LABEL: Record<string, string> = {
  changedEvents: 'Events changed',
  priorityWeightedDelay: 'Priority-weighted delay',
  focusTime: 'Focus time affected',
  tightTransitions: 'Tight transitions',
  taskRisk: 'Task deadline risk',
};
