import { VrBaseError } from '../diagnostics/errorBoundary';

export class ApiClientError extends VrBaseError {
  readonly status: number;
  readonly code: string;
  readonly url?: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(options: {
    message: string;
    status: number;
    code: string;
    url?: string;
    fieldErrors?: Record<string, string>;
    userMessage?: string;
    recoverable?: boolean;
    originalError?: unknown;
  }) {
    super({
      message: options.message,
      category: 'api_transport',
      severity: options.status >= 500 ? 'error' : 'warning',
      userMessage: options.userMessage ?? 'Could not communicate with the scheduling service.',
      recoverable: options.recoverable ?? (options.status >= 500 || options.status === 429),
      originalError: options.originalError,
    });
    this.name = 'ApiClientError';
    this.status = options.status;
    this.code = options.code;
    this.url = options.url;
    this.fieldErrors = options.fieldErrors;
  }
}

export class ApiNetworkError extends VrBaseError {
  readonly url?: string;

  constructor(message: string, url?: string, originalError?: unknown) {
    super({
      message: `Network failure connecting to API: ${message}`,
      category: 'api_transport',
      severity: 'error',
      userMessage: 'Unable to connect to the PlanRescue backend. Please check network connectivity.',
      recoverable: true,
      originalError,
    });
    this.name = 'ApiNetworkError';
    this.url = url;
  }
}

export class ApiTimeoutError extends VrBaseError {
  readonly timeoutMs: number;
  readonly url?: string;

  constructor(timeoutMs: number, url?: string) {
    super({
      message: `API request timed out after ${timeoutMs}ms`,
      category: 'api_transport',
      severity: 'warning',
      userMessage: 'The scheduling request took too long to complete. Please try again.',
      recoverable: true,
    });
    this.name = 'ApiTimeoutError';
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

export class ApiValidationError extends VrBaseError {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super({
      message: `API response contract validation failed: ${message}`,
      category: 'api_validation',
      severity: 'error',
      userMessage: 'Received an invalid response format from the server.',
      recoverable: false,
    });
    this.name = 'ApiValidationError';
    this.issues = issues;
  }
}
