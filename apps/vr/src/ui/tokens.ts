/**
 * PlanRescue Spatial - Centralized Spatial Design Tokens
 * 
 * Strict Single Source of Truth for visual design:
 * - Horizon OS Dark Palette & Glassmorphic Spatial Materials
 * - Ergonomic Seated FOV Layout Coordinates (cm & meters)
 * - Priority & Category Semantics
 * - Typography, Corner Radii, Spacing, and Motion
 */

export const SPATIAL_PALETTE = {
  // Environments & Surrounds
  studioVoid: 0x07090e,
  studioFloor: 0x0d111a,
  gridMajor: 0x1e293b,
  gridMinor: 0x0f172a,
  podiumSurface: 0x161f30,
  podiumTrim: 0x00e5ff,

  // Panels & Cards (Glassmorphic dark surfaces)
  panelBackground: 0x0f172a,
  panelBorder: 0x334155,
  panelBorderHover: 0x00e5ff,
  panelHeader: 0x1e293b,

  cardSurface: 0x1e293b,
  cardSurfaceHover: 0x283548,
  cardSurfaceSelected: 0x1e3a5f,
  cardBorder: 0x334155,
  cardBorderHover: 0x38bdf8,
  cardBorderSelected: 0x00e5ff,

  // Semantic Accents
  primary: 0x00e5ff,       // PlanRescue Cyan
  primaryHover: 0x38bdf8,
  accentPurple: 0x8b5cf6,  // Spatial AI Purple
  accentIndigo: 0x6366f1,

  // Priority Tokens (Authority aligned with Recovery Engine)
  priorityCritical: 0xef4444, // Red
  priorityHigh: 0xf97316,     // Orange
  priorityMedium: 0x3b82f6,   // Blue
  priorityLow: 0x10b981,      // Green

  // Status & Consequence Tokens
  statusFeasible: 0x10b981,
  statusAtRisk: 0xf59e0b,
  statusInfeasible: 0xef4444,
  statusWarning: 0xf59e0b,
  statusUnchanged: 0x64748b,
  statusMoved: 0x00e5ff,

  // Text & Labels (Hex strings for canvas/HTML/UIKitML)
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textInverse: '#0f172a',
  textCyan: '#00e5ff',
  textPurple: '#c084fc',
} as const;

export const SPATIAL_LAYOUT = {
  // Seated Ergonomics: origin [0, 0, 0] represents user head at neutral seated eye-line (~1.2m floor offset)
  userEyeHeightMeters: 1.25,
  comfortableReachDistanceMeters: 0.9,
  comfortableViewingDistanceMeters: 1.45,

  // Panel Positions in Space (x, y, z in meters, rotation around Y in degrees)
  zones: {
    // Center forward: Main Schedule & Timeline
    timeline: {
      position: { x: 0, y: 1.25, z: -1.45 },
      rotationY: 0,
      width: 1.2,
      height: 0.8,
    },
    // Left Wing (32 deg rotated inward): Tasks & Capacity Intelligence
    taskPanel: {
      position: { x: -0.95, y: 1.25, z: -1.3 },
      rotationY: 28,
      width: 0.65,
      height: 0.75,
    },
    // Right Wing (-32 deg rotated inward): PlanRescue AI & Recovery Intelligence
    assistantPanel: {
      position: { x: 0.95, y: 1.25, z: -1.3 },
      rotationY: -28,
      width: 0.65,
      height: 0.75,
    },
    // Floating Comparison Podium (active during recovery phase)
    comparisonWorkspace: {
      position: { x: 0, y: 1.15, z: -1.35 },
      rotationY: 0,
      width: 1.3,
      height: 0.85,
    },
    // Upper Status / Environment State Banner
    statusHUD: {
      position: { x: 0, y: 1.82, z: -1.4 },
      rotationY: 0,
      width: 0.9,
      height: 0.16,
    },
    // Lower Action & History Shelf
    actionShelf: {
      position: { x: 0, y: 0.72, z: -1.25 },
      rotationY: -15, // tilted slightly up towards eye
      width: 1.0,
      height: 0.28,
    },
  },
} as const;

export const SPATIAL_DIMENSIONS = {
  eventCardWidth: 0.22,
  eventCardHeight: 0.14,
  eventCardDepth: 0.015,
  cardCornerRadius: 0.012,
  
  timelineTrackLength: 1.1,
  timelineTrackHeight: 0.02,
  timelineTrackDepth: 0.01,

  buttonWidth: 0.16,
  buttonHeight: 0.05,
  buttonDepth: 0.01,

  badgeWidth: 0.06,
  badgeHeight: 0.022,
} as const;

export const SPATIAL_ANIMATION = {
  transitionFastMs: 150,
  transitionNormalMs: 300,
  transitionSlowMs: 600,
  dragSnapThresholdMeters: 0.06,
  eventShiftAnimationDurationMs: 450,
} as const;

export const ENVIRONMENT_LIGHTING = {
  ambientColor: 0x1e293b,
  ambientIntensity: 0.85,
  keyLightColor: 0xffffff,
  keyLightIntensity: 1.2,
  keyLightPosition: { x: 2, y: 4, z: 2 },
  accentCyanColor: 0x00e5ff,
  accentCyanIntensity: 0.6,
  accentCyanPosition: { x: -2, y: 1.5, z: -1 },
  accentPurpleColor: 0x8b5cf6,
  accentPurpleIntensity: 0.5,
  accentPurplePosition: { x: 2, y: 1.5, z: -1 },
} as const;
