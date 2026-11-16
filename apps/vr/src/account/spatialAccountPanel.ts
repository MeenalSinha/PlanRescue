import * as THREE from 'three';
import type { CalendarProviderItem, User, UserPreferences } from '../api/contracts';
import { SPATIAL_PALETTE } from '../ui/tokens';
import { createTextTexture, SpatialButton, SpatialPanel } from '../ui/components';
import { logger } from '../logging/logger';

export interface AccountPanelCallbacks {
  onStrategyChange?: (strategy: 'minimal_disruption' | 'buffered_transitions' | 'priority_first') => void;
  onSignOut?: () => void;
  onSyncCalendar?: (provider: 'google' | 'outlook' | 'local') => void;
}

/**
 * 3D Spatial Account & Personalization Panel (Phase 9 & 10)
 * Shows the authenticated user profile, timezone, preferred strategy, external calendar status, and comfort controls.
 */
export class SpatialAccountPanel extends SpatialPanel {
  private user: User | null = null;
  private preferences: UserPreferences | null = null;
  private calendarProviders: CalendarProviderItem[] = [];
  private readonly profileGroup: THREE.Group;
  private strategyButton: SpatialButton | null = null;
  private syncButton: SpatialButton | null = null;
  private callbacks: AccountPanelCallbacks = {};

  constructor(width = 0.76, height = 0.72) {
    super('User Account & Preferences', width, height, {
      accentColor: SPATIAL_PALETTE.primary,
    });

    this.profileGroup = new THREE.Group();
    this.profileGroup.position.set(0, 0.12, 0.015);
    this.group.add(this.profileGroup);

    this.buildControls();
  }

  setCallbacks(callbacks: AccountPanelCallbacks): void {
    this.callbacks = callbacks;
  }

  setAccount(user: User, preferences: UserPreferences): void {
    this.user = user;
    this.preferences = preferences;
    this.renderProfile();
    this.updateControls();
  }

  setCalendarProviders(providers: CalendarProviderItem[]): void {
    this.calendarProviders = providers;
    this.renderProfile();
    this.updateControls();
  }

  private renderProfile(): void {
    while (this.profileGroup.children.length > 0) {
      const child = this.profileGroup.children[0];
      if (child) {
        this.profileGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) (child.material as THREE.Material).dispose();
        }
      }
    }

    if (!this.user || !this.preferences) return;

    // Display Name & Email
    const userText = `👤 ${this.user.displayName}\nEmail: ${this.user.email}`;
    const { texture: uTex, aspect: uAspect } = createTextTexture(userText, {
      fontSize: 16,
      fontWeight: '700',
      color: SPATIAL_PALETTE.textPrimary,
      width: 512,
      height: 48,
      textAlign: 'left',
      padding: 6,
    });
    const uMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62 / uAspect),
      new THREE.MeshBasicMaterial({ map: uTex, transparent: true }),
    );
    uMesh.position.set(0, 0.08, 0);
    this.profileGroup.add(uMesh);

    // Timezone & Working Hours
    const tzText = `Timezone: ${this.preferences.timezone}\nWorking Hours: ${this.preferences.workingHoursStart} - ${this.preferences.workingHoursEnd} (${this.preferences.workingDays.length} days/week)`;
    const { texture: tTex, aspect: tAspect } = createTextTexture(tzText, {
      fontSize: 13,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 512,
      height: 44,
      textAlign: 'left',
      padding: 6,
    });
    const tMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62 / tAspect),
      new THREE.MeshBasicMaterial({ map: tTex, transparent: true }),
    );
    tMesh.position.set(0, 0.01, 0);
    this.profileGroup.add(tMesh);

    // Focus & Comfort settings
    const focusCount = this.preferences.focusPeriods.length;
    const comfortText = `Focus Blocks: ${focusCount} protected | Buffer: ${this.preferences.preferredBufferMinutes}m\nSpatial Comfort: ${this.preferences.spatialComfort.viewDistance}m view distance`;
    const { texture: cTex, aspect: cAspect } = createTextTexture(comfortText, {
      fontSize: 13,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textCyan,
      width: 512,
      height: 44,
      textAlign: 'left',
      padding: 6,
    });
    const cMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62 / cAspect),
      new THREE.MeshBasicMaterial({ map: cTex, transparent: true }),
    );
    cMesh.position.set(0, -0.06, 0);
    this.profileGroup.add(cMesh);

    // Connected Calendars (Phase 10)
    const connected = this.calendarProviders.filter((p) => p.connected).map((p) => p.name).join(', ') || 'Local SQLite only';
    const calText = `Calendars: ${connected}`;
    const { texture: calTex, aspect: calAspect } = createTextTexture(calText, {
      fontSize: 12,
      fontWeight: '600',
      color: SPATIAL_PALETTE.primary,
      width: 512,
      height: 36,
      textAlign: 'left',
      padding: 6,
    });
    const calMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62 / calAspect),
      new THREE.MeshBasicMaterial({ map: calTex, transparent: true }),
    );
    calMesh.position.set(0, -0.12, 0);
    this.profileGroup.add(calMesh);
  }

  private buildControls(): void {
    // Strategy Cycle Button
    this.strategyButton = new SpatialButton('Strategy: Minimal Disruption', 0.44, 0.05, {
      accentColor: SPATIAL_PALETTE.primary,
    });
    this.strategyButton.setPosition(0, -0.16, 0.02);
    this.strategyButton.onClick(() => {
      if (!this.preferences) return;
      const strategies: Array<'minimal_disruption' | 'buffered_transitions' | 'priority_first'> = [
        'minimal_disruption',
        'buffered_transitions',
        'priority_first',
      ];
      const nextIdx = (strategies.indexOf(this.preferences.preferredStrategy) + 1) % strategies.length;
      const nextStrategy = strategies[nextIdx]!;
      this.preferences.preferredStrategy = nextStrategy;
      this.updateControls();
      this.callbacks.onStrategyChange?.(nextStrategy);
    });
    this.group.add(this.strategyButton.group);

    // Sync Calendars Button (Phase 10)
    this.syncButton = new SpatialButton('Sync Calendars', 0.26, 0.045, {
      accentColor: SPATIAL_PALETTE.primary,
    });
    this.syncButton.setPosition(-0.14, -0.24, 0.02);
    this.syncButton.onClick(() => {
      logger.info('User requested calendar sync from Spatial Studio', 'SpatialAccountPanel');
      this.callbacks.onSyncCalendar?.('google');
    });
    this.group.add(this.syncButton.group);

    // Sign Out Button
    const signOutBtn = new SpatialButton('Sign Out', 0.20, 0.045, {
      accentColor: SPATIAL_PALETTE.statusWarning,
    });
    signOutBtn.setPosition(0.16, -0.24, 0.02);
    signOutBtn.onClick(() => {
      logger.info('User initiated sign out from Spatial Studio', 'SpatialAccountPanel');
      this.callbacks.onSignOut?.();
    });
    this.group.add(signOutBtn.group);
  }

  private updateControls(): void {
    if (!this.strategyButton || !this.preferences) return;
    const labels: Record<string, string> = {
      minimal_disruption: 'Strategy: Minimal Disruption',
      buffered_transitions: 'Strategy: Buffered Transitions',
      priority_first: 'Strategy: Priority First',
    };
    this.strategyButton.setLabel(labels[this.preferences.preferredStrategy] || 'Strategy');
  }

  override dispose(): void {
    while (this.profileGroup.children.length > 0) {
      const child = this.profileGroup.children[0];
      if (child) {
        this.profileGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) (child.material as THREE.Material).dispose();
        }
      }
    }
    super.dispose();
  }
}
