import type {
  ApiResponse,
  ApplyPlanResponse,
  ApprovePlanResponse,
  ConflictAnalysis,
  DashboardData,
  Disruption,
  RecoveryPlanSet,
} from './contracts';
import {
  dashboardDataSchema,
  conflictAnalysisSchema,
  recoveryPlanSetSchema,
  approvePlanResponseSchema,
  applyPlanResponseSchema,
} from './contracts';
import {
  ApiClientError,
  ApiNetworkError,
  ApiTimeoutError,
  ApiValidationError,
} from './errors';
import { logger } from '../logging/logger';

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  params?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  isIdempotent?: boolean;
}

export class PlanRescueApiClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetch: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultTimeoutMs = options.timeoutMs ?? 15000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch : (null as unknown as typeof fetch));
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Executes an HTTP request with timeout, abort support, and safe retry for idempotent calls.
   */
  async request<T>(options: RequestOptions): Promise<{ data: T; activity?: unknown[] }> {
    const {
      method = 'GET',
      path,
      body,
      params,
      signal: callerSignal,
      timeoutMs = this.defaultTimeoutMs,
      isIdempotent = method === 'GET',
    } = options;

    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') {
          url.searchParams.set(k, v);
        }
      }
    }

    const maxAttempts = isIdempotent ? this.maxRetries + 1 : 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const abortController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      // Link external caller signal to our controller
      const onCallerAbort = () => abortController.abort();
      if (callerSignal) {
        if (callerSignal.aborted) {
          throw new ApiClientError({
            message: 'Request was aborted before execution',
            status: 0,
            code: 'aborted',
            url: url.pathname,
            userMessage: 'Request was cancelled.',
            recoverable: false,
          });
        }
        callerSignal.addEventListener('abort', onCallerAbort);
      }

      // Configure timeout
      timeoutId = setTimeout(() => {
        abortController.abort(new Error('TIMEOUT'));
      }, timeoutMs);

      const requestStartTime = performance.now();
      logger.debug('ApiClient', `HTTP ${method} ${url.pathname} (Attempt ${attempt}/${maxAttempts})`);

      try {
        const response = await this.fetch(url.toString(), {
          method,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: abortController.signal,
        });

        const elapsedMs = Math.round(performance.now() - requestStartTime);
        logger.debug('ApiClient', `HTTP ${method} ${url.pathname} -> ${response.status} (${elapsedMs}ms)`);

        let responseJson: ApiResponse<T>;
        try {
          responseJson = (await response.json()) as ApiResponse<T>;
        } catch (jsonErr) {
          throw new ApiClientError({
            message: `Server returned non-JSON response (status ${response.status})`,
            status: response.status,
            code: 'invalid_json',
            url: url.pathname,
            userMessage: 'Server returned an unreadable response format.',
            originalError: jsonErr,
          });
        }

        if (!response.ok || !responseJson.ok) {
          const errPayload = responseJson.error ?? {
            code: `http_${response.status}`,
            message: response.statusText || 'Server error',
          };

          throw new ApiClientError({
            message: errPayload.message,
            status: response.status,
            code: errPayload.code,
            url: url.pathname,
            fieldErrors: errPayload.fields,
            userMessage: errPayload.message,
          });
        }

        return {
          data: responseJson.data as T,
          activity: responseJson.activity,
        };
      } catch (err) {
        if (abortController.signal.aborted) {
          if (abortController.signal.reason instanceof Error && abortController.signal.reason.message === 'TIMEOUT') {
            lastError = new ApiTimeoutError(timeoutMs, url.pathname);
          } else {
            lastError = new ApiClientError({
              message: 'Request was cancelled',
              status: 0,
              code: 'aborted',
              url: url.pathname,
              userMessage: 'The request was cancelled.',
              recoverable: false,
            });
            throw lastError; // Do not retry aborted requests
          }
        } else if (err instanceof ApiClientError) {
          lastError = err;
          // Only retry 502/503/504 for idempotent requests
          if (!isIdempotent || (err.status < 500 && err.status !== 429)) {
            throw err;
          }
        } else {
          lastError = new ApiNetworkError(
            err instanceof Error ? err.message : String(err),
            url.pathname,
            err,
          );
          if (!isIdempotent) {
            throw lastError;
          }
        }

        if (attempt < maxAttempts) {
          const backoffMs = Math.min(attempt * 300, 1500);
          logger.warn('ApiClient', `Retrying ${method} ${url.pathname} in ${backoffMs}ms: ${lastError.message}`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  /**
   * GET /api/dashboard?date=YYYY-MM-DD
   */
  async getDashboard(date?: string, signal?: AbortSignal): Promise<DashboardData> {
    const params: Record<string, string> = {};
    if (date) params.date = date;

    const result = await this.request<DashboardData>({
      method: 'GET',
      path: '/api/dashboard',
      params,
      signal,
      isIdempotent: true,
    });

    const parsed = dashboardDataSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Dashboard payload validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }

  /**
   * POST /api/recovery/analyze
   */
  async analyzeDisruption(
    payload: {
      startTime: string;
      endTime: string;
      disruption: Disruption;
    },
    signal?: AbortSignal,
  ): Promise<ConflictAnalysis> {
    const result = await this.request<ConflictAnalysis>({
      method: 'POST',
      path: '/api/recovery/analyze',
      body: payload,
      signal,
      isIdempotent: false,
    });

    const parsed = conflictAnalysisSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Conflict analysis payload validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }

  /**
   * POST /api/recovery/plans
   */
  async proposePlans(
    payload: {
      startTime: string;
      endTime: string;
      disruption: Disruption;
      protectedEventIds?: string[];
    },
    signal?: AbortSignal,
  ): Promise<RecoveryPlanSet> {
    const result = await this.request<RecoveryPlanSet>({
      method: 'POST',
      path: '/api/recovery/plans',
      body: payload,
      signal,
      isIdempotent: false,
    });

    const parsed = recoveryPlanSetSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Recovery plans payload validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }

  /**
   * POST /api/recovery/plans/[planId]/approve
   */
  async approvePlan(planId: string, signal?: AbortSignal): Promise<ApprovePlanResponse> {
    const result = await this.request<ApprovePlanResponse>({
      method: 'POST',
      path: `/api/recovery/plans/${encodeURIComponent(planId)}/approve`,
      signal,
      isIdempotent: false,
    });

    const parsed = approvePlanResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Approve plan response validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }

  /**
   * POST /api/recovery/plans/[planId]/apply
   */
  async applyPlan(planId: string, signal?: AbortSignal): Promise<ApplyPlanResponse> {
    const result = await this.request<ApplyPlanResponse>({
      method: 'POST',
      path: `/api/recovery/plans/${encodeURIComponent(planId)}/apply`,
      signal,
      isIdempotent: false,
    });

    const parsed = applyPlanResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Apply plan response validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }
}
