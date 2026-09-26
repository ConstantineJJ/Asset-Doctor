import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BoundsCalculator } from './BoundsCalculator';
import { computeCompareLayout } from '../compare/CompareLayout';
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
}

interface LineupRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  roots: THREE.Group[];
}

/**
 * Multi-Asset Compare renderer.
 *
 * One canvas + one WebGLRenderer is shared by every compare cell. Grid mode is
 * rendered with viewport/scissor rectangles; each model still owns an
 * independent scene/camera/mixer so assets cannot affect one another.
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
  private syncCameras = true;
  private syncAnimations = true;
  private soloAssetId: string | null = null;
  private activeAssetId: string | null = null;
  private playing = false;
  private looping = true;
  private animationSpeed = 1;
  private animationFrameId: number | null = null;
  private clock = new THREE.Clock();
  private syncingCamera = false;
  private lastProgressPublish = 0;

  private readonly onPointerDownBound: (event: PointerEvent) => void;
  private readonly onDoubleClickBound: (event: MouseEvent) => void;
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
    this.onResizeBound = () => this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDownBound);
    this.renderer.domElement.addEventListener('dblclick', this.onDoubleClickBound);
    window.addEventListener('resize', this.onResizeBound);

    this.startRenderLoop();
  }

  public setAssets(assets: CompareAssetRecord[]) {
    const nextIds = new Set(assets.map((asset) => asset.id));
    const removedRoots = this.assets
      .filter((asset) => !nextIds.has(asset.id))
      .map((asset) => asset.root);

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

    this.rebuildLineup();
    this.updateControlEnablement();
    removedRoots.forEach((root) => this.disposeAssetRoot(root));
  }

  public setViewMode(mode: CompareViewMode) {
    this.viewMode = mode;
    this.updateControlEnablement();
    if (mode === 'lineup') this.rebuildLineup();
  }

  public setScaleMode(mode: CompareScaleMode) {
    this.scaleMode = mode;
    this.rebuildLineup();
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

    this.clearSlotRuntimes();
    this.clearLineup();
    for (const asset of this.assets) this.disposeAssetRoot(asset.root);
    this.assets = [];

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
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

    const hemi = new THREE.HemisphereLight(0xe8f3ff, 0x15161a, 1.25);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9bbcff, 0.75);
    fill.position.set(-4, 3, -2);
    scene.add(fill);

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

  private rebuildLineup() {
    this.clearLineup();
    if (this.assets.length === 0) return;

    const scene = this.createScene();
    const roots: THREE.Group[] = [];
    let cursorX = 0;
    let maxHeight = 0;
    const raw: Array<{ root: THREE.Group; size: THREE.Vector3; bounds: THREE.Box3 }> = [];

    for (const asset of this.assets) {
      const root = cloneSkeleton(asset.root) as THREE.Group;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      maxHeight = Math.max(maxHeight, size.y);
      raw.push({ root, size, bounds });
    }

    const targetHeight = Math.max(maxHeight, 1);
    const gap = Math.max(targetHeight * 0.18, 0.25);

    for (const entry of raw) {
      const scale = this.scaleMode === 'normalize-height' && entry.size.y > 1e-6
        ? targetHeight / entry.size.y
        : 1;
      entry.root.scale.multiplyScalar(scale);
      entry.root.updateMatrixWorld(true);

      const scaledBounds = new THREE.Box3().setFromObject(entry.root);
      const scaledSize = scaledBounds.getSize(new THREE.Vector3());
      entry.root.position.x += cursorX - scaledBounds.min.x;
      entry.root.position.y -= scaledBounds.min.y;
      entry.root.updateMatrixWorld(true);
      cursorX += scaledSize.x + gap;
      roots.push(entry.root);
      scene.add(entry.root);
    }

    const combined = new THREE.Box3();
    roots.forEach((root) => combined.expandByObject(root));
    this.addGrid(scene, combined);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    this.lineup = { scene, camera, controls, roots };
    this.frameLineup();
    this.updateControlEnablement();
  }

  private frameLineup() {
    if (!this.lineup) return;
    const bounds = new THREE.Box3();
    this.lineup.roots.forEach((root) => bounds.expandByObject(root));
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
    if (this.viewMode === 'lineup') return;
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
    if (this.viewMode === 'lineup') return;
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

  private currentLayout(width: number, height: number): CompareViewportRect[] {
    const soloIndex = this.soloAssetId
      ? this.assets.findIndex((asset) => asset.id === this.soloAssetId)
      : null;
    return computeCompareLayout(this.assets.length, width, height, soloIndex !== null && soloIndex >= 0 ? soloIndex : null);
  }

  private updateControlEnablement(forcedIndex?: number) {
    if (this.lineup) this.lineup.controls.enabled = this.viewMode === 'lineup';
    if (this.viewMode !== 'grid') {
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
      slot.scene.remove(slot.asset.root);
      this.disposeSceneHelpers(slot.scene);
    }
    this.slots = [];
  }

  private clearLineup() {
    if (!this.lineup) return;
    this.lineup.controls.dispose();
    for (const root of this.lineup.roots) this.lineup.scene.remove(root);
    this.disposeSceneHelpers(this.lineup.scene);
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
