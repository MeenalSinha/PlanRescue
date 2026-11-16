import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HandInteractionManager } from '../src/interaction/handInteractionManager';
import { DesktopInteractionFallback } from '../src/interaction/desktopInteraction';
import { SpatialOnboardingTutorial } from '../src/interaction/onboarding';

describe('Hand Interaction System (Phase 3)', () => {
  it('registers and unregisters interactables properly', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const manager = new HandInteractionManager(scene, camera);

    const testMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    testMesh.position.set(0, 0, -1);
    scene.add(testMesh);

    manager.registerInteractable({
      id: 'target-1',
      mesh: testMesh,
      isSelectable: true,
      isGrabbable: true,
    });

    expect(manager.getInteractableCount()).toBe(1);

    manager.unregisterInteractable('target-1');
    expect(manager.getInteractableCount()).toBe(0);

    manager.dispose();
  });

  it('detects raycast intersection and triggers hover / select events', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    const manager = new HandInteractionManager(scene, camera);

    const onHover = vi.fn();
    const onSelect = vi.fn();

    const testMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    testMesh.position.set(0, 0, -1);
    scene.add(testMesh);

    manager.registerInteractable({
      id: 'button-1',
      mesh: testMesh,
      isSelectable: true,
      onHover,
      onSelect,
    });

    // Fire ray straight ahead at the target
    const origin = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(0, 0, -1);
    const hit = manager.processPointerRay(origin, direction);

    expect(hit?.id).toBe('button-1');
    expect(onHover).toHaveBeenCalledWith(true);
    expect(manager.getHoveredObjectId()).toBe('button-1');

    // Trigger select
    const selected = manager.triggerSelect();
    expect(selected).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Fire ray away from target (hover off)
    manager.processPointerRay(origin, new THREE.Vector3(1, 0, 0));
    expect(manager.getHoveredObjectId()).toBeNull();
    expect(onHover).toHaveBeenCalledWith(false);

    manager.dispose();
  });

  it('manages grab and release lifecycle on movable elements', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const manager = new HandInteractionManager(scene, camera);

    const onGrabStart = vi.fn();
    const onGrabEnd = vi.fn();

    const testMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    testMesh.position.set(0, 0, -1);
    scene.add(testMesh);

    manager.registerInteractable({
      id: 'movable-card',
      mesh: testMesh,
      isGrabbable: true,
      onGrabStart,
      onGrabEnd,
    });

    // Point at card
    manager.processPointerRay(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

    // Start grab
    const grabbed = manager.startGrab();
    expect(grabbed).toBe(true);
    expect(manager.isCurrentlyGrabbing()).toBe(true);
    expect(manager.getGrabbedObjectId()).toBe('movable-card');
    expect(onGrabStart).toHaveBeenCalledTimes(1);

    // Release grab
    const released = manager.releaseGrab();
    expect(released).toBe(true);
    expect(manager.isCurrentlyGrabbing()).toBe(false);
    expect(onGrabEnd).toHaveBeenCalledTimes(1);

    manager.dispose();
  });

  it('translates desktop mouse events via DesktopInteractionFallback', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    const manager = new HandInteractionManager(scene, camera);

    const domElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLElement;

    const fallback = new DesktopInteractionFallback(manager, camera, domElement);
    expect(domElement.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(domElement.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));

    fallback.dispose();
    expect(domElement.removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    manager.dispose();
  });

  it('advances and resets the SpatialOnboardingTutorial steps', () => {
    const tutorial = new SpatialOnboardingTutorial();
    tutorial.resetTutorial();

    let state = tutorial.getState();
    expect(state.currentStep).toBe('welcome');
    expect(state.isComplete).toBe(false);

    expect(tutorial.advanceStep()).toBe('point');
    expect(tutorial.advanceStep()).toBe('pinch');
    expect(tutorial.advanceStep()).toBe('grab');
    expect(tutorial.advanceStep()).toBe('ready');
    expect(tutorial.advanceStep()).toBe('completed');

    state = tutorial.getState();
    expect(state.isComplete).toBe(true);

    tutorial.resetTutorial();
    expect(tutorial.getState().currentStep).toBe('welcome');
  });

  it('processes optical hand joints from XRFrame to detect pinch distance and triggers pinch selection', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const manager = new HandInteractionManager(scene, camera);

    const onSelect = vi.fn();
    const testMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
    testMesh.position.set(0, 0, -1);
    scene.add(testMesh);

    manager.registerInteractable({
      id: 'target-hand',
      mesh: testMesh,
      isSelectable: true,
      onSelect,
    });

    // Mock Joint spaces
    const thumbJointSpace = {} as XRJointSpace;
    const indexJointSpace = {} as XRJointSpace;
    const targetRaySpace = {} as XRSpace;

    const mockHand = new Map<string, XRJointSpace>([
      ['thumb-tip', thumbJointSpace],
      ['index-finger-tip', indexJointSpace],
    ]);

    const mockInputSource = {
      handedness: 'right' as XRHandedness,
      hand: mockHand as unknown as XRHand,
      targetRaySpace,
    } as XRInputSource;

    const mockSession = {
      inputSources: [mockInputSource],
    } as unknown as XRSession;

    const mockRefSpace = {} as XRReferenceSpace;

    // 1. Frame with open hand (distance = 10cm, no pinch)
    const mockFrameOpen = {
      getJointPose: (joint: XRJointSpace) => {
        if (joint === thumbJointSpace) {
          return { transform: { position: { x: 0, y: 0, z: -0.5 } } };
        }
        if (joint === indexJointSpace) {
          return { transform: { position: { x: 0.1, y: 0, z: -0.5 } } }; // 10 cm apart
        }
        return null;
      },
      getPose: () => ({
        transform: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 }, // points at (0, 0, -1)
        },
      }),
    } as unknown as XRFrame;

    manager.updateFromXRFrame(mockFrameOpen, mockRefSpace, mockSession);
    const pinchStateOpen = manager.getPinchState('right');
    expect(pinchStateOpen.isPinching).toBe(false);
    expect(pinchStateOpen.pinchDistance).toBeCloseTo(0.1, 2);
    expect(onSelect).not.toHaveBeenCalled();

    // 2. Frame with closed pinch (distance = 2cm < 3.5cm threshold)
    const mockFramePinch = {
      getJointPose: (joint: XRJointSpace) => {
        if (joint === thumbJointSpace) {
          return { transform: { position: { x: 0, y: 0, z: -0.5 } } };
        }
        if (joint === indexJointSpace) {
          return { transform: { position: { x: 0.02, y: 0, z: -0.5 } } }; // 2 cm apart
        }
        return null;
      },
      getPose: () => ({
        transform: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      }),
    } as unknown as XRFrame;

    manager.updateFromXRFrame(mockFramePinch, mockRefSpace, mockSession);
    const pinchStateClosed = manager.getPinchState('right');
    expect(pinchStateClosed.isPinching).toBe(true);
    expect(pinchStateClosed.pinchDistance).toBeCloseTo(0.02, 2);
    expect(onSelect).toHaveBeenCalledTimes(1);

    // 3. Loss of tracking handles gracefully
    const mockSessionEmpty = { inputSources: [] } as unknown as XRSession;
    manager.updateFromXRFrame(mockFramePinch, mockRefSpace, mockSessionEmpty);
    expect(manager.getHandTrackingStatus().rightHand).toBe(false);

    manager.dispose();
  });
});
