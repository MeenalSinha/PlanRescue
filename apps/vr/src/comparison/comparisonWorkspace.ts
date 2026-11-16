import * as THREE from 'three';
import type { RecoveryPlan, ScheduleEvent } from '../api/contracts';
import { SPATIAL_PALETTE, SPATIAL_DIMENSIONS } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialButton, SpatialUIElement } from '../ui/components';
import type { HandInteractionManager } from '../interaction/handInteractionManager';

export interface StrategySelectCallback {
  (plan: RecoveryPlan): void;
}

/**
 * 3D Before-and-After Schedule Comparison Workspace:
 * Renders dual timeline tracks (Baseline vs Proposed) with animated
 * card movements and visual diff highlighting.
 */
export class SpatialComparisonWorkspace extends SpatialPanel {
  private readonly baselineTrackGroup: THREE.Group;
  private readonly proposedTrackGroup: THREE.Group;
  private readonly strategyButtonsGroup: THREE.Group;
  private readonly changeDetailsGroup: THREE.Group;
  private readonly interactionManager?: HandInteractionManager;

  private onStrategySelected?: StrategySelectCallback;
  private activeCandidates: RecoveryPlan[] = [];
  private selectedPlan: RecoveryPlan | null = null;

  constructor(
    interactionManager?: HandInteractionManager,
    width = 1.3,
    height = 0.85,
  ) {
    super('Recovery Plan Comparison', width, height, {
      accentColor: SPATIAL_PALETTE.primary,
    });
    this.interactionManager = interactionManager;

    // Strategy selector shelf along top
    this.strategyButtonsGroup = new THREE.Group();
    this.strategyButtonsGroup.position.set(0, 0.28, 0.02);
    this.group.add(this.strategyButtonsGroup);

    // Track 1: Before (Baseline Schedule)
    this.baselineTrackGroup = new THREE.Group();
    this.baselineTrackGroup.position.set(0, 0.12, 0.02);
    this.group.add(this.baselineTrackGroup);

    // Track 2: After (Proposed Recovery Schedule)
    this.proposedTrackGroup = new THREE.Group();
    this.proposedTrackGroup.position.set(0, -0.1, 0.02);
    this.group.add(this.proposedTrackGroup);

    // Change details panel below
    this.changeDetailsGroup = new THREE.Group();
    this.changeDetailsGroup.position.set(0, -0.28, 0.02);
    this.group.add(this.changeDetailsGroup);

    this.buildTrackLabels();
  }

  private buildTrackLabels(): void {
    // Label for Baseline
    const { texture: bTex, aspect: bAspect } = createTextTexture('BEFORE (Original Schedule):', {
      fontSize: 14,
      fontWeight: '600',
      color: SPATIAL_PALETTE.textMuted,
      width: 384,
      height: 36,
      textAlign: 'left',
      padding: 4,
    });
    const bMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.4 / bAspect),
      new THREE.MeshBasicMaterial({ map: bTex, transparent: true }),
    );
    bMesh.position.set(-0.45, 0.21, 0.02);
    this.group.add(bMesh);

    // Label for Proposed
    const { texture: pTex, aspect: pAspect } = createTextTexture('AFTER (Proposed Recovery):', {
      fontSize: 14,
      fontWeight: '600',
      color: SPATIAL_PALETTE.textCyan,
      width: 384,
      height: 36,
      textAlign: 'left',
      padding: 4,
    });
    const pMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.4 / pAspect),
      new THREE.MeshBasicMaterial({ map: pTex, transparent: true }),
    );
    pMesh.position.set(-0.45, -0.01, 0.02);
    this.group.add(pMesh);
  }

  setCandidates(candidates: RecoveryPlan[], baselineEvents: ScheduleEvent[]): void {
    this.activeCandidates = candidates;
    this.clearStrategyButtons();

    if (candidates.length === 0) {
      return;
    }

    // Build Strategy Buttons: Minimal Disruption, Buffered Transitions, Priority First
    const btnW = 0.36;
    const btnH = 0.045;
    const totalW = candidates.length * btnW + (candidates.length - 1) * 0.04;
    const startX = -totalW / 2 + btnW / 2;

    candidates.forEach((plan, i) => {
      const isRankOne = plan.score.rank === 1;
      const label = `${isRankOne ? '★ ' : ''}${this.formatStrategyName(plan.strategy)} (${plan.score.total})`;
      const btn = new SpatialButton(label, btnW, btnH, {
        accentColor: isRankOne ? SPATIAL_PALETTE.primary : 0x475569,
      });
      btn.setPosition(startX + i * (btnW + 0.04), 0, 0);
      btn.onClick(() => {
        this.selectPlan(plan, baselineEvents);
      });
      this.strategyButtonsGroup.add(btn.group);
    });

    // Select the first (recommended) candidate by default
    if (candidates[0]) {
      this.selectPlan(candidates[0], baselineEvents);
    }
  }

  selectPlan(plan: RecoveryPlan, baselineEvents: ScheduleEvent[]): void {
    this.selectedPlan = plan;
    this.renderComparisonTracks(baselineEvents, plan);
    this.renderChangeExplanations(plan);
    this.onStrategySelected?.(plan);
  }

  private renderComparisonTracks(baselineEvents: ScheduleEvent[], plan: RecoveryPlan): void {
    // Clear tracks
    this.clearTrack(this.baselineTrackGroup);
    this.clearTrack(this.proposedTrackGroup);

    const changedMap = new Map(plan.changes.map((c) => [c.eventId, c]));
    const trackW = 1.1;
    const dayStartMin = 8 * 60; // 08:00
    const dayTotalMin = 12 * 60; // 12 hours

    // 1. Render Baseline Track (Before)
    baselineEvents.forEach((evt) => {
      const startMin = this.parseMinutes(evt.startTime);
      const durMin = evt.durationMinutes;
      const blockW = Math.max((durMin / dayTotalMin) * trackW - 0.008, 0.08);
      const posX = ((startMin - dayStartMin + durMin / 2) / dayTotalMin) * trackW - trackW / 2;

      const isChanged = changedMap.has(evt.id);
      const geo = new THREE.BoxGeometry(blockW, 0.07, 0.01);
      const mat = new THREE.MeshStandardMaterial({
        color: isChanged ? 0x475569 : 0x1e293b,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(posX, 0, 0);
      this.baselineTrackGroup.add(mesh);
    });

    // 2. Render Proposed Track (After)
    baselineEvents.forEach((evt) => {
      const change = changedMap.get(evt.id);
      const isChanged = change !== undefined;
      const startMin = isChanged ? this.parseMinutes(change.proposedStartTime) : this.parseMinutes(evt.startTime);
      const durMin = evt.durationMinutes;
      const blockW = Math.max((durMin / dayTotalMin) * trackW - 0.008, 0.08);
      const posX = ((startMin - dayStartMin + durMin / 2) / dayTotalMin) * trackW - trackW / 2;

      const geo = new THREE.BoxGeometry(blockW, 0.07, 0.015);
      const mat = new THREE.MeshStandardMaterial({
        color: isChanged ? SPATIAL_PALETTE.cardSurfaceSelected : 0x1e293b,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(posX, 0, isChanged ? 0.01 : 0);
      this.proposedTrackGroup.add(mesh);

      // Cyan accent border on moved blocks
      if (isChanged) {
        const edges = new THREE.EdgesGeometry(geo);
        const border = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: SPATIAL_PALETTE.primary }),
        );
        mesh.add(border);
      }
    });
  }

  private renderChangeExplanations(plan: RecoveryPlan): void {
    while (this.changeDetailsGroup.children.length > 0) {
      const child = this.changeDetailsGroup.children[0];
      if (child) {
        this.changeDetailsGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) (child.material as THREE.Material).dispose();
        }
      }
    }

    const changes = plan.changes;
    if (changes.length === 0) {
      const { texture, aspect } = createTextTexture('✓ No meetings shifted in this strategy', {
        fontSize: 15,
        color: SPATIAL_PALETTE.statusFeasible,
        width: 512,
        height: 36,
      });
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5 / aspect),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
      );
      this.changeDetailsGroup.add(mesh);
      return;
    }

    // Display first 2 change reasons concisely
    const lines = changes.slice(0, 2).map((c) => {
      const orig = this.formatTime(c.originalStartTime);
      const prop = this.formatTime(c.proposedStartTime);
      return `• ${c.title}: ${orig} → ${prop} (${c.reason})`;
    });

    const { texture, aspect } = createTextTexture(lines.join('\n'), {
      fontSize: 13,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textPrimary,
      width: 768,
      height: 64,
      textAlign: 'left',
      padding: 6,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.85 / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    this.changeDetailsGroup.add(mesh);
  }

  private parseMinutes(iso: string): number {
    try {
      const timePart = iso.split('T')[1];
      if (timePart) {
        const [h, m] = timePart.split(':');
        return parseInt(h ?? '0', 10) * 60 + parseInt(m ?? '0', 10);
      }
    } catch {
      // Fallback
    }
    return 600;
  }

  private formatTime(iso: string): string {
    try {
      const parts = iso.split('T');
      if (parts[1]) return parts[1].substring(0, 5);
    } catch {
      // Fallback
    }
    return iso;
  }

  private formatStrategyName(s: string): string {
    return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private clearTrack(track: THREE.Group): void {
    while (track.children.length > 0) {
      const child = track.children[0];
      if (child) {
        track.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) (child.material as THREE.Material).dispose();
        }
      }
    }
  }

  private clearStrategyButtons(): void {
    while (this.strategyButtonsGroup.children.length > 0) {
      const child = this.strategyButtonsGroup.children[0];
      if (child) {
        this.strategyButtonsGroup.remove(child);
      }
    }
  }

  onSelectStrategy(cb: StrategySelectCallback): this {
    this.onStrategySelected = cb;
    return this;
  }

  override dispose(): void {
    this.clearStrategyButtons();
    this.clearTrack(this.baselineTrackGroup);
    this.clearTrack(this.proposedTrackGroup);
    super.dispose();
  }
}
