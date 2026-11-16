import type {
  ActionHistoryItem,
  ApplyApprovedPlanOutput,
  ApproveRecoveryPlanOutput,
  ConflictAnalysis,
  DashboardData,
  Disruption,
  GetActionHistoryOutput,
  RecoveryPlan,
  RecoveryPlanSet,
  ValidationResult,
} from './contracts';
import {
  actionHistoryItemSchema,
  applyApprovedPlanOutputSchema,
  approveRecoveryPlanOutputSchema,
  conflictAnalysisSchema,
  dashboardDataSchema,
  getActionHistoryOutputSchema,
  planSetSchema,
  validationResultSchema,
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

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new ApiTimeoutError(timeoutMs, url.pathname));
        }, timeoutMs);
      });

      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
        };
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }

        const fetchPromise = this.fetch(url.toString(), {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: abortController.signal,
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);

        let jsonPayload: unknown = null;
        try {
          jsonPayload = await response.json();
        } catch {
          jsonPayload = null;
        }

        if (!response.ok) {
          const errObj = (jsonPayload as { error?: { code?: string; message?: string } })?.error;
          const status = response.status;
          const isServerBusy = status === 503 || status === 429;
          const recoverable = isIdempotent && isServerBusy;

          const clientError = new ApiClientError({
            message: errObj?.message ?? `HTTP error ${status}`,
            status,
            code: errObj?.code ?? `http_${status}`,
            url: url.pathname,
            userMessage:
              status === 503
                ? 'Backend service temporarily unavailable. Please retry.'
                : status === 404
                  ? 'Requested resource not found.'
                  : 'An error occurred while communicating with the server.',
            recoverable,
          });

          if (recoverable && attempt < maxAttempts) {
            const delayMs = attempt * 300;
            logger.warn(`Retrying ${method} ${url.pathname} in ${delayMs}ms: ${clientError.message}`, 'ApiClient');
            await new Promise((r) => setTimeout(r, delayMs));
            lastError = clientError;
            continue;
          }

          throw clientError;
        }

        // Handle standard Next.js ApiResponse envelope: { ok: true, data: T, activity: [...] }
        if (
          jsonPayload !== null &&
          typeof jsonPayload === 'object' &&
          'ok' in jsonPayload
        ) {
          const env = jsonPayload as { ok: boolean; data?: T; error?: { code: string; message: string }; activity?: unknown[] };
          if (!env.ok) {
            throw new ApiClientError({
              message: env.error?.message ?? 'API returned operational failure',
              status: response.status,
              code: env.error?.code ?? 'api_failure',
              url: url.pathname,
              userMessage: env.error?.message ?? 'Action could not be completed.',
              recoverable: false,
            });
          }
          return { data: env.data as T, activity: env.activity };
        }

        return { data: jsonPayload as T };
      } catch (err: unknown) {
        if (timeoutId) clearTimeout(timeoutId);

        if (err instanceof ApiTimeoutError || err instanceof ApiClientError) {
          if (err.recoverable && attempt < maxAttempts) {
            lastError = err;
            continue;
          }
          throw err;
        }

        const isNetworkErr = err instanceof TypeError || (err as Error)?.name === 'NetworkError';
        const networkError = new ApiNetworkError(
          err instanceof Error ? err.message : String(err),
          url.pathname,
          err,
        );

        if (isNetworkErr && isIdempotent && attempt < maxAttempts) {
          const delayMs = attempt * 300;
          logger.warn(`Network error on ${method} ${url.pathname}. Retrying in ${delayMs}ms`, 'ApiClient');
          await new Promise((r) => setTimeout(r, delayMs));
          lastError = networkError;
          continue;
        }

        throw networkError;
      } finally {
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
      protectedEventIds?: string[];
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
   * POST /api/recovery/propose
   * Proposes recovery candidates using deterministic Recovery Engine and persists candidates when saveCandidates is true.
   */
  async proposePlans(
    payload: {
      startTime: string;
      endTime: string;
      disruption: Disruption;
      protectedEventIds?: string[];
      saveCandidates?: boolean;
      preferences?: { optimizeFor?: string };
    },
    signal?: AbortSignal,
  ): Promise<RecoveryPlanSet> {
    const result = await this.request<RecoveryPlanSet>({
      method: 'POST',
      path: '/api/recovery/propose',
      body: payload,
      signal,
      isIdempotent: false,
    });

    const parsed = planSetSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Recovery plans payload validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }

  /**
   * POST /api/recovery/validate
   * Submits a recovery plan to independent validator.
   */
  async validatePlan(
    plan: RecoveryPlan,
    signal?: AbortSignal,
  ): Promise<ValidationResult> {
    const result = await this.request<ValidationResult>({
      method: 'POST',
      path: '/api/recovery/validate',
      body: plan,
      signal,
      isIdempotent: true,
    });

    const parsed = validationResultSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Validation result payload validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }

  /**
   * POST /api/recovery/plans/[planId]/approve
   */
  async approvePlan(
    planId: string,
    actor?: string,
    signal?: AbortSignal,
  ): Promise<ApproveRecoveryPlanOutput> {
    const result = await this.request<ApproveRecoveryPlanOutput>({
      method: 'POST',
      path: `/api/recovery/plans/${encodeURIComponent(planId)}/approve`,
      body: actor ? { actor } : undefined,
      signal,
      isIdempotent: false,
    });

    const parsed = approveRecoveryPlanOutputSchema.safeParse(result.data);
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
  async applyPlan(
    planId: string,
    options?: { actor?: string; expectedSnapshotHash?: string },
    signal?: AbortSignal,
  ): Promise<ApplyApprovedPlanOutput> {
    const result = await this.request<ApplyApprovedPlanOutput>({
      method: 'POST',
      path: `/api/recovery/plans/${encodeURIComponent(planId)}/apply`,
      body: options,
      signal,
      isIdempotent: false,
    });

    const parsed = applyApprovedPlanOutputSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Apply plan response validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }

  /**
   * GET /api/actions/history
   */
  async getActionHistory(signal?: AbortSignal): Promise<GetActionHistoryOutput> {
    const result = await this.request<GetActionHistoryOutput>({
      method: 'GET',
      path: '/api/actions/history',
      signal,
      isIdempotent: true,
    });

    const parsed = getActionHistoryOutputSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ApiValidationError(
        'Action history payload validation failed',
        parsed.error.issues.map((i) => i.message),
      );
    }
    return parsed.data;
  }
}
