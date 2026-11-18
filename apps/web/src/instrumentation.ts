/**
 * Next.js Server Startup Instrumentation Hook (Spatial Phase 14)
 *
 * Runs when the Node.js server starts up. Strictly validates production
 * configuration, secrets entropy, and required service endpoints before traffic arrives.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // During next build (phase-production-build), CI compilation, and test execution,
    // skip hard-failing on missing runtime deployment secrets.
    // Build artifacts (static bundles, images, CI compiles) do not contain runtime secrets.
    // Secrets are strictly enforced when the production server boots (next start) before accepting traffic.
    const isBuildOrTest =
      process.env.NEXT_PHASE === 'phase-production-build' ||
      process.argv.some((arg) => arg.includes('build') || arg.includes('test')) ||
      process.env.npm_lifecycle_event?.includes('build') ||
      process.env.npm_lifecycle_event?.includes('test') ||
      process.env.NODE_ENV === 'test' ||
      Boolean(process.env.VITEST);

    if (isBuildOrTest) {
      return;
    }

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
