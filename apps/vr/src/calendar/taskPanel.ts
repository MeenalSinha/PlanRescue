import * as THREE from 'three';
import type { Task } from '../api/contracts';
import { SPATIAL_PALETTE, SPATIAL_DIMENSIONS } from '../ui/tokens';
import { createTextTexture, SpatialPanel, SpatialUIElement } from '../ui/components';

/**
 * 3D Task Card displaying title, deadline, duration, and priority status.
 */
export class SpatialTaskCard extends SpatialUIElement {
  readonly task: Task;

  constructor(task: Task, width = 0.58, height = 0.09) {
    super(`TaskCard_${task.id}`);
    this.task = task;

    const priorityColor =
      task.priority === 'critical'
        ? SPATIAL_PALETTE.priorityCritical
        : task.priority === 'high'
          ? SPATIAL_PALETTE.priorityHigh
          : task.priority === 'medium'
            ? SPATIAL_PALETTE.priorityMedium
            : SPATIAL_PALETTE.priorityLow;

    // Card background
    const bodyGeo = new THREE.BoxGeometry(width, height, 0.01);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.1,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(bodyMesh);

    // Left priority indicator stripe
    const stripeW = 0.006;
    const stripeGeo = new THREE.PlaneGeometry(stripeW, height * 0.85);
    const stripeMesh = new THREE.Mesh(
      stripeGeo,
      new THREE.MeshBasicMaterial({ color: priorityColor }),
    );
    stripeMesh.position.set(-width / 2 + stripeW / 2 + 0.002, 0, 0.006);
    this.group.add(stripeMesh);

    // Title label
    const { texture: titleTex, aspect: titleAspect } = createTextTexture(task.title, {
      fontSize: 18,
      fontWeight: '600',
      color: SPATIAL_PALETTE.textPrimary,
      width: 384,
      height: 48,
      textAlign: 'left',
      padding: 6,
    });
    const labelW = width * 0.7;
    const labelH = labelW / titleAspect;
    const titleMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(labelW, labelH),
      new THREE.MeshBasicMaterial({ map: titleTex, transparent: true }),
    );
    titleMesh.position.set(-width / 2 + labelW / 2 + 0.02, 0.015, 0.006);
    this.group.add(titleMesh);

    // Subtitle (duration + deadline + status)
    const deadlineShort = task.deadline.includes('T') ? task.deadline.split('T')[1]?.substring(0, 5) : task.deadline;
    const subText = `${task.estimatedDurationMinutes}m | Due: ${deadlineShort} | [${task.status}]`;
    const { texture: subTex, aspect: subAspect } = createTextTexture(subText, {
      fontSize: 14,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 384,
      height: 40,
      textAlign: 'left',
      padding: 6,
    });
    const subW = width * 0.7;
    const subH = subW / subAspect;
    const subMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(subW, subH),
      new THREE.MeshBasicMaterial({ map: subTex, transparent: true }),
    );
    subMesh.position.set(-width / 2 + subW / 2 + 0.02, -0.018, 0.006);
    this.group.add(subMesh);
  }
}

/**
 * Task Intelligence Panel displaying outstanding tasks and capacity alerts.
 */
export class SpatialTaskPanel extends SpatialPanel {
  private readonly cards: SpatialTaskCard[] = [];

  constructor(width = 0.65, height = 0.75) {
    super('Tasks & Deadlines', width, height, {
      accentColor: SPATIAL_PALETTE.accentIndigo,
    });
  }

  setTasks(tasks: Task[]): void {
    this.clearTasks();

    const startY = 0.22;
    const gap = 0.11;
    const maxTasks = 5; // Display up to 5 highest priority tasks in comfortable view

    const displayTasks = tasks.slice(0, maxTasks);
    displayTasks.forEach((task, index) => {
      const card = new SpatialTaskCard(task, 0.58, 0.09);
      card.setPosition(0, startY - index * gap, 0.015);
      this.group.add(card.group);
      this.cards.push(card);
    });

    if (tasks.length === 0) {
      const { texture, aspect } = createTextTexture('No outstanding tasks for today', {
        fontSize: 18,
        color: SPATIAL_PALETTE.textMuted,
        width: 384,
        height: 64,
      });
      const emptyMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5 / aspect),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
      );
      emptyMesh.position.set(0, 0, 0.015);
      emptyMesh.name = 'empty_tasks_notice';
      this.group.add(emptyMesh);
    }
  }

  clearTasks(): void {
    for (const card of this.cards) {
      this.group.remove(card.group);
      card.dispose();
    }
    this.cards.length = 0;

    const notice = this.group.getObjectByName('empty_tasks_notice');
    if (notice) {
      this.group.remove(notice);
    }
  }

  override dispose(): void {
    this.clearTasks();
    super.dispose();
  }
}
