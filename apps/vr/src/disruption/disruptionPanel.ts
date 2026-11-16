import * as THREE from 'three';
import type { Disruption, ScheduleEvent } from '../api/contracts';
import { SPATIAL_PALETTE, SPATIAL_DIMENSIONS } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialButton, SpatialUIElement } from '../ui/components';
import { logger } from '../logging/logger';

export interface DisruptionSubmitCallback {
  (disruption: Disruption): void;
}

/**
 * Spatial Disruption Reporting Panel:
 * Lets users select an overrun duration (1–240 min) for a selected calendar meeting
 * and submit for real-time conflict analysis.
 */
export class SpatialDisruptionPanel extends SpatialPanel {
  private selectedEvent: ScheduleEvent | null = null;
  private overrunMinutes = 30; // default 30 min preset
  private readonly summaryGroup: THREE.Group;
  private readonly presetButtons: SpatialButton[] = [];
  private onSubmit?: DisruptionSubmitCallback;
  private onCancel?: () => void;

  constructor(width = 0.65, height = 0.75) {
    super('Report Disruption', width, height, {
      accentColor: SPATIAL_PALETTE.priorityHigh,
    });

    this.summaryGroup = new THREE.Group();
    this.summaryGroup.position.set(0, 0.1, 0.015);
    this.group.add(this.summaryGroup);

    this.buildControls();
    this.updateSummary();
  }

  setTargetEvent(event: ScheduleEvent | null): void {
    this.selectedEvent = event;
    this.updateSummary();
  }

  getTargetEvent(): ScheduleEvent | null {
    return this.selectedEvent;
  }

  setOverrunMinutes(minutes: number): void {
    // Authoritative backend validation: 1 to 240 minutes
    const clamped = Math.max(1, Math.min(240, Math.round(minutes)));
    this.overrunMinutes = clamped;
    this.updateSummary();
  }

  getOverrunMinutes(): number {
    return this.overrunMinutes;
  }

  private buildControls(): void {
    // Preset buttons: +15m, +30m, +45m, +60m
    const presets = [15, 30, 45, 60];
    const startX = -0.21;
    const gapX = 0.14;
    const posY = -0.12;

    presets.forEach((mins, i) => {
      const btn = new SpatialButton(`+${mins}m`, 0.12, 0.045, {
        accentColor: SPATIAL_PALETTE.primary,
      });
      btn.setPosition(startX + i * gapX, posY, 0.02);
      btn.onClick(() => {
        this.setOverrunMinutes(mins);
      });
      this.group.add(btn.group);
      this.presetButtons.push(btn);
    });

    // Action button: "Analyze Impact"
    const submitBtn = new SpatialButton('Analyze Impact', 0.28, 0.055, {
      accentColor: SPATIAL_PALETTE.priorityHigh,
    });
    submitBtn.setPosition(0, -0.23, 0.02);
    submitBtn.onClick(() => {
      if (this.selectedEvent) {
        const disruption: Disruption = {
          type: 'event_overrun',
          eventId: this.selectedEvent.id,
          overrunMinutes: this.overrunMinutes,
        };
        logger.info(
          `Submitting disruption: ${disruption.eventId} +${disruption.overrunMinutes}m`,
          'DisruptionPanel',
        );
        this.onSubmit?.(disruption);
      }
    });
    this.group.add(submitBtn.group);
  }

  private updateSummary(): void {
    // Clear previous summary
    while (this.summaryGroup.children.length > 0) {
      const child = this.summaryGroup.children[0];
      if (child) {
        this.summaryGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) (child.material as THREE.Material).dispose();
        }
      }
    }

    if (!this.selectedEvent) {
      const { texture, aspect } = createTextTexture(
        'Select a meeting from the schedule to report an overrun',
        {
          fontSize: 16,
          color: SPATIAL_PALETTE.textSecondary,
          width: 512,
          height: 64,
        },
      );
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.55 / aspect),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
      );
      mesh.position.set(0, 0.05, 0);
      this.summaryGroup.add(mesh);
      return;
    }

    // Meeting details card
    const titleText = `Selected: ${this.selectedEvent.title}`;
    const { texture: tTex, aspect: tAspect } = createTextTexture(titleText, {
      fontSize: 18,
      fontWeight: '700',
      color: SPATIAL_PALETTE.textPrimary,
      width: 512,
      height: 48,
      textAlign: 'left',
      padding: 8,
    });
    const tMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55 / tAspect),
      new THREE.MeshBasicMaterial({ map: tTex, transparent: true }),
    );
    tMesh.position.set(0, 0.08, 0);
    this.summaryGroup.add(tMesh);

    // Overrun detail text
    const projectedEnd = this.computeProjectedEndTime(this.selectedEvent.endTime, this.overrunMinutes);
    const detailText = `Original: ${this.formatTime(this.selectedEvent.startTime)} - ${this.formatTime(this.selectedEvent.endTime)} (${this.selectedEvent.durationMinutes}m)\nProjected: End at ${projectedEnd} (+${this.overrunMinutes}m overrun)`;
    const { texture: dTex, aspect: dAspect } = createTextTexture(detailText, {
      fontSize: 15,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textCyan,
      width: 512,
      height: 64,
      textAlign: 'left',
      padding: 8,
    });
    const dMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55 / dAspect),
      new THREE.MeshBasicMaterial({ map: dTex, transparent: true }),
    );
    dMesh.position.set(0, -0.01, 0);
    this.summaryGroup.add(dMesh);
  }

  private computeProjectedEndTime(originalEndIso: string, overrunMins: number): string {
    try {
      const d = new Date(originalEndIso);
      if (!isNaN(d.getTime())) {
        const projected = new Date(d.getTime() + overrunMins * 60000);
        return `${projected.getHours().toString().padStart(2, '0')}:${projected.getMinutes().toString().padStart(2, '0')}`;
      }
    } catch {
      // Fallback
    }
    return `+${overrunMins}m`;
  }

  private formatTime(iso: string): string {
    try {
      const parts = iso.split('T');
      if (parts[1]) return parts[1].substring(0, 5);
    } catch {
      // Fallback
    }
    return iso;
  }

  onSubmitDisruption(cb: DisruptionSubmitCallback): this {
    this.onSubmit = cb;
    return this;
  }

  onCancelDisruption(cb: () => void): this {
    this.onCancel = cb;
    return this;
  }

  override dispose(): void {
    for (const btn of this.presetButtons) {
      btn.dispose();
    }
    this.presetButtons.length = 0;
    super.dispose();
  }
}
