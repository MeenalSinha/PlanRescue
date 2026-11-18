import * as THREE from 'three';
import type { RecoveryPlan } from '../api/contracts';
import { SPATIAL_PALETTE } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialUIElement } from '../ui/components';

/**
 * Spatial AI Assistant Panel (PlanRescue AI):
 * Formulates clear, grounded natural explanations for schedule changes,
 * protected events, strategy trade-offs, and task deadline impacts.
 */
export class SpatialAssistantPanel extends SpatialPanel {
  private readonly contentGroup: THREE.Group;

  constructor(width = 0.65, height = 0.75) {
    super('PlanRescue AI', width, height, {
      accentColor: SPATIAL_PALETTE.accentPurple,
    });

    this.contentGroup = new THREE.Group();
    this.contentGroup.position.set(0, 0, 0.015);
    this.group.add(this.contentGroup);

    this.showIdleState();
  }

  showStatusNotice(message: string): void {
    this.clearContent();

    const { texture, aspect } = createTextTexture(message, {
      fontSize: 15,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 512,
      height: 96,
      textAlign: 'left',
      padding: 12,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    mesh.position.set(0, 0.08, 0);
    this.contentGroup.add(mesh);
  }

  showIdleState(): void {
    this.clearContent();

    const text = 'PlanRescue AI is active.\nReport an overrun to analyze trade-offs and explore recovery alternatives.';
    const { texture, aspect } = createTextTexture(text, {
      fontSize: 16,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 512,
      height: 96,
      textAlign: 'left',
      padding: 12,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    mesh.position.set(0, 0.08, 0);
    this.contentGroup.add(mesh);
  }

  /**
   * Explains a specific recovery proposal using grounded backend facts.
   */
  explainProposal(candidate: RecoveryPlan): void {
    this.clearContent();

    const startY = 0.22;
    const gap = 0.11;

    // 1. Strategy & Recommendation Banner
    const isRecommended = candidate.score.rank === 1;
    const bannerText = `${isRecommended ? '⭐ RECOMMENDED PLAN' : 'ALTERNATIVE STRATEGY'}\nStrategy: ${this.formatStrategyName(candidate.strategy)} (Penalty Score: ${candidate.score.total})`;
    const { texture: bTex, aspect: bAspect } = createTextTexture(bannerText, {
      fontSize: 16,
      fontWeight: '700',
      color: isRecommended ? SPATIAL_PALETTE.textCyan : SPATIAL_PALETTE.textPrimary,
      width: 512,
      height: 56,
      textAlign: 'left',
      padding: 6,
    });
    const bMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56 / bAspect),
      new THREE.MeshBasicMaterial({ map: bTex, transparent: true }),
    );
    bMesh.position.set(0, startY, 0);
    this.contentGroup.add(bMesh);

    // 2. Schedule Changes Explanation
    const changesCount = candidate.changes.length;
    const changeSummary =
      changesCount === 0
        ? 'No meetings needed to be rescheduled.'
        : `${changesCount} meeting${changesCount > 1 ? 's' : ''} moved to accommodate overrun while protecting appointments.`;
    const { texture: cTex, aspect: cAspect } = createTextTexture(`Changes: ${changeSummary}`, {
      fontSize: 14,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textPrimary,
      width: 512,
      height: 48,
      textAlign: 'left',
      padding: 6,
    });
    const cMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56 / cAspect),
      new THREE.MeshBasicMaterial({ map: cTex, transparent: true }),
    );
    cMesh.position.set(0, startY - gap, 0);
    this.contentGroup.add(cMesh);

    // 3. Protected Constraints
    const protectedCount = candidate.unchangedProtectedEvents.length;
    const protText = `Protected: ${protectedCount} critical or fixed appointment${protectedCount === 1 ? '' : 's'} kept intact.`;
    const { texture: pTex, aspect: pAspect } = createTextTexture(protText, {
      fontSize: 14,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 512,
      height: 40,
      textAlign: 'left',
      padding: 6,
    });
    const pMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56 / pAspect),
      new THREE.MeshBasicMaterial({ map: pTex, transparent: true }),
    );
    pMesh.position.set(0, startY - gap * 2, 0);
    this.contentGroup.add(pMesh);

    // 4. Task Capacity Assessment
    const atRiskTasks = candidate.taskAssessments.filter((t) => t.status === 'at_risk');
    const taskSummary =
      atRiskTasks.length === 0
        ? '✓ All outstanding task deadlines remain feasible.'
        : `⚠️ Warning: ${atRiskTasks.length} task deadline${atRiskTasks.length > 1 ? 's' : ''} at risk.`;
    const { texture: tTex, aspect: tAspect } = createTextTexture(`Tasks: ${taskSummary}`, {
      fontSize: 14,
      fontWeight: '600',
      color: atRiskTasks.length === 0 ? SPATIAL_PALETTE.statusFeasible : SPATIAL_PALETTE.statusAtRisk,
      width: 512,
      height: 48,
      textAlign: 'left',
      padding: 6,
    });
    const tMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56 / tAspect),
      new THREE.MeshBasicMaterial({ map: tTex, transparent: true }),
    );
    tMesh.position.set(0, startY - gap * 3, 0);
    this.contentGroup.add(tMesh);
  }

  showInfeasibleExplanation(summary: string): void {
    this.clearContent();

    const text = `❌ Infeasible Schedule Scenario:\n${summary}\nNo plan can resolve the disruption without breaking protected constraints.`;
    const { texture, aspect } = createTextTexture(text, {
      fontSize: 15,
      fontWeight: '500',
      color: SPATIAL_PALETTE.statusInfeasible,
      width: 512,
      height: 96,
      textAlign: 'left',
      padding: 8,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    mesh.position.set(0, 0.05, 0);
    this.contentGroup.add(mesh);
  }

  private formatStrategyName(strategy: string): string {
    switch (strategy) {
      case 'minimal_disruption':
        return 'Minimal Disruption';
      case 'buffered_transitions':
        return 'Buffered Transitions';
      case 'priority_first':
        return 'Priority First';
      default:
        return strategy;
    }
  }

  private clearContent(): void {
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

  override dispose(): void {
    this.clearContent();
    super.dispose();
  }
}
