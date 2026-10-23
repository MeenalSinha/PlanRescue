import { callMcpTool } from '@/lib/mcpClient';
import { planSetSchema, saveRecoveryPlansOutputSchema } from '@/lib/contract';
import { MAX_BODY_BYTES, proposeRequestSchema } from '@/lib/requests';
import { handleToolRoute, ok, failFrom, readJson, fail } from '@/lib/routeKit';
import { loadServerConfig } from '@/lib/env';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

/** POST /api/recovery/propose -> calls propose_recovery_plan, then automatically persists candidates via save_recovery_plans. */
export async function POST(request: Request) {
  const body = await readJson(request, MAX_BODY_BYTES);
  if ('response' in body) return body.response;

  const parsed = proposeRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return fail('invalid_request', 'Some of the request values are not valid.');
  }

  try {
    const config = loadServerConfig();
    const input = parsed.data;

    // 2. Propose candidates
    const proposeRes = await callMcpTool(
      'propose_recovery_plan',
      {
        startTime: input.startTime,
        endTime: input.endTime,
        disruption: input.disruption,
        ...(input.protectedEventIds && input.protectedEventIds.length > 0 ? { protectedEventIds: input.protectedEventIds } : {}),
        ...(input.preferences?.optimizeFor ? { preferences: { optimizeFor: input.preferences.optimizeFor } } : {}),
      },
      planSetSchema,
      (set) =>
        set.outcome === 'infeasible'
          ? 'No feasible plan'
          : set.outcome === 'no_changes_needed'
            ? 'No changes needed'
            : `${set.candidates.length} candidate${set.candidates.length === 1 ? '' : 's'} returned`,
      config,
    );

    const activities = [proposeRes.activity];
    const planSet = proposeRes.data;

    // 2. Persist candidates via save_recovery_plans ONLY if saveCandidates is explicitly requested
    if (input.saveCandidates && planSet.candidates.length > 0) {
      const requestId = randomUUID();
      const saveRes = await callMcpTool(
        'save_recovery_plans',
        {
          requestId,
          plans: planSet.candidates,
        },
        saveRecoveryPlansOutputSchema,
        (out) => `Saved ${out.plans.length} candidate plan(s)`,
        config,
      );

      activities.push(saveRes.activity);

      // Map persistent recovery plan IDs and savedStatus back to candidates
      const persistentMap = new Map(saveRes.data.plans.map((p) => [p.sourcePlanId, p]));
      for (const candidate of planSet.candidates) {
        const saved = persistentMap.get(candidate.planId);
        if (saved) {
          candidate.persistentId = saved.id;
          candidate.savedStatus = saved.status;
        }
      }
    }

    return ok(planSet, activities);
  } catch (error) {
    return failFrom(error);
  }
}
