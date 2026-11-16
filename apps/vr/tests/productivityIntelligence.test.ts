import { describe, expect, it, vi } from 'vitest';
import { PlanRescueApiClient } from '../src/api/client';
import { SpatialProductivityPanel } from '../src/intelligence/spatialProductivityPanel';

describe('Spatial Phase 11: VR Productivity Intelligence', () => {
  it('fetches and validates productivity insights from API client', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ok: true,
        data: {
          date: '2026-10-22',
          metrics: {
            healthScore: 82,
            totalScheduledMinutes: 240,
            totalWorkingMinutes: 540,
            focusTimeMinutes: 180,
            fragmentedMinutes: 30,
            backToBackCount: 1,
            overloadPercentage: 44,
            contextSwitches: 2,
          },
          recommendations: [
            {
              id: 'rec_buffer',
              type: 'buffer_needed',
              severity: 'medium',
              title: 'Back-to-Back Meeting Fatigue',
              description: 'You have 1 consecutive meetings without transition buffers.',
              suggestedAction: 'Use the Buffered Transitions strategy to insert 10m breathers.',
            },
          ],
          summary: 'Healthy Schedule: 82/100. Good balance between meetings and focus time.',
        },
      }),
    });

    const client = new PlanRescueApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const res = await client.getProductivityInsights('2026-10-22');
    expect(res.date).toBe('2026-10-22');
    expect(res.metrics.healthScore).toBe(82);
    expect(res.recommendations.length).toBe(1);
    expect(res.recommendations[0]?.type).toBe('buffer_needed');
  });

  it('renders productivity metrics and recommendations into SpatialProductivityPanel', () => {
    const panel = new SpatialProductivityPanel(0.74, 0.52);

    panel.setInsights({
      date: '2026-10-22',
      metrics: {
        healthScore: 70,
        totalScheduledMinutes: 300,
        totalWorkingMinutes: 540,
        focusTimeMinutes: 120,
        fragmentedMinutes: 45,
        backToBackCount: 2,
        overloadPercentage: 55,
        contextSwitches: 4,
      },
      recommendations: [
        {
          id: 'rec_buffer',
          type: 'buffer_needed',
          severity: 'high',
          title: 'Back-to-Back Meeting Fatigue',
          description: 'You have 2 consecutive meetings without transition buffers.',
          suggestedAction: 'Insert 10m buffers between meetings.',
        },
      ],
      summary: 'Moderate Schedule Strain: 70/100.',
    });

    expect(panel.group.children.length).toBeGreaterThan(0);
    panel.dispose();
  });
});
