import { logger } from '../logging/logger';

export type AppState =
  | 'INITIALIZING'
  | 'CONFIGURATION_ERROR'
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'READY'
  | 'XR_AVAILABLE'
  | 'XR_SESSION_ACTIVE'
  | 'XR_SESSION_ENDED'
  | 'ERROR';

export type AppStateChangeListener = (newState: AppState, oldState: AppState) => void;

export class AppLifecycleManager {
  private currentState: AppState = 'INITIALIZING';
  private readonly listeners: Set<AppStateChangeListener> = new Set();
  private initializationStarted = false;
  private isDisposed = false;

  getState(): AppState {
    return this.currentState;
  }

  isInitialized(): boolean {
    return (
      this.currentState === 'READY' ||
      this.currentState === 'XR_AVAILABLE' ||
      this.currentState === 'XR_SESSION_ACTIVE'
    );
  }

  transitionTo(nextState: AppState): void {
    if (this.isDisposed) return;
    if (this.currentState === nextState) return;

    const oldState = this.currentState;
    this.currentState = nextState;
    logger.info('Lifecycle', `Application transition: ${oldState} -> ${nextState}`);

    for (const listener of this.listeners) {
      try {
        listener(nextState, oldState);
      } catch (err) {
        logger.error('Lifecycle', `State change listener error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  subscribe(listener: AppStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markInitializationStarted(): void {
    if (this.initializationStarted) {
      throw new Error('Application initialization has already been initiated');
    }
    this.initializationStarted = true;
  }

  dispose(): void {
    this.transitionTo('XR_SESSION_ENDED');
    this.isDisposed = true;
    this.listeners.clear();
  }
}
