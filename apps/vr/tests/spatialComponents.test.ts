import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  SpatialPanel,
  SpatialCard,
  SpatialButton,
  SpatialLoadingIndicator,
  SpatialStudioEnvironment,
} from '../src/ui/components';
import { SPATIAL_PALETTE } from '../src/ui/tokens';

describe('Spatial UI Component Library (Phase 2)', () => {
  it('creates and positions a SpatialPanel with header and border', () => {
    const panel = new SpatialPanel('Daily Schedule', 1.2, 0.8);
    panel.setPosition(0, 1.25, -1.5);
    panel.setRotationY(15);

    expect(panel.group.position.x).toBe(0);
    expect(panel.group.position.y).toBe(1.25);
    expect(panel.group.position.z).toBe(-1.5);
    expect(panel.group.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(15));

    panel.setHighlighted(true);
    panel.dispose();
  });

  it('manages hover and selection state on SpatialCard', () => {
    const card = new SpatialCard('evt-101', 'Team Sync', '10:00 AM - 10:45 AM', {
      priorityColor: SPATIAL_PALETTE.priorityHigh,
      movable: true,
    });

    expect(card.dataId).toBe('evt-101');
    expect(card.group.position.z).toBe(0);

    // Hover elevates card forward slightly for spatial depth feedback
    card.setHovered(true);
    expect(card.group.position.z).toBeGreaterThan(0);

    card.setHovered(false);
    expect(card.group.position.z).toBe(0);

    card.setSelected(true);
    expect(card.group.position.z).toBeGreaterThan(0);

    card.dispose();
  });

  it('triggers click handlers on SpatialButton', () => {
    const onClick = vi.fn();
    const button = new SpatialButton('Approve Plan', 0.2, 0.05);
    button.onClick(onClick);

    button.setHovered(true);
    button.setPressed(true);

    expect(onClick).toHaveBeenCalledTimes(1);
    button.dispose();
  });

  it('rotates SpatialLoadingIndicator during update cycles', () => {
    const indicator = new SpatialLoadingIndicator();
    const initialRotZ = indicator.group.children[0]?.rotation.z ?? 0;

    indicator.update(0.1);
    const updatedRotZ = indicator.group.children[0]?.rotation.z ?? 0;
    expect(updatedRotZ).not.toBe(initialRotZ);

    indicator.dispose();
  });

  it('initializes and cleans up the SpatialStudioEnvironment', () => {
    const scene = new THREE.Scene();
    const env = new SpatialStudioEnvironment(scene);

    const studioGroup = scene.getObjectByName('PlanRescue_Spatial_Studio');
    expect(studioGroup).toBeDefined();

    // Check lighting and anchor podium exist
    expect(scene.getObjectByName('studio_ambient_light')).toBeDefined();
    expect(scene.getObjectByName('studio_key_light')).toBeDefined();
    expect(scene.getObjectByName('schedule_anchor_podium')).toBeDefined();

    // Toggle loading
    env.showLoading(true);
    env.update(0.016);
    env.showLoading(false);

    env.dispose();
    expect(scene.getObjectByName('PlanRescue_Spatial_Studio')).toBeUndefined();
  });
});
