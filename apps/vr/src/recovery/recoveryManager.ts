import type {
  Disruption,
  RecoveryPlan,
  RecoveryPlanSet,
  ValidationResult,
} from '../api/contracts';
import type { PlanRescueApiClient } from '../api/client';
import { logger } from '../logging/logger';

export type RecoveryState =
  | 'idle'
  | 'proposing'
  | 'candidates_ready'
  | 'validating'
  | 'infeasible'
  | 'no_changes_needed'
  | 'error';

export interface RecoveryProposalParams {
  startTime: string;
  endTime: string;
  disruption: Disruption;
  protectedEventIds?: string[];
  optimizeFor?: 'minimal_disruption' | 'buffered_transitions' | 'priority_first';
}

/**
 * Manages the client-side lifecycle of deterministic recovery proposals,
 * scoring analysis, candidate persistence tracking, and independent plan validation.
 */
export class SpatialRecoveryManager {
  private readonly client: PlanRescueApiClient;
  private state: RecoveryState = 'idle';
  private currentPlanSet: RecoveryPlanSet | null = null;
  private selectedCandidate: RecoveryPlan | null = null;
  private validationResults = new Map<string, ValidationResult>();
  private activeAbortController: AbortController | null = null;

  constructor(client: PlanRescueApiClient) {
    this.client = client;
  }

  getState(): RecoveryState {
    return this.state;
  }

  getCurrentPlanSet(): RecoveryPlanSet | null {
    return this.currentPlanSet;
  }

  getSelectedCandidate(): RecoveryPlan | null {
    return this.selectedCandidate;
  }

  getCandidates(): RecoveryPlan[] {
    return this.currentPlanSet?.candidates ?? [];
  }

  /**
   * Generates recovery candidates via backend deterministic Recovery Engine,
   * explicitly requesting candidate persistence via saveCandidates: true.
   */
  async generateProposals(params: RecoveryProposalParams): Promise<RecoveryPlanSet> {
    this.cancelPendingRequests();
    this.activeAbortController = new AbortController();
    this.state = 'proposing';
    this.currentPlanSet = null;
    this.selectedCandidate = null;
    this.validationResults.clear();

    try {
      logger.info(
        `Requesting recovery proposals for disruption on ${params.disruption.eventId}`,
        'RecoveryManager',
      );

      const planSet = await this.client.proposePlans(
        {
          startTime: params.startTime,
          endTime: params.endTime,
          disruption: params.disruption,
          protectedEventIds: params.protectedEventIds,
          saveCandidates: true, // Crucial: persists plans in SQLite and returns persistentIds
          preferences: params.optimizeFor ? { optimizeFor: params.optimizeFor } : undefined,
        },
        this.activeAbortController.signal,
      );

      this.currentPlanSet = planSet;

      if (planSet.outcome === 'infeasible') {
        this.state = 'infeasible';
        logger.warn('Backend reported scenario is infeasible', 'RecoveryManager');
      } else if (planSet.outcome === 'no_changes_needed') {
        this.state = 'no_changes_needed';
        logger.info('Backend reported no changes needed', 'RecoveryManager');
      } else {
        this.state = 'candidates_ready';
        // Automatically select the top-ranked candidate (lowest penalty score)
        if (planSet.candidates.length > 0 && planSet.candidates[0]) {
          this.selectCandidate(planSet.candidates[0]);
        }
        logger.info(
          `Received ${planSet.candidates.length} recovery candidate(s)`,
          'RecoveryManager',
        );
      }

      return planSet;
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        this.state = 'idle';
        throw err;
      }
      this.state = 'error';
      logger.error('Failed to generate recovery proposals', 'RecoveryManager', err);
      throw err;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Selects a candidate for active inspection, spatial comparison, and review.
   */
  selectCandidate(candidate: RecoveryPlan): void {
    this.selectedCandidate = candidate;
    // Cache embedded validation result if available
    if (candidate.validation) {
      this.validationResults.set(candidate.planId, candidate.validation);
    }
    logger.info(
      `Selected recovery strategy: ${candidate.strategy} (Score: ${candidate.score.total})`,
      'RecoveryManager',
    );
  }

  /**
   * Executes independent validation check for a plan via /api/recovery/validate.
   */
  async validateCandidate(candidate: RecoveryPlan): Promise<ValidationResult> {
    if (this.validationResults.has(candidate.planId)) {
      return this.validationResults.get(candidate.planId)!;
    }

    try {
      logger.info(`Validating candidate ${candidate.planId}`, 'RecoveryManager');
      const result = await this.client.validatePlan(candidate);
      this.validationResults.set(candidate.planId, result);
      return result;
    } catch (err) {
      logger.error(`Validation failed for ${candidate.planId}`, 'RecoveryManager', err);
      throw err;
    }
  }

  getValidationResult(planId: string): ValidationResult | undefined {
    return this.validationResults.get(planId);
  }

  cancelPendingRequests(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  reset(): void {
    this.cancelPendingRequests();
    this.state = 'idle';
    this.currentPlanSet = null;
    this.selectedCandidate = null;
    this.validationResults.clear();
  }
}
