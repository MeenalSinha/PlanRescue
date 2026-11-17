import { describe, expect, it } from 'vitest';
import { AccessibilityManager, DEFAULT_COMFORT_ENVELOPE } from '../src/core/accessibilityManager';
import { XrCapabilityDetector } from '../src/platform/xrCapabilities';

describe('Spatial Phase 13: Accessibility, Ergonomics & Quest Capability Verification', () => {
  describe('AccessibilityManager', () => {
    it('initializes with default comfort envelope and seated eye height', () => {
      const a11y = new AccessibilityManager();
      const prefs = a11y.getPreferences();
      const envelope = a11y.getComfortEnvelope();

      expect(prefs.postureMode).toBe('seated');
      expect(prefs.studioEyeHeight).toBe(DEFAULT_COMFORT_ENVELOPE.seatedEyeHeightMeters);
      expect(prefs.reducedMotion).toBe(false);
      expect(prefs.colorblindFriendly).toBe(true);
      expect(envelope.recommendedViewDistanceMeters).toBe(1.35);
      expect(envelope.verticalViewingConeDegrees).toBe(25);
    });

    it('adjusts studio eye height when switching from seated to standing posture', () => {
      const a11y = new AccessibilityManager();

      a11y.updatePreferences({ postureMode: 'standing' });
      expect(a11y.getPreferences().postureMode).toBe('standing');
      expect(a11y.getPreferences().studioEyeHeight).toBe(DEFAULT_COMFORT_ENVELOPE.standingEyeHeightMeters);

      a11y.updatePreferences({ postureMode: 'seated' });
      expect(a11y.getPreferences().postureMode).toBe('seated');
      expect(a11y.getPreferences().studioEyeHeight).toBe(DEFAULT_COMFORT_ENVELOPE.seatedEyeHeightMeters);
    });

    it('formats non-color status labels for colorblind accessibility', () => {
      const a11y = new AccessibilityManager({ colorblindFriendly: true });

      expect(a11y.formatStatusLabel('valid', 'Valid Plan')).toBe('[✓] Valid Plan');
      expect(a11y.formatStatusLabel('at_risk', 'At Risk')).toBe('[!] At Risk');
      expect(a11y.formatStatusLabel('infeasible', 'Infeasible')).toBe('[✕] Infeasible');
      expect(a11y.formatStatusLabel('custom', 'Custom')).toBe('[•] Custom');
    });

    it('respects reduced motion preference for vestibular comfort', () => {
      const a11y = new AccessibilityManager({ reducedMotion: false });
      expect(a11y.shouldAnimate()).toBe(true);

      a11y.updatePreferences({ reducedMotion: true });
      expect(a11y.shouldAnimate()).toBe(false);
    });
  });

  describe('Accurate Capability & Hardware Tier Detection', () => {
    it('honestly detects Desktop XR Emulation and never claims it is physical hardware', () => {
      const detector = new XrCapabilityDetector();
      const result = detector.detectHardwareTier(true);

      expect(result.tier).toBe('emulated');
      expect(result.label).toContain('Desktop XR Emulation');
      expect(result.label).not.toContain('(Physical Hardware)');
    });

    it('correctly detects Meta Quest 3 hardware tier from user agent', () => {
      const detector = new XrCapabilityDetector();

      const origNavigator = globalThis.navigator;
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: { userAgent: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/34.0' },
          configurable: true,
          writable: true,
        });

        const result = detector.detectHardwareTier(false);
        expect(result.tier).toBe('quest-3');
        expect(result.label).toBe('Meta Quest 3 (Physical Hardware)');
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: origNavigator,
          configurable: true,
          writable: true,
        });
      }
    });

    it('falls back to Desktop 2.5D Canvas when no XR headset is detected', () => {
      const detector = new XrCapabilityDetector();

      const origNavigator = globalThis.navigator;
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36' },
          configurable: true,
          writable: true,
        });

        const result = detector.detectHardwareTier(false);
        expect(result.tier).toBe('desktop-fallback');
        expect(result.label).toBe('Desktop 2.5D Fallback Canvas');
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: origNavigator,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});
