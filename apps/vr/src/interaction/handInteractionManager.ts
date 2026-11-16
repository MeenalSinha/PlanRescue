import * as THREE from 'three';
import { logger } from '../logging/logger';

export type InteractionState =
  | 'idle'
  | 'hovering'
  | 'pointing'
  | 'pinching'
  | 'grabbing'
  | 'released'
  | 'disabled';

export interface InteractableObject {
  id: string;
  mesh: THREE.Object3D;
  isGrabbable?: boolean;
  isSelectable?: boolean;
  onHover?: (isHovered: boolean) => void;
  onSelect?: () => void;
  onGrabStart?: () => void;
  onGrabMove?: (newPosition: THREE.Vector3) => void;
  onGrabEnd?: (finalPosition: THREE.Vector3) => void;
}

export interface HandPinchState {
  isPinching: boolean;
  pinchDistance: number;
  handedness: XRHandedness;
}

/**
 * Manages hand tracking, pointer rays, pinch gestures, and spatial manipulation.
 */
export class HandInteractionManager {
  private readonly camera: THREE.Camera;
  private readonly scene: THREE.Scene;
  private readonly raycaster = new THREE.Raycaster();
  private readonly interactables = new Map<string, InteractableObject>();

  // State
  private hoveredObject: InteractableObject | null = null;
  private grabbedObject: InteractableObject | null = null;
  private grabOffset = new THREE.Vector3();
  private activeHandedness: XRHandedness = 'none';
  private leftHandActive = false;
  private rightHandActive = false;
  private pinchThresholdMeters = 0.035; // 3.5 cm between thumb and index

  // Drag plane for stable seated manipulation
  private readonly dragPlane = new THREE.Plane();
  private readonly planeIntersect = new THREE.Vector3();

  // Ray visualizer line
  private readonly rayLine: THREE.Line;
  private isRayVisible = false;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;

    // Build reusable ray visualizer
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -2),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.6,
    });
    this.rayLine = new THREE.Line(lineGeo, lineMat);
    this.rayLine.name = 'hand_interaction_ray';
    this.rayLine.visible = false;
    this.scene.add(this.rayLine);
  }

  registerInteractable(obj: InteractableObject): void {
    this.interactables.set(obj.id, obj);
  }

  unregisterInteractable(id: string): void {
    if (this.hoveredObject?.id === id) {
      this.hoveredObject.onHover?.(false);
      this.hoveredObject = null;
    }
    if (this.grabbedObject?.id === id) {
      this.grabbedObject = null;
    }
    this.interactables.delete(id);
  }

  getInteractableCount(): number {
    return this.interactables.size;
  }

  /**
   * Updates hand input source availability from WebXR session.
   */
  updateInputSources(session: XRSession | null): void {
    if (!session) {
      this.leftHandActive = false;
      this.rightHandActive = false;
      return;
    }

    let left = false;
    let right = false;
    for (const source of session.inputSources) {
      if (source.handedness === 'left') left = true;
      if (source.handedness === 'right') right = true;
    }
    this.leftHandActive = left;
    this.rightHandActive = right;
  }

  getHandTrackingStatus(): { leftHand: boolean; rightHand: boolean } {
    return {
      leftHand: this.leftHandActive,
      rightHand: this.rightHandActive,
    };
  }

  /**
   * Executes raycasting from a given 3D origin and forward direction.
   */
  processPointerRay(origin: THREE.Vector3, direction: THREE.Vector3): InteractableObject | null {
    this.scene.updateMatrixWorld(true);
    this.raycaster.set(origin, direction.normalize());

    const meshes: THREE.Object3D[] = [];
    const meshToInteractable = new Map<THREE.Object3D, InteractableObject>();

    for (const item of this.interactables.values()) {
      meshes.push(item.mesh);
      meshToInteractable.set(item.mesh, item);
      item.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshes.push(child);
          meshToInteractable.set(child, item);
        }
      });
    }

    const hits = this.raycaster.intersectObjects(meshes, true);
    let matchedItem: InteractableObject | null = null;

    if (hits.length > 0 && hits[0]) {
      const hitObj = hits[0].object;
      matchedItem = meshToInteractable.get(hitObj) ?? null;
    }

    // Handle hover transitions
    if (this.hoveredObject !== matchedItem) {
      if (this.hoveredObject) {
        this.hoveredObject.onHover?.(false);
      }
      this.hoveredObject = matchedItem;
      if (this.hoveredObject) {
        this.hoveredObject.onHover?.(true);
      }
    }

    // Update ray visualizer if grabbing or hovering
    if (this.hoveredObject || this.grabbedObject) {
      this.rayLine.visible = true;
      const positions = this.rayLine.geometry.attributes.position;
      if (positions) {
        positions.setXYZ(0, origin.x, origin.y, origin.z);
        const targetDist = hits[0]?.distance ?? 1.5;
        const targetPos = origin.clone().add(direction.clone().multiplyScalar(targetDist));
        positions.setXYZ(1, targetPos.x, targetPos.y, targetPos.z);
        positions.needsUpdate = true;
      }
    } else {
      this.rayLine.visible = false;
    }

    // If an object is currently grabbed, update its position along the drag plane
    if (this.grabbedObject) {
      this.dragPlane.setFromNormalAndCoplanarPoint(
        this.camera.getWorldDirection(new THREE.Vector3()).negate(),
        this.grabbedObject.mesh.position,
      );
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.planeIntersect)) {
        const newPos = this.planeIntersect.clone().sub(this.grabOffset);
        this.grabbedObject.onGrabMove?.(newPos);
      }
    }

    return matchedItem;
  }

  /**
   * Triggers selection on currently hovered object.
   */
  triggerSelect(): boolean {
    if (this.hoveredObject && this.hoveredObject.isSelectable !== false) {
      this.hoveredObject.onSelect?.();
      return true;
    }
    return false;
  }

  /**
   * Starts grabbing currently hovered object if it is grabbable.
   */
  startGrab(pointerPosition?: THREE.Vector3): boolean {
    if (this.hoveredObject && this.hoveredObject.isGrabbable) {
      this.grabbedObject = this.hoveredObject;
      if (pointerPosition) {
        this.grabOffset.copy(pointerPosition).sub(this.grabbedObject.mesh.position);
      } else {
        this.grabOffset.set(0, 0, 0);
      }
      this.grabbedObject.onGrabStart?.();
      logger.info(`Grab started on ${this.grabbedObject.id}`, 'HandInteraction');
      return true;
    }
    return false;
  }

  /**
   * Releases currently grabbed object.
   */
  releaseGrab(): boolean {
    if (this.grabbedObject) {
      const finalPos = this.grabbedObject.mesh.position.clone();
      this.grabbedObject.onGrabEnd?.(finalPos);
      logger.info(`Grab released on ${this.grabbedObject.id}`, 'HandInteraction');
      this.grabbedObject = null;
      return true;
    }
    return false;
  }

  isCurrentlyGrabbing(): boolean {
    return this.grabbedObject !== null;
  }

  getHoveredObjectId(): string | null {
    return this.hoveredObject?.id ?? null;
  }

  getGrabbedObjectId(): string | null {
    return this.grabbedObject?.id ?? null;
  }

  dispose(): void {
    if (this.hoveredObject) {
      this.hoveredObject.onHover?.(false);
      this.hoveredObject = null;
    }
    this.grabbedObject = null;
    this.interactables.clear();
    this.scene.remove(this.rayLine);
    this.rayLine.geometry.dispose();
    (this.rayLine.material as THREE.Material).dispose();
  }
}
