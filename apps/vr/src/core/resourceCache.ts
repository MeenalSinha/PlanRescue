import * as THREE from 'three';

/**
 * Three.js Geometry & Material Resource Cache (Phase 13)
 *
 * Avoids creating redundant geometries and materials across dozens of spatial UI elements,
 * event blocks, buttons, and status chips. Reduces GC churn and keeps WebGL draw state lean.
 */
export class SpatialResourceCache {
  private static instance: SpatialResourceCache | null = null;

  private planeGeometries = new Map<string, THREE.PlaneGeometry>();
  private boxGeometries = new Map<string, THREE.BoxGeometry>();
  private sphereGeometries = new Map<string, THREE.SphereGeometry>();
  private materials = new Map<string, THREE.Material>();

  static getInstance(): SpatialResourceCache {
    if (!this.instance) {
      this.instance = new SpatialResourceCache();
    }
    return this.instance;
  }

  getPlaneGeometry(width: number, height: number): THREE.PlaneGeometry {
    const key = `${width.toFixed(3)}x${height.toFixed(3)}`;
    let geo = this.planeGeometries.get(key);
    if (!geo) {
      geo = new THREE.PlaneGeometry(width, height);
      this.planeGeometries.set(key, geo);
    }
    return geo;
  }

  getBoxGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
    const key = `${width.toFixed(3)}x${height.toFixed(3)}x${depth.toFixed(3)}`;
    let geo = this.boxGeometries.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(width, height, depth);
      this.boxGeometries.set(key, geo);
    }
    return geo;
  }

  getSphereGeometry(radius: number, segments = 16): THREE.SphereGeometry {
    const key = `${radius.toFixed(3)}_${segments}`;
    let geo = this.sphereGeometries.get(key);
    if (!geo) {
      geo = new THREE.SphereGeometry(radius, segments, segments);
      this.sphereGeometries.set(key, geo);
    }
    return geo;
  }

  getStandardMaterial(key: string, options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    let mat = this.materials.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!mat) {
      mat = new THREE.MeshStandardMaterial(options);
      this.materials.set(key, mat);
    }
    return mat;
  }

  getBasicMaterial(key: string, options: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    let mat = this.materials.get(key) as THREE.MeshBasicMaterial | undefined;
    if (!mat) {
      mat = new THREE.MeshBasicMaterial(options);
      this.materials.set(key, mat);
    }
    return mat;
  }

  getStats(): { geometries: number; materials: number } {
    const totalGeos = this.planeGeometries.size + this.boxGeometries.size + this.sphereGeometries.size;
    return {
      geometries: totalGeos,
      materials: this.materials.size,
    };
  }

  disposeAll(): void {
    for (const geo of this.planeGeometries.values()) geo.dispose();
    for (const geo of this.boxGeometries.values()) geo.dispose();
    for (const geo of this.sphereGeometries.values()) geo.dispose();
    for (const mat of this.materials.values()) mat.dispose();

    this.planeGeometries.clear();
    this.boxGeometries.clear();
    this.sphereGeometries.clear();
    this.materials.clear();
  }
}
