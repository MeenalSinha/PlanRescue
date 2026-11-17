import { logger } from '../logging/logger';

export type HardwareTier = 'quest-3' | 'quest-pro' | 'quest-2' | 'generic-xr' | 'emulated' | 'desktop-fallback';

export interface XrCapabilityReport {
  isSecureContext: boolean;
  hasNavigatorXr: boolean;
  isImmersiveVrSupported: boolean;
  hasWebGL2: boolean;
  handTrackingConfigured: boolean;
  handTrackingSupportedByBrowser: boolean;
  currentInputSources: XrInputSourceSummary[];
  isEmulatedEnvironment: boolean;
  hardwareTier: HardwareTier;
  deviceLabel: string;
  canEnterImmersiveVr: boolean;
  reasonsUnsupported: string[];
}

export interface XrInputSourceSummary {
  handedness: XRHandedness;
  targetRayMode: XRTargetRayMode;
  hasHandTracking: boolean;
  profiles: string[];
}

export class XrCapabilityDetector {
  private readonly handTrackingConfigured: boolean;
  private readonly emulationConfigured: boolean;

  constructor(options: { handTrackingConfigured?: boolean; emulationConfigured?: boolean } = {}) {
    this.handTrackingConfigured = options.handTrackingConfigured ?? true;
    this.emulationConfigured = options.emulationConfigured ?? true;
  }

  /**
   * Detects WebGL2 rendering support on an offscreen/temporary canvas.
   */
  checkWebGL2Support(): boolean {
    if (typeof document === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      return gl !== null && gl !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Determines if the current runtime session is running under an XR emulator (e.g., IWER / Meta WebXR Emulator).
   */
  detectEmulation(): boolean {
    if (typeof window === 'undefined') return false;
    // Common signatures of WebXR desktop emulators
    const win = window as unknown as Record<string, unknown>;
    return (
      win.__IWER_ACTIVE__ === true ||
      win.__META_XR_SIMULATOR__ === true ||
      typeof win.__WEBXR_EMULATOR_DEVICE__ !== 'undefined'
    );
  }

  /**
   * Detects the underlying hardware tier and user-facing device label.
   */
  detectHardwareTier(isEmulated: boolean): { tier: HardwareTier; label: string } {
    if (isEmulated) {
      return { tier: 'emulated', label: 'Desktop XR Emulation (IWER / WebXR Simulator)' };
    }

    if (typeof navigator === 'undefined') {
      return { tier: 'desktop-fallback', label: 'Headless / Test Runtime' };
    }

    const ua = navigator.userAgent || '';
    if (/Quest 3/i.test(ua)) {
      return { tier: 'quest-3', label: 'Meta Quest 3 (Physical Hardware)' };
    }
    if (/Quest Pro/i.test(ua)) {
      return { tier: 'quest-pro', label: 'Meta Quest Pro (Physical Hardware)' };
    }
    if (/Quest 2/i.test(ua)) {
      return { tier: 'quest-2', label: 'Meta Quest 2 (Physical Hardware)' };
    }
    if (/OculusBrowser/i.test(ua) || /Quest/i.test(ua)) {
      return { tier: 'generic-xr', label: 'Meta Quest Horizon OS (Physical Hardware)' };
    }

    return { tier: 'desktop-fallback', label: 'Desktop 2.5D Fallback Canvas' };
  }

  /**
   * Performs a comprehensive runtime capabilities check.
   */
  async detectCapabilities(): Promise<XrCapabilityReport> {
    const isSecureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
    const hasNavigatorXr =
      typeof navigator !== 'undefined' && 'xr' in navigator && Boolean(navigator.xr);
    const hasWebGL2 = this.checkWebGL2Support();
    const isEmulated = this.detectEmulation();
    const { tier: hardwareTier, label: deviceLabel } = this.detectHardwareTier(isEmulated);

    const reasons: string[] = [];

    if (!isSecureContext) {
      reasons.push('Context is not secure (HTTPS or localhost is required for WebXR)');
    }
    if (!hasNavigatorXr) {
      reasons.push('WebXR API (navigator.xr) is not available in this browser');
    }
    if (!hasWebGL2) {
      reasons.push('WebGL2 hardware rendering context is not supported or disabled');
    }

    let isImmersiveVrSupported = false;
    let handTrackingSupportedByBrowser = false;

    if (hasNavigatorXr && navigator.xr) {
      try {
        isImmersiveVrSupported = await navigator.xr.isSessionSupported('immersive-vr');
        if (!isImmersiveVrSupported) {
          reasons.push('Headset does not support immersive-vr session mode');
        }
      } catch (err) {
        reasons.push(`Error querying immersive-vr support: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Feature query probe: check if browser knows XRHand
      handTrackingSupportedByBrowser = typeof window !== 'undefined' && 'XRHand' in window;
    }

    const canEnterImmersiveVr =
      isSecureContext && hasNavigatorXr && hasWebGL2 && isImmersiveVrSupported;

    const report: XrCapabilityReport = {
      isSecureContext,
      hasNavigatorXr,
      isImmersiveVrSupported,
      hasWebGL2,
      handTrackingConfigured: this.handTrackingConfigured,
      handTrackingSupportedByBrowser,
      currentInputSources: [],
      isEmulatedEnvironment: isEmulated,
      hardwareTier,
      deviceLabel,
      canEnterImmersiveVr,
      reasonsUnsupported: reasons,
    };

    logger.debug('Capabilities', 'XR Capability detection completed', {
      canEnterImmersiveVr: report.canEnterImmersiveVr,
      isEmulated: report.isEmulatedEnvironment,
      hardwareTier: report.hardwareTier,
      deviceLabel: report.deviceLabel,
      reasons: report.reasonsUnsupported,
    });

    return report;
  }

  /**
   * Summarizes input sources from an active WebXR session.
   */
  summarizeInputSources(session: XRSession | null): XrInputSourceSummary[] {
    if (!session || !session.inputSources) return [];

    const summaries: XrInputSourceSummary[] = [];
    for (let i = 0; i < session.inputSources.length; i++) {
      const source = session.inputSources[i];
      if (!source) continue;

      summaries.push({
        handedness: source.handedness,
        targetRayMode: source.targetRayMode,
        hasHandTracking: Boolean(source.hand),
        profiles: Array.from(source.profiles ?? []),
      });
    }

    return summaries;
  }
}
