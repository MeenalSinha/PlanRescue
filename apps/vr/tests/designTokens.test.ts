import { describe, expect, it } from 'vitest';
import {
  SPATIAL_PALETTE,
  SPATIAL_LAYOUT,
  SPATIAL_DIMENSIONS,
  SPATIAL_ANIMATION,
  ENVIRONMENT_LIGHTING,
} from '../src/ui/tokens';

describe('Spatial Design Tokens (Phase 2)', () => {
  it('defines valid hex numbers for 3D materials in the spatial palette', () => {
    expect(typeof SPATIAL_PALETTE.studioVoid).toBe('number');
    expect(typeof SPATIAL_PALETTE.panelBackground).toBe('number');
    expect(typeof SPATIAL_PALETTE.primary).toBe('number');
    expect(SPATIAL_PALETTE.primary).toBe(0x00e5ff); // PlanRescue signature cyan
    expect(SPATIAL_PALETTE.priorityCritical).toBe(0xef4444);
    expect(SPATIAL_PALETTE.priorityHigh).toBe(0xf97316);
    expect(SPATIAL_PALETTE.priorityMedium).toBe(0x3b82f6);
    expect(SPATIAL_PALETTE.priorityLow).toBe(0x10b981);
  });

  it('defines ergonomic seated spatial layout parameters within Quest FOV reach', () => {
    expect(SPATIAL_LAYOUT.userEyeHeightMeters).toBeGreaterThan(1.0);
    expect(SPATIAL_LAYOUT.userEyeHeightMeters).toBeLessThan(1.5);
    expect(SPATIAL_LAYOUT.comfortableReachDistanceMeters).toBeLessThanOrEqual(1.0);
    expect(SPATIAL_LAYOUT.comfortableViewingDistanceMeters).toBeGreaterThanOrEqual(1.2);

    // Timeline is centered in front of user
    expect(SPATIAL_LAYOUT.zones.timeline.position.x).toBe(0);
    expect(SPATIAL_LAYOUT.zones.timeline.rotationY).toBe(0);

    // Task and Assistant panels are angled symmetrically inwards for seated readability
    expect(SPATIAL_LAYOUT.zones.taskPanel.rotationY).toBeGreaterThan(0);
    expect(SPATIAL_LAYOUT.zones.assistantPanel.rotationY).toBeLessThan(0);
    expect(Math.abs(SPATIAL_LAYOUT.zones.taskPanel.rotationY)).toBe(
      Math.abs(SPATIAL_LAYOUT.zones.assistantPanel.rotationY),
    );
  });

  it('defines reasonable physical dimensions for spatial cards and controls', () => {
    expect(SPATIAL_DIMENSIONS.eventCardWidth).toBeGreaterThan(0.15); // > 15 cm
    expect(SPATIAL_DIMENSIONS.eventCardWidth).toBeLessThan(0.4);
    expect(SPATIAL_DIMENSIONS.buttonHeight).toBeGreaterThanOrEqual(0.04); // Accessible touch target
  });

  it('configures restrained architectural lighting parameters', () => {
    expect(ENVIRONMENT_LIGHTING.ambientIntensity).toBeGreaterThan(0);
    expect(ENVIRONMENT_LIGHTING.keyLightIntensity).toBeGreaterThan(ENVIRONMENT_LIGHTING.ambientIntensity);
    expect(ENVIRONMENT_LIGHTING.keyLightPosition.y).toBeGreaterThan(2);
  });
});
