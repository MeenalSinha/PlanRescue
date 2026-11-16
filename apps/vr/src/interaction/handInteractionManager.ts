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
  private pinchThresholdMeters = 0.035;       // 3.5 cm to start pinch
  private pinchReleaseThresholdMeters = 0.050; // 5.0 cm hysteresis to release pinch

  private readonly handPinchStates = new Map<XRHandedness, boolean>();
  private readonly lastPinchDistances = new Map<XRHandedness, number>();
  private readonly controllerTriggerStates = new Map<XRHandedness, boolean>();
  private readonly controllerGripStates = new Map<XRHandedness, boolean>();

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

  getPinchState(handedness: XRHandedness): HandPinchState {
    return {
      handedness,
      isPinching: this.handPinchStates.get(handedness) ?? false,
      pinchDistance: this.lastPinchDistances.get(handedness) ?? 1.0,
    };
  }

  /**
   * Reads real optical hand joints and/or controller target rays from the active XRFrame.
   */
  updateFromXRFrame(frame: XRFrame, referenceSpace: XRReferenceSpace, session: XRSession): void {
    let leftPresent = false;
    let rightPresent = false;

    for (const source of session.inputSources) {
      const handedness = source.handedness;
      if (handedness === 'left') leftPresent = true;
      if (handedness === 'right') rightPresent = true;

      // 1. Process Optical Hand Tracking (XRHand)
      if (source.hand) {
        this.processOpticalHand(source, frame, referenceSpace);
      } else if (source.targetRaySpace) {
        // 2. Fallback to 6DoF Controller target ray and buttons
        this.processControllerInput(source, frame, referenceSpace);
      }
    }

    // Handle tracking loss
    if (!leftPresent && this.leftHandActive) {
      this.handleHandTrackingLoss('left');
    }
    if (!rightPresent && this.rightHandActive) {
      this.handleHandTrackingLoss('right');
    }

    this.leftHandActive = leftPresent;
    this.rightHandActive = rightPresent;
  }

  private processOpticalHand(source: XRInputSource, frame: XRFrame, referenceSpace: XRReferenceSpace): void {
    const hand = source.hand;
    if (!hand) return;
    const handedness = source.handedness;

    // Get joint spaces (supporting both .get() Map-like and indexed property access)
    const getJoint = (name: string): XRJointSpace | null => {
      if (typeof (hand as unknown as { get: (k: string) => XRJointSpace }).get === 'function') {
        return (hand as unknown as { get: (k: string) => XRJointSpace }).get(name) ?? null;
      }
      return (hand as unknown as Record<string, XRJointSpace>)[name] ?? null;
    };

    const thumbTipJoint = getJoint('thumb-tip');
    const indexTipJoint = getJoint('index-finger-tip');

    if (!thumbTipJoint || !indexTipJoint) return;
    if (typeof frame.getJointPose !== 'function') return;

    const thumbPose = frame.getJointPose(thumbTipJoint, referenceSpace);
    const indexPose = frame.getJointPose(indexTipJoint, referenceSpace);

    if (!thumbPose || !indexPose) {
      // Joint tracking lost on this hand
      return;
    }

    const thumbPos = new THREE.Vector3(
      thumbPose.transform.position.x,
      thumbPose.transform.position.y,
      thumbPose.transform.position.z,
    );
    const indexPos = new THREE.Vector3(
      indexPose.transform.position.x,
      indexPose.transform.position.y,
      indexPose.transform.position.z,
    );

    const pinchDistance = thumbPos.distanceTo(indexPos);
    this.lastPinchDistances.set(handedness, pinchDistance);
    const pinchPoint = thumbPos.clone().lerp(indexPos, 0.5);

    // Optical Hand pointer ray
    if (source.targetRaySpace) {
      const rayPose = frame.getPose(source.targetRaySpace, referenceSpace);
      if (rayPose) {
        const origin = new THREE.Vector3(
          rayPose.transform.position.x,
          rayPose.transform.position.y,
          rayPose.transform.position.z,
        );
        const orientation = new THREE.Quaternion(
          rayPose.transform.orientation.x,
          rayPose.transform.orientation.y,
          rayPose.transform.orientation.z,
          rayPose.transform.orientation.w,
        );
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
        this.processPointerRay(origin, direction);
      }
    }

    // Evaluate pinch gesture with hysteresis
    const wasPinching = this.handPinchStates.get(handedness) ?? false;
    const isPinching = wasPinching
      ? pinchDistance < this.pinchReleaseThresholdMeters
      : pinchDistance < this.pinchThresholdMeters;

    if (isPinching !== wasPinching) {
      this.handPinchStates.set(handedness, isPinching);
      this.activeHandedness = handedness;

      if (isPinching) {
        // Pinch gesture started
        if (this.hoveredObject?.isGrabbable) {
          this.startGrab(pinchPoint);
        } else {
          this.triggerSelect();
        }
      } else {
        // Pinch gesture released
        if (this.isCurrentlyGrabbing()) {
          this.releaseGrab();
        }
      }
    }
  }

  private processControllerInput(source: XRInputSource, frame: XRFrame, referenceSpace: XRReferenceSpace): void {
    if (!source.targetRaySpace) return;
    const rayPose = frame.getPose(source.targetRaySpace, referenceSpace);
    if (!rayPose) return;

    const origin = new THREE.Vector3(
      rayPose.transform.position.x,
      rayPose.transform.position.y,
      rayPose.transform.position.z,
    );
    const orientation = new THREE.Quaternion(
      rayPose.transform.orientation.x,
      rayPose.transform.orientation.y,
      rayPose.transform.orientation.z,
      rayPose.transform.orientation.w,
    );
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
    this.processPointerRay(origin, direction);

    // Controller trigger & grip button interaction
    const triggerPressed = source.gamepad?.buttons[0]?.pressed ?? false;
    const gripPressed = source.gamepad?.buttons[1]?.pressed ?? false;

    const wasTrigger = this.controllerTriggerStates.get(source.handedness) ?? false;
    if (triggerPressed !== wasTrigger) {
      this.controllerTriggerStates.set(source.handedness, triggerPressed);
      if (triggerPressed) {
        this.triggerSelect();
      }
    }

    const wasGrip = this.controllerGripStates.get(source.handedness) ?? false;
    if (gripPressed !== wasGrip) {
      this.controllerGripStates.set(source.handedness, gripPressed);
      if (gripPressed) {
        this.startGrab();
      } else {
        this.releaseGrab();
      }
    }
  }

  private handleHandTrackingLoss(handedness: XRHandedness): void {
    if (this.activeHandedness === handedness && this.isCurrentlyGrabbing()) {
      this.releaseGrab();
    }
    this.handPinchStates.delete(handedness);
    this.lastPinchDistances.delete(handedness);
    if (this.activeHandedness === handedness) {
      this.activeHandedness = 'none';
      if (this.hoveredObject) {
        this.hoveredObject.onHover?.(false);
        this.hoveredObject = null;
      }
      this.rayLine.visible = false;
    }
    logger.warn('HandInteraction', `Tracking lost on ${handedness} hand`);
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
