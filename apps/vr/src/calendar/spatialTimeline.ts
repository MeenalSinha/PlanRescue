import * as THREE from 'three';
import type { ScheduleEvent, Priority } from '../api/contracts';
import { SPATIAL_PALETTE, SPATIAL_DIMENSIONS, SPATIAL_LAYOUT } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialUIElement } from '../ui/components';
import type { HandInteractionManager } from '../interaction/handInteractionManager';
import { logger } from '../logging/logger';

export interface TimelineOptions {
  trackWidth?: number;
  trackHeight?: number;
  dayStartHour?: number; // e.g. 9 for 09:00
  dayEndHour?: number;   // e.g. 19 for 19:00
}

export interface EventCardSelectCallback {
  (event: ScheduleEvent): void;
}

export interface EventDraftMoveCallback {
  (eventId: string, newStartTimeMinutes: number): void;
}

/**
 * 3D Event Card on the Spatial Timeline.
 */
export class SpatialEventBlock extends SpatialUIElement {
  readonly event: ScheduleEvent;
  private readonly baseMesh: THREE.Mesh;
  private readonly borderMesh: THREE.LineSegments;
  private readonly lockIconMesh?: THREE.Mesh;
  private isSelected = false;
  private isHovered = false;

  constructor(
    event: ScheduleEvent,
    width: number,
    height: number,
  ) {
    super(`EventBlock_${event.id}`);
    this.event = event;

    const priorityColor =
      event.priority === 'critical'
        ? SPATIAL_PALETTE.priorityCritical
        : event.priority === 'high'
          ? SPATIAL_PALETTE.priorityHigh
          : event.priority === 'medium'
            ? SPATIAL_PALETTE.priorityMedium
            : SPATIAL_PALETTE.priorityLow;

    // Base body geometry
    const geo = new THREE.BoxGeometry(width, height, SPATIAL_DIMENSIONS.eventCardDepth);
    const mat = new THREE.MeshStandardMaterial({
      color: SPATIAL_PALETTE.cardSurface,
      roughness: 0.35,
      metalness: 0.2,
      transparent: true,
      opacity: 0.94,
    });
    this.baseMesh = new THREE.Mesh(geo, mat);
    this.group.add(this.baseMesh);

    // Border
    const edges = new THREE.EdgesGeometry(geo);
    this.borderMesh = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: event.movable ? SPATIAL_PALETTE.cardBorder : 0x475569,
      }),
    );
    this.group.add(this.borderMesh);

    // Left priority stripe
    const stripeW = 0.008;
    const stripeGeo = new THREE.PlaneGeometry(stripeW, height * 0.9);
    const stripeMesh = new THREE.Mesh(
      stripeGeo,
      new THREE.MeshBasicMaterial({ color: priorityColor }),
    );
    stripeMesh.position.set(-width / 2 + stripeW / 2 + 0.002, 0, SPATIAL_DIMENSIONS.eventCardDepth / 2 + 0.001);
    this.group.add(stripeMesh);

    // Title text
    const { texture, aspect } = createTextTexture(event.title, {
      fontSize: 20,
      fontWeight: '700',
      color: SPATIAL_PALETTE.textPrimary,
      width: 256,
      height: 64,
      textAlign: 'left',
      padding: 6,
    });
    const labelW = Math.min(width * 0.85, 0.22);
    const labelH = labelW / aspect;
    const titleMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(labelW, labelH),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    titleMesh.position.set(0.01, 0.015, SPATIAL_DIMENSIONS.eventCardDepth / 2 + 0.002);
    this.group.add(titleMesh);

    // Time interval format (e.g. 10:00 - 11:30)
    const timeLabel = `${this.formatTime(event.startTime)} (${event.durationMinutes}m)`;
    const { texture: timeTex, aspect: timeAspect } = createTextTexture(timeLabel, {
      fontSize: 15,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 256,
      height: 48,
      textAlign: 'left',
      padding: 6,
    });
    const timeW = Math.min(width * 0.85, 0.2);
    const timeH = timeW / timeAspect;
    const timeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(timeW, timeH),
      new THREE.MeshBasicMaterial({ map: timeTex, transparent: true }),
    );
    timeMesh.position.set(0.01, -0.02, SPATIAL_DIMENSIONS.eventCardDepth / 2 + 0.002);
    this.group.add(timeMesh);

    // Fixed / Immovable badge
    if (!event.movable) {
      const lockGeo = new THREE.PlaneGeometry(0.018, 0.018);
      const { texture: lockTex } = createTextTexture('🔒', { fontSize: 24, width: 64, height: 64 });
      this.lockIconMesh = new THREE.Mesh(
        lockGeo,
        new THREE.MeshBasicMaterial({ map: lockTex, transparent: true }),
      );
      this.lockIconMesh.position.set(width / 2 - 0.02, height / 2 - 0.02, SPATIAL_DIMENSIONS.eventCardDepth / 2 + 0.002);
      this.group.add(this.lockIconMesh);
    }
  }

  private formatTime(iso: string): string {
    try {
      const parts = iso.split('T');
      if (parts[1]) {
        return parts[1].substring(0, 5);
      }
    } catch {
      // Fallback
    }
    return iso;
  }

  setHovered(hovered: boolean): void {
    this.isHovered = hovered;
    this.updateVisualState();
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.updateVisualState();
  }

  private updateVisualState(): void {
    const mat = this.baseMesh.material as THREE.MeshStandardMaterial;
    const borderMat = this.borderMesh.material as THREE.LineBasicMaterial;

    if (this.isSelected) {
      mat.color.setHex(SPATIAL_PALETTE.cardSurfaceSelected);
      borderMat.color.setHex(SPATIAL_PALETTE.cardBorderSelected);
      this.group.position.z = 0.03;
    } else if (this.isHovered) {
      mat.color.setHex(SPATIAL_PALETTE.cardSurfaceHover);
      borderMat.color.setHex(SPATIAL_PALETTE.cardBorderHover);
      this.group.position.z = 0.015;
    } else {
      mat.color.setHex(SPATIAL_PALETTE.cardSurface);
      borderMat.color.setHex(this.event.movable ? SPATIAL_PALETTE.cardBorder : 0x475569);
      this.group.position.z = 0;
    }
  }
}

/**
 * Spatial Daily Timeline:
 * Renders daily schedule along a physical 3D timeline track with time markers,
 * interactive event blocks, and safe draft manipulation.
 */
export class SpatialTimeline extends SpatialUIElement {
  private readonly trackWidth: number;
  private readonly dayStartMinutes: number;
  private readonly dayTotalMinutes: number;
  private readonly eventBlocks = new Map<string, SpatialEventBlock>();
  private readonly interactionManager?: HandInteractionManager;

  private selectedEventId: string | null = null;
  private onEventSelected?: EventCardSelectCallback;
  private onDraftMove?: EventDraftMoveCallback;

  constructor(
    interactionManager?: HandInteractionManager,
    options: TimelineOptions = {},
  ) {
    super('Spatial_Daily_Timeline');
    this.interactionManager = interactionManager;

    this.trackWidth = options.trackWidth ?? 1.1;
    const startHour = options.dayStartHour ?? 8;
    const endHour = options.dayEndHour ?? 20;
    this.dayStartMinutes = startHour * 60;
    this.dayTotalMinutes = (endHour - startHour) * 60;

    this.buildTimelineTrack(startHour, endHour);
  }

  private buildTimelineTrack(startHour: number, endHour: number): void {
    // Background rail track
    const trackGeo = new THREE.BoxGeometry(
      this.trackWidth,
      SPATIAL_DIMENSIONS.timelineTrackHeight,
      SPATIAL_DIMENSIONS.timelineTrackDepth,
    );
    const trackMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.2,
    });
    const trackMesh = new THREE.Mesh(trackGeo, trackMat);
    trackMesh.position.set(0, 0, 0);
    this.group.add(trackMesh);

    // Hour marker ticks & labels
    const totalHours = endHour - startHour;
    for (let i = 0; i <= totalHours; i += 2) {
      const hour = startHour + i;
      const x = (i / totalHours) * this.trackWidth - this.trackWidth / 2;

      // Vertical tick mark
      const tickGeo = new THREE.BoxGeometry(0.003, 0.035, 0.012);
      const tickMesh = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial({ color: 0x475569 }));
      tickMesh.position.set(x, 0, 0.006);
      this.group.add(tickMesh);

      // Hour text label
      const hourStr = `${hour.toString().padStart(2, '0')}:00`;
      const { texture, aspect } = createTextTexture(hourStr, {
        fontSize: 18,
        color: SPATIAL_PALETTE.textMuted,
        width: 128,
        height: 48,
      });
      const lblW = 0.07;
      const lblH = lblW / aspect;
      const lblMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(lblW, lblH),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
      );
      lblMesh.position.set(x, -0.04, 0.01);
      this.group.add(lblMesh);
    }
  }

  setEvents(events: ScheduleEvent[]): void {
    this.clearEvents();

    for (const evt of events) {
      const startMin = this.parseMinutesFromISO(evt.startTime);
      const durationMin = evt.durationMinutes;

      // Calculate width and center position along timeline track
      const blockWidth = Math.max(
        (durationMin / this.dayTotalMinutes) * this.trackWidth - 0.008,
        0.08,
      );
      const blockHeight = 0.12;
      const centerMin = startMin - this.dayStartMinutes + durationMin / 2;
      const posX = (centerMin / this.dayTotalMinutes) * this.trackWidth - this.trackWidth / 2;
      const posY = 0.09; // Position above the rail

      const block = new SpatialEventBlock(evt, blockWidth, blockHeight);
      block.setPosition(posX, posY, 0.01);
      this.group.add(block.group);
      this.eventBlocks.set(evt.id, block);

      // Register with HandInteractionManager
      if (this.interactionManager) {
        this.interactionManager.registerInteractable({
          id: evt.id,
          mesh: block.group,
          isSelectable: true,
          isGrabbable: evt.movable,
          onHover: (hovered) => block.setHovered(hovered),
          onSelect: () => this.handleEventSelected(evt),
          onGrabMove: (newPos) => this.handleDraftDrag(evt.id, newPos),
          onGrabEnd: (finalPos) => this.handleDraftDrop(evt.id, finalPos),
        });
      }
    }
  }

  private parseMinutesFromISO(iso: string): number {
    try {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) {
        return d.getHours() * 60 + d.getMinutes();
      }
      // Fallback parse 'T10:30'
      const timePart = iso.split('T')[1];
      if (timePart) {
        const [h, m] = timePart.split(':');
        return parseInt(h ?? '0', 10) * 60 + parseInt(m ?? '0', 10);
      }
    } catch {
      // Fallback
    }
    return 600; // default 10:00 AM
  }

  private handleEventSelected(event: ScheduleEvent): void {
    this.selectedEventId = event.id;
    for (const [id, block] of this.eventBlocks.entries()) {
      block.setSelected(id === event.id);
    }
    this.onEventSelected?.(event);
    logger.info(`Event selected: ${event.title} (${event.id})`, 'SpatialTimeline');
  }

  private handleDraftDrag(eventId: string, newPosition: THREE.Vector3): void {
    const block = this.eventBlocks.get(eventId);
    if (!block || !block.event.movable) return;

    // Constrain movement strictly to the timeline X axis
    const minX = -this.trackWidth / 2;
    const maxX = this.trackWidth / 2;
    const clampedX = Math.max(minX, Math.min(maxX, newPosition.x));
    block.group.position.x = clampedX;

    // Convert X position back to time minutes
    const normalized = (clampedX + this.trackWidth / 2) / this.trackWidth;
    const currentMin = this.dayStartMinutes + normalized * this.dayTotalMinutes;
    this.onDraftMove?.(eventId, Math.round(currentMin));
  }

  private handleDraftDrop(eventId: string, finalPosition: THREE.Vector3): void {
    const block = this.eventBlocks.get(eventId);
    if (!block || !block.event.movable) return;

    // Snap to 15-minute time increment
    const normalized = (block.group.position.x + this.trackWidth / 2) / this.trackWidth;
    const exactMin = this.dayStartMinutes + normalized * this.dayTotalMinutes;
    const snappedMin = Math.round(exactMin / 15) * 15;

    // Recalculate snapped X
    const snappedNorm = (snappedMin - this.dayStartMinutes) / this.dayTotalMinutes;
    block.group.position.x = snappedNorm * this.trackWidth - this.trackWidth / 2;

    logger.info(`Draft position for ${eventId} snapped to ${snappedMin}m`, 'SpatialTimeline');
  }

  onSelectEvent(cb: EventCardSelectCallback): this {
    this.onEventSelected = cb;
    return this;
  }

  onDraftMoveEvent(cb: EventDraftMoveCallback): this {
    this.onDraftMove = cb;
    return this;
  }

  getSelectedEventId(): string | null {
    return this.selectedEventId;
  }

  clearEvents(): void {
    for (const [id, block] of this.eventBlocks.entries()) {
      this.interactionManager?.unregisterInteractable(id);
      this.group.remove(block.group);
      block.dispose();
    }
    this.eventBlocks.clear();
    this.selectedEventId = null;
  }

  override dispose(): void {
    this.clearEvents();
    super.dispose();
  }
}
