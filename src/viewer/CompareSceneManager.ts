import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BoundsCalculator } from './BoundsCalculator';
import { LightingManager } from './LightingManager';
import { RenderModeManager } from './RenderModeManager';
import { computeCompareLayout } from '../compare/CompareLayout';
import type { LightingPreset, RenderMode } from '../types';
import type {
  CompareAssetRecord,
  CompareScaleMode,
  CompareViewMode,
  CompareViewportRect,
} from '../compare/CompareTypes';

interface CompareSceneManagerCallbacks {
  onActiveAssetChange?: (assetId: string) => void;
  onSoloRequest?: (assetId: string | null) => void;
  onAnimationProgress?: (normalized: number) => void;
  onManualScaleChange?: (assetId: string, scale: number) => void;
}

interface SlotRuntime {
  asset: CompareAssetRecord;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  bounds: THREE.Box3;
  radius: number;
  lightingManager: LightingManager;
  renderModeManager: RenderModeManager;
}

interface LineupRootRuntime {
  asset: CompareAssetRecord;
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  /** Bounds captured once from the authored presentation clone before lineup scaling. */
  sourceBounds: THREE.Box3;
  sourceSize: THREE.Vector3;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
}

interface LineupRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  roots: LineupRootRuntime[];
  lightingManager: LightingManager;
  renderModeManager: RenderModeManager;
  /** Current analytically maintained lineup bounds; avoids expandByObject on UI input. */
  bounds: THREE.Box3;
}

/**
 * Multi-Asset Compare renderer.
 *
 * A single WebGLRenderer serves every compare cell. Grid assets keep independent
 * cameras. Lineup uses presentation-only SkeletonUtils clones, including their
 * own AnimationMixers, so playback never animates an invisible source while the
 * visible Lineup clone remains frozen.
 */
export class CompareSceneManager {
  public readonly renderer: THREE.WebGLRenderer;

  private readonly container: HTMLElement;
  private readonly callbacks: CompareSceneManagerCallbacks;
  private assets: CompareAssetRecord[] = [];
  private slots: SlotRuntime[] = [];
  private lineup: LineupRuntime | null = null;
  private viewMode: CompareViewMode = 'grid';
  private scaleMode: CompareScaleMode = 'real';
  private renderMode: RenderMode = 'pbr';
  private lightingPreset: LightingPreset = 'neutral-studio';
  private syncCameras = true;
  private syncAnimations = true;
  private soloAssetId: string | null = null;
  private activeAssetId: string | null = null;
  private playing = false;
  private looping = true;
  private active = true;
  private animationSpeed = 1;
  private animationFrameId: number | null = null;
  private readonly clock = new THREE.Clock();
  private syncingCamera = false;
  private lastProgressPublish = 0;
  private readonly manualScales = new Map<string, number>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private readonly onPointerDownBound: (event: PointerEvent) => void;
  private readonly onDoubleClickBound: (event: MouseEvent) => void;
  private readonly onWheelBound: (event: WheelEvent) => void;
  private readonly onResizeBound: () => void;

  constructor(container: HTMLElement, callbacks: CompareSceneManagerCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Object.assign(this.renderer.domElement.style, {
      width: '100%',
      height: '100%',
      display: 'block',
    });
    container.appendChild(this.renderer.domElement);

    this.onPointerDownBound = (event) => this.handlePointerDown(event);
    this.onDoubleClickBound = (event) => this.handleDoubleClick(event);
    this.onWheelBound = (event) => this.handleWheel(event);
    this.onResizeBound = () => this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDownBound);
    this.renderer.domElement.addEventListener('dblclick', this.onDoubleClickBound);
    this.renderer.domElement.addEventListener('wheel', this.onWheelBound, { passive: false });
    window.addEventListener('resize', this.onResizeBound);
    this.startRenderLoop();
  }

  public setActive(active: boolean) {
    this.active = active;
    if (active) {
      this.clock.getDelta();
      this.resize();
    }
    this.updateControlEnablement();
  }

  public setAssets(assets: CompareAssetRecord[]) {
    const nextIds = new Set(assets.map((asset) => asset.id));
    const removedRoots = this.assets
      .filter((asset) => !nextIds.has(asset.id))
      .map((asset) => asset.root);
    const progress = this.getReferenceNormalizedTime();

    for (const asset of assets) {
      if (!this.manualScales.has(asset.id)) {
        this.manualScales.set(asset.id, this.clampManualScale(asset.manualScale));
      }
    }
    for (const id of [...this.manualScales.keys()]) {
      if (!nextIds.has(id)) this.manualScales.delete(id);
    }

    this.clearSlotRuntimes();
    this.clearLineup();
    this.assets = assets.slice(0, 5);

    for (const asset of this.assets) {
      this.prepareAssetRoot(asset.root);
      this.slots.push(this.createSlotRuntime(asset));
    }

    if (!this.activeAssetId || !nextIds.has(this.activeAssetId)) {
      this.activeAssetId = this.assets[0]?.id ?? null;
      if (this.activeAssetId) this.callbacks.onActiveAssetChange?.(this.activeAssetId);
    }
    if (this.soloAssetId && !nextIds.has(this.soloAssetId)) {
      this.soloAssetId = null;
      this.callbacks.onSoloRequest?.(null);
    }

    if (this.viewMode === 'lineup') {
      this.rebuildLineup(true);
    } else {
      this.seekNormalized(progress);
    }
    this.updateControlEnablement();
    removedRoots.forEach((root) => this.disposeAssetRoot(root));
  }

  public setViewMode(mode: CompareViewMode) {
    this.viewMode = mode;
    if (mode === 'lineup') {
      // Lineup is presentation-only. Rebuild from authored source each time we
      // enter it instead of reusing stale clones created while Grid was active.
      this.rebuildLineup(true);
    } else {
      // Release presentation clones/mixers while Grid is active. Session state
      // such as manual scales and selected assets is stored outside the clones.
      this.clearLineup();
    }
    this.updateControlEnablement();
  }

  public setScaleMode(mode: CompareScaleMode) {
    this.scaleMode = mode;
    if (this.viewMode === 'lineup') this.updateLineupLayout(true, true);
  }

  public setRenderMode(mode: RenderMode) {
    this.renderMode = mode;
    for (const slot of this.slots) slot.renderModeManager.applyMode(mode, slot.asset.root);
    if (this.lineup) {
      for (const entry of this.lineup.roots) {
        this.lineup.renderModeManager.applyMode(mode, entry.root);
      }
    }
  }

  public setLightingPreset(preset: LightingPreset) {
    this.lightingPreset = preset;
    for (const slot of this.slots) slot.lightingManager.applyPreset(preset);
    this.lineup?.lightingManager.applyPreset(preset);
  }

  public setSyncCameras(enabled: boolean) {
    this.syncCameras = enabled;
  }

  public setSyncAnimations(enabled: boolean) {
    this.syncAnimations = enabled;
    if (enabled) this.seekNormalized(this.getReferenceNormalizedTime());
  }

  public setSoloAssetId(assetId: string | null) {
    this.soloAssetId = assetId;
    this.updateControlEnablement();
  }

  public setActiveAssetId(assetId: string | null) {
    if (assetId && !this.assets.some((asset) => asset.id === assetId)) return;
    this.activeAssetId = assetId;
    this.callbacks.onActiveAssetChange?.(assetId ?? '');
    this.updateControlEnablement();
    if (this.syncAnimations) this.seekNormalized(this.getReferenceNormalizedTime());
  }

  public setManualScale(assetId: string, scale: number, reframe = false) {
    if (!this.assets.some((asset) => asset.id === assetId)) return;
    const next = this.clampManualScale(scale);
    this.manualScales.set(assetId, next);
    this.callbacks.onManualScaleChange?.(assetId, next);
    if (this.viewMode === 'lineup') this.updateLineupLayout(reframe, reframe);
  }

  public resetManualScales() {
    for (const asset of this.assets) {
      this.manualScales.set(asset.id, 1);
      this.callbacks.onManualScaleChange?.(asset.id, 1);
    }
    if (this.viewMode === 'lineup') this.updateLineupLayout(true, true);
  }

  public getManualScale(assetId: string) {
    return this.manualScales.get(assetId) ?? 1;
  }

  public setClip(assetId: string, clipIndex: number) {
    const slot = this.slots.find((runtime) => runtime.asset.id === assetId);
    if (!slot || !Number.isInteger(clipIndex)) return;
    const clip = slot.asset.animations[clipIndex];
    if (!clip || !slot.mixer) return;

    const progress = this.getReferenceNormalizedTime();
    slot.action?.stop();
    slot.action = this.createAction(slot.mixer, clip);

    const lineupEntry = this.lineup?.roots.find((entry) => entry.asset.id === assetId);
    if (lineupEntry?.mixer) {
      lineupEntry.action?.stop();
      lineupEntry.action = this.createAction(lineupEntry.mixer, clip);
    }

    if (this.syncAnimations) this.seekNormalized(progress);
  }

  public setPlaying(playing: boolean) {
    this.playing = playing;
    for (const action of this.allActions()) action.paused = !playing;
  }

  public setLooping(looping: boolean) {
    this.looping = looping;
    for (const action of this.allActions()) this.configureLoop(action);
  }

  public setAnimationSpeed(speed: number) {
    this.animationSpeed = THREE.MathUtils.clamp(speed, 0.05, 4);
    for (const action of this.allActions()) action.setEffectiveTimeScale(this.animationSpeed);
  }

  public seekNormalized(normalized: number) {
    const t = THREE.MathUtils.clamp(normalized, 0, 1);
    if (this.syncAnimations) {
      for (const slot of this.slots) this.seekAction(slot.mixer, slot.action, t);
      for (const entry of this.lineup?.roots ?? []) this.seekAction(entry.mixer, entry.action, t);
      return;
    }

    const activeId = this.activeAssetId ?? this.assets[0]?.id;
    const slot = this.slots.find((entry) => entry.asset.id === activeId);
    if (slot) this.seekAction(slot.mixer, slot.action, t);
    const lineupEntry = this.lineup?.roots.find((entry) => entry.asset.id === activeId);
    if (lineupEntry) this.seekAction(lineupEntry.mixer, lineupEntry.action, t);
  }

  public resetCameras() {
    for (const slot of this.slots) this.frameSlot(slot);
    if (this.lineup) this.frameLineup();
  }

  public dispose() {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    window.removeEventListener('resize', this.onResizeBound);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDownBound);
    this.renderer.domElement.removeEventListener('dblclick', this.onDoubleClickBound);
    this.renderer.domElement.removeEventListener('wheel', this.onWheelBound);

    this.clearSlotRuntimes();
    this.clearLineup();
    for (const asset of this.assets) this.disposeAssetRoot(asset.root);
    this.assets = [];
    this.manualScales.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private allActions() {
    return [
      ...this.slots.map((slot) => slot.action),
      ...(this.lineup?.roots.map((entry) => entry.action) ?? []),
    ].filter((action): action is THREE.AnimationAction => Boolean(action));
  }

  private createAction(mixer: THREE.AnimationMixer, clip: THREE.AnimationClip) {
    const action = mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.paused = !this.playing;
    this.configureLoop(action);
    action.setEffectiveTimeScale(this.animationSpeed);
    action.play();
    return action;
  }

  private configureLoop(action: THREE.AnimationAction) {
    action.clampWhenFinished = !this.looping;
    action.setLoop(this.looping ? THREE.LoopRepeat : THREE.LoopOnce, this.looping ? Infinity : 1);
  }

  private clampManualScale(scale: number) {
    return THREE.MathUtils.clamp(Number.isFinite(scale) ? scale : 1, 0.1, 5);
  }

  private prepareAssetRoot(root: THREE.Group) {
    root.visible = true;
    root.updateMatrixWorld(true);
    if (root.userData.__assetDoctorCompareGrounded) return;
    const bounds = BoundsCalculator.computeAccurateWorldBounds(root);
    if (bounds.isValid && Number.isFinite(bounds.box.min.y)) {
      root.position.y -= bounds.box.min.y;
      root.updateMatrixWorld(true);
    }
    root.userData.__assetDoctorCompareGrounded = true;
  }

  private createSlotRuntime(asset: CompareAssetRecord): SlotRuntime {
    const scene = this.createScene();
    scene.add(asset.root);
    asset.root.updateMatrixWorld(true);

    const boundsResult = BoundsCalculator.computeAccurateWorldBounds(asset.root);
    const bounds = boundsResult.isValid ? boundsResult.box.clone() : new THREE.Box3().setFromObject(asset.root);
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.05);
    this.addGrid(scene, bounds);

    const lightingManager = new LightingManager(scene);
    lightingManager.applyPreset(this.lightingPreset);
    const renderModeManager = new RenderModeManager(scene);
    asset.root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) renderModeManager.registerMesh(object as THREE.Mesh);
    });
    renderModeManager.applyMode(this.renderMode, asset.root);

    const camera = new THREE.PerspectiveCamera(45, 1, Math.max(0.001, radius / 1000), Math.max(100, radius * 100));
    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.enabled = false;

    const mixer = asset.animations.length > 0 ? new THREE.AnimationMixer(asset.root) : null;
    const runtime: SlotRuntime = {
      asset,
      scene,
      camera,
      controls,
      mixer,
      action: null,
      bounds,
      radius,
      lightingManager,
      renderModeManager,
    };
    this.frameSlot(runtime);
    controls.addEventListener('change', () => this.handleCameraChanged(runtime));

    if (mixer && asset.animations.length > 0) {
      const clipIndex = THREE.MathUtils.clamp(asset.selectedClipIndex, 0, asset.animations.length - 1);
      runtime.action = this.createAction(mixer, asset.animations[clipIndex]);
    }
    return runtime;
  }

  private createScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x131518);
    return scene;
  }

  private addGrid(scene: THREE.Scene, bounds: THREE.Box3) {
    const size = bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, size.y, 1);
    const gridSize = Math.max(2, Math.ceil(span * 2));
    const divisions = Math.min(100, Math.max(10, Math.round(gridSize * 4)));
    const grid = new THREE.GridHelper(gridSize, divisions, 0x3b82f6, 0x272b32);
    grid.position.y = 0;
    grid.name = '__asset_doctor_compare_grid';
    scene.add(grid);
  }

  private frameSlot(slot: SlotRuntime) {
    const center = slot.bounds.getCenter(new THREE.Vector3());
    const size = slot.bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.05);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(slot.camera.fov * 0.5)) * 1.25;
    slot.camera.position.copy(center).add(new THREE.Vector3(0.75, 0.45, 1).normalize().multiplyScalar(distance));
    slot.camera.near = Math.max(distance / 1000, 0.001);
    slot.camera.far = Math.max(distance * 100, 100);
    slot.camera.updateProjectionMatrix();
    slot.controls.target.copy(center);
    slot.controls.update();
  }

  private handleCameraChanged(source: SlotRuntime) {
    if (!this.syncCameras || this.syncingCamera || this.viewMode !== 'grid') return;
    this.syncingCamera = true;
    try {
      const sourceCenter = source.controls.target;
      const normalizedOffset = source.camera.position.clone()
        .sub(sourceCenter)
        .divideScalar(Math.max(source.radius, 1e-6));
      for (const target of this.slots) {
        if (target === source) continue;
        const center = target.bounds.getCenter(new THREE.Vector3());
        target.controls.target.copy(center);
        target.camera.position.copy(center).add(normalizedOffset.clone().multiplyScalar(target.radius));
        target.camera.up.copy(source.camera.up);
        target.camera.updateProjectionMatrix();
        target.controls.update();
      }
    } finally {
      this.syncingCamera = false;
    }
  }

  private cloneAuthoredAsset(asset: CompareAssetRecord) {
    const slot = this.slots.find((entry) => entry.asset.id === asset.id);
    if (!slot) return cloneSkeleton(asset.root) as THREE.Group;
    return slot.renderModeManager.withOriginalMaterials(
      asset.root,
      () => cloneSkeleton(asset.root) as THREE.Group
    );
  }

  private rebuildLineup(reframe: boolean) {
    const progress = this.getReferenceNormalizedTime();
    this.clearLineup();
    if (this.assets.length === 0) return;

    const scene = this.createScene();
    const roots: LineupRootRuntime[] = [];

    // Cloning a production GLB (especially a skinned/textured one) is expensive.
    // Do it once when Lineup is created, never for interactive scale changes.
    for (const asset of this.assets) {
      const root = this.cloneAuthoredAsset(asset);
      root.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(root);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const basePosition = root.position.clone();
      const baseScale = root.scale.clone();
      scene.add(root);

      const mixer = asset.animations.length > 0 ? new THREE.AnimationMixer(root) : null;
      let action: THREE.AnimationAction | null = null;
      if (mixer) {
        const clipIndex = THREE.MathUtils.clamp(asset.selectedClipIndex, 0, asset.animations.length - 1);
        action = this.createAction(mixer, asset.animations[clipIndex]);
      }
      roots.push({
        asset,
        root,
        mixer,
        action,
        sourceBounds,
        sourceSize,
        basePosition,
        baseScale,
      });
    }

    const lightingManager = new LightingManager(scene);
    lightingManager.applyPreset(this.lightingPreset);
    const renderModeManager = new RenderModeManager(scene);
    for (const entry of roots) {
      entry.root.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) renderModeManager.registerMesh(object as THREE.Mesh);
      });
      renderModeManager.applyMode(this.renderMode, entry.root);
    }

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    this.lineup = {
      scene,
      camera,
      controls,
      roots,
      lightingManager,
      renderModeManager,
      bounds: new THREE.Box3(),
    };
    this.updateLineupLayout(reframe, true);
    scene.updateMatrixWorld(true);
    this.seekNormalized(progress);
    this.updateControlEnablement();
  }

  private updateLineupLayout(reframe: boolean, refreshGrid: boolean) {
    if (!this.lineup || this.lineup.roots.length === 0) return;

    const maxHeight = Math.max(
      0,
      ...this.lineup.roots.map((entry) => entry.sourceSize.y)
    );
    const targetHeight = Math.max(maxHeight, 1);
    const gap = Math.max(targetHeight * 0.18, 0.25);
    const combined = new THREE.Box3();
    let cursorX = 0;

    for (const entry of this.lineup.roots) {
      const normalizeScale =
        this.scaleMode === 'normalize-height' && entry.sourceSize.y > 1e-6
          ? targetHeight / entry.sourceSize.y
          : 1;
      const manualScale = this.manualScales.get(entry.asset.id) ?? 1;
      const factor = normalizeScale * manualScale;

      // sourceBounds were measured with baseScale already applied. Uniformly
      // scaling their offsets around the root origin lets us update bounds and
      // placement without traversing thousands of meshes/vertices again.
      const minOffset = entry.sourceBounds.min.clone().sub(entry.basePosition).multiplyScalar(factor);
      const maxOffset = entry.sourceBounds.max.clone().sub(entry.basePosition).multiplyScalar(factor);

      entry.root.scale.copy(entry.baseScale).multiplyScalar(factor);
      entry.root.position.copy(entry.basePosition);

      const currentMinX = entry.root.position.x + minOffset.x;
      entry.root.position.x += cursorX - currentMinX;
      const currentMinY = entry.root.position.y + minOffset.y;
      entry.root.position.y -= currentMinY;
      entry.root.updateMatrixWorld(true);

      const min = entry.root.position.clone().add(minOffset);
      const max = entry.root.position.clone().add(maxOffset);
      combined.expandByPoint(min);
      combined.expandByPoint(max);

      cursorX += entry.sourceSize.x * factor + gap;
    }

    this.lineup.bounds.copy(combined);
    if (refreshGrid) this.refreshLineupGrid();
    if (reframe) this.frameLineup();
  }

  private refreshLineupGrid() {
    if (!this.lineup || this.lineup.bounds.isEmpty()) return;
    const stale = this.lineup.scene.children.filter(
      (child) => child.name === '__asset_doctor_compare_grid'
    );
    for (const child of stale) {
      this.lineup.scene.remove(child);
      if ((child as THREE.GridHelper).isGridHelper) {
        (child as THREE.GridHelper).geometry.dispose();
        const material = (child as THREE.GridHelper).material;
        if (Array.isArray(material)) material.forEach((value) => value.dispose());
        else material.dispose();
      }
    }
    this.addGrid(this.lineup.scene, this.lineup.bounds);
  }

  private frameLineup() {
    if (!this.lineup || this.lineup.bounds.isEmpty()) return;
    const bounds = this.lineup.bounds;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.1);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(this.lineup.camera.fov * 0.5)) * 1.2;
    this.lineup.camera.position.copy(center).add(new THREE.Vector3(0.25, 0.18, 1).normalize().multiplyScalar(distance));
    this.lineup.camera.near = Math.max(distance / 2000, 0.001);
    this.lineup.camera.far = Math.max(distance * 100, 100);
    this.lineup.camera.updateProjectionMatrix();
    this.lineup.controls.target.copy(center);
    this.lineup.controls.update();
  }

  private seekAction(
    mixer: THREE.AnimationMixer | null,
    action: THREE.AnimationAction | null,
    normalized: number
  ) {
    if (!action || !mixer) return;
    const duration = Math.max(action.getClip().duration, 1e-6);
    const paused = action.paused;
    action.paused = false;
    action.time = THREE.MathUtils.clamp(normalized, 0, 1) * duration;
    mixer.update(0);
    action.paused = paused;
  }

  private getReferenceSlot() {
    return this.slots.find((slot) => slot.asset.id === this.activeAssetId && slot.action)
      ?? this.slots.find((slot) => slot.action)
      ?? null;
  }

  private getReferenceNormalizedTime() {
    const reference = this.getReferenceSlot();
    if (!reference?.action) return 0;
    const duration = Math.max(reference.action.getClip().duration, 1e-6);
    return THREE.MathUtils.clamp(reference.action.time / duration, 0, 1);
  }

  private advanceAnimations(delta: number) {
    if (!this.playing) return;

    if (!this.syncAnimations) {
      for (const slot of this.slots) slot.mixer?.update(delta);
      for (const entry of this.lineup?.roots ?? []) entry.mixer?.update(delta);
      return;
    }

    const reference = this.getReferenceSlot();
    if (!reference?.mixer || !reference.action) return;
    reference.mixer.update(delta);
    const normalized = this.getReferenceNormalizedTime();

    // Sync means phase sync, not equal elapsed seconds. A 2 s Walk and a 4 s
    // Walk therefore remain at the same normalized pose throughout playback.
    for (const slot of this.slots) {
      if (slot !== reference) this.seekAction(slot.mixer, slot.action, normalized);
    }
    for (const entry of this.lineup?.roots ?? []) {
      this.seekAction(entry.mixer, entry.action, normalized);
    }
  }

  private hitGrid(event: MouseEvent | PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const yFromBottom = rect.bottom - event.clientY;
    return this.currentLayout(rect.width, rect.height).find(
      (cell) => x >= cell.x && x <= cell.x + cell.width && yFromBottom >= cell.y && yFromBottom <= cell.y + cell.height
    );
  }

  private hitLineupAsset(event: MouseEvent | PointerEvent | WheelEvent): CompareAssetRecord | null {
    if (!this.lineup) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.lineup.camera);
    const hits = this.raycaster.intersectObjects(this.lineup.roots.map((entry) => entry.root), true);
    for (const hit of hits) {
      let current: THREE.Object3D | null = hit.object;
      while (current) {
        const entry = this.lineup.roots.find((candidate) => candidate.root === current);
        if (entry) return entry.asset;
        current = current.parent;
      }
    }
    return null;
  }

  private handlePointerDown(event: PointerEvent) {
    if (this.viewMode === 'lineup') {
      const asset = this.hitLineupAsset(event);
      if (asset) this.setActiveAssetId(asset.id);
      return;
    }
    const hit = this.hitGrid(event);
    if (!hit) return;
    const asset = this.assets[hit.index];
    if (!asset) return;
    this.activeAssetId = asset.id;
    this.callbacks.onActiveAssetChange?.(asset.id);
    this.updateControlEnablement(hit.index);
  }

  private handleDoubleClick(event: MouseEvent) {
    if (this.viewMode === 'lineup') {
      const asset = this.hitLineupAsset(event);
      if (asset) this.setActiveAssetId(asset.id);
      return;
    }
    const hit = this.hitGrid(event);
    if (!hit) return;
    const asset = this.assets[hit.index];
    if (!asset) return;
    const next = this.soloAssetId === asset.id ? null : asset.id;
    this.soloAssetId = next;
    this.callbacks.onSoloRequest?.(next);
    this.updateControlEnablement();
  }

  private handleWheel(event: WheelEvent) {
    if (this.viewMode !== 'lineup' || !event.altKey) return;
    const asset = this.hitLineupAsset(event);
    if (!asset) return;
    event.preventDefault();
    const current = this.manualScales.get(asset.id) ?? 1;
    const factor = event.deltaY < 0 ? 1.05 : 1 / 1.05;
    this.setManualScale(asset.id, current * factor, false);
    this.setActiveAssetId(asset.id);
  }

  private currentLayout(width: number, height: number): CompareViewportRect[] {
    const soloIndex = this.soloAssetId
      ? this.assets.findIndex((asset) => asset.id === this.soloAssetId)
      : -1;
    return computeCompareLayout(this.assets.length, width, height, soloIndex >= 0 ? soloIndex : null);
  }

  private updateControlEnablement(forcedIndex?: number) {
    if (this.lineup) this.lineup.controls.enabled = this.active && this.viewMode === 'lineup';
    if (!this.active || this.viewMode !== 'grid') {
      this.slots.forEach((slot) => { slot.controls.enabled = false; });
      return;
    }

    let activeIndex = forcedIndex;
    if (activeIndex === undefined && this.activeAssetId) {
      activeIndex = this.assets.findIndex((asset) => asset.id === this.activeAssetId);
    }
    if (activeIndex === undefined || activeIndex < 0) activeIndex = 0;
    const soloIndex = this.soloAssetId
      ? this.assets.findIndex((asset) => asset.id === this.soloAssetId)
      : -1;
    this.slots.forEach((slot, index) => {
      slot.controls.enabled = soloIndex >= 0 ? index === soloIndex : index === activeIndex;
    });
  }

  private resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
  }

  private startRenderLoop() {
    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      const delta = Math.min(this.clock.getDelta(), 0.1);
      if (!this.active) return;

      const width = this.container.clientWidth || 1;
      const height = this.container.clientHeight || 1;
      const canvas = this.renderer.domElement;
      if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
        this.renderer.setSize(width, height, false);
      }

      this.advanceAnimations(delta);
      for (const slot of this.slots) slot.controls.update();
      this.lineup?.controls.update();

      this.renderer.setScissorTest(true);
      this.renderer.setClearColor(0x131518, 1);
      this.renderer.clear();

      if (this.viewMode === 'lineup' && this.lineup) {
        this.lineup.camera.aspect = width / height;
        this.lineup.camera.updateProjectionMatrix();
        this.renderer.setViewport(0, 0, width, height);
        this.renderer.setScissor(0, 0, width, height);
        this.renderer.render(this.lineup.scene, this.lineup.camera);
      } else {
        for (const cell of this.currentLayout(width, height)) {
          const slot = this.slots[cell.index];
          if (!slot) continue;
          slot.camera.aspect = Math.max(cell.width, 1) / Math.max(cell.height, 1);
          slot.camera.updateProjectionMatrix();
          this.renderer.setViewport(cell.x, cell.y, cell.width, cell.height);
          this.renderer.setScissor(cell.x, cell.y, cell.width, cell.height);
          this.renderer.render(slot.scene, slot.camera);
        }
      }
      this.renderer.setScissorTest(false);

      const now = performance.now();
      if (now - this.lastProgressPublish > 100) {
        this.lastProgressPublish = now;
        this.callbacks.onAnimationProgress?.(this.getReferenceNormalizedTime());
      }
    };
    render();
  }

  private clearSlotRuntimes() {
    for (const slot of this.slots) {
      slot.controls.dispose();
      slot.mixer?.stopAllAction();
      if (slot.mixer) slot.mixer.uncacheRoot(slot.asset.root);
      slot.renderModeManager.resetAll(slot.asset.root);
      slot.renderModeManager.dispose();
      slot.lightingManager.dispose();
      slot.scene.remove(slot.asset.root);
      this.disposeSceneHelpers(slot.scene);
    }
    this.slots = [];
  }

  private clearLineup() {
    if (!this.lineup) return;
    const lineup = this.lineup;
    lineup.controls.dispose();
    for (const entry of lineup.roots) {
      entry.mixer?.stopAllAction();
      if (entry.mixer) entry.mixer.uncacheRoot(entry.root);
      lineup.renderModeManager.resetAll(entry.root);
      lineup.scene.remove(entry.root);
      entry.root.clear();
    }
    lineup.renderModeManager.dispose();
    lineup.lightingManager.dispose();
    this.disposeSceneHelpers(lineup.scene);
    this.lineup = null;
  }

  private disposeSceneHelpers(scene: THREE.Scene) {
    scene.traverse((object) => {
      if ((object as THREE.GridHelper).isGridHelper) {
        (object as THREE.GridHelper).geometry.dispose();
        const material = (object as THREE.GridHelper).material;
        if (Array.isArray(material)) material.forEach((value) => value.dispose());
        else material.dispose();
      }
    });
  }

  private disposeAssetRoot(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of mats) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
        }
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  }
}