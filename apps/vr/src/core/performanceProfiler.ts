import * as THREE from 'three';
import { logger } from '../logging/logger';

export interface PerformanceSnapshot {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  isWithinBudget72Hz: boolean; // budget 13.88ms
  isWithinBudget90Hz: boolean; // budget 11.11ms
  budgetHealth: 'optimal' | 'warning' | 'critical';
  timestamp: number;
}

export interface PerformanceProfilerConfig {
  sampleWindowSize?: number;
  warnThresholdDrawCalls?: number;
  warnThresholdFrameTimeMs?: number;
}

/**
 * Spatial Performance Profiler (Phase 13)
 *
 * Continuously monitors render performance, memory allocations, draw calls,
 * and frame budgets (72Hz / 90Hz targets for Meta Quest 2 / Quest 3 / Quest Pro).
 */
export class SpatialPerformanceProfiler {
  private readonly renderer?: THREE.WebGLRenderer;
  private readonly sampleWindowSize: number;
  private readonly warnThresholdDrawCalls: number;
  private readonly warnThresholdFrameTimeMs: number;

  private frameTimes: number[] = [];
  private lastTimestamp = 0;
  private currentFps = 60;
  private currentFrameTimeMs = 16.6;
  private totalFramesSampled = 0;

  constructor(renderer?: THREE.WebGLRenderer, config: PerformanceProfilerConfig = {}) {
    this.renderer = renderer;
    this.sampleWindowSize = config.sampleWindowSize ?? 60;
    this.warnThresholdDrawCalls = config.warnThresholdDrawCalls ?? 80;
    this.warnThresholdFrameTimeMs = config.warnThresholdFrameTimeMs ?? 13.88; // 72Hz baseline
  }

  /**
   * Called once per animation loop frame with high-resolution timestamp (ms).
   */
  recordFrame(timestampMs: number): void {
    if (this.lastTimestamp > 0) {
      const deltaMs = timestampMs - this.lastTimestamp;
      if (deltaMs > 0 && deltaMs < 200) {
        // filter out extreme pauses/tab-switches
        this.frameTimes.push(deltaMs);
        if (this.frameTimes.length > this.sampleWindowSize) {
          this.frameTimes.shift();
        }

        const avgDelta = this.frameTimes.reduce((acc, v) => acc + v, 0) / this.frameTimes.length;
        this.currentFrameTimeMs = Math.round(avgDelta * 100) / 100;
        this.currentFps = Math.min(120, Math.round(1000 / avgDelta));
      }
    }

    this.lastTimestamp = timestampMs;
    this.totalFramesSampled++;

    // Periodic health log every 300 frames
    if (this.totalFramesSampled % 300 === 0 && this.totalFramesSampled > 0) {
      const snap = this.getSnapshot();
      if (snap.budgetHealth !== 'optimal') {
        logger.warn('SpatialPerformance', `XR Frame Budget Strain: ${snap.fps} FPS, ${snap.frameTimeMs}ms/frame, ${snap.drawCalls} draw calls`);
      }
    }
  }

  /**
   * Captures current instantaneous rendering metrics snapshot.
   */
  getSnapshot(): PerformanceSnapshot {
    const renderInfo = this.renderer?.info?.render;
    const memoryInfo = this.renderer?.info?.memory;

    const drawCalls = renderInfo?.calls ?? 0;
    const triangles = renderInfo?.triangles ?? 0;
    const geometries = memoryInfo?.geometries ?? 0;
    const textures = memoryInfo?.textures ?? 0;

    const isWithinBudget72Hz = this.currentFrameTimeMs <= 13.88;
    const isWithinBudget90Hz = this.currentFrameTimeMs <= 11.11;

    let budgetHealth: 'optimal' | 'warning' | 'critical' = 'optimal';
    if (!isWithinBudget72Hz || drawCalls > this.warnThresholdDrawCalls * 1.5) {
      budgetHealth = 'critical';
    } else if (!isWithinBudget90Hz || drawCalls > this.warnThresholdDrawCalls) {
      budgetHealth = 'warning';
    }

    return {
      fps: this.currentFps,
      frameTimeMs: this.currentFrameTimeMs,
      drawCalls,
      triangles,
      geometries,
      textures,
      isWithinBudget72Hz,
      isWithinBudget90Hz,
      budgetHealth,
      timestamp: Date.now(),
    };
  }

  reset(): void {
    this.frameTimes = [];
    this.lastTimestamp = 0;
    this.currentFps = 60;
    this.currentFrameTimeMs = 16.6;
    this.totalFramesSampled = 0;
  }
}
