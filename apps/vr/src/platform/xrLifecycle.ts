import { XrSessionError } from '../diagnostics/errorBoundary';
import { logger } from '../logging/logger';
import type { XrCapabilityDetector, XrInputSourceSummary } from './xrCapabilities';

export type XrSessionStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'suspended'
  | 'stopping'
  | 'ended';

export interface XrSessionLifecycleEvents {
  onStatusChange?: (status: XrSessionStatus) => void;
  onInputSourcesChange?: (sources: XrInputSourceSummary[]) => void;
  onError?: (error: Error) => void;
}

export class XrLifecycleManager {
  private status: XrSessionStatus = 'idle';
  private session: XRSession | null = null;
  private readonly detector: XrCapabilityDetector;
  private readonly events: XrSessionLifecycleEvents;
  private inputSourcesChangeHandler: ((e: XRInputSourcesChangeEvent) => void) | null = null;
  private visibilityChangeHandler: ((e: XRSessionEvent) => void) | null = null;
  private endHandler: (() => void) | null = null;

  constructor(detector: XrCapabilityDetector, events: XrSessionLifecycleEvents = {}) {
    this.detector = detector;
    this.events = events;
  }

  getStatus(): XrSessionStatus {
    return this.status;
  }

  getSession(): XRSession | null {
    return this.session;
  }

  private setStatus(status: XrSessionStatus): void {
    if (this.status === status) return;
    this.status = status;
    logger.info('XrLifecycle', `XR session state transition: ${status}`);
    this.events.onStatusChange?.(status);
  }

  /**
   * Requests and begins an immersive WebXR session.
   */
  async startSession(renderer?: { xr: { setSession: (s: XRSession) => Promise<void> } }): Promise<XRSession> {
    if (this.status === 'active' || this.status === 'requesting') {
      logger.warn('XrLifecycle', 'Session request ignored: session is already active or requesting');
      if (this.session) return this.session;
    }

    if (typeof navigator === 'undefined' || !navigator.xr) {
      const err = new XrSessionError('WebXR API is not supported on this platform');
      this.events.onError?.(err);
      throw err;
    }

    this.setStatus('requesting');

    try {
      // Request features: local-floor, hand-tracking
      const sessionInit: XRSessionInit = {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking', 'bounded-floor', 'layers'],
      };

      const session = await navigator.xr.requestSession('immersive-vr', sessionInit);
      this.session = session;

      // Attach to Three.js renderer if provided
      if (renderer && renderer.xr) {
        await renderer.xr.setSession(session);
      }

      this.setupEventListeners(session);
      this.setStatus('active');

      logger.info('XrLifecycle', 'Immersive VR session started successfully');
      return session;
    } catch (error) {
      this.setStatus('idle');
      const sessionError = new XrSessionError(
        `Failed to start XR session: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
      this.events.onError?.(sessionError);
      throw sessionError;
    }
  }

  private setupEventListeners(session: XRSession): void {
    this.inputSourcesChangeHandler = () => {
      const summary = this.detector.summarizeInputSources(session);
      logger.debug('XrLifecycle', `XR input sources changed: ${summary.length} active inputs`);
      this.events.onInputSourcesChange?.(summary);
    };

    this.visibilityChangeHandler = () => {
      logger.info('XrLifecycle', `XR session visibility state changed to ${session.visibilityState}`);
      if (session.visibilityState === 'hidden' || session.visibilityState === 'visible-blurred') {
        this.setStatus('suspended');
      } else if (session.visibilityState === 'visible') {
        this.setStatus('active');
      }
    };

    this.endHandler = () => {
      logger.info('XrLifecycle', 'XR session ended by user or platform');
      this.cleanup();
      this.setStatus('ended');
      // Reset to idle so user can enter again
      setTimeout(() => {
        if (this.status === 'ended') {
          this.setStatus('idle');
        }
      }, 500);
    };

    session.addEventListener('inputsourceschange', this.inputSourcesChangeHandler as EventListener);
    session.addEventListener('visibilitychange', this.visibilityChangeHandler as EventListener);
    session.addEventListener('end', this.endHandler as EventListener);
  }

  /**
   * Safely terminates the active XR session.
   */
  async endSession(): Promise<void> {
    if (!this.session || this.status === 'idle' || this.status === 'ended') {
      return;
    }

    this.setStatus('stopping');

    try {
      await this.session.end();
    } catch (error) {
      logger.warn('XrLifecycle', `Error ending session: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.cleanup();
      this.setStatus('idle');
    }
  }

  private cleanup(): void {
    if (this.session) {
      if (this.inputSourcesChangeHandler) {
        this.session.removeEventListener('inputsourceschange', this.inputSourcesChangeHandler as EventListener);
        this.inputSourcesChangeHandler = null;
      }
      if (this.visibilityChangeHandler) {
        this.session.removeEventListener('visibilitychange', this.visibilityChangeHandler as EventListener);
        this.visibilityChangeHandler = null;
      }
      if (this.endHandler) {
        this.session.removeEventListener('end', this.endHandler as EventListener);
        this.endHandler = null;
      }
      this.session = null;
    }
  }

  dispose(): void {
    void this.endSession();
  }
}
