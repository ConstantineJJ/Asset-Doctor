import * as THREE from 'three';
import { CameraController } from './CameraController';
import { ExplodedViewController } from './ExplodedViewController';
import { LightingManager } from './LightingManager';
import { RenderModeManager } from './RenderModeManager';
import { SurfaceManager } from './SurfaceManager';
import { BoundsCalculator, AccurateBoundsResult } from './BoundsCalculator';
import type { HealthIssue, LightingConfig, LightingPreset, RenderMode, SurfaceType } from '../types';
import { measureRootMotion } from '../analysis/AnimationAnalyzer';

export interface SceneManagerCallbacks {
  onMeshSelected?: (uuid: string | null) => void;
  onAnimationTimeUpdate?: (time: number, duration: number) => void;
  onAnimationPlaybackStateChange?: (playing: boolean) => void;
  onLightingChange?: (config: LightingConfig) => void;
  onModelRotationChange?: (degrees: number) => void;
}

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public cameraController: CameraController;
  public lightingManager: LightingManager;
  public renderModeManager: RenderModeManager;
  public surfaceManager: SurfaceManager;
  public explodedViewController: ExplodedViewController;

  private container: HTMLElement;
  private currentAssetRoot: THREE.Group | null = null;
  private animationMixer: THREE.AnimationMixer | null = null;
  private activeAnimationAction: THREE.AnimationAction | null = null;
  private animationClips: THREE.AnimationClip[] = [];
  private clock: THREE.Clock;
  private isPlayingAnimation: boolean = false;
  private animationSpeed: number = 1.0;
  private animationLoop: boolean = true;

  // Model Rotation & Turntable
  private modelRotationY: number = 0;
  private isAutoRotating: boolean = false;
  private autoRotateSpeed: number = 1.0;

  // Interactive Light Dragging
  private isDraggingLight: boolean = false;
  private lightDragPlane: THREE.Plane = new THREE.Plane();

  // Helpers
  private gridHelper: THREE.GridHelper | null = null;
  private axesHelper: THREE.AxesHelper | null = null;
  private bboxHelper: THREE.Box3Helper | null = null;
  private originHelper: THREE.Group | null = null;
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private selectionBoxHelper: THREE.BoxHelper | null = null;
  private selectedBoneMarker: THREE.Mesh | null = null;
  private rootMotionHelper: THREE.Group | null = null;
  private issueOverlay: THREE.Object3D | null = null;
  private orientationWidget: HTMLDivElement | null = null;
  private orientationAxes: Record<'x' | 'y' | 'z', { line: SVGLineElement; label: SVGTextElement }> | null = null;
  private issueReturnView: {
    position: THREE.Vector3;
    target: THREE.Vector3;
    near: number;
    far: number;
  } | null = null;

  private isGridVisible: boolean = true;
  private isAxesVisible: boolean = true;
  private isBboxVisible: boolean = false;
  private isSkeletonVisible: boolean = false;
  private isSkeletonXray: boolean = false;
  private isRootMotionVisible: boolean = false;
  private isOriginVisible: boolean = true;

  private selectedMeshUuid: string | null = null;
  private callbacks: SceneManagerCallbacks = {};
  private animationFrameId: number | null = null;
  private raycaster: THREE.Raycaster;
  private mouseVector: THREE.Vector2;

  // Stats
  public fps: number = 60;
  private frameCount: number = 0;
  private lastFpsTime: number = performance.now();
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, callbacks: SceneManagerCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouseVector = new THREE.Vector2();

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x131518);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 2000);
    this.camera.position.set(3, 2.5, 4);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Ensure the canvas adapts completely to its parent container without leaving empty gaps
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    container.appendChild(this.renderer.domElement);
    this.initOrientationWidget();

    this.cameraController = new CameraController(this.camera, this.renderer.domElement);
    this.lightingManager = new LightingManager(this.scene);
    this.surfaceManager = new SurfaceManager(this.scene);
    this.renderModeManager = new RenderModeManager(this.scene);
    this.explodedViewController = new ExplodedViewController();

    this.initHelpers();
    this.bindEvents();
    this.startRenderLoop();
  }

  private initOrientationWidget() {
    const host = document.createElement('div');
    host.setAttribute('aria-label', 'Viewport orientation gizmo');
    Object.assign(host.style, {
      position: 'absolute',
      right: '10px',
      bottom: '10px',
      width: '66px',
      height: '66px',
      pointerEvents: 'none',
      zIndex: '12',
      opacity: '0.85',
      background: 'rgba(19, 21, 24, 0.58)',
      border: '1px solid rgba(75, 85, 99, 0.45)',
      borderRadius: '50%',
      backdropFilter: 'blur(2px)',
    });

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('width', '64');
    svg.setAttribute('height', '64');

    const makeAxis = (color: string, labelText: string) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '32');
      line.setAttribute('y1', '32');
      line.setAttribute('x2', '32');
      line.setAttribute('y2', '12');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');

      const label = document.createElementNS(ns, 'text');
      label.textContent = labelText;
      label.setAttribute('x', '32');
      label.setAttribute('y', '9');
      label.setAttribute('fill', color);
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'monospace');
      label.setAttribute('font-weight', '700');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');

      svg.appendChild(line);
      svg.appendChild(label);
      return { line, label };
    };

    this.orientationAxes = {
      x: makeAxis('#ef4444', 'X'),
      y: makeAxis('#22c55e', 'Y'),
      z: makeAxis('#3b82f6', 'Z'),
    };

    host.appendChild(svg);
    this.container.appendChild(host);
    this.orientationWidget = host;
  }

  private updateOrientationWidget() {
    if (!this.orientationAxes) return;

    const inverseCamera = this.camera.quaternion.clone().invert();
    const axes: Array<['x' | 'y' | 'z', THREE.Vector3]> = [
      ['x', new THREE.Vector3(1, 0, 0)],
      ['y', new THREE.Vector3(0, 1, 0)],
      ['z', new THREE.Vector3(0, 0, 1)],
    ];

    for (const [key, direction] of axes) {
      direction.applyQuaternion(inverseCamera);
      const x = 32 + direction.x * 22;
      const y = 32 - direction.y * 22;
      const opacity = String(0.45 + Math.max(0, direction.z + 1) * 0.275);
      const parts = this.orientationAxes[key];
      parts.line.setAttribute('x2', x.toFixed(2));
      parts.line.setAttribute('y2', y.toFixed(2));
      parts.line.setAttribute('opacity', opacity);
      parts.label.setAttribute('x', x.toFixed(2));
      parts.label.setAttribute('y', y.toFixed(2));
      parts.label.setAttribute('opacity', opacity);
    }
  }

  private initHelpers() {
    // Ground Grid (Blender dark style)
    this.gridHelper = new THREE.GridHelper(30, 60, 0x3b82f6, 0x272b32);
    this.gridHelper.position.y = 0;
    this.gridHelper.name = '__ascope_internal_grid';
    this.gridHelper.visible = this.isGridVisible;
    this.scene.add(this.gridHelper);

    // Axes
    this.axesHelper = new THREE.AxesHelper(2);
    this.axesHelper.name = '__ascope_internal_axes';
    this.axesHelper.visible = this.isAxesVisible;
    this.scene.add(this.axesHelper);

    // Origin Marker (small crosshair)
    this.originHelper = new THREE.Group();
    this.originHelper.name = '__ascope_internal_origin';
    const originSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
    );
    this.originHelper.add(originSphere);
    this.originHelper.visible = this.isOriginVisible;
    this.scene.add(this.originHelper);
  }

  private bindEvents() {
    this.onWindowResize = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.onWindowResize);

    // Automatically detect container size changes (e.g. collapsing/expanding scene tree or side panels)
    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.resizeObserver = new ResizeObserver(() => {
        this.onWindowResize();
      });
      this.resizeObserver.observe(this.container);
    }

    // Hover detection over light bulb gizmo
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (this.isDraggingLight) return;
      if (!this.lightingManager.getLightBulbVisible()) return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouseVector, this.camera);

      const bulbHits = this.raycaster.intersectObject(this.lightingManager.getBulbMesh(), false);
      const isHovered = bulbHits.length > 0;
      this.lightingManager.setBulbHovered(isHovered);
      if (isHovered) {
        this.renderer.domElement.style.cursor = 'grab';
      } else if (this.renderer.domElement.style.cursor === 'grab') {
        this.renderer.domElement.style.cursor = '';
      }
    });

    // Viewport click selection & light bulb drag
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouseVector, this.camera);

      // Check if light bulb is clicked for dragging
      if (this.lightingManager.getLightBulbVisible()) {
        const bulbHits = this.raycaster.intersectObject(this.lightingManager.getBulbMesh(), false);
        if (bulbHits.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          this.isDraggingLight = true;
          this.cameraController.controls.enabled = false;
          this.renderer.domElement.style.cursor = 'grabbing';

          // Set drag plane facing camera at the current bulb position
          const camDir = new THREE.Vector3();
          this.camera.getWorldDirection(camDir).negate();
          const bulbPos = this.lightingManager.getKeyLight().position.clone();
          this.lightDragPlane.setFromNormalAndCoplanarPoint(camDir, bulbPos);

          const onLightMove = (moveEvt: PointerEvent) => {
            const mRect = this.renderer.domElement.getBoundingClientRect();
            const mx = ((moveEvt.clientX - mRect.left) / mRect.width) * 2 - 1;
            const my = -((moveEvt.clientY - mRect.top) / mRect.height) * 2 + 1;
            this.raycaster.setFromCamera(new THREE.Vector2(mx, my), this.camera);

            const hitPoint = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(this.lightDragPlane, hitPoint)) {
              // Ensure height stays above surface
              hitPoint.y = Math.max(0.5, hitPoint.y);
              this.lightingManager.setKeyLightPosition(hitPoint.x, hitPoint.y, hitPoint.z);
              this.callbacks.onLightingChange?.(this.lightingManager.getConfig());
            }
          };

          const onLightUp = () => {
            this.isDraggingLight = false;
            this.cameraController.controls.enabled = true;
            this.renderer.domElement.style.cursor = '';
            this.lightingManager.setBulbHovered(false);
            window.removeEventListener('pointermove', onLightMove);
            window.removeEventListener('pointerup', onLightUp);
          };

          window.addEventListener('pointermove', onLightMove);
          window.addEventListener('pointerup', onLightUp);
          return;
        }
      }

      // Only select on left click without heavy dragging
      const startX = e.clientX;
      const startY = e.clientY;

      const onPointerUp = (upEvt: PointerEvent) => {
        window.removeEventListener('pointerup', onPointerUp);
        const dist = Math.hypot(upEvt.clientX - startX, upEvt.clientY - startY);
        if (dist < 4) {
          this.handleViewportClick(upEvt);
        }
      };
      window.addEventListener('pointerup', onPointerUp);
    });
  }

  private handleViewportClick(e: PointerEvent) {
    if (!this.currentAssetRoot) return;

    const rect = this.renderer.domElement.getBoundingClientRect();

    // SkeletonHelper is a viewport helper outside the asset hierarchy, so Three.js
    // mesh raycasting cannot select bones directly. Pick the rendered bone segments
    // in screen space before falling back to mesh raycasting.
    const boneHit = this.pickBoneAtPointer(e, rect);
    if (boneHit) {
      this.selectObject(boneHit.uuid);
      return;
    }

    this.mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouseVector, this.camera);
    const intersects = this.raycaster.intersectObjects(this.currentAssetRoot.children, true);

    const validHit = intersects.find(
      (hit) => !hit.object.name?.startsWith('__ascope_internal_') && (hit.object as THREE.Mesh).isMesh
    );

    if (validHit) {
      this.selectObject(validHit.object.uuid);
    } else {
      this.selectObject(null);
    }
  }

  private projectWorldToCanvas(
    world: THREE.Vector3,
    rect: DOMRect
  ): { point: THREE.Vector2; depth: number } | null {
    const projected = world.clone().project(this.camera);
    if (![projected.x, projected.y, projected.z].every(Number.isFinite)) return null;
    if (projected.z < -1 || projected.z > 1) return null;

    return {
      point: new THREE.Vector2(
        rect.left + (projected.x + 1) * 0.5 * rect.width,
        rect.top + (1 - projected.y) * 0.5 * rect.height
      ),
      depth: projected.z,
    };
  }

  private pointToSegmentDistance2D(
    point: THREE.Vector2,
    a: THREE.Vector2,
    b: THREE.Vector2
  ): number {
    const ab = b.clone().sub(a);
    const lengthSq = ab.lengthSq();
    if (lengthSq <= 1e-9) return point.distanceTo(a);

    const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1);
    return point.distanceTo(a.clone().add(ab.multiplyScalar(t)));
  }

  private pickBoneAtPointer(e: PointerEvent, rect: DOMRect): THREE.Bone | null {
    if (!this.currentAssetRoot || !this.isSkeletonVisible) return null;

    this.currentAssetRoot.updateMatrixWorld(true);
    const pointer = new THREE.Vector2(e.clientX, e.clientY);
    const thresholdPx = 11;
    let bestBone: THREE.Bone | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestDepth = Number.POSITIVE_INFINITY;

    this.currentAssetRoot.traverse((object) => {
      if (!(object as THREE.Bone).isBone) return;
      const bone = object as THREE.Bone;

      const childWorld = new THREE.Vector3();
      bone.getWorldPosition(childWorld);
      const childScreen = this.projectWorldToCanvas(childWorld, rect);
      if (!childScreen) return;

      const parentBone =
        bone.parent && (bone.parent as THREE.Bone).isBone ? (bone.parent as THREE.Bone) : null;

      let distance = pointer.distanceTo(childScreen.point);
      let depth = childScreen.depth;

      if (parentBone) {
        const parentWorld = new THREE.Vector3();
        parentBone.getWorldPosition(parentWorld);
        const parentScreen = this.projectWorldToCanvas(parentWorld, rect);
        if (parentScreen) {
          distance = this.pointToSegmentDistance2D(pointer, parentScreen.point, childScreen.point);
          depth = Math.min(parentScreen.depth, childScreen.depth);
        }
      }

      if (
        distance <= thresholdPx &&
        (distance < bestDistance - 0.25 ||
          (Math.abs(distance - bestDistance) <= 0.25 && depth < bestDepth))
      ) {
        bestDistance = distance;
        bestDepth = depth;
        bestBone = bone;
      }
    });

    return bestBone;
  }

  public lastMeshDiagnostics: Array<Record<string, any>> = [];
  public lastWholeModelInspection: Record<string, any> = {};

  public setAsset(assetRoot: THREE.Group, clips: THREE.AnimationClip[] = []) {
    // 1. Cleanly dispose previous asset
    this.disposeCurrentAsset();
    this.clearIssueLocalization();

    this.currentAssetRoot = assetRoot;
    this.scene.add(this.currentAssetRoot);

    // Ensure root and children are visible, on default layer, with updated matrices
    assetRoot.visible = true;
    assetRoot.layers.set(0);
    assetRoot.frustumCulled = false;
    assetRoot.updateMatrixWorld(true);

    const meshDiagnostics: Array<Record<string, any>> = [];

    // Instrument and verify all loaded meshes & skinned meshes
    assetRoot.traverse((obj) => {
      // Diagnostic verification: ensure no parent or child is accidentally hidden or frustum-culled
      obj.visible = true;
      obj.layers.set(0);
      obj.frustumCulled = false;

      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const isSkinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;

        // Ensure materials are visible, two-sided, non-zero opacity, and depth-writing
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m) {
            m.visible = true;
            m.side = THREE.DoubleSide;
            if (m.opacity < 0.05) m.opacity = 1.0;
            m.depthWrite = true;
          }
        }

        // Ensure skeleton matrices are up-to-date
        if (isSkinned) {
          const sm = mesh as THREE.SkinnedMesh;
          sm.frustumCulled = false;
          if (sm.skeleton) {
            if (!sm.skeleton.boneInverses || sm.skeleton.boneInverses.length === 0) {
              sm.skeleton.calculateInverses();
            }
            sm.updateWorldMatrix(true, true);
            for (let i = 0; i < sm.skeleton.bones.length; i++) {
              if (sm.skeleton.bones[i]) {
                sm.skeleton.bones[i].updateWorldMatrix(true, false);
              }
            }
            sm.skeleton.update();
          }
          // Compute and fix bounding sphere for frustum culling
          const skinnedBox = BoundsCalculator.computeSkinnedMeshWorldBounds(sm);
          BoundsCalculator.fixSkinnedMeshFrustumSphere(sm, skinnedBox);
        } else {
          if (mesh.geometry) {
            mesh.geometry.computeBoundingBox();
            mesh.geometry.computeBoundingSphere();
          }
        }

        // Register with render mode manager
        this.renderModeManager.registerMesh(mesh);

        // Collect exact requested debug instrumentation
        const geom = mesh.geometry;
        const mat = mesh.material;
        const matArray = Array.isArray(mat) ? mat : [mat];

        meshDiagnostics.push({
          name: mesh.name || 'unnamed_mesh',
          type: mesh.type,
          visible: mesh.visible,
          matrixWorld: Array.from(mesh.matrixWorld.elements),
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
          geometryVertexCount: geom?.attributes.position ? geom.attributes.position.count : 0,
          materialExistence: Boolean(mat),
          materialVisible: matArray.every((m) => m && m.visible),
          frustumCulled: mesh.frustumCulled,
          boundingBox: geom?.boundingBox
            ? {
                min: [geom.boundingBox.min.x, geom.boundingBox.min.y, geom.boundingBox.min.z],
                max: [geom.boundingBox.max.x, geom.boundingBox.max.y, geom.boundingBox.max.z],
              }
            : null,
          boundingSphere: geom?.boundingSphere
            ? {
                center: [geom.boundingSphere.center.x, geom.boundingSphere.center.y, geom.boundingSphere.center.z],
                radius: geom.boundingSphere.radius,
              }
            : null,
        });
      }
    });

    this.lastMeshDiagnostics = meshDiagnostics;
    console.log('[AssetDoctor Loaded Meshes Instrumentation]', meshDiagnostics);

    // 2. Exploded view controller registration
    this.explodedViewController.registerAsset(assetRoot);

    // 3. Ground alignment: deterministic sequence:
    // load -> initialize matrices -> calculate bounds -> apply alignment -> update matrices -> recalculate bounds -> frame camera
    assetRoot.updateMatrixWorld(true);
    const initialBounds = BoundsCalculator.computeAccurateWorldBounds(assetRoot);

    if (initialBounds.isValid) {
      const minY = initialBounds.box.min.y;
      // Only align if base is offset from 0 and within sensible limits (< 50,000)
      if (Math.abs(minY) > 0.001 && Math.abs(minY) < 50000) {
        assetRoot.position.y -= minY;
      }
    } else {
      console.warn('[AssetDoctor GroundAlignment] Initial bounds invalid or extreme, skipping ground shift:', initialBounds.warning);
    }

    // Update matrices again after alignment
    assetRoot.updateMatrixWorld(true);
    assetRoot.traverse((obj) => {
      obj.frustumCulled = false;
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = obj as THREE.SkinnedMesh;
        sm.frustumCulled = false;
        if (sm.skeleton) {
          sm.updateWorldMatrix(true, true);
          for (let i = 0; i < sm.skeleton.bones.length; i++) {
            if (sm.skeleton.bones[i]) sm.skeleton.bones[i].updateWorldMatrix(true, false);
          }
          sm.skeleton.update();
        }
      }
    });

    // Recalculate final bounds
    const finalBounds = BoundsCalculator.computeAccurateWorldBounds(assetRoot);

    // Recreate bounding box helper with final bounds
    if (!finalBounds.box.isEmpty()) {
      this.bboxHelper = new THREE.Box3Helper(finalBounds.box, new THREE.Color(0xf59e0b));
      this.bboxHelper.name = '__ascope_internal_bbox';
      this.bboxHelper.visible = this.isBboxVisible;
      this.bboxHelper.frustumCulled = false;
      this.scene.add(this.bboxHelper);

      if (this.gridHelper) {
        const size = finalBounds.box.getSize(new THREE.Vector3()).length();
        const gridScale = Math.max(1, Math.ceil(size / 15));
        this.gridHelper.scale.set(gridScale, 1, gridScale);
      }

      this.surfaceManager.setGroundHeight(finalBounds.box.min.y);
      this.modelRotationY = 0;
      this.callbacks.onModelRotationChange?.(0);
    }

    // 4. Skeleton Helper
    this.skeletonHelper = new THREE.SkeletonHelper(assetRoot);
    this.skeletonHelper.name = '__ascope_internal_skeleton';
    this.skeletonHelper.visible = this.isSkeletonVisible;
    this.skeletonHelper.frustumCulled = false;
    this.applySkeletonXrayMaterial();
    this.scene.add(this.skeletonHelper);

    // 5. Animations setup
    this.animationClips = clips;
    if (clips.length > 0) {
      this.animationMixer = new THREE.AnimationMixer(assetRoot);
      this.animationMixer.addEventListener('finished', () => {
        if (this.animationLoop) return;
        this.isPlayingAnimation = false;
        this.callbacks.onAnimationPlaybackStateChange?.(false);
        const duration = this.activeAnimationAction?.getClip().duration ?? 0;
        this.callbacks.onAnimationTimeUpdate?.(duration, duration);
      });
      this.playAnimationClip(0);
    }

    // 6. Camera auto-frame using FINAL bounds
    const frameResult = this.cameraController.frameObject(assetRoot, 1.4);

    // Reapply current render mode
    this.renderModeManager.applyMode(this.renderModeManager.getMode(), assetRoot);

    // Overall Asset Inspection Log
    const rootPos = assetRoot.position;
    const rootRot = assetRoot.rotation;
    const rootScale = assetRoot.scale;
    const center = frameResult.sphere.center;
    const camPos = this.camera.position;

    this.lastWholeModelInspection = {
      rootPosition: [rootPos.x, rootPos.y, rootPos.z],
      rootRotation: [rootRot.x, rootRot.y, rootRot.z],
      rootScale: [rootScale.x, rootScale.y, rootScale.z],
      calculatedWholeModelBox3Min: [finalBounds.box.min.x, finalBounds.box.min.y, finalBounds.box.min.z],
      calculatedWholeModelBox3Max: [finalBounds.box.max.x, finalBounds.box.max.y, finalBounds.box.max.z],
      boundingSphereCenter: [finalBounds.sphere.center.x, finalBounds.sphere.center.y, finalBounds.sphere.center.z],
      boundingSphereRadius: finalBounds.sphere.radius,
      cameraPosition: [camPos.x, camPos.y, camPos.z],
      cameraTarget: [this.cameraController.controls.target.x, this.cameraController.controls.target.y, this.cameraController.controls.target.z],
      cameraNear: this.camera.near,
      cameraFar: this.camera.far,
      distanceCameraToModelCenter: camPos.distanceTo(center),
      diagnostics: finalBounds.diagnostics,
    };

    console.log('[AssetDoctor Whole-Model Inspection]', this.lastWholeModelInspection);
  }

  public playAnimationClip(clipIndex: number): boolean {
    if (
      !this.animationMixer ||
      !Number.isInteger(clipIndex) ||
      clipIndex < 0 ||
      clipIndex >= this.animationClips.length
    ) {
      return false;
    }

    if (this.activeAnimationAction) {
      this.activeAnimationAction.stop();
    }

    const clip = this.animationClips[clipIndex];
    const action = this.animationMixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.clampWhenFinished = !this.animationLoop;
    action.setLoop(this.animationLoop ? THREE.LoopRepeat : THREE.LoopOnce, this.animationLoop ? Infinity : 1);
    action.setEffectiveTimeScale(this.animationSpeed);
    action.play();

    this.activeAnimationAction = action;
    this.animationMixer.setTime(0);
    this.animationMixer.update(0);
    this.isPlayingAnimation = true;

    this.updateRootMotionHelper(clip);
    this.callbacks.onAnimationTimeUpdate?.(0, clip.duration);
    this.callbacks.onAnimationPlaybackStateChange?.(true);
    return true;
  }

  public toggleAnimationPlay(play?: boolean) {
    if (!this.activeAnimationAction) return;

    const shouldPlay = play !== undefined ? play : !this.isPlayingAnimation;
    const duration = this.activeAnimationAction.getClip().duration;

    if (shouldPlay && !this.animationLoop && this.activeAnimationAction.time >= duration - 1e-6) {
      this.activeAnimationAction.reset();
      this.animationMixer?.setTime(0);
      this.animationMixer?.update(0);
      this.callbacks.onAnimationTimeUpdate?.(0, duration);
    }

    this.isPlayingAnimation = shouldPlay;
    if (shouldPlay) this.activeAnimationAction.play();
    this.activeAnimationAction.paused = !shouldPlay;
    this.callbacks.onAnimationPlaybackStateChange?.(shouldPlay);
  }

  public stopAnimation() {
    this.isPlayingAnimation = false;
    const duration = this.activeAnimationAction?.getClip().duration ?? 0;

    if (this.activeAnimationAction) {
      this.activeAnimationAction.stop();
      this.activeAnimationAction.reset();
    }
    if (this.animationMixer) {
      this.animationMixer.setTime(0);
    }

    // Stop means "return to the authored rest/bind pose", not merely freeze at t=0.
    const posedSkeletons = new Set<THREE.Skeleton>();
    this.currentAssetRoot?.traverse((object) => {
      if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
      const skeleton = (object as THREE.SkinnedMesh).skeleton;
      if (!skeleton || posedSkeletons.has(skeleton)) return;
      skeleton.pose();
      skeleton.update();
      posedSkeletons.add(skeleton);
    });
    this.currentAssetRoot?.updateMatrixWorld(true);

    this.callbacks.onAnimationTimeUpdate?.(0, duration);
    this.callbacks.onAnimationPlaybackStateChange?.(false);
  }

  public seekAnimation(normalizedTime: number) {
    if (!this.activeAnimationAction || !this.animationMixer) return;
    const duration = this.activeAnimationAction.getClip().duration;
    const targetTime = THREE.MathUtils.clamp(normalizedTime, 0, 1) * duration;

    // Scrubbing must work identically while playing or paused. Updating the
    // action's local time and forcing a zero-delta mixer evaluation avoids the
    // paused-action / global-mixer-time desynchronization that previously made
    // the range slider snap back after pause/resume.
    const wasPaused = this.activeAnimationAction.paused;
    this.activeAnimationAction.paused = false;
    this.activeAnimationAction.time = targetTime;
    this.animationMixer.update(0);
    this.activeAnimationAction.paused = wasPaused;

    this.callbacks.onAnimationTimeUpdate?.(targetTime, duration);
  }

  public stepAnimationFrame(stepSeconds: number = 1 / 30) {
    if (!this.activeAnimationAction || !this.animationMixer) return;
    this.isPlayingAnimation = false;
    const duration = this.activeAnimationAction.getClip().duration;
    let newTime = this.activeAnimationAction.time + stepSeconds;

    if (this.animationLoop) {
      if (newTime > duration) newTime = 0;
      if (newTime < 0) newTime = duration;
    } else {
      newTime = THREE.MathUtils.clamp(newTime, 0, duration);
    }

    this.activeAnimationAction.paused = false;
    this.activeAnimationAction.time = newTime;
    this.animationMixer.update(0);
    this.activeAnimationAction.paused = true;

    this.callbacks.onAnimationTimeUpdate?.(newTime, duration);
    this.callbacks.onAnimationPlaybackStateChange?.(false);
  }

  public setAnimationSpeed(speed: number) {
    this.animationSpeed = speed;
    if (this.activeAnimationAction) {
      this.activeAnimationAction.timeScale = speed;
    }
  }

  public setAnimationLoop(loop: boolean) {
    this.animationLoop = loop;
    if (this.activeAnimationAction) {
      this.activeAnimationAction.clampWhenFinished = !loop;
      this.activeAnimationAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    }
  }

  public setRootMotionVisible(visible: boolean) {
    this.isRootMotionVisible = visible;
    if (!visible) {
      this.clearRootMotionHelper();
      return;
    }

    const clip = this.activeAnimationAction?.getClip();
    if (clip) this.updateRootMotionHelper(clip);
  }

  private getRootBoneNames(): string[] {
    if (!this.currentAssetRoot) return [];
    const names: string[] = [];
    this.currentAssetRoot.traverse((object) => {
      if (!(object as THREE.Bone).isBone) return;
      if (!object.parent || !(object.parent as THREE.Bone).isBone) {
        names.push(object.name);
      }
    });
    return names.filter(Boolean);
  }

  private resolveRootMotionTarget(trackName?: string): THREE.Object3D | null {
    if (!trackName || !this.currentAssetRoot) return null;

    try {
      const parsed = THREE.PropertyBinding.parseTrackName(trackName);
      if (parsed.objectName === 'bones' && parsed.objectIndex !== undefined) {
        const boneName = String(parsed.objectIndex);
        let match: THREE.Bone | null = null;
        this.currentAssetRoot.traverse((object) => {
          if (!match && (object as THREE.Bone).isBone && object.name === boneName) {
            match = object as THREE.Bone;
          }
        });
        if (match) return match;
      }

      if (parsed.nodeName) {
        const found = THREE.PropertyBinding.findNode(this.currentAssetRoot, parsed.nodeName);
        return found && (found as THREE.Object3D).isObject3D ? (found as THREE.Object3D) : null;
      }
    } catch {
      // Root-motion visualization is advisory; unresolved bindings simply fall back to asset root.
    }

    return null;
  }

  private clearRootMotionHelper() {
    if (!this.rootMotionHelper) return;
    this.scene.remove(this.rootMotionHelper);
    this.rootMotionHelper.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      renderable.geometry?.dispose();
      if (Array.isArray(renderable.material)) {
        renderable.material.forEach((material) => material.dispose());
      } else {
        renderable.material?.dispose();
      }
    });
    this.rootMotionHelper = null;
  }

  private updateRootMotionHelper(clip: THREE.AnimationClip) {
    this.clearRootMotionHelper();
    if (!this.isRootMotionVisible || !this.currentAssetRoot) return;

    const measurement = measureRootMotion(clip, this.getRootBoneNames());
    if (!measurement.detected || measurement.translation <= 0) return;

    this.currentAssetRoot.updateMatrixWorld(true);
    const target = this.resolveRootMotionTarget(measurement.translationTrackName);
    const origin = new THREE.Vector3();
    (target ?? this.currentAssetRoot).getWorldPosition(origin);

    const localDelta = new THREE.Vector3(...measurement.delta);
    const parentMatrix = target?.parent?.matrixWorld ?? this.currentAssetRoot.matrixWorld;
    const worldDelta = localDelta.applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentMatrix));
    const length = worldDelta.length();
    if (!Number.isFinite(length) || length <= 1e-6) return;

    const direction = worldDelta.clone().normalize();
    const assetDiagonal = Math.max(this.getAssetDiagonal(), length);
    const headLength = Math.min(length * 0.25, assetDiagonal * 0.04);
    const headWidth = Math.min(length * 0.12, assetDiagonal * 0.018);

    const helper = new THREE.Group();
    helper.name = '__ascope_internal_root_motion';

    const arrow = new THREE.ArrowHelper(
      direction,
      origin,
      length,
      0xa855f7,
      Math.max(headLength, assetDiagonal * 0.008),
      Math.max(headWidth, assetDiagonal * 0.004)
    );
    arrow.name = '__ascope_internal_root_motion_arrow';
    arrow.renderOrder = 998;
    const arrowLineMaterial = arrow.line.material as THREE.LineBasicMaterial;
    arrowLineMaterial.depthTest = false;
    arrowLineMaterial.depthWrite = false;
    arrowLineMaterial.transparent = true;
    arrowLineMaterial.opacity = 0.95;
    const arrowConeMaterial = arrow.cone.material as THREE.MeshBasicMaterial;
    arrowConeMaterial.depthTest = false;
    arrowConeMaterial.depthWrite = false;
    arrowConeMaterial.transparent = true;
    arrowConeMaterial.opacity = 0.95;

    const markerRadius = Math.max(assetDiagonal * 0.006, length * 0.025);
    const startMarker = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xc084fc,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      })
    );
    startMarker.position.copy(origin);
    startMarker.renderOrder = 999;

    const endMarker = startMarker.clone();
    endMarker.material = (startMarker.material as THREE.MeshBasicMaterial).clone();
    endMarker.position.copy(origin).add(worldDelta);

    helper.add(arrow, startMarker, endMarker);
    this.rootMotionHelper = helper;
    this.scene.add(helper);
  }

  public selectObject(uuid: string | null) {
    this.selectedMeshUuid = uuid;

    this.clearIssueLocalization();

    if (this.selectionBoxHelper) {
      this.scene.remove(this.selectionBoxHelper);
      this.selectionBoxHelper.dispose();
      this.selectionBoxHelper = null;
    }
    if (this.selectedBoneMarker) {
      this.scene.remove(this.selectedBoneMarker);
      this.selectedBoneMarker.geometry.dispose();
      (this.selectedBoneMarker.material as THREE.Material).dispose();
      this.selectedBoneMarker = null;
    }

    if (uuid && this.currentAssetRoot) {
      const obj = this.currentAssetRoot.getObjectByProperty('uuid', uuid);
      if (obj) {
        if ((obj as THREE.Bone).isBone) {
          const bone = obj as THREE.Bone;
          const worldPosition = new THREE.Vector3();
          bone.getWorldPosition(worldPosition);
          const markerRadius = this.getBoneMarkerRadius(bone);
          this.selectedBoneMarker = new THREE.Mesh(
            new THREE.SphereGeometry(markerRadius, 14, 10),
            new THREE.MeshBasicMaterial({
              color: 0x22d3ee,
              depthTest: !this.isSkeletonXray,
              depthWrite: false,
              transparent: true,
              opacity: 0.95,
            })
          );
          this.selectedBoneMarker.name = '__ascope_internal_bone_selection';
          this.selectedBoneMarker.position.copy(worldPosition);
          this.selectedBoneMarker.renderOrder = 1000;
          this.scene.add(this.selectedBoneMarker);
        } else {
          this.selectionBoxHelper = new THREE.BoxHelper(obj, 0x00f0ff);
          this.selectionBoxHelper.name = '__ascope_internal_selection';
          this.scene.add(this.selectionBoxHelper);
        }
      }
    }

    if (this.callbacks.onMeshSelected) {
      this.callbacks.onMeshSelected(uuid);
    }
  }

  private getAssetDiagonal(): number {
    if (!this.currentAssetRoot) return 0;
    const bounds = BoundsCalculator.computeAccurateWorldBounds(this.currentAssetRoot);
    if (!bounds.isValid || bounds.box.isEmpty()) return 0;
    return bounds.box.getSize(new THREE.Vector3()).length();
  }

  private getBoneSpan(bone: THREE.Bone): number {
    const origin = new THREE.Vector3();
    bone.getWorldPosition(origin);
    const distances: number[] = [];

    if (bone.parent && (bone.parent as THREE.Bone).isBone) {
      const parentPosition = new THREE.Vector3();
      bone.parent.getWorldPosition(parentPosition);
      distances.push(origin.distanceTo(parentPosition));
    }

    for (const child of bone.children) {
      if (!(child as THREE.Bone).isBone) continue;
      const childPosition = new THREE.Vector3();
      child.getWorldPosition(childPosition);
      distances.push(origin.distanceTo(childPosition));
    }

    return distances.length > 0 ? Math.max(...distances) : 0;
  }

  private getBoneMarkerRadius(bone: THREE.Bone): number {
    const assetDiagonal = this.getAssetDiagonal();
    const span = this.getBoneSpan(bone);
    return Math.max(assetDiagonal * 0.0045, span * 0.075, 0.003);
  }

  private getBoneFocusDistance(bone: THREE.Bone): number {
    const assetDiagonal = this.getAssetDiagonal();
    const span = this.getBoneSpan(bone);
    const relativeFloor = assetDiagonal > 0 ? assetDiagonal * 0.10 : 0.15;
    return Math.max(span * 3.5, relativeFloor, 0.05);
  }

  private updateSelectedBoneMarker() {
    if (!this.selectedBoneMarker || !this.selectedMeshUuid || !this.currentAssetRoot) return;
    const object = this.currentAssetRoot.getObjectByProperty('uuid', this.selectedMeshUuid);
    if (!object || !(object as THREE.Bone).isBone) return;

    const worldPosition = new THREE.Vector3();
    object.getWorldPosition(worldPosition);
    this.selectedBoneMarker.position.copy(worldPosition);
  }

  public clearIssueLocalization() {
    if (this.issueOverlay) {
      this.scene.remove(this.issueOverlay);
      this.issueOverlay.traverse((obj) => {
        const renderable = obj as THREE.LineSegments & {
          geometry?: THREE.BufferGeometry;
          material?: THREE.Material | THREE.Material[];
        };
        renderable.geometry?.dispose();
        if (Array.isArray(renderable.material)) {
          renderable.material.forEach((entry) => entry.dispose());
        } else {
          renderable.material?.dispose();
        }
      });
      this.issueOverlay = null;
    }
  }

  private getCurrentVertexWorld(mesh: THREE.Mesh, vertexIndex: number): THREE.Vector3 | null {
    const position = mesh.geometry?.attributes?.position;
    if (!position || vertexIndex < 0 || vertexIndex >= position.count) return null;

    const point = new THREE.Vector3();

    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = mesh as THREE.SkinnedMesh;
      skinned.updateMatrixWorld(true);
      skinned.skeleton?.update();
      skinned.getVertexPosition(vertexIndex, point);
    } else {
      point.fromBufferAttribute(position as THREE.BufferAttribute, vertexIndex);
    }

    return point.applyMatrix4(mesh.matrixWorld);
  }

  private getTriangleVertexIndices(mesh: THREE.Mesh, triangleIndex: number): [number, number, number] | null {
    const geometry = mesh.geometry;
    if (!geometry?.attributes?.position || triangleIndex < 0) return null;

    const base = triangleIndex * 3;
    if (geometry.index) {
      if (base + 2 >= geometry.index.count) return null;
      return [
        geometry.index.getX(base),
        geometry.index.getX(base + 1),
        geometry.index.getX(base + 2),
      ];
    }

    if (base + 2 >= geometry.attributes.position.count) return null;
    return [base, base + 1, base + 2];
  }

  private getPrimaryIssueFocus(mesh: THREE.Mesh, issue: HealthIssue): THREE.Vector3 | null {
    const indices = issue.affectedIndices ?? [];
    if (indices.length === 0 || !issue.affectedElement) return null;

    const points: THREE.Vector3[] = [];
    if (issue.affectedElement === 'triangle') {
      const triangle = this.getTriangleVertexIndices(mesh, indices[0]);
      if (triangle) {
        for (const vertexIndex of triangle) {
          const point = this.getCurrentVertexWorld(mesh, vertexIndex);
          if (point) points.push(point);
        }
      }
    } else {
      const limit = issue.affectedElement === 'edge' ? 2 : 64;
      for (const vertexIndex of indices.slice(0, limit)) {
        const point = this.getCurrentVertexWorld(mesh, vertexIndex);
        if (point) points.push(point);
      }
    }

    if (points.length === 0) return null;
    const center = new THREE.Vector3();
    points.forEach((point) => center.add(point));
    return center.multiplyScalar(1 / points.length);
  }

  private getSemanticIssueTargets(mesh: THREE.Mesh, issue: HealthIssue) {
    const targets: Array<{
      affectedElement: NonNullable<HealthIssue['affectedElement']>;
      affectedIndices: number[];
    }> = [];

    const seen = new Set<string>();
    const pushTarget = (
      element: HealthIssue['affectedElement'],
      indices: number[] | undefined
    ) => {
      if (!element || !indices || indices.length === 0) return;
      const key = `${element}:${indices.join(',')}`;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push({ affectedElement: element, affectedIndices: indices });
    };

    // Keep the currently selected diagnostic location first so navigation arrows
    // retain a deterministic primary focus, then render the rest of the sampled
    // semantic region on the same mesh.
    pushTarget(issue.affectedElement, issue.affectedIndices);
    for (const location of issue.locations ?? []) {
      if (location.meshUuid !== mesh.uuid) continue;
      pushTarget(location.affectedElement, location.affectedIndices);
      if (targets.length >= 64) break;
    }

    return targets;
  }

  private buildIssueOverlay(
    mesh: THREE.Mesh,
    issue: HealthIssue
  ): { center: THREE.Vector3; radius: number } | null {
    const targets = this.getSemanticIssueTargets(mesh, issue);
    if (targets.length === 0) return null;

    const overlayGroup = new THREE.Group();
    overlayGroup.name = '__ascope_internal_issue_overlay';
    overlayGroup.renderOrder = 9999;

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffb020,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });

    const pointsMaterial = new THREE.PointsMaterial({
      color: 0xffb020,
      size: 8,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });

    const faceMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb020,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
    });

    const regionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb020,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });

    const currentPoints: THREE.Vector3[] = [];

    for (const target of targets) {
      const indices = target.affectedIndices;

      if (target.affectedElement === 'triangle') {
        for (const triangleIndex of indices.slice(0, 64)) {
          const triangle = this.getTriangleVertexIndices(mesh, triangleIndex);
          if (!triangle) continue;

          const trianglePoints: THREE.Vector3[] = [];
          for (const vertexIndex of triangle) {
            const point = this.getCurrentVertexWorld(mesh, vertexIndex);
            if (point) {
              trianglePoints.push(point);
              currentPoints.push(point);
            }
          }

          if (trianglePoints.length === 3) {
            const [a, b, c] = trianglePoints;
            const faceGeometry = new THREE.BufferGeometry().setFromPoints([a, b, c]);
            faceGeometry.setIndex([0, 1, 2]);
            const face = new THREE.Mesh(faceGeometry, faceMaterial);
            face.renderOrder = 9998;
            overlayGroup.add(face);

            const edgeGeometry = new THREE.BufferGeometry().setFromPoints([a, b, b, c, c, a]);
            const edgeOverlay = new THREE.LineSegments(edgeGeometry, lineMaterial);
            edgeOverlay.renderOrder = 9999;
            overlayGroup.add(edgeOverlay);
          }
        }
        continue;
      }

      if (target.affectedElement === 'edge') {
        const edgePoints: THREE.Vector3[] = [];
        for (const vertexIndex of indices.slice(0, 2)) {
          const point = this.getCurrentVertexWorld(mesh, vertexIndex);
          if (point) {
            edgePoints.push(point);
            currentPoints.push(point);
          }
        }
        if (edgePoints.length === 2) {
          const geometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
          const overlay = new THREE.LineSegments(geometry, lineMaterial);
          overlay.renderOrder = 9999;
          overlayGroup.add(overlay);
        }
        continue;
      }

      const targetPoints: THREE.Vector3[] = [];
      for (const vertexIndex of indices.slice(0, 64)) {
        const point = this.getCurrentVertexWorld(mesh, vertexIndex);
        if (point) {
          targetPoints.push(point);
          currentPoints.push(point);
        }
      }

      if (targetPoints.length === 0) continue;

      const pointGeometry = new THREE.BufferGeometry().setFromPoints(targetPoints);
      const points = new THREE.Points(pointGeometry, pointsMaterial);
      points.renderOrder = 9999;
      overlayGroup.add(points);

      if (target.affectedElement === 'component') {
        const box = new THREE.Box3().setFromPoints(targetPoints);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const minThickness = Math.max(size.length() * 0.025, 0.002);
        size.set(
          Math.max(size.x, minThickness),
          Math.max(size.y, minThickness),
          Math.max(size.z, minThickness)
        );
        const zoneGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        const zone = new THREE.Mesh(zoneGeometry, regionMaterial);
        zone.position.copy(center);
        zone.renderOrder = 9997;
        overlayGroup.add(zone);
      }
    }

    if (overlayGroup.children.length === 0) {
      lineMaterial.dispose();
      pointsMaterial.dispose();
      faceMaterial.dispose();
      regionMaterial.dispose();
      return null;
    }

    const hasLines = overlayGroup.children.some((child) => child instanceof THREE.LineSegments);
    const hasPoints = overlayGroup.children.some((child) => child instanceof THREE.Points);
    const hasFaces = overlayGroup.children.some(
      (child) => child instanceof THREE.Mesh && child.material === faceMaterial
    );
    const hasRegions = overlayGroup.children.some(
      (child) => child instanceof THREE.Mesh && child.material === regionMaterial
    );
    if (!hasLines) lineMaterial.dispose();
    if (!hasPoints) pointsMaterial.dispose();
    if (!hasFaces) faceMaterial.dispose();
    if (!hasRegions) regionMaterial.dispose();

    this.issueOverlay = overlayGroup;
    this.scene.add(overlayGroup);

    if (currentPoints.length === 0) return null;
    const sphere = new THREE.Sphere();
    new THREE.Box3().setFromPoints(currentPoints).getBoundingSphere(sphere);
    return { center: sphere.center, radius: sphere.radius };
  }

  private captureIssueReturnView() {
    if (this.issueReturnView) return;
    this.issueReturnView = {
      position: this.camera.position.clone(),
      target: this.cameraController.controls.target.clone(),
      near: this.camera.near,
      far: this.camera.far,
    };
  }

  public restoreIssueView() {
    if (!this.issueReturnView) {
      this.clearIssueLocalization();
      return;
    }

    this.clearIssueLocalization();
    this.camera.position.copy(this.issueReturnView.position);
    this.camera.near = this.issueReturnView.near;
    this.camera.far = this.issueReturnView.far;
    this.cameraController.controls.target.copy(this.issueReturnView.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.cameraController.controls.update();
    this.issueReturnView = null;
  }

  public cancelIssueInspection() {
    this.clearIssueLocalization();
    this.issueReturnView = null;
  }

  public localizeIssue(issue: HealthIssue) {
    this.captureIssueReturnView();
    this.clearIssueLocalization();

    let targetObject: THREE.Object3D | null = null;
    if (issue.meshUuid && this.currentAssetRoot) {
      targetObject = this.currentAssetRoot.getObjectByProperty('uuid', issue.meshUuid) ?? null;
      if (targetObject) {
        this.selectObject(issue.meshUuid);
      }
    }

    const targetMesh = targetObject && (targetObject as THREE.Mesh).isMesh
      ? (targetObject as THREE.Mesh)
      : null;

    // Recalculate the selected location from the currently rendered mesh, while
    // visualizing the whole sampled semantic region for this issue on the mesh.
    // This preserves precise navigation without reducing a multi-face problem to
    // a single highlighted triangle.
    const primaryFocus = targetMesh ? this.getPrimaryIssueFocus(targetMesh, issue) : null;
    const overlay = targetMesh ? this.buildIssueOverlay(targetMesh, issue) : null;
    const focusTuple: [number, number, number] | undefined = primaryFocus
      ? [primaryFocus.x, primaryFocus.y, primaryFocus.z]
      : overlay
        ? [overlay.center.x, overlay.center.y, overlay.center.z]
        : issue.focusPosition;

    if (focusTuple) {
      let targetDistance: number | undefined;

      if (targetMesh) {
        const assetDiagonal = Math.max(this.getAssetDiagonal(), 0.001);
        const semanticRadius = Math.max(overlay?.radius ?? 0, assetDiagonal * 0.015);
        targetDistance = Math.max(semanticRadius * 3.5, assetDiagonal * 0.10, 0.03);
      }

      this.cameraController.focusPosition(focusTuple, targetDistance);
      return;
    }

    if (targetObject) {
      this.cameraController.focusSelectedObject(targetObject, 1.8);
    }
  }

  public focusSelected() {
    if (!this.selectedMeshUuid || !this.currentAssetRoot) {
      if (this.currentAssetRoot) {
        this.cameraController.frameObject(this.currentAssetRoot);
      }
      return;
    }
    const obj = this.currentAssetRoot.getObjectByProperty('uuid', this.selectedMeshUuid);
    if (obj) {
      if ((obj as THREE.Bone).isBone) {
        const bone = obj as THREE.Bone;
        const worldPosition = new THREE.Vector3();
        bone.getWorldPosition(worldPosition);
        this.cameraController.focusPosition(
          [worldPosition.x, worldPosition.y, worldPosition.z],
          this.getBoneFocusDistance(bone)
        );
      } else {
        this.cameraController.focusSelectedObject(obj, 1.6);
      }
    } else {
      console.warn(`[AssetDoctor Focus] Object with UUID ${this.selectedMeshUuid} not found in scene.`);
    }
  }

  public frameRawBounds() {
    if (this.currentAssetRoot) {
      this.cameraController.frameRawBounds(this.currentAssetRoot);
    }
  }

  public isolateObject(uuid: string | null) {
    if (!this.currentAssetRoot) return;

    if (!uuid) {
      this.showAllObjects();
      return;
    }

    this.currentAssetRoot.traverse((obj) => {
      if (obj.name?.startsWith('__ascope_internal_')) return;
      if ((obj as THREE.Mesh).isMesh) {
        obj.visible = obj.uuid === uuid;
      }
    });
  }

  public showAllObjects() {
    if (!this.currentAssetRoot) return;
    this.currentAssetRoot.traverse((obj) => {
      if (obj.name?.startsWith('__ascope_internal_')) return;
      obj.visible = true;
    });
  }

  public toggleObjectVisibility(uuid: string) {
    if (!this.currentAssetRoot) return;
    const obj = this.currentAssetRoot.getObjectByProperty('uuid', uuid);
    if (obj) {
      obj.visible = !obj.visible;
    }
  }

  public setRenderMode(mode: RenderMode) {
    if (this.currentAssetRoot) {
      this.renderModeManager.applyMode(mode, this.currentAssetRoot);
    }
  }

  public setLightingPreset(preset: LightingPreset) {
    this.lightingManager.applyPreset(preset);
  }

  public updateLightingConfig(config: Partial<LightingConfig>) {
    this.lightingManager.updateManualIntensities(config);
    if (config.exposure !== undefined) {
      this.renderer.toneMappingExposure = config.exposure;
    }
  }

  public setExplodedAmount(amount: number) {
    this.explodedViewController.setExplodeAmount(amount);
  }

  // Toggles
  public toggleGrid(visible?: boolean) {
    this.isGridVisible = visible !== undefined ? visible : !this.isGridVisible;
    if (this.gridHelper) this.gridHelper.visible = this.isGridVisible;
  }

  public toggleAxes(visible?: boolean) {
    this.isAxesVisible = visible !== undefined ? visible : !this.isAxesVisible;
    if (this.axesHelper) this.axesHelper.visible = this.isAxesVisible;
  }

  public toggleBbox(visible?: boolean) {
    this.isBboxVisible = visible !== undefined ? visible : !this.isBboxVisible;
    if (this.bboxHelper) this.bboxHelper.visible = this.isBboxVisible;
  }

  public toggleSkeleton(visible?: boolean) {
    this.isSkeletonVisible = visible !== undefined ? visible : !this.isSkeletonVisible;
    if (this.skeletonHelper) this.skeletonHelper.visible = this.isSkeletonVisible;
  }

  public setSkeletonXray(enabled: boolean) {
    this.isSkeletonXray = enabled;

    // X-Ray is a presentation mode of the skeleton overlay. Enabling it must
    // reveal the skeleton in the same click instead of requiring a second action.
    if (enabled) {
      this.isSkeletonVisible = true;
      if (this.skeletonHelper) this.skeletonHelper.visible = true;
    }

    this.applySkeletonXrayMaterial();

    if (this.selectedBoneMarker) {
      const material = this.selectedBoneMarker.material as THREE.MeshBasicMaterial;
      material.depthTest = !enabled;
      material.needsUpdate = true;
    }
  }

  private applySkeletonXrayMaterial() {
    if (!this.skeletonHelper) return;
    const material = this.skeletonHelper.material as THREE.LineBasicMaterial;
    material.depthTest = !this.isSkeletonXray;
    material.depthWrite = false;
    material.transparent = true;
    material.opacity = this.isSkeletonXray ? 0.95 : 0.8;
    material.needsUpdate = true;
    this.skeletonHelper.renderOrder = this.isSkeletonXray ? 999 : 0;
  }

  public resetPreviewPose() {
    if (!this.currentAssetRoot) return;

    this.isPlayingAnimation = false;
    const duration = this.activeAnimationAction?.getClip().duration ?? 0;
    if (this.animationMixer) {
      this.animationMixer.stopAllAction();
      this.animationMixer.setTime(0);
    }

    const posedSkeletons = new Set<THREE.Skeleton>();
    this.currentAssetRoot.traverse((object) => {
      if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.skeleton || posedSkeletons.has(mesh.skeleton)) return;
      mesh.skeleton.pose();
      mesh.skeleton.update();
      posedSkeletons.add(mesh.skeleton);
    });
    this.currentAssetRoot.updateMatrixWorld(true);
    this.callbacks.onAnimationTimeUpdate?.(0, duration);
  }

  public toggleOrigin(visible?: boolean) {
    this.isOriginVisible = visible !== undefined ? visible : !this.isOriginVisible;
    if (this.originHelper) this.originHelper.visible = this.isOriginVisible;
  }

  public getToggleStates() {
    return {
      grid: this.isGridVisible,
      axes: this.isAxesVisible,
      bbox: this.isBboxVisible,
      skeleton: this.isSkeletonVisible,
      skeletonXray: this.isSkeletonXray,
      origin: this.isOriginVisible,
    };
  }

  // Surface Management
  public setSurface(type: SurfaceType) {
    this.surfaceManager.setSurface(type);
  }

  public getSurface(): SurfaceType {
    return this.surfaceManager.getSurface();
  }

  // Model Rotation & Turntable Control
  public setModelRotation(deg: number) {
    this.modelRotationY = THREE.MathUtils.degToRad(deg);
    if (this.currentAssetRoot) {
      this.currentAssetRoot.rotation.y = this.modelRotationY;
    }
    this.callbacks.onModelRotationChange?.(deg);
  }

  public getModelRotation(): number {
    return Math.round(THREE.MathUtils.radToDeg(this.modelRotationY));
  }

  public setAutoRotate(enabled: boolean, speed: number = 1.0) {
    this.isAutoRotating = enabled;
    this.autoRotateSpeed = speed;
  }

  public getAutoRotate(): boolean {
    return this.isAutoRotating;
  }

  public getAutoRotateSpeed(): number {
    return this.autoRotateSpeed;
  }

  public setLightBulbVisible(visible: boolean) {
    this.lightingManager.setLightBulbVisible(visible);
  }

  public getLightBulbVisible(): boolean {
    return this.lightingManager.getLightBulbVisible();
  }

  public resize() {
    this.onWindowResize();
  }

  private onWindowResize() {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // false keeps width: 100% and height: 100% in CSS, preventing any black gaps on layout shifts
    this.renderer.setSize(width, height, false);
  }

  private startRenderLoop() {
    const loop = () => {
      this.animationFrameId = requestAnimationFrame(loop);

      const delta = this.clock.getDelta();

      if (this.animationMixer && this.isPlayingAnimation) {
        this.animationMixer.update(delta);

        if (this.activeAnimationAction && this.callbacks.onAnimationTimeUpdate) {
          this.callbacks.onAnimationTimeUpdate(
            this.activeAnimationAction.time,
            this.activeAnimationAction.getClip().duration
          );
        }
      }

      this.cameraController.update();
      this.updateOrientationWidget();

      // Handle Turntable model auto-rotation around its axis
      if (this.isAutoRotating && this.currentAssetRoot) {
        this.modelRotationY += this.autoRotateSpeed * 0.015;
        if (this.modelRotationY > Math.PI * 2) this.modelRotationY -= Math.PI * 2;
        this.currentAssetRoot.rotation.y = this.modelRotationY;
        this.callbacks.onModelRotationChange?.(
          Math.round(THREE.MathUtils.radToDeg(this.modelRotationY))
        );
      }

      if (this.selectionBoxHelper) {
        this.selectionBoxHelper.update();
      }
      this.updateSelectedBoneMarker();

      this.renderer.render(this.scene, this.camera);

      // FPS tracking
      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFpsTime >= 500) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
        this.frameCount = 0;
        this.lastFpsTime = now;
      }
    };
    loop();
  }

  public disposeCurrentAsset() {
    this.clearIssueLocalization();
    this.issueReturnView = null;
    if (!this.currentAssetRoot) return;

    if (this.animationMixer) {
      this.animationMixer.stopAllAction();
      this.animationMixer.uncacheRoot(this.currentAssetRoot);
      this.animationMixer = null;
      this.activeAnimationAction = null;
    }

    if (this.bboxHelper) {
      this.scene.remove(this.bboxHelper);
      this.bboxHelper.dispose();
      this.bboxHelper = null;
    }

    if (this.skeletonHelper) {
      this.scene.remove(this.skeletonHelper);
      this.skeletonHelper.dispose();
      this.skeletonHelper = null;
    }

    if (this.selectionBoxHelper) {
      this.scene.remove(this.selectionBoxHelper);
      this.selectionBoxHelper.dispose();
      this.selectionBoxHelper = null;
    }

    if (this.selectedBoneMarker) {
      this.scene.remove(this.selectedBoneMarker);
      this.selectedBoneMarker.geometry.dispose();
      (this.selectedBoneMarker.material as THREE.Material).dispose();
      this.selectedBoneMarker = null;
    }

    this.clearRootMotionHelper();

    this.explodedViewController.reset();
    this.renderModeManager.resetAll(this.currentAssetRoot);

    // Deep GPU resource disposal
    this.currentAssetRoot.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m) {
            const std = m as THREE.MeshStandardMaterial;
            if (std.map) std.map.dispose();
            if (std.normalMap) std.normalMap.dispose();
            if (std.roughnessMap) std.roughnessMap.dispose();
            if (std.metalnessMap) std.metalnessMap.dispose();
            if (std.aoMap) std.aoMap.dispose();
            if (std.emissiveMap) std.emissiveMap.dispose();
            m.dispose();
          }
        }
      }
    });

    this.scene.remove(this.currentAssetRoot);
    this.currentAssetRoot.clear();
    this.currentAssetRoot = null;
    this.selectedMeshUuid = null;
  }

  public dispose() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.onWindowResize);

    this.disposeCurrentAsset();
    if (this.orientationWidget?.parentNode) {
      this.orientationWidget.parentNode.removeChild(this.orientationWidget);
    }
    this.orientationWidget = null;
    this.orientationAxes = null;
    this.cameraController.dispose();
    this.lightingManager.dispose();
    this.surfaceManager.dispose();
    this.renderModeManager.dispose();

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
  }
}
