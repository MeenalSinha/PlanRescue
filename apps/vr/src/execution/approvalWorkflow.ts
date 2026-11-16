import * as THREE from 'three';
import type {
  ApplyApprovedPlanOutput,
  ApproveRecoveryPlanOutput,
  RecoveryPlan,
} from '../api/contracts';
import type { PlanRescueApiClient } from '../api/client';
import { SPATIAL_PALETTE } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialButton, SpatialUIElement } from '../ui/components';
import { logger } from '../logging/logger';

export type WorkflowStep =
  | 'review'
  | 'approved'
  | 'confirming_execution'
  | 'executing'
  | 'applied'
  | 'stale_rejected'
  | 'failed';

export interface WorkflowCallbacks {
  onApprovalComplete?: (output: ApproveRecoveryPlanOutput) => void;
  onExecutionComplete?: (output: ApplyApprovedPlanOutput) => void;
  onExecutionFailed?: (err: Error) => void;
}

/**
 * Two-Step Approval and Execution Confirmation Panel:
 * Guarantees that approval is explicit, separate from execution confirmation,
 * and executes atomically through the protected backend route.
 */
export class SpatialApprovalWorkflow extends SpatialPanel {
  private readonly client: PlanRescueApiClient;
  private currentStep: WorkflowStep = 'review';
  private targetPlan: RecoveryPlan | null = null;
  private approvalResult: ApproveRecoveryPlanOutput | null = null;
  private executionResult: ApplyApprovedPlanOutput | null = null;

  private readonly contentGroup: THREE.Group;
  private readonly actionButtonsGroup: THREE.Group;
  private callbacks: WorkflowCallbacks = {};

  constructor(client: PlanRescueApiClient, width = 0.85, height = 0.65) {
    super('Plan Review & Approval', width, height, {
      accentColor: SPATIAL_PALETTE.primary,
    });
    this.client = client;

    this.contentGroup = new THREE.Group();
    this.contentGroup.position.set(0, 0.08, 0.015);
    this.group.add(this.contentGroup);

    this.actionButtonsGroup = new THREE.Group();
    this.actionButtonsGroup.position.set(0, -0.22, 0.02);
    this.group.add(this.actionButtonsGroup);
  }

  setCallbacks(cbs: WorkflowCallbacks): this {
    this.callbacks = cbs;
    return this;
  }

  getStep(): WorkflowStep {
    return this.currentStep;
  }

  /**
   * Initializes the review step for a persistent candidate plan.
   */
  loadPlanForReview(plan: RecoveryPlan): void {
    this.targetPlan = plan;
    this.currentStep = 'review';
    this.approvalResult = null;
    this.executionResult = null;

    this.renderReviewContent();
    this.renderActionButtons();
  }

  private renderReviewContent(): void {
    this.clearContentGroup();

    if (!this.targetPlan) return;

    const plan = this.targetPlan;
    const isPersisted = !!plan.persistentId;
    const lines = [
      `Selected Strategy: ${plan.strategy.toUpperCase()}`,
      `Total Penalty Score: ${plan.score.total} (Rank ${plan.score.rank})`,
      `Proposed Changes: ${plan.changes.length} meeting(s) to shift`,
      `Protected Constraints: ${plan.unchangedProtectedEvents.length} critical appointment(s) preserved`,
      `Validation Check: ${plan.validation?.isValid ? '✓ PASSED (Safe to Approve)' : '✗ FAILED'}`,
      isPersisted ? `Durable Plan ID: ${plan.persistentId}` : '⚠️ Warning: Transient plan ID (auto-persisting)',
    ];

    const { texture, aspect } = createTextTexture(lines.join('\n'), {
      fontSize: 15,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textPrimary,
      width: 768,
      height: 140,
      textAlign: 'left',
      padding: 10,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.75 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    this.contentGroup.add(mesh);
  }

  private renderActionButtons(): void {
    this.clearButtonsGroup();

    if (!this.targetPlan) return;

    if (this.currentStep === 'review') {
      // Step 1: Explicit Approval Button
      const approveBtn = new SpatialButton('Approve Recovery Plan', 0.32, 0.05, {
        accentColor: SPATIAL_PALETTE.statusFeasible,
      });
      approveBtn.onClick(() => this.executeApproval());
      this.actionButtonsGroup.add(approveBtn.group);
    } else if (this.currentStep === 'approved' || this.currentStep === 'confirming_execution') {
      // Step 2: Separate Confirmation Action
      const confirmBtn = new SpatialButton('Confirm Schedule Execution', 0.36, 0.055, {
        accentColor: SPATIAL_PALETTE.primary,
      });
      confirmBtn.onClick(() => this.executeApplication());
      this.actionButtonsGroup.add(confirmBtn.group);
    } else if (this.currentStep === 'applied') {
      const doneLabel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.06),
        new THREE.MeshBasicMaterial({
          map: createTextTexture('✓ Schedule Successfully Updated in SQLite', {
            fontSize: 16,
            fontWeight: '700',
            color: SPATIAL_PALETTE.statusFeasible,
            width: 512,
            height: 48,
          }).texture,
          transparent: true,
        }),
      );
      this.actionButtonsGroup.add(doneLabel);
    }
  }

  /**
   * Step 1: Explicit Approval action.
   */
  async executeApproval(actor = 'spatial_user'): Promise<ApproveRecoveryPlanOutput> {
    if (!this.targetPlan) throw new Error('No plan loaded for approval');

    // Use persistentId if available, fallback to planId
    const planIdToApprove = this.targetPlan.persistentId ?? this.targetPlan.planId;

    try {
      logger.info(`Approving recovery plan ${planIdToApprove}`, 'ApprovalWorkflow');
      const result = await this.client.approvePlan(planIdToApprove, actor);
      this.approvalResult = result;
      this.currentStep = 'approved';

      this.renderApprovedNotice(result);
      this.renderActionButtons();
      this.callbacks.onApprovalComplete?.(result);
      return result;
    } catch (err) {
      logger.error('Failed to approve plan', 'ApprovalWorkflow', err);
      this.currentStep = 'failed';
      this.renderFailureNotice((err as Error).message);
      throw err;
    }
  }

  /**
   * Step 2: Separate Confirmation & Execution action.
   */
  async executeApplication(actor = 'spatial_user'): Promise<ApplyApprovedPlanOutput> {
    if (!this.targetPlan) throw new Error('No plan loaded for application');

    const planIdToApply = this.targetPlan.persistentId ?? this.targetPlan.planId;
    this.currentStep = 'executing';

    try {
      logger.info(`Executing approved plan ${planIdToApply}`, 'ApprovalWorkflow');
      const result = await this.client.applyPlan(planIdToApply, { actor });
      this.executionResult = result;
      this.currentStep = 'applied';

      this.renderAppliedNotice(result);
      this.renderActionButtons();
      this.callbacks.onExecutionComplete?.(result);
      return result;
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'Execution error';
      logger.error('Execution failed', 'ApprovalWorkflow', err);

      if (msg.includes('stale') || msg.includes('snapshot')) {
        this.currentStep = 'stale_rejected';
        this.renderStaleNotice();
      } else {
        this.currentStep = 'failed';
        this.renderFailureNotice(msg);
      }
      this.callbacks.onExecutionFailed?.(err as Error);
      throw err;
    }
  }

  private renderApprovedNotice(res: ApproveRecoveryPlanOutput): void {
    this.clearContentGroup();
    const text = `✓ Plan ${res.planId} Approved at ${this.formatTime(res.approvedAt)}.\n\nSEPARATE CONFIRMATION REQUIRED:\nConfirm below to atomically update stored calendar records.`;
    const { texture, aspect } = createTextTexture(text, {
      fontSize: 16,
      fontWeight: '600',
      color: SPATIAL_PALETTE.textCyan,
      width: 640,
      height: 96,
      textAlign: 'left',
      padding: 8,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.72 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    this.contentGroup.add(mesh);
  }

  private renderAppliedNotice(res: ApplyApprovedPlanOutput): void {
    this.clearContentGroup();
    const text = `🎉 EXECUTION COMPLETE!\nApplied at: ${this.formatTime(res.appliedAt)}\nEvents Updated: ${res.changesCount}\nStrategy: ${res.strategy}`;
    const { texture, aspect } = createTextTexture(text, {
      fontSize: 16,
      fontWeight: '700',
      color: SPATIAL_PALETTE.statusFeasible,
      width: 640,
      height: 96,
      textAlign: 'center',
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.72 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    this.contentGroup.add(mesh);
  }

  private renderStaleNotice(): void {
    this.clearContentGroup();
    const text = '⚠️ PLAN IS STALE:\nThe schedule changed before execution was confirmed.\nThe outdated proposal was rejected. Please recalculate fresh candidates.';
    const { texture, aspect } = createTextTexture(text, {
      fontSize: 15,
      fontWeight: '600',
      color: SPATIAL_PALETTE.statusWarning,
      width: 640,
      height: 96,
      textAlign: 'left',
      padding: 8,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.72 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    this.contentGroup.add(mesh);
  }

  private renderFailureNotice(errMsg: string): void {
    this.clearContentGroup();
    const text = `✗ Execution Failed:\n${errMsg}`;
    const { texture, aspect } = createTextTexture(text, {
      fontSize: 15,
      fontWeight: '600',
      color: SPATIAL_PALETTE.statusInfeasible,
      width: 640,
      height: 64,
      textAlign: 'left',
      padding: 8,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.72 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    this.contentGroup.add(mesh);
  }

  private formatTime(iso: string): string {
    try {
      const parts = iso.split('T');
      if (parts[1]) return parts[1].substring(0, 8);
    } catch {
      // Fallback
    }
    return iso;
  }

  private clearContentGroup(): void {
    while (this.contentGroup.children.length > 0) {
      const child = this.contentGroup.children[0];
      if (child) {
        this.contentGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) (child.material as THREE.Material).dispose();
        }
      }
    }
  }

  private clearButtonsGroup(): void {
    while (this.actionButtonsGroup.children.length > 0) {
      const child = this.actionButtonsGroup.children[0];
      if (child) {
        this.actionButtonsGroup.remove(child);
      }
    }
  }

  override dispose(): void {
    this.clearButtonsGroup();
    this.clearContentGroup();
    super.dispose();
  }
}
