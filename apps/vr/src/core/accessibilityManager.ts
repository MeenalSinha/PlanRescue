import type { AccessibilityPreferences } from '../api/contracts';
import { logger } from '../logging/logger';

export interface SpatialComfortEnvelope {
  seatedEyeHeightMeters: number;
  standingEyeHeightMeters: number;
  recommendedViewDistanceMeters: number;
  horizontalArcRadiusMeters: number;
  verticalViewingConeDegrees: number;
}

export const DEFAULT_COMFORT_ENVELOPE: SpatialComfortEnvelope = {
  seatedEyeHeightMeters: 1.25,
  standingEyeHeightMeters: 1.60,
  recommendedViewDistanceMeters: 1.35,
  horizontalArcRadiusMeters: 1.40,
  verticalViewingConeDegrees: 25, // 25 degree downward tilt from eye level for neck comfort
};

export class AccessibilityManager {
  private static instance: AccessibilityManager | null = null;
  private prefs: AccessibilityPreferences;
  private readonly comfortEnvelope: SpatialComfortEnvelope;
  private listeners: Array<(prefs: AccessibilityPreferences) => void> = [];

  constructor(initialPrefs?: Partial<AccessibilityPreferences>) {
    this.comfortEnvelope = DEFAULT_COMFORT_ENVELOPE;
    this.prefs = {
      highContrast: initialPrefs?.highContrast ?? false,
      textScale: initialPrefs?.textScale ?? 1.0,
      reducedMotion: initialPrefs?.reducedMotion ?? false,
      colorblindFriendly: initialPrefs?.colorblindFriendly ?? true,
      interactionMode: initialPrefs?.interactionMode ?? 'hands',
      postureMode: initialPrefs?.postureMode ?? 'seated',
      studioEyeHeight: initialPrefs?.studioEyeHeight ?? DEFAULT_COMFORT_ENVELOPE.seatedEyeHeightMeters,
    };
  }

  static getInstance(): AccessibilityManager {
    if (!this.instance) {
      this.instance = new AccessibilityManager();
    }
    return this.instance;
  }

  getPreferences(): AccessibilityPreferences {
    return { ...this.prefs };
  }

  getComfortEnvelope(): SpatialComfortEnvelope {
    return { ...this.comfortEnvelope };
  }

  updatePreferences(partial: Partial<AccessibilityPreferences>): AccessibilityPreferences {
    const prev = { ...this.prefs };
    this.prefs = {
      ...this.prefs,
      ...partial,
    };

    // If posture changed, adjust studio eye height accordingly unless explicit
    if (partial.postureMode && partial.postureMode !== prev.postureMode && !partial.studioEyeHeight) {
      this.prefs.studioEyeHeight =
        this.prefs.postureMode === 'seated'
          ? this.comfortEnvelope.seatedEyeHeightMeters
          : this.comfortEnvelope.standingEyeHeightMeters;
    }

    logger.info('Accessibility', 'Updated accessibility preferences', this.prefs);

    for (const listener of this.listeners) {
      listener(this.prefs);
    }

    return this.prefs;
  }

  subscribe(listener: (prefs: AccessibilityPreferences) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Helper to format status badges with text symbols for non-color accessibility.
   */
  formatStatusLabel(status: string, label: string): string {
    if (!this.prefs.colorblindFriendly) return label;

    switch (status.toLowerCase()) {
      case 'valid':
      case 'applied':
      case 'connected':
      case 'healthy':
        return `[✓] ${label}`;
      case 'warning':
      case 'at_risk':
      case 'syncing':
        return `[!] ${label}`;
      case 'infeasible':
      case 'invalid':
      case 'error':
      case 'failed':
        return `[✕] ${label}`;
      default:
        return `[•] ${label}`;
    }
  }

  /**
   * Checks whether animations should be skipped or clamped for vestibular comfort.
   */
  shouldAnimate(): boolean {
    return !this.prefs.reducedMotion;
  }
}
