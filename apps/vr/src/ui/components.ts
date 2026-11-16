import * as THREE from 'three';
import {
  SPATIAL_PALETTE,
  SPATIAL_DIMENSIONS,
  SPATIAL_ANIMATION,
} from './tokens';

/**
 * Creates a high-resolution text texture on an offscreen canvas for crisp spatial typography.
 */
export function createTextTexture(
  text: string,
  options: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string;
    color?: string | number;
    backgroundColor?: string | number;
    width?: number;
    height?: number;
    textAlign?: CanvasTextAlign;
    padding?: number;
  } = {},
): { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; aspect: number } {
  const {
    fontSize = 32,
    fontFamily = 'system-ui, -apple-system, sans-serif',
    fontWeight = '600',
    color = SPATIAL_PALETTE.textPrimary,
    backgroundColor = 'transparent',
    width = 512,
    height = 128,
    textAlign = 'center',
    padding = 16,
  } = options;

  const toColorString = (c: string | number) =>
    typeof c === 'number' ? `#${c.toString(16).padStart(6, '0')}` : c;
  const resolvedColor = toColorString(color);
  const resolvedBg = backgroundColor === 'transparent' ? 'transparent' : toColorString(backgroundColor);

  let canvas: HTMLCanvasElement;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
  } else {
    // Fallback stub for headless test runner
    canvas = {
      width,
      height,
      getContext: () => ({
        clearRect: () => {},
        fillStyle: '',
        fillRect: () => {},
        font: '',
        textAlign: '',
        textBaseline: '',
        fillText: () => {},
        measureText: () => ({ width: 100 }),
      }),
    } as unknown as HTMLCanvasElement;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    if (resolvedBg !== 'transparent') {
      ctx.fillStyle = resolvedBg;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = resolvedColor;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';

    const x = textAlign === 'left' ? padding : textAlign === 'right' ? width - padding : width / 2;
    const y = height / 2;
    ctx.fillText(text, x, y);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  return { texture, canvas, aspect: width / height };
}

/**
 * Base Spatial Entity containing interactive Three.js Group.
 */
export class SpatialUIElement {
  readonly group: THREE.Group;
  protected isDisposed = false;

  constructor(name: string) {
    this.group = new THREE.Group();
    this.group.name = name;
  }

  setPosition(x: number, y: number, z: number): this {
    this.group.position.set(x, y, z);
    return this;
  }

  setRotationY(degrees: number): this {
    this.group.rotation.y = THREE.MathUtils.degToRad(degrees);
    return this;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else if (obj.material) {
          obj.material.dispose();
        }
      }
    });
    this.group.clear();
  }
}

/**
 * Reusable Glassmorphic Spatial Panel with Header and Frame.
 */
export class SpatialPanel extends SpatialUIElement {
  private readonly bgMesh: THREE.Mesh;
  private readonly borderMesh: THREE.LineSegments;
  private readonly titleMesh?: THREE.Mesh;

  constructor(
    title: string,
    width = 1.0,
    height = 0.7,
    options: {
      subtitle?: string;
      accentColor?: number;
      opacity?: number;
    } = {},
  ) {
    super(`Panel_${title.replace(/\s+/g, '_')}`);
    const { accentColor = SPATIAL_PALETTE.primary, opacity = 0.88 } = options;

    // Background plane with glassmorphic metallic roughness
    const bgGeo = new THREE.PlaneGeometry(width, height);
    const bgMat = new THREE.MeshStandardMaterial({
      color: SPATIAL_PALETTE.panelBackground,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    });
    this.bgMesh = new THREE.Mesh(bgGeo, bgMat);
    this.bgMesh.name = 'panel_background';
    this.group.add(this.bgMesh);

    // Glowing border wireframe
    const edges = new THREE.EdgesGeometry(bgGeo);
    const borderMat = new THREE.LineBasicMaterial({
      color: SPATIAL_PALETTE.panelBorder,
      linewidth: 1,
    });
    this.borderMesh = new THREE.LineSegments(edges, borderMat);
    this.borderMesh.position.z = 0.002;
    this.group.add(this.borderMesh);

    // Header trim bar
    const barWidth = width;
    const barHeight = 0.006;
    const barGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const barMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const barMesh = new THREE.Mesh(barGeo, barMat);
    barMesh.position.set(0, height / 2 - barHeight / 2, 0.004);
    this.group.add(barMesh);

    // Title label
    const { texture, aspect } = createTextTexture(title, {
      fontSize: 26,
      color: SPATIAL_PALETTE.textPrimary,
      width: 512,
      height: 64,
      textAlign: 'left',
      padding: 12,
    });
    const titleWidth = Math.min(width * 0.9, 0.6);
    const titleHeight = titleWidth / aspect;
    const titleGeo = new THREE.PlaneGeometry(titleWidth, titleHeight);
    const titleMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
    });
    this.titleMesh = new THREE.Mesh(titleGeo, titleMat);
    this.titleMesh.position.set(-width / 2 + titleWidth / 2 + 0.04, height / 2 - 0.04, 0.005);
    this.group.add(this.titleMesh);
  }

  setHighlighted(highlight: boolean): void {
    const mat = this.borderMesh.material as THREE.LineBasicMaterial;
    mat.color.setHex(highlight ? SPATIAL_PALETTE.panelBorderHover : SPATIAL_PALETTE.panelBorder);
  }
}

/**
 * Interactive Spatial Card (for calendar events, tasks, candidate strategies).
 */
export class SpatialCard extends SpatialUIElement {
  private readonly baseMesh: THREE.Mesh;
  private readonly borderMesh: THREE.LineSegments;
  private isHovered = false;
  private isSelected = false;
  private readonly defaultZ = 0;
  private readonly hoverZ = 0.02;

  readonly dataId: string;

  constructor(
    id: string,
    title: string,
    subtitle: string,
    options: {
      width?: number;
      height?: number;
      priorityColor?: number;
      movable?: boolean;
    } = {},
  ) {
    super(`Card_${id}`);
    this.dataId = id;

    const width = options.width ?? SPATIAL_DIMENSIONS.eventCardWidth;
    const height = options.height ?? SPATIAL_DIMENSIONS.eventCardHeight;
    const priorityColor = options.priorityColor ?? SPATIAL_PALETTE.priorityMedium;

    // Card background body
    const bodyGeo = new THREE.BoxGeometry(width, height, SPATIAL_DIMENSIONS.eventCardDepth);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: SPATIAL_PALETTE.cardSurface,
      roughness: 0.35,
      metalness: 0.15,
      transparent: true,
      opacity: 0.92,
    });
    this.baseMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.baseMesh.name = `card_body_${id}`;
    this.group.add(this.baseMesh);

    // Card border
    const edges = new THREE.EdgesGeometry(bodyGeo);
    const borderMat = new THREE.LineBasicMaterial({
      color: SPATIAL_PALETTE.cardBorder,
    });
    this.borderMesh = new THREE.LineSegments(edges, borderMat);
    this.group.add(this.borderMesh);

    // Priority color stripe on the left edge
    const stripeWidth = 0.008;
    const stripeGeo = new THREE.PlaneGeometry(stripeWidth, height * 0.9);
    const stripeMat = new THREE.MeshBasicMaterial({ color: priorityColor });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.position.set(-width / 2 + stripeWidth / 2 + 0.003, 0, SPATIAL_DIMENSIONS.eventCardDepth / 2 + 0.001);
    this.group.add(stripeMesh);

    // Title label
    const { texture: titleTex, aspect: titleAspect } = createTextTexture(title, {
      fontSize: 22,
      fontWeight: '700',
      color: SPATIAL_PALETTE.textPrimary,
      width: 384,
      height: 64,
      textAlign: 'left',
      padding: 8,
    });
    const labelW = width * 0.8;
    const labelH = labelW / titleAspect;
    const labelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(labelW, labelH),
      new THREE.MeshBasicMaterial({ map: titleTex, transparent: true }),
    );
    labelMesh.position.set(0.01, 0.025, SPATIAL_DIMENSIONS.eventCardDepth / 2 + 0.002);
    this.group.add(labelMesh);

    // Subtitle / time label
    const { texture: subTex, aspect: subAspect } = createTextTexture(subtitle, {
      fontSize: 16,
      fontWeight: '500',
      color: SPATIAL_PALETTE.textSecondary,
      width: 384,
      height: 48,
      textAlign: 'left',
      padding: 8,
    });
    const subW = width * 0.8;
    const subH = subW / subAspect;
    const subMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(subW, subH),
      new THREE.MeshBasicMaterial({ map: subTex, transparent: true }),
    );
    subMesh.position.set(0.01, -0.025, SPATIAL_DIMENSIONS.eventCardDepth / 2 + 0.002);
    this.group.add(subMesh);
  }

  setHovered(hovered: boolean): void {
    if (this.isHovered === hovered) return;
    this.isHovered = hovered;
    this.updateVisualState();
  }

  setSelected(selected: boolean): void {
    if (this.isSelected === selected) return;
    this.isSelected = selected;
    this.updateVisualState();
  }

  private updateVisualState(): void {
    const mat = this.baseMesh.material as THREE.MeshStandardMaterial;
    const borderMat = this.borderMesh.material as THREE.LineBasicMaterial;

    if (this.isSelected) {
      mat.color.setHex(SPATIAL_PALETTE.cardSurfaceSelected);
      borderMat.color.setHex(SPATIAL_PALETTE.cardBorderSelected);
      this.group.position.z = this.hoverZ;
    } else if (this.isHovered) {
      mat.color.setHex(SPATIAL_PALETTE.cardSurfaceHover);
      borderMat.color.setHex(SPATIAL_PALETTE.cardBorderHover);
      this.group.position.z = this.hoverZ;
    } else {
      mat.color.setHex(SPATIAL_PALETTE.cardSurface);
      borderMat.color.setHex(SPATIAL_PALETTE.cardBorder);
      this.group.position.z = this.defaultZ;
    }
  }
}

/**
 * Interactive Spatial Button with Ray and Near-Touch hover/active feedback.
 */
export class SpatialButton extends SpatialUIElement {
  private readonly mesh: THREE.Mesh;
  private readonly borderMesh: THREE.LineSegments;
  private isHovered = false;
  private isPressed = false;
  private onClickHandler?: () => void;

  constructor(
    label: string,
    width: number = SPATIAL_DIMENSIONS.buttonWidth,
    height: number = SPATIAL_DIMENSIONS.buttonHeight,
    options: {
      accentColor?: number;
      textColor?: string | number;
    } = {},
  ) {
    super(`Btn_${label.replace(/\s+/g, '_')}`);
    const { accentColor = SPATIAL_PALETTE.primary, textColor = SPATIAL_PALETTE.textPrimary } = options;

    const geo = new THREE.BoxGeometry(width, height, SPATIAL_DIMENSIONS.buttonDepth);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.3,
      metalness: 0.2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    const edges = new THREE.EdgesGeometry(geo);
    this.borderMesh = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: accentColor }),
    );
    this.group.add(this.borderMesh);

    const { texture, aspect } = createTextTexture(label, {
      fontSize: 20,
      fontWeight: '600',
      color: textColor,
      width: 256,
      height: 64,
    });
    const labelW = width * 0.85;
    const labelH = labelW / aspect;
    const textMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(labelW, labelH),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    textMesh.position.z = SPATIAL_DIMENSIONS.buttonDepth / 2 + 0.002;
    this.group.add(textMesh);
  }

  onClick(fn: () => void): this {
    this.onClickHandler = fn;
    return this;
  }

  triggerClick(): void {
    if (this.onClickHandler) {
      this.onClickHandler();
    }
  }

  setHovered(hovered: boolean): void {
    if (this.isHovered === hovered) return;
    this.isHovered = hovered;
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(hovered ? 0x2563eb : 0x1e293b);
  }

  setPressed(pressed: boolean): void {
    if (this.isPressed === pressed) return;
    this.isPressed = pressed;
    this.group.position.z += pressed ? -0.005 : 0.005;
    if (pressed) {
      this.triggerClick();
    }
  }
}

/**
 * Spatial Loading Spinner / Ring for Async Operations.
 */
export class SpatialLoadingIndicator extends SpatialUIElement {
  private readonly ringMesh: THREE.Mesh;

  constructor(radius = 0.06) {
    super('Spatial_Loading_Indicator');

    const geo = new THREE.TorusGeometry(radius, 0.006, 16, 48, Math.PI * 1.5);
    const mat = new THREE.MeshBasicMaterial({
      color: SPATIAL_PALETTE.primary,
    });
    this.ringMesh = new THREE.Mesh(geo, mat);
    this.group.add(this.ringMesh);
  }

  update(deltaSeconds: number): void {
    this.ringMesh.rotation.z -= deltaSeconds * 4.0;
  }
}

/**
 * Spatial Studio Environment Manager:
 * Assembles the full virtual productivity studio layout:
 * - Studio Floor & Floor Fade
 * - Ambient & Architectural Key/Accent Lights
 * - Scheduled Podium Anchor & Spatial Layout Zones
 */
export class SpatialStudioEnvironment {
  readonly scene: THREE.Scene;
  private readonly studioGroup: THREE.Group;
  private loadingIndicator?: SpatialLoadingIndicator;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.studioGroup = new THREE.Group();
    this.studioGroup.name = 'PlanRescue_Spatial_Studio';
    this.scene.add(this.studioGroup);

    this.setupLighting();
    this.setupFloor();
    this.setupPodiumAnchor();
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0x0f172a, 0.9);
    ambient.name = 'studio_ambient_light';
    this.studioGroup.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2, 4, 2);
    keyLight.name = 'studio_key_light';
    this.studioGroup.add(keyLight);

    const cyanAccent = new THREE.PointLight(SPATIAL_PALETTE.primary, 0.8, 8);
    cyanAccent.position.set(-2, 1.8, -1);
    cyanAccent.name = 'studio_cyan_accent';
    this.studioGroup.add(cyanAccent);

    const purpleAccent = new THREE.PointLight(SPATIAL_PALETTE.accentPurple, 0.6, 8);
    purpleAccent.position.set(2, 1.8, -1);
    purpleAccent.name = 'studio_purple_accent';
    this.studioGroup.add(purpleAccent);
  }

  private setupFloor(): void {
    // Floor grid
    const grid = new THREE.GridHelper(10, 20, SPATIAL_PALETTE.gridMajor, SPATIAL_PALETTE.gridMinor);
    grid.position.y = 0;
    grid.name = 'studio_floor_grid';
    this.studioGroup.add(grid);

    // Subtle dark circular platform beneath the seated user
    const platformGeo = new THREE.CylinderGeometry(1.5, 1.6, 0.02, 32);
    const platformMat = new THREE.MeshStandardMaterial({
      color: SPATIAL_PALETTE.studioFloor,
      roughness: 0.6,
      metalness: 0.1,
    });
    const platformMesh = new THREE.Mesh(platformGeo, platformMat);
    platformMesh.position.y = -0.01;
    platformMesh.name = 'studio_user_platform';
    this.studioGroup.add(platformMesh);
  }

  private setupPodiumAnchor(): void {
    // Central schedule anchor podium
    const podiumGeo = new THREE.CylinderGeometry(0.7, 0.75, 0.04, 32);
    const podiumMat = new THREE.MeshStandardMaterial({
      color: SPATIAL_PALETTE.podiumSurface,
      roughness: 0.3,
      metalness: 0.3,
    });
    const podium = new THREE.Mesh(podiumGeo, podiumMat);
    podium.position.set(0, 0.02, -1.45);
    podium.name = 'schedule_anchor_podium';
    this.studioGroup.add(podium);

    // Glowing cyan trim ring on the podium
    const ringGeo = new THREE.RingGeometry(0.68, 0.7, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: SPATIAL_PALETTE.podiumTrim,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.041, -1.45);
    ring.name = 'podium_trim_ring';
    this.studioGroup.add(ring);
  }

  showLoading(show: boolean): void {
    if (show && !this.loadingIndicator) {
      this.loadingIndicator = new SpatialLoadingIndicator(0.08);
      this.loadingIndicator.setPosition(0, 1.25, -1.2);
      this.studioGroup.add(this.loadingIndicator.group);
    } else if (!show && this.loadingIndicator) {
      this.studioGroup.remove(this.loadingIndicator.group);
      this.loadingIndicator.dispose();
      this.loadingIndicator = undefined;
    }
  }

  update(deltaSeconds: number): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.update(deltaSeconds);
    }
  }

  dispose(): void {
    this.showLoading(false);
    this.studioGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else if (obj.material) {
          obj.material.dispose();
        }
      }
    });
    this.studioGroup.clear();
    this.scene.remove(this.studioGroup);
  }
}
