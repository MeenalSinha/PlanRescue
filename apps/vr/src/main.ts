import { bootstrapApplication } from './app/bootstrap';
import { logger } from './logging/logger';

async function init(): Promise<void> {
  const container = document.getElementById('scene-container') as HTMLDivElement | null;
  const statusEl = document.getElementById('app-status') as HTMLDivElement | null;
  const capXrEl = document.getElementById('cap-xr') as HTMLSpanElement | null;
  const capHandEl = document.getElementById('cap-hand') as HTMLSpanElement | null;
  const capWebglEl = document.getElementById('cap-webgl') as HTMLSpanElement | null;
  const btnEnterVr = document.getElementById('btn-enter-vr') as HTMLButtonElement | null;

  if (!container) {
    logger.error('Main', 'Fatal: #scene-container element not found in DOM');
    return;
  }

  try {
    const app = await bootstrapApplication({ container });

    // Update capability indicators
    if (capXrEl) {
      capXrEl.textContent = app.capabilities.isImmersiveVrSupported
        ? (app.capabilities.isEmulatedEnvironment ? 'Supported (Emulated)' : 'Supported')
        : 'Unsupported (Desktop 3D)';
      capXrEl.style.color = app.capabilities.isImmersiveVrSupported ? '#34d399' : '#f59e0b';
    }

    if (capHandEl) {
      capHandEl.textContent = app.config.xr.enableHandTracking ? 'Enabled' : 'Disabled';
    }

    if (capWebglEl) {
      capWebglEl.textContent = app.capabilities.hasWebGL2 ? 'WebGL2 Ready' : 'Unavailable';
      capWebglEl.style.color = app.capabilities.hasWebGL2 ? '#34d399' : '#ef4444';
    }

    // Update status badge
    const updateStatusPill = (state: string) => {
      if (!statusEl) return;
      statusEl.textContent = state;
      statusEl.className = 'status-pill';
      if (state === 'XR_AVAILABLE' || state === 'XR_SESSION_ACTIVE') {
        statusEl.classList.add('status-xr-available');
      } else if (state === 'READY') {
        statusEl.classList.add('status-ready');
      } else {
        statusEl.classList.add('status-error');
      }
    };

    updateStatusPill(app.state);
    app.lifecycle.subscribe((newState) => {
      updateStatusPill(newState);
      if (btnEnterVr) {
        if (newState === 'XR_SESSION_ACTIVE') {
          btnEnterVr.disabled = false;
          btnEnterVr.textContent = 'Exit VR';
        } else if (newState === 'XR_AVAILABLE') {
          btnEnterVr.disabled = false;
          btnEnterVr.textContent = 'Enter VR';
        } else {
          btnEnterVr.disabled = true;
          btnEnterVr.textContent = 'VR Unavailable';
        }
      }
    });

    // Enter VR button action
    if (btnEnterVr) {
      if (app.capabilities.canEnterImmersiveVr) {
        btnEnterVr.disabled = false;
        btnEnterVr.textContent = 'Enter VR';
      } else {
        btnEnterVr.disabled = true;
        btnEnterVr.textContent = 'VR Unavailable (Desktop)';
      }

      btnEnterVr.addEventListener('click', async () => {
        if (app.xr.getStatus() === 'active') {
          await app.xr.endSession();
        } else {
          try {
            await app.xr.startSession(app.world.renderer ? { xr: app.world.renderer.xr } : undefined);
          } catch (err) {
            logger.error('Main', `Failed to start XR session: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        app.controller?.dispose();
        app.world.dispose();
      });
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = 'STARTUP_ERROR';
      statusEl.className = 'status-pill status-error';
    }
    if (btnEnterVr) {
      btnEnterVr.disabled = true;
      btnEnterVr.textContent = 'Error';
    }
    logger.error('Main', `Initialization error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}
