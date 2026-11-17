import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SpatialPerformanceProfiler } from '../src/core/performanceProfiler';
import { SpatialResourceCache } from '../src/core/resourceCache';
import { SpatialUIElement } from '../src/ui/components';

describe('Spatial Phase 13: XR Optimization & Performance Profiling', () => {
  describe('SpatialPerformanceProfiler', () => {
    it('calculates frame time and FPS accurately across sample window', () => {
      const profiler = new SpatialPerformanceProfiler();

      // Simulate 60 frames spaced at 11.1ms (90Hz target)
      let time = 1000;
      for (let i = 0; i < 60; i++) {
        profiler.recordFrame(time);
        time += 11.1;
      }

      const snapshot = profiler.getSnapshot();
      expect(snapshot.frameTimeMs).toBeCloseTo(11.1, 0.5);
      expect(snapshot.fps).toBeGreaterThanOrEqual(85);
      expect(snapshot.isWithinBudget72Hz).toBe(true);
      expect(snapshot.isWithinBudget90Hz).toBe(true);
      expect(snapshot.budgetHealth).toBe('optimal');
    });

    it('detects when frame time exceeds 72Hz frame budget (13.88ms)', () => {
      const profiler = new SpatialPerformanceProfiler();

      // Simulate frames at 22ms (~45 FPS, degraded)
      let time = 1000;
      for (let i = 0; i < 30; i++) {
        profiler.recordFrame(time);
        time += 22.0;
      }

      const snapshot = profiler.getSnapshot();
      expect(snapshot.frameTimeMs).toBeCloseTo(22.0, 0.5);
      expect(snapshot.isWithinBudget72Hz).toBe(false);
      expect(snapshot.isWithinBudget90Hz).toBe(false);
      expect(snapshot.budgetHealth).toBe('critical');
    });

    it('samples renderer draw calls and memory info when WebGLRenderer is provided', () => {
      const mockRenderer = {
        info: {
          render: { calls: 42, triangles: 8500 },
          memory: { geometries: 12, textures: 8 },
        },
      } as unknown as THREE.WebGLRenderer;

      const profiler = new SpatialPerformanceProfiler(mockRenderer);
      profiler.recordFrame(1000);
      profiler.recordFrame(1011.1);

      const snapshot = profiler.getSnapshot();
      expect(snapshot.drawCalls).toBe(42);
      expect(snapshot.triangles).toBe(8500);
      expect(snapshot.geometries).toBe(12);
      expect(snapshot.textures).toBe(8);
    });
  });

  describe('SpatialResourceCache', () => {
    it('caches and reuses geometry instances matching dimensions', () => {
      const cache = SpatialResourceCache.getInstance();
      cache.disposeAll();

      const geo1 = cache.getPlaneGeometry(0.8, 0.5);
      const geo2 = cache.getPlaneGeometry(0.8, 0.5);
      const geoDifferent = cache.getPlaneGeometry(1.0, 0.5);

      // Identical dimensions return exact same cached reference
      expect(geo1).toBe(geo2);
      // Different dimensions create new cached geometry
      expect(geo1).not.toBe(geoDifferent);

      const stats = cache.getStats();
      expect(stats.geometries).toBe(2);
    });

    it('caches and reuses shared materials by key', () => {
      const cache = SpatialResourceCache.getInstance();
      cache.disposeAll();

      const mat1 = cache.getStandardMaterial('card_bg', { color: 0x1e293b, roughness: 0.3 });
      const mat2 = cache.getStandardMaterial('card_bg', { color: 0x1e293b, roughness: 0.3 });

      expect(mat1).toBe(mat2);

      const stats = cache.getStats();
      expect(stats.materials).toBe(1);

      cache.disposeAll();
      const statsAfter = cache.getStats();
      expect(statsAfter.materials).toBe(0);
      expect(statsAfter.geometries).toBe(0);
    });
  });

  describe('SpatialUIElement Memory Management & Disposal', () => {
    it('disposes meshes, geometries, materials, and attached textures on dispose()', () => {
      const element = new SpatialUIElement('TestElement');

      const mockTexture = new THREE.Texture();
      let textureDisposed = false;
      mockTexture.dispose = () => {
        textureDisposed = true;
      };

      const geometry = new THREE.PlaneGeometry(1, 1);
      let geometryDisposed = false;
      geometry.dispose = () => {
        geometryDisposed = true;
      };

      const material = new THREE.MeshBasicMaterial({ map: mockTexture });
      let materialDisposed = false;
      material.dispose = () => {
        materialDisposed = true;
      };

      const mesh = new THREE.Mesh(geometry, material);
      element.group.add(mesh);

      expect(element.group.children.length).toBe(1);

      element.dispose();

      expect(geometryDisposed).toBe(true);
      expect(materialDisposed).toBe(true);
      expect(textureDisposed).toBe(true);
      expect(element.group.children.length).toBe(0);
    });
  });
});
