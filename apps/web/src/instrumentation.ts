/**
 * Next.js Server Startup Instrumentation Hook (Spatial Phase 14)
 *
 * Runs once when the Node.js server starts up. Strictly validates production
 * configuration, secrets entropy, and required service endpoints before traffic arrives.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnvironment } = await import('@/lib/envValidation');
    const result = validateEnvironment();
    if (!result.isValid) {
      const msg = `FATAL: PlanRescue Spatial server startup aborted due to configuration errors:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`;
      if (process.env.NODE_ENV === 'production') {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
    }
    if (result.warnings.length > 0) {
      console.warn(`[PlanRescue] Startup configuration warnings:\n${result.warnings.map((w) => `  - ${w}`).join('\n')}`);
    }
  }
}
