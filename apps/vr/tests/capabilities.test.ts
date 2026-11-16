import { beforeEach, describe, expect, it } from 'vitest';
import { XrCapabilityDetector } from '../src/platform/xrCapabilities';

describe('XR Capability Detection', () => {
  let detector: XrCapabilityDetector;

  beforeEach(() => {
    detector = new XrCapabilityDetector({
      handTrackingConfigured: true,
      emulationConfigured: true,
    });
  });

  it('correctly reports when WebXR API is missing in a non-browser environment', async () => {
    const report = await detector.detectCapabilities();
    expect(report.canEnterImmersiveVr).toBe(false);
    expect(report.reasonsUnsupported.length).toBeGreaterThan(0);
    expect(report.reasonsUnsupported.some((r) => r.includes('WebXR API') || r.includes('secure'))).toBe(true);
  });

  it('summarizes XRInputSourceArray with handedness, targetRayMode, and hand presence', () => {
    const mockSession = {
      inputSources: [
        {
          handedness: 'left',
          targetRayMode: 'tracked-pointer',
          hand: {}, // hand tracking present
          profiles: ['oculus-hand', 'generic-hand'],
        },
        {
          handedness: 'right',
          targetRayMode: 'tracked-pointer',
          hand: null, // standard controller
          profiles: ['oculus-touch-v3'],
        },
      ],
    } as unknown as XRSession;

    const summary = detector.summarizeInputSources(mockSession);
    expect(summary.length).toBe(2);

    expect(summary[0]?.handedness).toBe('left');
    expect(summary[0]?.hasHandTracking).toBe(true);
    expect(summary[0]?.profiles).toContain('oculus-hand');

    expect(summary[1]?.handedness).toBe('right');
    expect(summary[1]?.hasHandTracking).toBe(false);
  });

  it('handles null session or empty input sources safely without errors', () => {
    expect(detector.summarizeInputSources(null)).toEqual([]);
    expect(detector.summarizeInputSources({ inputSources: [] } as unknown as XRSession)).toEqual([]);
  });
});
