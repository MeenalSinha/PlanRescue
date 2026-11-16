import * as THREE from 'three';
import type { ValidationResult } from '../api/contracts';
import { SPATIAL_PALETTE } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialUIElement } from '../ui/components';

/**
 * 3D Independent Validation Explorer Panel:
 * Shows individual verification checks returned by the backend independent validator.
 */
export class SpatialValidationExplorer extends SpatialPanel {
  private readonly checksGroup: THREE.Group;

  constructor(width = 0.65, height = 0.75) {
    super('Independent Validation', width, height, {
      accentColor: SPATIAL_PALETTE.statusFeasible,
    });

    this.checksGroup = new THREE.Group();
    this.checksGroup.position.set(0, 0.18, 0.015);
    this.group.add(this.checksGroup);
  }

  displayValidation(result: ValidationResult): void {
    this.clearChecks();

    const startY = 0;
    const gap = 0.085;

    // Display checks (e.g. No Overlaps, Duration Preserved, Protected Constraints, Deadline Feasibility)
    const checksToDisplay = result.checks.slice(0, 5);

    checksToDisplay.forEach((chk, i) => {
      const isPassed = chk.passed;
      const statusIcon = isPassed ? '✓' : chk.severity === 'hard' ? '✗' : '⚠️';
      const statusColor = isPassed
        ? SPATIAL_PALETTE.statusFeasible
        : chk.severity === 'hard'
          ? SPATIAL_PALETTE.statusInfeasible
          : SPATIAL_PALETTE.statusWarning;

      const lineText = `${statusIcon} ${chk.name}: ${chk.message}`;
      const { texture, aspect } = createTextTexture(lineText, {
        fontSize: 14,
        fontWeight: isPassed ? '500' : '700',
        color: statusColor,
        width: 512,
        height: 40,
        textAlign: 'left',
        padding: 6,
      });

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.56, 0.56 / aspect),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
      );
      mesh.position.set(0, startY - i * gap, 0);
      this.checksGroup.add(mesh);
    });

    // Summary banner at bottom
    const summaryText = result.isValid
      ? '✓ All hard constraints satisfied. Proposal is safe to execute.'
      : '✗ Plan contains constraint violations and cannot be executed.';
    const { texture: sTex, aspect: sAspect } = createTextTexture(summaryText, {
      fontSize: 14,
      fontWeight: '600',
      color: result.isValid ? SPATIAL_PALETTE.statusFeasible : SPATIAL_PALETTE.statusInfeasible,
      width: 512,
      height: 48,
      textAlign: 'center',
    });
    const sMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56 / sAspect),
      new THREE.MeshBasicMaterial({ map: sTex, transparent: true }),
    );
    sMesh.position.set(0, startY - checksToDisplay.length * gap - 0.03, 0);
    this.checksGroup.add(sMesh);
  }

  clearChecks(): void {
    while (this.checksGroup.children.length > 0) {
      const child = this.checksGroup.children[0];
      if (child) {
        this.checksGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) (child.material as THREE.Material).dispose();
        }
      }
    }
  }

  override dispose(): void {
    this.clearChecks();
    super.dispose();
  }
}
