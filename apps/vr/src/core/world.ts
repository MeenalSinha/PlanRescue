import * as THREE from 'three';
import { RenderingError } from '../diagnostics/errorBoundary';
import { logger } from '../logging/logger';
import { SpatialPerformanceProfiler } from './performanceProfiler';

export interface WorldOptions {
  container?: HTMLElement;
  enableShadows?: boolean;
  antialias?: boolean;
}

export class SpatialWorld {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer | null = null;
  profiler: SpatialPerformanceProfiler | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeListener: (() => void) | null = null;
  private isDisposed = false;
  private animationCallbacks: Array<(delta: number, time: number, frame?: XRFrame) => void> = [];
  private lastTime = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100);
    this.camera.position.set(0, 1.25, 0.20); // Seated eye level and panoramic desktop viewing distance

    this.setupBasicEnvironment();
  }

  /**
   * Initializes basic lighting and spatial reference structures.
   */
  private setupBasicEnvironment(): void {
    // Ambient light for general studio visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambientLight);

    // Directional key light
    const keyLight = new THREE.DirectionalLight(0xe0e7ff, 0.85);
    keyLight.position.set(2, 4, 3);
    this.scene.add(keyLight);

    // Brand accent fill lights for spatial depth and studio atmosphere
    const leftFillLight = new THREE.PointLight(0x00e5ff, 0.4, 6);
    leftFillLight.position.set(-2, 1.5, -0.5);
    this.scene.add(leftFillLight);

    const rightFillLight = new THREE.PointLight(0x8b5cf6, 0.4, 6);
    rightFillLight.position.set(2, 1.5, -0.5);
    this.scene.add(rightFillLight);

    // Ground reference grid (10m x 10m)
    const grid = new THREE.GridHelper(10, 20, 0x3b82f6, 0x1e293b);
    grid.position.set(0, 0, 0);
    this.scene.add(grid);

    // Minimal reference anchor: Schedule Horizon Anchor Podium
    const podiumGeometry = new THREE.CylinderGeometry(0.5, 0.6, 0.1, 32);
    const podiumMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.2,
      roughness: 0.8,
    });
    const podium = new THREE.Mesh(podiumGeometry, podiumMaterial);
    podium.position.set(0, 0.05, -1.2);
    podium.name = 'schedule-anchor-podium';
    this.scene.add(podium);

    // Visual horizon indicator ring on podium
    const ringGeometry = new THREE.RingGeometry(0.35, 0.38, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.11, -1.2);
    this.scene.add(ring);
  }

  /**
   * Initializes the Three.js WebGLRenderer with WebXR support.
   */
  initializeRenderer(container: HTMLElement, options: WorldOptions = {}): THREE.WebGLRenderer {
    if (this.isDisposed) {
      throw new RenderingError('Cannot initialize renderer on a disposed world instance');
    }

    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: options.antialias ?? true,
        alpha: false,
        powerPreference: 'high-performance',
      });

      renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
      renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
      renderer.xr.enabled = true;

      container.appendChild(renderer.domElement);
      this.renderer = renderer;
      this.profiler = new SpatialPerformanceProfiler(renderer);

      this.updateCameraAspect(container.clientWidth || 800, container.clientHeight || 600);
      this.setupResizeHandling(container);
      this.startRenderLoop();

      logger.info('SpatialWorld', 'Three.js rendering engine initialized successfully');
      return renderer;
    } catch (error) {
      const renderError = new RenderingError(
        `Failed to initialize WebGL rendering context: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
      logger.error('SpatialWorld', renderError.message);
      throw renderError;
    }
  }

  private updateCameraAspect(width: number, height: number): void {
    if (height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private setupResizeHandling(container: HTMLElement): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0 && this.renderer) {
            this.renderer.setSize(width, height);
            this.updateCameraAspect(width, height);
          }
        }
      });
      this.resizeObserver.observe(container);
    } else if (typeof window !== 'undefined') {
      this.resizeListener = () => {
        if (this.renderer && container) {
          const width = container.clientWidth;
          const height = container.clientHeight;
          this.renderer.setSize(width, height);
          this.updateCameraAspect(width, height);
        }
      };
      window.addEventListener('resize', this.resizeListener);
    }
  }

  private startRenderLoop(): void {
    if (!this.renderer) return;

    this.renderer.setAnimationLoop((time, frame) => {
      if (this.isDisposed || !this.renderer) return;

      this.profiler?.recordFrame(time);

      const delta = this.lastTime > 0 ? (time - this.lastTime) / 1000 : 0.016;
      this.lastTime = time;

      // Execute custom update callbacks
      for (const callback of this.animationCallbacks) {
        try {
          callback(delta, time, frame as XRFrame | undefined);
        } catch (err) {
          logger.error('SpatialWorld', `Animation loop callback error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      this.renderer.render(this.scene, this.camera);
    });
  }

  setPostureEyeHeight(heightMeters: number): void {
    this.camera.position.y = heightMeters;
  }

  onUpdate(callback: (delta: number, time: number, frame?: XRFrame) => void): () => void {
    this.animationCallbacks.push(callback);
    return () => {
      this.animationCallbacks = this.animationCallbacks.filter((cb) => cb !== callback);
    };
  }

  getReferenceSpace(): XRReferenceSpace | null {
    return this.renderer?.xr.getReferenceSpace() ?? null;
  }

  getXRSession(): XRSession | null {
    return this.renderer?.xr.getSession() ?? null;
  }

  dispose(): void {
    this.isDisposed = true;
    this.animationCallbacks = [];

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      if (this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      }
      this.renderer.dispose();
      this.renderer = null;
    }

    // Traverse and dispose geometries and materials
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((mat) => mat.dispose());
        } else if (object.material) {
          object.material.dispose();
        }
      }
    });

    logger.info('SpatialWorld', 'Spatial world resources disposed');
  }
}
