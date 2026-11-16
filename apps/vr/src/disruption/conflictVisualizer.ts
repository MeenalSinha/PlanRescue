import * as THREE from 'three';
import type { ConflictAnalysis, Conflict } from '../api/contracts';
import { SPATIAL_PALETTE } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialUIElement } from '../ui/components';

/**
 * 3D Conflict Summary Card on the spatial assistant panel.
 */
export class SpatialConflictCard extends SpatialUIElement {
  readonly conflict: Conflict;

  constructor(conflict: Conflict, width = 0.58, height = 0.1) {
    super(`ConflictCard_${conflict.issueId}`);
    this.conflict = conflict;

    const isDirect = conflict.introducedByDisruption;
    const severityColor =
      conflict.severity === 'critical'
        ? SPATIAL_PALETTE.priorityCritical
        : conflict.severity === 'high'
          ? SPATIAL_PALETTE.priorityHigh
          : SPATIAL_PALETTE.statusWarning;

    // Background body
    const bodyGeo = new THREE.BoxGeometry(width, height, 0.012);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x221318, // subtle warning tinted background
      roughness: 0.4,
      metalness: 0.1,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(bodyMesh);

    // Left severity stripe
    const stripeW = 0.008;
    const stripeGeo = new THREE.PlaneGeometry(stripeW, height * 0.85);
    const stripeMesh = new THREE.Mesh(
      stripeGeo,
      new THREE.MeshBasicMaterial({ color: severityColor }),
    );
    stripeMesh.position.set(-width / 2 + stripeW / 2 + 0.002, 0, 0.007);
    this.group.add(stripeMesh);

    // Description text
    const labelText = `${isDirect ? '[NEW] ' : '[EXISTING] '}${conflict.description}`;
    const { texture: tTex, aspect: tAspect } = createTextTexture(labelText, {
      fontSize: 16,
      fontWeight: '600',
      color: SPATIAL_PALETTE.textPrimary,
      width: 512,
      height: 48,
      textAlign: 'left',
      padding: 6,
    });
    const tW = width * 0.88;
    const tH = tW / tAspect;
    const tMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(tW, tH),
      new THREE.MeshBasicMaterial({ map: tTex, transparent: true }),
    );
    tMesh.position.set(0.01, 0.018, 0.008);
    this.group.add(tMesh);

    // Suggested next step
    const { texture: sTex, aspect: sAspect } = createTextTexture(conflict.suggestedNextStep, {
      fontSize: 13,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 512,
      height: 36,
      textAlign: 'left',
      padding: 6,
    });
    const sW = width * 0.88;
    const sH = sW / sAspect;
    const sMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(sW, sH),
      new THREE.MeshBasicMaterial({ map: sTex, transparent: true }),
    );
    sMesh.position.set(0.01, -0.02, 0.008);
    this.group.add(sMesh);
  }
}

/**
 * Spatial Conflict Visualizer Panel:
 * Displays real conflict results, affected meetings, and protected event constraints.
 */
export class SpatialConflictVisualizer extends SpatialPanel {
  private readonly conflictCards: SpatialConflictCard[] = [];

  constructor(width = 0.65, height = 0.75) {
    super('Conflict Analysis', width, height, {
      accentColor: SPATIAL_PALETTE.priorityCritical,
    });
  }

  displayAnalysis(analysis: ConflictAnalysis): void {
    this.clearConflicts();

    const startY = 0.22;
    const gap = 0.12;

    const allConflicts = [...analysis.newConflicts, ...analysis.existingConflicts];
    const displayItems = allConflicts.slice(0, 4);

    displayItems.forEach((c, idx) => {
      const card = new SpatialConflictCard(c, 0.58, 0.1);
      card.setPosition(0, startY - idx * gap, 0.015);
      this.group.add(card.group);
      this.conflictCards.push(card);
    });

    if (allConflicts.length === 0) {
      const { texture, aspect } = createTextTexture('✓ No scheduling conflicts detected', {
        fontSize: 18,
        fontWeight: '600',
        color: SPATIAL_PALETTE.statusFeasible,
        width: 384,
        height: 64,
      });
      const okMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5 / aspect),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
      );
      okMesh.position.set(0, 0, 0.015);
      okMesh.name = 'no_conflicts_notice';
      this.group.add(okMesh);
    }
  }

  clearConflicts(): void {
    for (const card of this.conflictCards) {
      this.group.remove(card.group);
      card.dispose();
    }
    this.conflictCards.length = 0;

    const okNotice = this.group.getObjectByName('no_conflicts_notice');
    if (okNotice) {
      this.group.remove(okNotice);
    }
  }

  override dispose(): void {
    this.clearConflicts();
    super.dispose();
  }
}
