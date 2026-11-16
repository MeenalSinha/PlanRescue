import { describe, expect, it, vi } from 'vitest';
import { AppLifecycleManager, type AppState } from '../src/app/lifecycle';
import { XrLifecycleManager } from '../src/platform/xrLifecycle';
import { XrCapabilityDetector } from '../src/platform/xrCapabilities';

describe('Application Lifecycle & State Machine', () => {
  it('starts in INITIALIZING state', () => {
    const lifecycle = new AppLifecycleManager();
    expect(lifecycle.getState()).toBe('INITIALIZING');
    expect(lifecycle.isInitialized()).toBe(false);
  });

  it('prevents repeated initialization calls', () => {
    const lifecycle = new AppLifecycleManager();
    lifecycle.markInitializationStarted();
    expect(() => lifecycle.markInitializationStarted()).toThrow(/already/);
  });

  it('emits state transitions to subscribers', () => {
    const lifecycle = new AppLifecycleManager();
    const history: Array<{ next: AppState; old: AppState }> = [];

    const unsubscribe = lifecycle.subscribe((next, old) => {
      history.push({ next, old });
    });

    lifecycle.transitionTo('READY');
    lifecycle.transitionTo('XR_AVAILABLE');
    lifecycle.transitionTo('XR_SESSION_ACTIVE');

    expect(history).toEqual([
      { next: 'READY', old: 'INITIALIZING' },
      { next: 'XR_AVAILABLE', old: 'READY' },
      { next: 'XR_SESSION_ACTIVE', old: 'XR_AVAILABLE' },
    ]);
    expect(lifecycle.isInitialized()).toBe(true);

    unsubscribe();
    lifecycle.transitionTo('XR_SESSION_ENDED');
    expect(history.length).toBe(3); // no new items after unsubscribe
  });

  it('cleans up resources on dispose', () => {
    const lifecycle = new AppLifecycleManager();
    lifecycle.transitionTo('READY');
    lifecycle.dispose();
    expect(lifecycle.getState()).toBe('XR_SESSION_ENDED');
  });

  it('XrLifecycleManager initializes in idle state', () => {
    const detector = new XrCapabilityDetector();
    const xr = new XrLifecycleManager(detector);
    expect(xr.getStatus()).toBe('idle');
    expect(xr.getSession()).toBeNull();
  });
});
