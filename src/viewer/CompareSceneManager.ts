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
  assetId: string;
  root: THREE.Group;
}

interface LineupRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  roots: LineupRootRuntime[];
  lightingManager: LightingManager;
  renderModeManager: RenderModeManager;
}

/**
 * Multi-Asset Compare renderer.
 *
 * One canvas + one WebGLRenderer is shared by every compare cell. Grid mode is
 * rendered with viewport/scissor rectangles; each model owns an independent
 * scene/camera/mixer. Lineup uses presentation-only clones so manual size
 * matching never mutates the source model kept for Doctor or export.
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
  private clock = new THREE.Clock();
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
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
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

    for (const asset of assets) {
      if (!this.manualScales.has(asset.id)) {
        this.manualScales.set(asset.id, this.clampManualScale(asset.manualScale));
      }
    }
    for (const id of Array.from(this.manualScales.keys())) {
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

    this.rebuildLineup(true);
    this.updateControlEnablement();
    removedRoots.forEach((root) => this.disposeAssetRoot(root));
  }

  public setViewMode(mode: CompareViewMode) {
    this.viewMode = mode;
    this.updateControlEnablement();
    if (mode === 'lineup') this.rebuildLineup(true);
  }

  public setScaleMode(mode: CompareScaleMode) {
    this.scaleMode = mode;
    this.rebuildLineup(true);
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
  }

  public setManualScale(assetId: string, scale: number, reframe = false) {
    if (!this.assets.some((asset) => asset.id === assetId)) return;
    const next = this.clampManualScale(scale);
    this.manualScales.set(assetId, next);
    this.callbacks.onManualScaleChange?.(assetId, next);
    if (this.viewMode === 'lineup') this.rebuildLineup(reframe);
  }

  public resetManualScales() {
    for (const asset of this.assets) {
      this.manualScales.set(asset.id, 1);
      this.callbacks.onManualScaleChange?.(asset.id, 1);
    }
    if (this.viewMode === 'lineup') this.rebuildLineup(true);
  }

  public getManualScale(assetId: string) {
    return this.manualScales.get(assetId) ?? 1;
  }

  public setClip(assetId: string, clipIndex: number) {
    const slot = this.slots.find((runtime) => runtime.asset.id === assetId);
    if (!slot || !Number.isInteger(clipIndex)) return;
    const clip = slot.asset.animations[clipIndex];
    if (!clip || !slot.mixer) return;

    slot.action?.stop();
    const action = slot.mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.paused = !this.playing;
    action.clampWhenFinished = !this.looping;
    action.setLoop(this.looping ? THREE.LoopRepeat : THREE.LoopOnce, this.looping ? Infinity : 1);
    action.setEffectiveTimeScale(this.animationSpeed);
    action.play();
    slot.action = action;

    if (this.syncAnimations) this.seekNormalized(this.getReferenceNormalizedTime());
  }

  public setPlaying(playing: boolean) {
    this.playing = playing;
    for (const slot of this.slots) {
      if (slot.action) slot.action.paused = !playing;
    }
  }

  public setLooping(looping: boolean) {
    this.looping = looping;
    for (const slot of this.slots) {
      if (!slot.action) continue;
      slot.action.clampWhenFinished = !looping;
      slot.action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    }
  }

  public setAnimationSpeed(speed: number) {
    this.animationSpeed = THREE.MathUtils.clamp(speed, 0.05, 4);
    for (const slot of this.slots) slot.action?.setEffectiveTimeScale(this.animationSpeed);
  }

  public seekNormalized(normalized: number) {
    const t = THREE.MathUtils.clamp(normalized, 0, 1);
    if (this.syncAnimations) {
      for (const slot of this.slots) this.seekSlot(slot, t);
      return;
    }

    const active = this.slots.find((slot) => slot.asset.id === this.activeAssetId) ?? this.slots[0];
    if (active) this.seekSlot(active, t);
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
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
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
    renderModeManager.applyMode(this.renderMode, asset.root);

    const camera = new THREE.PerspectiveCamera(45, 1, Math.max(0.001, radius / 1000), Math.max(100, radius * 100));
    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.enabled = false;

    const runtime: SlotRuntime = {
      asset,
      scene,
      camera,
      controls,
      mixer: asset.animations.length > 0 ? new THREE.AnimationMixer(asset.root) : null,
      action: null,
      bounds,
      radius,
      lightingManager,
      renderModeManager,
    };

    this.frameSlot(runtime);
    controls.addEventListener('change', () => this.handleCameraChanged(runtime));

    if (runtime.mixer && asset.animations.length > 0) {
      const clipIndex = Math.min(Math.max(asset.selectedClipIndex, 0), asset.animations.length - 1);
      const clip = asset.animations[clipIndex];
      const action = runtime.mixer.clipAction(clip);
      action.reset();
      action.enabled = true;
      action.paused = !this.playing;
      action.setLoop(this.looping ? THREE.LoopRepeat : THREE.LoopOnce, this.looping ? Infinity : 1);
      action.setEffectiveTimeScale(this.animationSpeed);
      action.play();
      runtime.action = action;
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
    if (!this.syncCameras || this.syncingCamera || this.viewMode !== 'grid' || !this.active) return;
    this.syncingCamera = true;
    try {
      const sourceCenter = source.controls.target;
      const normalizedOffset = source.camera.position.clone().sub(sourceCenter).divideScalar(Math.max(source.radius, 1e-6));

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

  private rebuildLineup(reframe: boolean) {
    const previousCamera = !reframe && this.lineup
      ? {
          position: this.lineup.camera.position.clone(),
          target: this.lineup.controls.target.clone(),
          up: this.lineup.camera.up.clone(),
        }
      : null;

    this.clearLineup();
    if (this.assets.length === 0) return;

    const scene = this.createScene();
    const roots: LineupRootRuntime[] = [];
    let cursorX = 0;
    let maxHeight = 0;
    const raw: Array<{
      asset: CompareAssetRecord;
      root: THREE.Group;
      size: THREE.Vector3;
    }> = [];

    for (const asset of this.assets) {
      const root = cloneSkeleton(asset.root) as THREE.Group;
      root.userData.__assetDoctorCompareAssetId = asset.id;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      maxHeight = Math.max(maxHeight, size.y);
      raw.push({ asset, root, size });
    }

    const targetHeight = Math.max(maxHeight, 1);
    const gap = Math.max(targetHeight * 0.18, 0.25);

    for (const entry of raw) {
      const normalizedScale = this.scaleMode === 'normalize-height' && entry.size.y > 1e-6
        ? targetHeight / entry.size.y
        : 1;
      const manualScale = this.manualScales.get(entry.asset.id) ?? 1;
      entry.root.scale.multiplyScalar(normalizedScale * manualScale);
      entry.root.updateMatrixWorld(true);

      const scaledBounds = new THREE.Box3().setFromObject(entry.root);
      const scaledSize = scaledBounds.getSize(new THREE.Vector3());
      entry.root.position.x += cursorX - scaledBounds.min.x;
      entry.root.position.y -= scaledBounds.min.y;
      entry.root.updateMatrixWorld(true);
      cursorX += scaledSize.x + gap;
      roots.push({ assetId: entry.asset.id, root: entry.root });
      scene.add(entry.root);
    }

    const combined = new THREE.Box3();
    roots.forEach((entry) => combined.expandByObject(entry.root));
    this.addGrid(scene, combined);

    const lightingManager = new LightingManager(scene);
    lightingManager.applyPreset(this.lightingPreset);
    const renderModeManager = new RenderModeManager(scene);
    for (const entry of roots) renderModeManager.applyMode(this.renderMode, entry.root);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    this.lineup = { scene, camera, controls, roots, lightingManager, renderModeManager };
    if (previousCamera) {
      camera.position.copy(previousCamera.position);
      camera.up.copy(previousCamera.up);
      controls.target.copy(previousCamera.target);
      controls.update();
    } else {
      this.frameLineup();
    }
    this.updateControlEnablement();
  }

  private frameLineup() {
    if (!this.lineup) return;
    const bounds = new THREE.Box3();
    this.lineup.roots.forEach((entry) => bounds.expandByObject(entry.root));
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

  private seekSlot(slot: SlotRuntime, normalized: number) {
    if (!slot.action || !slot.mixer) return;
    const duration = slot.action.getClip().duration;
    const target = normalized * duration;
    const paused = slot.action.paused;
    slot.action.paused = false;
    slot.action.time = target;
    slot.mixer.update(0);
    slot.action.paused = paused;
  }

  private getReferenceNormalizedTime() {
    const active = this.slots.find((slot) => slot.asset.id === this.activeAssetId && slot.action) ??
      this.slots.find((slot) => slot.action);
    if (!active?.action) return 0;
    const duration = Math.max(active.action.getClip().duration, 1e-6);
    return THREE.MathUtils.clamp(active.action.time / duration, 0, 1);
  }

  private handlePointerDown(event: PointerEvent) {
    if (!this.active) return;

    if (this.viewMode === 'lineup') {
      const assetId = this.pickLineupAsset(event.clientX, event.clientY);
      if (!assetId) return;
      this.activeAssetId = assetId;
      this.callbacks.onActiveAssetChange?.(assetId);
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const yFromBottom = rect.bottom - event.clientY;
    const layout = this.currentLayout(rect.width, rect.height);
    const hit = layout.find((cell) => x >= cell.x && x <= cell.x + cell.width && yFromBottom >= cell.y && yFromBottom <= cell.y + cell.height);
    if (!hit) return;

    const asset = this.assets[hit.index];
    if (!asset) return;
    this.activeAssetId = asset.id;
    this.callbacks.onActiveAssetChange?.(asset.id);
    this.updateControlEnablement(hit.index);
  }

  private handleDoubleClick(event: MouseEvent) {
    if (!this.active || this.viewMode === 'lineup') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const yFromBottom = rect.bottom - event.clientY;
    const layout = this.currentLayout(rect.width, rect.height);
    const hit = layout.find((cell) => x >= cell.x && x <= cell.x + cell.width && yFromBottom >= cell.y && yFromBottom <= cell.y + cell.height);
    if (!hit) return;
    const asset = this.assets[hit.index];
    if (!asset) return;

    const next = this.soloAssetId === asset.id ? null : asset.id;
    this.soloAssetId = next;
    this.callbacks.onSoloRequest?.(next);
    this.updateControlEnablement();
  }

  private handleWheel(event: WheelEvent) {
    if (!this.active || this.viewMode !== 'lineup' || !event.altKey) return;
    const assetId = this.pickLineupAsset(event.clientX, event.clientY);
    if (!assetId) return;

    event.preventDefault();
    event.stopPropagation();
    this.activeAssetId = assetId;
    this.callbacks.onActiveAssetChange?.(assetId);

    const current = this.manualScales.get(assetId) ?? 1;
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.setManualScale(assetId, current * factor, false);
  }

  private pickLineupAsset(clientX: number, clientY: number): string | null {
    if (!this.lineup) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.lineup.camera);
    const intersections = this.raycaster.intersectObjects(
      this.lineup.roots.map((entry) => entry.root),
      true
    );

    for (const intersection of intersections) {
      let node: THREE.Object3D | null = intersection.object;
      while (node) {
        const id = node.userData.__assetDoctorCompareAssetId as string | undefined;
        if (id) return id;
        node = node.parent;
      }
    }
    return null;
  }

  private currentLayout(width: number, height: number): CompareViewportRect[] {
    const soloIndex = this.soloAssetId
      ? this.assets.findIndex((asset) => asset.id === this.soloAssetId)
      : null;
    return computeCompareLayout(this.assets.length, width, height, soloIndex !== null && soloIndex >= 0 ? soloIndex : null);
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
      if (canvas.width === 0 || canvas.height === 0 || canvas.clientWidth !== width || canvas.clientHeight !== height) {
        this.renderer.setSize(width, height, false);
      }

      if (this.playing) {
        for (const slot of this.slots) slot.mixer?.update(delta);
      }

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
        const layout = this.currentLayout(width, height);
        for (const cell of layout) {
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
    this.lineup.controls.dispose();
    for (const entry of this.lineup.roots) {
      this.lineup.renderModeManager.resetAll(entry.root);
      this.lineup.scene.remove(entry.root);
    }
    this.lineup.renderModeManager.dispose();
    this.lineup.lightingManager.dispose();
    this.disposeSceneHelpers(this.lineup.scene);
    this.lineup = null;
  }

  private disposeSceneHelpers(scene: THREE.Scene) {
    scene.traverse((object) => {
      if (object.name !== '__asset_doctor_compare_grid') return;
      const grid = object as THREE.GridHelper;
      grid.geometry.dispose();
      const material = grid.material;
      if (Array.isArray(material)) material.forEach((value) => value.dispose());
      else material.dispose();
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
