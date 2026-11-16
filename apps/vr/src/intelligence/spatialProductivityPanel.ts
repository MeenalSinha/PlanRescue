import * as THREE from 'three';
import type { ProductivityInsights } from '../api/contracts';
import { SPATIAL_PALETTE } from '../ui/tokens';
import { createTextTexture, SpatialPanel } from '../ui/components';

/**
 * 3D Spatial Productivity & Health Intelligence Panel (Spatial Phase 11)
 *
 * Renders the Schedule Health Score (0-100), focus time metrics,
 * and grounded AI recovery recommendations in Horizon OS dark glassmorphic styling.
 */
export class SpatialProductivityPanel extends SpatialPanel {
  private insights: ProductivityInsights | null = null;
  private readonly contentGroup: THREE.Group;

  constructor(width = 0.74, height = 0.52) {
    super('Productivity & Health Intelligence', width, height, {
      accentColor: SPATIAL_PALETTE.accentPurple,
    });

    this.contentGroup = new THREE.Group();
    this.contentGroup.position.set(0, 0.08, 0.015);
    this.group.add(this.contentGroup);
  }

  setInsights(insights: ProductivityInsights): void {
    this.insights = insights;
    this.renderContent();
  }

  private renderContent(): void {
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

    if (!this.insights) return;

    const { metrics, recommendations, summary } = this.insights;

    // 1. Health Score Ring / Badge
    const scoreColor =
      metrics.healthScore >= 80
        ? '#10b981' // Green
        : metrics.healthScore >= 60
          ? '#f59e0b' // Amber
          : '#ef4444'; // Red

    const scoreText = `Schedule Health: ${metrics.healthScore}/100\n${summary}`;
    const { texture: sTex, aspect: sAspect } = createTextTexture(scoreText, {
      fontSize: 16,
      fontWeight: '700',
      color: scoreColor,
      width: 512,
      height: 48,
      textAlign: 'left',
      padding: 6,
    });
    const sMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.64, 0.64 / sAspect),
      new THREE.MeshBasicMaterial({ map: sTex, transparent: true }),
    );
    sMesh.position.set(0, 0.08, 0);
    this.contentGroup.add(sMesh);

    // 2. Metrics Breakdown
    const focusHours = Math.floor(metrics.focusTimeMinutes / 60);
    const focusMins = metrics.focusTimeMinutes % 60;
    const focusFormatted = focusHours > 0 ? `${focusHours}h ${focusMins}m` : `${focusMins}m`;

    const metricsText = `Focus Blocks: ${focusFormatted} | Fragmented: ${metrics.fragmentedMinutes}m\nBack-to-Back: ${metrics.backToBackCount} | Density: ${metrics.overloadPercentage}%`;
    const { texture: mTex, aspect: mAspect } = createTextTexture(metricsText, {
      fontSize: 13,
      fontWeight: '600',
      color: SPATIAL_PALETTE.textCyan,
      width: 512,
      height: 44,
      textAlign: 'left',
      padding: 6,
    });
    const mMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.64, 0.64 / mAspect),
      new THREE.MeshBasicMaterial({ map: mTex, transparent: true }),
    );
    mMesh.position.set(0, 0.01, 0);
    this.contentGroup.add(mMesh);

    // 3. Grounded Recommendations (up to 2)
    const recsToDisplay = recommendations.slice(0, 2);
    if (recsToDisplay.length > 0) {
      const recLines = recsToDisplay
        .map((r, idx) => `💡 ${idx + 1}. ${r.title}\n   ${r.suggestedAction}`)
        .join('\n\n');

      const { texture: rTex, aspect: rAspect } = createTextTexture(recLines, {
        fontSize: 12,
        fontWeight: '500',
        color: SPATIAL_PALETTE.textPrimary,
        width: 512,
        height: 64,
        textAlign: 'left',
        padding: 6,
      });
      const rMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.64, 0.64 / rAspect),
        new THREE.MeshBasicMaterial({ map: rTex, transparent: true }),
      );
      rMesh.position.set(0, -0.09, 0);
      this.contentGroup.add(rMesh);
    }
  }

  override dispose(): void {
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
    super.dispose();
  }
}
