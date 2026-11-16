import { SpatialPanel } from '../ui/components';
import { SPATIAL_LAYOUT } from '../ui/tokens';

export type OnboardingStep =
  | 'welcome'
  | 'point'
  | 'pinch'
  | 'grab'
  | 'ready'
  | 'completed';

export interface OnboardingState {
  currentStep: OnboardingStep;
  isComplete: boolean;
  stepDescription: string;
}

const STORAGE_KEY = 'planrescue_spatial_onboarding_completed';

export class SpatialOnboardingTutorial {
  private step: OnboardingStep = 'welcome';
  private panel?: SpatialPanel;

  constructor() {
    this.checkPreviousCompletion();
  }

  private checkPreviousCompletion(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'true') {
          this.step = 'completed';
        }
      } catch {
        // Fallback for sandboxed or private storage environments
      }
    }
  }

  getState(): OnboardingState {
    const descriptions: Record<OnboardingStep, string> = {
      welcome: 'Welcome to PlanRescue Spatial Studio. Reshape your day with your hands.',
      point: 'Point your index finger or controller ray at any calendar block.',
      pinch: 'Pinch thumb and index finger together to select an event.',
      grab: 'Pinch and hold a movable block to preview alternative schedule times.',
      ready: 'Release to place a draft. Report overruns to generate recovery proposals.',
      completed: 'Onboarding completed. You are ready to explore your day.',
    };

    return {
      currentStep: this.step,
      isComplete: this.step === 'completed',
      stepDescription: descriptions[this.step],
    };
  }

  advanceStep(): OnboardingStep {
    switch (this.step) {
      case 'welcome':
        this.step = 'point';
        break;
      case 'point':
        this.step = 'pinch';
        break;
      case 'pinch':
        this.step = 'grab';
        break;
      case 'grab':
        this.step = 'ready';
        break;
      case 'ready':
      case 'completed':
        this.step = 'completed';
        this.persistCompletion();
        break;
    }
    return this.step;
  }

  resetTutorial(): void {
    this.step = 'welcome';
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Safe fallback
      }
    }
  }

  private persistCompletion(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        // Safe fallback
      }
    }
  }
}
