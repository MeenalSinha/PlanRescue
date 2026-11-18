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
  private isRightMouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private isEnabled = true;

  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;
  private onContextMenuBound: (e: MouseEvent) => void;

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
    this.onWheelBound = this.handleWheel.bind(this);
    this.onContextMenuBound = (e: MouseEvent) => e.preventDefault();

    this.attachListeners();
  }

  private attachListeners(): void {
    this.domElement.addEventListener('mousemove', this.onMouseMoveBound);
    this.domElement.addEventListener('mousedown', this.onMouseDownBound);
    this.domElement.addEventListener('mouseup', this.onMouseUpBound);
    this.domElement.addEventListener('wheel', this.onWheelBound, { passive: true });
    this.domElement.addEventListener('contextmenu', this.onContextMenuBound);
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
    if (this.isRightMouseDown) {
      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.camera.rotation.y -= deltaX * 0.003;
      this.camera.rotation.x = Math.max(-0.4, Math.min(0.4, this.camera.rotation.x - deltaY * 0.003));
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.simulatePointerMove(x, y);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button === 2) {
      this.isRightMouseDown = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      return;
    }

    this.isMouseDown = true;
    const grabbed = this.simulateGrab();
    if (!grabbed) {
      this.simulateClick();
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button === 2) {
      this.isRightMouseDown = false;
      return;
    }

    this.isMouseDown = false;
    this.simulateRelease();
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.isEnabled) return;
    this.camera.position.z = Math.max(-0.15, Math.min(0.55, this.camera.position.z + e.deltaY * 0.001));
  }

  dispose(): void {
    this.domElement.removeEventListener('mousemove', this.onMouseMoveBound);
    this.domElement.removeEventListener('mousedown', this.onMouseDownBound);
    this.domElement.removeEventListener('mouseup', this.onMouseUpBound);
    this.domElement.removeEventListener('wheel', this.onWheelBound);
    this.domElement.removeEventListener('contextmenu', this.onContextMenuBound);
  }
}
