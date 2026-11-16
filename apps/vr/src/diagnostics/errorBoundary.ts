import { logger } from '../logging/logger';

export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

export type ErrorCategory =
  | 'configuration'
  | 'initialization'
  | 'xr_unsupported'
  | 'xr_session'
  | 'rendering'
  | 'api_transport'
  | 'api_validation'
  | 'runtime_unexpected';

export interface NormalizedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  userMessage: string;
  technicalDetails?: string;
  recoverable: boolean;
  timestamp: string;
}

export class VrBaseError extends Error {
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly userMessage: string;
  readonly recoverable: boolean;
  readonly originalError?: unknown;

  constructor(options: {
    message: string;
    category: ErrorCategory;
    severity?: ErrorSeverity;
    userMessage?: string;
    recoverable?: boolean;
    originalError?: unknown;
  }) {
    super(options.message);
    this.name = 'VrBaseError';
    this.category = options.category;
    this.severity = options.severity ?? 'error';
    this.userMessage = options.userMessage ?? 'An unexpected error occurred.';
    this.recoverable = options.recoverable ?? false;
    this.originalError = options.originalError;
  }
}

export class InitializationError extends VrBaseError {
  constructor(message: string, originalError?: unknown) {
    super({
      message,
      category: 'initialization',
      severity: 'critical',
      userMessage: 'PlanRescue Spatial could not start properly. Please refresh the page.',
      recoverable: false,
      originalError,
    });
    this.name = 'InitializationError';
  }
}

export class XrUnsupportedError extends VrBaseError {
  constructor(reason: string) {
    super({
      message: `WebXR Immersive VR is not supported: ${reason}`,
      category: 'xr_unsupported',
      severity: 'warning',
      userMessage: 'Immersive VR is unavailable on this device. You can explore the 3D studio in desktop mode.',
      recoverable: true,
    });
    this.name = 'XrUnsupportedError';
  }
}

export class XrSessionError extends VrBaseError {
  constructor(message: string, originalError?: unknown) {
    super({
      message,
      category: 'xr_session',
      severity: 'error',
      userMessage: 'Unable to start or maintain the VR session. Please check your headset connection.',
      recoverable: true,
      originalError,
    });
    this.name = 'XrSessionError';
  }
}

export class RenderingError extends VrBaseError {
  constructor(message: string, originalError?: unknown) {
    super({
      message,
      category: 'rendering',
      severity: 'critical',
      userMessage: 'A 3D rendering error occurred. Please check that WebGL2 is enabled in your browser.',
      recoverable: false,
      originalError,
    });
    this.name = 'RenderingError';
  }
}

/**
 * Normalizes any caught error into a safe, structured record without leaking stack traces or internal paths to users.
 */
export function normalizeError(error: unknown): NormalizedError {
  const timestamp = new Date().toISOString();

  if (error instanceof VrBaseError) {
    return {
      category: error.category,
      severity: error.severity,
      userMessage: error.userMessage,
      technicalDetails: error.message,
      recoverable: error.recoverable,
      timestamp,
    };
  }

  if (error instanceof Error) {
    // Sanitize technical messages to avoid leaking filesystem paths
    const sanitizedMsg = error.message.replace(/([A-Z]:\\[^\s]+|\/[^\s]+)/gi, '[path]');
    return {
      category: 'runtime_unexpected',
      severity: 'error',
      userMessage: 'An unexpected application error occurred.',
      technicalDetails: sanitizedMsg,
      recoverable: false,
      timestamp,
    };
  }

  return {
    category: 'runtime_unexpected',
    severity: 'error',
    userMessage: 'An unknown system exception occurred.',
    technicalDetails: String(error),
    recoverable: false,
    timestamp,
  };
}

/**
 * Centralized error handler that logs the error safely and returns the normalized presentation.
 */
export function handleGlobalError(error: unknown, context = 'App'): NormalizedError {
  const normalized = normalizeError(error);
  logger.error(context, `${normalized.userMessage} (${normalized.category})`, {
    technicalDetails: normalized.technicalDetails,
    severity: normalized.severity,
    recoverable: normalized.recoverable,
  });
  return normalized;
}
