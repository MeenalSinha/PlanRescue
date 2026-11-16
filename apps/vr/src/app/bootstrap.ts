import { loadRuntimeConfig, validateConfig } from '../config/loader';
import { ConfigurationError, type VrConfig } from '../config/schema';
import { PlanRescueApiClient } from '../api/client';
import { SpatialWorld } from '../core/world';
import { handleGlobalError, type NormalizedError } from '../diagnostics/errorBoundary';
import { logger } from '../logging/logger';
import { XrCapabilityDetector, type XrCapabilityReport } from '../platform/xrCapabilities';
import { XrLifecycleManager } from '../platform/xrLifecycle';
import { AppLifecycleManager, type AppState } from './lifecycle';

export interface BootstrapResult {
  config: VrConfig;
  capabilities: XrCapabilityReport;
  world: SpatialWorld;
  xr: XrLifecycleManager;
  api: PlanRescueApiClient;
  lifecycle: AppLifecycleManager;
  state: AppState;
}

export interface BootstrapOptions {
  container?: HTMLElement;
  configOverride?: Partial<VrConfig>;
  skipRenderer?: boolean; // For headless/unit test environments
}

export async function bootstrapApplication(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const lifecycle = new AppLifecycleManager();
  lifecycle.markInitializationStarted();

  logger.info('Bootstrap', 'Starting PlanRescue Spatial application bootstrap sequence');

  let config: VrConfig;
  try {
    if (options.configOverride) {
      config = validateConfig(options.configOverride as Record<string, unknown>);
    } else {
      config = await loadRuntimeConfig();
    }
    logger.setLevel(config.logLevel);
    logger.info('Bootstrap', `Configuration validated successfully for env=${config.appEnv}`);
  } catch (error) {
    lifecycle.transitionTo('CONFIGURATION_ERROR');
    const normalized = handleGlobalError(error, 'BootstrapConfig');
    throw new ConfigurationError(normalized.userMessage);
  }

  // Capability detection
  const detector = new XrCapabilityDetector({
    handTrackingConfigured: config.xr.enableHandTracking,
    emulationConfigured: config.xr.enableEmulation,
  });
  const capabilities = await detector.detectCapabilities();

  // If essential rendering (WebGL2) is completely unsupported, halt gracefully
  if (!capabilities.hasWebGL2 && !options.skipRenderer) {
    lifecycle.transitionTo('UNSUPPORTED_ENVIRONMENT');
    logger.error('Bootstrap', 'WebGL2 is not supported on this device/browser');
  }

  // Initialize Spatial World
  const world = new SpatialWorld();
  if (options.container && !options.skipRenderer && capabilities.hasWebGL2) {
    try {
      world.initializeRenderer(options.container);
    } catch (renderError) {
      lifecycle.transitionTo('ERROR');
      handleGlobalError(renderError, 'BootstrapRenderer');
      throw renderError;
    }
  }

  // Initialize XR Lifecycle Manager
  const xr = new XrLifecycleManager(detector, {
    onStatusChange: (status) => {
      if (status === 'active') {
        lifecycle.transitionTo('XR_SESSION_ACTIVE');
      } else if (status === 'ended') {
        lifecycle.transitionTo(capabilities.canEnterImmersiveVr ? 'XR_AVAILABLE' : 'READY');
      }
    },
    onError: (err) => {
      handleGlobalError(err, 'XrLifecycle');
    },
  });

  // Initialize Typed API Client
  const api = new PlanRescueApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: config.requestTimeoutMs,
  });

  // Final State determination
  const finalState: AppState = capabilities.canEnterImmersiveVr ? 'XR_AVAILABLE' : 'READY';
  lifecycle.transitionTo(finalState);

  logger.info('Bootstrap', `PlanRescue Spatial initialized in ${finalState} state`);

  return {
    config,
    capabilities,
    world,
    xr,
    api,
    lifecycle,
    state: finalState,
  };
}
