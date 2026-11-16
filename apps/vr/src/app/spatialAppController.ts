import * as THREE from 'three';
import type { PlanRescueApiClient } from '../api/client';
import type { DashboardData, ScheduleEvent } from '../api/contracts';
import type { VrConfig } from '../config/schema';
import type { SpatialWorld } from '../core/world';
import { logger } from '../logging/logger';
import { SpatialStudioEnvironment } from '../ui/components';
import { HandInteractionManager } from '../interaction/handInteractionManager';
import { DesktopInteractionFallback } from '../interaction/desktopInteraction';
import { SpatialOnboardingTutorial } from '../interaction/onboarding';
import { SpatialTimeline } from '../calendar/spatialTimeline';
import { SpatialTaskPanel } from '../calendar/taskPanel';
import { SpatialDisruptionPanel } from '../disruption/disruptionPanel';
import { SpatialConflictVisualizer } from '../disruption/conflictVisualizer';
import { SpatialRecoveryManager } from '../recovery/recoveryManager';
import { SpatialAssistantPanel } from '../assistant/spatialAssistant';
import { SpatialComparisonWorkspace } from '../comparison/comparisonWorkspace';
import { SpatialValidationExplorer } from '../comparison/validationExplorer';
import { SpatialApprovalWorkflow } from '../execution/approvalWorkflow';
import { SpatialActionHistoryPanel } from '../history/spatialActionHistory';

export interface SpatialAppControllerOptions {
  world: SpatialWorld;
  api: PlanRescueApiClient;
  config: VrConfig;
}

/**
 * Spatial Application Controller:
 * Coordinates the live 3D productivity studio, instantiating and wiring all Phase 2-8
 * spatial modules into the active Three.js scene, establishing hand interactions, and
 * managing end-to-end reactive data flow with the PlanRescue backend.
 */
export class SpatialAppController {
  readonly world: SpatialWorld;
  readonly api: PlanRescueApiClient;
  readonly config: VrConfig;

  // Environment & Interactions
  readonly studio: SpatialStudioEnvironment;
  readonly interactionManager: HandInteractionManager;
  readonly desktopFallback: DesktopInteractionFallback | null = null;
  readonly onboardingTutorial: SpatialOnboardingTutorial;

  // Center Stage (Timeline & Comparison)
  readonly timeline: SpatialTimeline;
  readonly taskPanel: SpatialTaskPanel;
  readonly comparisonWorkspace: SpatialComparisonWorkspace;

  // Left Wing (Disruption & Conflicts)
  readonly disruptionPanel: SpatialDisruptionPanel;
  readonly conflictVisualizer: SpatialConflictVisualizer;

  // Right Wing (AI Assistant, Validation, Approval, History)
  readonly assistantPanel: SpatialAssistantPanel;
  readonly validationExplorer: SpatialValidationExplorer;
  readonly approvalWorkflow: SpatialApprovalWorkflow;
  readonly actionHistoryPanel: SpatialActionHistoryPanel;
  readonly recoveryManager: SpatialRecoveryManager;

  private unregisterUpdateLoop: (() => void) | null = null;
  private currentDashboardData: DashboardData | null = null;
  private isDisposed = false;

  constructor(options: SpatialAppControllerOptions) {
    this.world = options.world;
    this.api = options.api;
    this.config = options.config;

    // 1. Environment & Interactions
    this.studio = new SpatialStudioEnvironment(this.world.scene);
    this.interactionManager = new HandInteractionManager(this.world.scene, this.world.camera);

    if (this.world.renderer && typeof document !== 'undefined') {
      this.desktopFallback = new DesktopInteractionFallback(
        this.interactionManager,
        this.world.camera,
        this.world.renderer.domElement,
      );
    }

    this.onboardingTutorial = new SpatialOnboardingTutorial();
    this.recoveryManager = new SpatialRecoveryManager(this.api);

    // 2. Center Stage (Timeline, Tasks, Comparison)
    this.timeline = new SpatialTimeline(this.interactionManager, { trackWidth: 1.3 });
    this.timeline.setPosition(0, 1.35, -1.35);
    this.world.scene.add(this.timeline.group);

    this.taskPanel = new SpatialTaskPanel(0.75, 0.45);
    this.taskPanel.setPosition(0, 0.88, -1.35);
    this.world.scene.add(this.taskPanel.group);

    this.comparisonWorkspace = new SpatialComparisonWorkspace(this.interactionManager, 1.35, 0.7);
    this.comparisonWorkspace.setPosition(0, 1.25, -1.35);
    this.comparisonWorkspace.group.visible = false;
    this.world.scene.add(this.comparisonWorkspace.group);

    // 3. Left Wing (Disruption & Conflicts) - angled at -35 deg
    this.disruptionPanel = new SpatialDisruptionPanel();
    this.disruptionPanel.setPosition(-1.15, 1.30, -1.0).setRotationY(35);
    this.world.scene.add(this.disruptionPanel.group);

    this.conflictVisualizer = new SpatialConflictVisualizer(0.7, 0.45);
    this.conflictVisualizer.setPosition(-1.15, 0.85, -1.0).setRotationY(35);
    this.world.scene.add(this.conflictVisualizer.group);

    // 4. Right Wing (Assistant, Validation, Approval, History) - angled at +35 deg
    this.assistantPanel = new SpatialAssistantPanel(0.7, 0.52);
    this.assistantPanel.setPosition(1.15, 1.35, -1.0).setRotationY(-35);
    this.world.scene.add(this.assistantPanel.group);

    this.validationExplorer = new SpatialValidationExplorer(0.7, 0.45);
    this.validationExplorer.setPosition(1.15, 0.85, -1.0).setRotationY(-35);
    this.world.scene.add(this.validationExplorer.group);

    this.approvalWorkflow = new SpatialApprovalWorkflow(this.api, 0.7, 0.52);
    this.approvalWorkflow.setPosition(1.15, 1.35, -1.0).setRotationY(-35);
    this.approvalWorkflow.group.visible = false;
    this.world.scene.add(this.approvalWorkflow.group);

    this.actionHistoryPanel = new SpatialActionHistoryPanel(0.7, 0.45);
    this.actionHistoryPanel.setPosition(1.15, 0.85, -1.0).setRotationY(-35);
    this.world.scene.add(this.actionHistoryPanel.group);

    // 5. Connect Render Loop
    this.setupRenderLoop();

    // 6. Connect Inter-Module Reactive Events
    this.wireEventHandlers();

    logger.info('SpatialAppController', 'All Phase 2-8 spatial modules initialized and mounted');
  }

  private setupRenderLoop(): void {
    this.unregisterUpdateLoop = this.world.onUpdate((_delta, _time, frame) => {
      if (this.isDisposed) return;

      if (frame) {
        const refSpace = this.world.getReferenceSpace();
        const session = this.world.getXRSession();
        if (refSpace && session) {
          this.interactionManager.updateFromXRFrame(frame, refSpace, session);
        }
      }
    });
  }

  private wireEventHandlers(): void {
    // A. Timeline event selection
    this.timeline.onSelectEvent((event: ScheduleEvent) => {
      logger.info('SpatialAppController', `Selected event: ${event.title}`);
      this.disruptionPanel.setTargetEvent(event);
      this.clearScenarioResults();
    });

    // B. Disruption scenario submitted for analysis
    this.disruptionPanel.onSubmitDisruption(async (disruption) => {
      if (!this.currentDashboardData) return;
      logger.info('SpatialAppController', `Analyzing disruption for ${disruption.eventId} (+${disruption.overrunMinutes}m)`);

      try {
        // 1. Conflict analysis
        const conflicts = await this.api.analyzeDisruption({
          startTime: this.currentDashboardData.window.startTime,
          endTime: this.currentDashboardData.window.endTime,
          disruption,
        });
        this.conflictVisualizer.displayAnalysis(conflicts);

        // 2. Propose recovery plans with persistent storage
        const planSet = await this.recoveryManager.generateProposals({
          startTime: this.currentDashboardData.window.startTime,
          endTime: this.currentDashboardData.window.endTime,
          disruption,
        });

        if (planSet.outcome === 'plans_found' && planSet.candidates.length > 0) {
          const topPlan = planSet.candidates[0]!;
          this.assistantPanel.explainProposal(topPlan);
          this.comparisonWorkspace.setCandidates(planSet.candidates, this.currentDashboardData.events);
          this.comparisonWorkspace.group.visible = true;
          this.timeline.group.visible = false; // Hide single track in favor of dual track

          this.validationExplorer.displayValidation(topPlan.validation);
          this.validationExplorer.group.visible = true;
          this.actionHistoryPanel.group.visible = false;

          this.approvalWorkflow.loadPlanForReview(topPlan);
          this.approvalWorkflow.group.visible = true;
          this.assistantPanel.group.visible = false;
        } else if (planSet.outcome === 'infeasible') {
          this.assistantPanel.showInfeasibleExplanation(planSet.infeasibility?.summary ?? 'No feasible schedule exists');
          this.comparisonWorkspace.group.visible = false;
          this.timeline.group.visible = true;
          this.approvalWorkflow.group.visible = false;
          this.assistantPanel.group.visible = true;
        } else {
          this.comparisonWorkspace.group.visible = false;
          this.timeline.group.visible = true;
          this.approvalWorkflow.group.visible = false;
          this.assistantPanel.group.visible = true;
        }
      } catch (err) {
        logger.error('SpatialAppController', `Disruption recovery flow error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // C. Approval and Execution Workflow callbacks
    this.approvalWorkflow.setCallbacks({
      onApprovalComplete: (approved) => {
        logger.info('SpatialAppController', `Plan proposal approved: ${approved.planId}`);
      },
      onExecutionComplete: async (executed) => {
        logger.info('SpatialAppController', `Plan changes executed atomically: ${executed.planId}`);
        // Return to timeline view and refresh data
        this.comparisonWorkspace.group.visible = false;
        this.timeline.group.visible = true;
        this.approvalWorkflow.group.visible = false;
        this.assistantPanel.group.visible = true;
        this.validationExplorer.group.visible = false;
        this.actionHistoryPanel.group.visible = true;

        await this.loadInitialData();
      },
    });

    // D. Comparison Workspace candidate selection
    this.comparisonWorkspace.onSelectStrategy((candidate) => {
      this.recoveryManager.selectCandidate(candidate);
      this.assistantPanel.explainProposal(candidate);
      this.validationExplorer.displayValidation(candidate.validation);
      this.approvalWorkflow.loadPlanForReview(candidate);
    });
  }

  private clearScenarioResults(): void {
    this.conflictVisualizer.clearConflicts();
    this.comparisonWorkspace.group.visible = false;
    this.timeline.group.visible = true;
    this.approvalWorkflow.group.visible = false;
    this.assistantPanel.group.visible = true;
    this.validationExplorer.group.visible = false;
    this.actionHistoryPanel.group.visible = true;
  }

  /**
   * Fetches real schedule, task, and audit data from the backend API.
   */
  async loadInitialData(): Promise<void> {
    try {
      logger.info('SpatialAppController', 'Fetching schedule and tasks from backend API...');
      const dashboard = await this.api.getDashboard();
      this.currentDashboardData = dashboard;

      this.timeline.setEvents(dashboard.events);
      this.taskPanel.setTasks(dashboard.tasks);

      const history = await this.api.getActionHistory();
      this.actionHistoryPanel.setHistoryEntries(history.entries);

      logger.info('SpatialAppController', `Loaded ${dashboard.events.length} events, ${dashboard.tasks.length} tasks, and ${history.entries.length} history records`);
    } catch (err) {
      logger.error('SpatialAppController', `Failed to load initial data from API: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.unregisterUpdateLoop?.();
    this.desktopFallback?.dispose();
    this.interactionManager.dispose();
    this.studio.dispose();
    this.timeline.dispose();
    this.taskPanel.dispose();
    this.comparisonWorkspace.dispose();
    this.disruptionPanel.dispose();
    this.conflictVisualizer.dispose();
    this.assistantPanel.dispose();
    this.validationExplorer.dispose();
    this.approvalWorkflow.dispose();
    this.actionHistoryPanel.dispose();

    logger.info('SpatialAppController', 'All spatial modules disposed cleanly');
  }
}
