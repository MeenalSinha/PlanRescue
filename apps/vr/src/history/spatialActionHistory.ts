import * as THREE from 'three';
import type { ActionHistoryItem } from '../api/contracts';
import { SPATIAL_PALETTE } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialUIElement } from '../ui/components';

/**
 * 3D Audit Trail History Entry.
 */
export class SpatialHistoryItemCard extends SpatialUIElement {
  readonly item: ActionHistoryItem;

  constructor(item: ActionHistoryItem, width = 0.72, height = 0.08) {
    super(`HistoryItem_${item.id}`);
    this.item = item;

    const isApplied = item.actionType === 'plan_applied';
    const isApproved = item.actionType === 'plan_approved';
    const isStale = item.actionType === 'plan_stale';

    const accentColor = isApplied
      ? SPATIAL_PALETTE.statusFeasible
      : isApproved
        ? SPATIAL_PALETTE.primary
        : isStale
          ? SPATIAL_PALETTE.statusWarning
          : SPATIAL_PALETTE.cardBorder;

    // Body
    const bodyGeo = new THREE.BoxGeometry(width, height, 0.01);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(bodyMesh);

    // Accent left stripe
    const stripeW = 0.006;
    const stripeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(stripeW, height * 0.85),
      new THREE.MeshBasicMaterial({ color: accentColor }),
    );
    stripeMesh.position.set(-width / 2 + stripeW / 2 + 0.002, 0, 0.006);
    this.group.add(stripeMesh);

    // Summary line
    const timeShort = item.occurredAt.includes('T') ? item.occurredAt.split('T')[1]?.substring(0, 8) : item.occurredAt;
    const lineText = `[${timeShort}] ${item.actionType.toUpperCase()}: ${item.summary}`;
    const { texture, aspect } = createTextTexture(lineText, {
      fontSize: 14,
      fontWeight: '600',
      color: SPATIAL_PALETTE.textPrimary,
      width: 640,
      height: 40,
      textAlign: 'left',
      padding: 6,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.9, (width * 0.9) / aspect),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    mesh.position.set(0.01, 0, 0.006);
    this.group.add(mesh);
  }
}

/**
 * Spatial Action History Panel:
 * Shows persistent audit trail of planning, approval, and execution decisions.
 */
export class SpatialActionHistoryPanel extends SpatialPanel {
  private readonly items: SpatialHistoryItemCard[] = [];

  constructor(width = 0.85, height = 0.65) {
    super('Action History & Audit Trail', width, height, {
      accentColor: SPATIAL_PALETTE.primary,
    });
  }

  setHistoryEntries(entries: ActionHistoryItem[]): void {
    this.clearHistory();

    const startY = 0.16;
    const gap = 0.095;
    const maxEntries = 5;

    const displayEntries = entries.slice(0, maxEntries);
    displayEntries.forEach((entry, i) => {
      const card = new SpatialHistoryItemCard(entry, 0.75, 0.08);
      card.setPosition(0, startY - i * gap, 0.015);
      this.group.add(card.group);
      this.items.push(card);
    });

    if (entries.length === 0) {
      const { texture, aspect } = createTextTexture('No audit records recorded yet', {
        fontSize: 16,
        color: SPATIAL_PALETTE.textMuted,
        width: 384,
        height: 64,
      });
      const emptyMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5 / aspect),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
      );
      emptyMesh.position.set(0, 0, 0.015);
      emptyMesh.name = 'empty_history_notice';
      this.group.add(emptyMesh);
    }
  }

  clearHistory(): void {
    for (const item of this.items) {
      this.group.remove(item.group);
      item.dispose();
    }
    this.items.length = 0;

    const notice = this.group.getObjectByName('empty_history_notice');
    if (notice) {
      this.group.remove(notice);
    }
  }

  override dispose(): void {
    this.clearHistory();
    super.dispose();
  }
}
