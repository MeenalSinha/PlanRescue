import * as THREE from 'three';
import { HandInteractionManager } from './handInteractionManager';

/**
 * Bridges desktop mouse events to the HandInteractionManager for development and automated testing.
 */
export class DesktopInteractionFallback {
  private readonly interactionManager: HandInteractionManager;
  private readonly camera: THREE.Camera;
  private readonly domElement: HTMLElement;
  private isMouseDown = false;
  private isEnabled = true;

  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;

  constructor(
    interactionManager: HandInteractionManager,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ) {
    this.interactionManager = interactionManager;
    this.camera = camera;
    this.domElement = domElement;

    this.onMouseMoveBound = this.handleMouseMove.bind(this);
    this.onMouseDownBound = this.handleMouseDown.bind(this);
    this.onMouseUpBound = this.handleMouseUp.bind(this);

    this.attachListeners();
  }

  private attachListeners(): void {
    this.domElement.addEventListener('mousemove', this.onMouseMoveBound);
    this.domElement.addEventListener('mousedown', this.onMouseDownBound);
    this.domElement.addEventListener('mouseup', this.onMouseUpBound);
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Translates client coordinates into a 3D ray from the camera.
   */
  simulatePointerMove(normalizedX: number, normalizedY: number): void {
    if (!this.isEnabled) return;

    const rayOrigin = this.camera.position.clone();
    const target = new THREE.Vector3(normalizedX, normalizedY, 0.5);
    target.unproject(this.camera);
    const direction = target.sub(rayOrigin).normalize();

    this.interactionManager.processPointerRay(rayOrigin, direction);
  }

  simulateClick(): boolean {
    if (!this.isEnabled) return false;
    return this.interactionManager.triggerSelect();
  }

  simulateGrab(): boolean {
    if (!this.isEnabled) return false;
    return this.interactionManager.startGrab();
  }

  simulateRelease(): boolean {
    if (!this.isEnabled) return false;
    return this.interactionManager.releaseGrab();
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.simulatePointerMove(x, y);
  }

  private handleMouseDown(_e: MouseEvent): void {
    this.isMouseDown = true;
    const grabbed = this.simulateGrab();
    if (!grabbed) {
      this.simulateClick();
    }
  }

  private handleMouseUp(_e: MouseEvent): void {
    this.isMouseDown = false;
    this.simulateRelease();
  }

  dispose(): void {
    this.domElement.removeEventListener('mousemove', this.onMouseMoveBound);
    this.domElement.removeEventListener('mousedown', this.onMouseDownBound);
    this.domElement.removeEventListener('mouseup', this.onMouseUpBound);
  }
}
