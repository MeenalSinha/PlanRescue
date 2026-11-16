import { describe, expect, it } from 'vitest';
import { bootstrapApplication } from '../src/app/bootstrap';

describe('Application Bootstrap Smoke Test', () => {
  it('boots the application cleanly in a test environment', async () => {
    const app = await bootstrapApplication({
      configOverride: {
        appEnv: 'test',
        apiBaseUrl: 'http://127.0.0.1:3000',
        logLevel: 'error', // keep test output clean
      },
      skipRenderer: true, // headless testing
    });

    expect(app.state).toBe('READY');
    expect(app.lifecycle.isInitialized()).toBe(true);
    expect(app.config.appEnv).toBe('test');
    expect(app.config.apiBaseUrl).toBe('http://127.0.0.1:3000');

    // Capabilities checked
    expect(app.capabilities).toBeDefined();
    expect(app.capabilities.canEnterImmersiveVr).toBe(false); // In Node environment

    // World initialized with starter spatial scene
    expect(app.world).toBeDefined();
    expect(app.world.scene.children.length).toBeGreaterThan(0);
    const podium = app.world.scene.getObjectByName('schedule-anchor-podium');
    expect(podium).toBeDefined();

    // API client initialized
    expect(app.api).toBeDefined();
    expect(app.api.getBaseUrl()).toBe('http://127.0.0.1:3000');

    // Clean teardown
    app.world.dispose();
    app.xr.dispose();
    app.lifecycle.dispose();
    expect(app.lifecycle.getState()).toBe('XR_SESSION_ENDED');
  });
});
