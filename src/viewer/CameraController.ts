import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BoundsCalculator, AccurateBoundsResult } from './BoundsCalculator';
import {cameraFitDistance} from './CameraFit';

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls;
  public lastBoundsResult: AccurateBoundsResult | null = null;
  public lastFramingDiagnostics: Record<string, any> = {};

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 50000;
  }

  /**
   * Frames an object using the deterministic 8-step framing pipeline with accurate bounds.
   */
  public frameObject(object: THREE.Object3D, offsetFactor: number = 1.35): AccurateBoundsResult {
    // 1. Calculate valid final world-space bounds
    const boundsResult = BoundsCalculator.computeAccurateWorldBounds(object);
    this.lastBoundsResult = boundsResult;

    const { box, sphere, isValid, warning } = boundsResult;

    if (!isValid) {
      console.warn(`[AssetDoctor CameraController] Invalid bounds encountered during frameObject: ${warning}. Using safe fallback.`);
    }

    // 2. Derive center and model size
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, Math.max(size.y, size.z), 0.05);
    const dir = new THREE.Vector3(1, 0.75, 1.25).normalize();
    const cameraDistance = cameraFitDistance(box,this.camera,dir,offsetFactor);

    // 3. Update OrbitControls.target to the new center
    this.controls.target.copy(center);

    // 4. Position camera at a valid distance
    this.camera.position.copy(center).add(dir.multiplyScalar(cameraDistance));

    // 5. Update near/far clipping planes adaptively
    this.camera.near = Math.max(0.001, maxDim / 2000);
    this.camera.far = Math.max(5000, cameraDistance * 50);

    // 6. Call camera.updateProjectionMatrix()
    this.camera.updateProjectionMatrix();

    // 7. Call camera.updateMatrixWorld(true)
    this.camera.updateMatrixWorld(true);

    // 8. Call controls.update()
    this.controls.update();

    // Verify that the bounding sphere is inside the camera frustum
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);
    const isInFrustum = frustum.intersectsSphere(sphere);

    this.lastFramingDiagnostics = {
      objectName: object.name || 'unnamed',
      objectType: object.type,
      boxMin: [box.min.x, box.min.y, box.min.z],
      boxMax: [box.max.x, box.max.y, box.max.z],
      center: [center.x, center.y, center.z],
      size: [size.x, size.y, size.z],
      sphereRadius: sphere.radius,
      cameraPos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      cameraTarget: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      cameraNear: this.camera.near,
      cameraFar: this.camera.far,
      cameraDistanceToCenter: this.camera.position.distanceTo(center),
      isInFrustum,
      isValid,
    };

    console.log('[AssetDoctor AutoFrame Diagnostics]', this.lastFramingDiagnostics);

    return boundsResult;
  }

  /**
   * Frames raw unskinned Box3 bounds as a diagnostic option.
   */
  public frameRawBounds(object: THREE.Object3D, offsetFactor: number = 1.35) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      console.warn('[AssetDoctor FrameRawBounds] Raw box is empty.');
      return;
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, Math.max(size.y, size.z), 0.05);
    const dir = new THREE.Vector3(1, 0.75, 1.25).normalize();
    const cameraDistance = cameraFitDistance(box,this.camera,dir,offsetFactor);

    this.controls.target.copy(center);
    this.camera.position.copy(center).add(dir.multiplyScalar(cameraDistance));

    this.camera.near = Math.max(0.001, maxDim / 2000);
    this.camera.far = Math.max(5000, cameraDistance * 50);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.controls.update();

    console.log('[AssetDoctor FrameRawBounds]', {
      center: [center.x, center.y, center.z],
      size: [size.x, size.y, size.z],
      camPos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
    });
  }

  /**
   * Instruments and focuses a selected Object3D (Mesh, SkinnedMesh, Bone, Group).
   */
  public focusSelectedObject(object: THREE.Object3D, offsetFactor: number = 1.6) {
    const camPosBefore = this.camera.position.clone();
    const camTargetBefore = this.controls.target.clone();

    // 1. Calculate valid final world-space bounds
    const boundsResult = BoundsCalculator.computeAccurateWorldBounds(object);
    const { box, sphere, isValid, warning } = boundsResult;

    if (!isValid) {
      console.warn(`[AssetDoctor Focus Diagnostics] Invalid bounds for selected object: ${warning}`);
    }

    // 2. Derive center and model size
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, Math.max(size.y, size.z), 0.2);

    // 3. Update OrbitControls.target to the new center
    this.controls.target.copy(center);

    // 4. Position camera at a valid distance (maintain current relative angle)
    const currentDir = new THREE.Vector3().subVectors(camPosBefore, camTargetBefore);
    if (currentDir.lengthSq() < 0.0001) {
      currentDir.set(1, 0.75, 1.25);
    }
    currentDir.normalize();
    const cameraDistance = Math.max(.3,cameraFitDistance(box,this.camera,currentDir,offsetFactor));
    this.camera.position.copy(center).add(currentDir.multiplyScalar(cameraDistance));

    // 5. Update near/far
    this.camera.near = Math.max(0.01, maxDim / 1000);
    this.camera.far = Math.max(1000, cameraDistance * 30);

    // 6. Call camera.updateProjectionMatrix()
    this.camera.updateProjectionMatrix();

    // 7. Call camera.updateMatrixWorld(true)
    this.camera.updateMatrixWorld(true);

    // 8. Call controls.update()
    this.controls.update();

    const focusLog = {
      selectedObjectName: object.name || 'unnamed',
      selectedObjectUUID: object.uuid,
      selectedObjectType: object.type,
      isSkinnedMesh: (object as THREE.SkinnedMesh).isSkinnedMesh || false,
      isBone: (object as THREE.Bone).isBone || false,
      isMesh: (object as THREE.Mesh).isMesh || false,
      isGroup: object instanceof THREE.Group,
      computedBoxMin: [box.min.x, box.min.y, box.min.z],
      computedBoxMax: [box.max.x, box.max.y, box.max.z],
      computedCenter: [center.x, center.y, center.z],
      computedSize: [size.x, size.y, size.z],
      boundingSphereCenter: [sphere.center.x, sphere.center.y, sphere.center.z],
      boundingSphereRadius: sphere.radius,
      cameraPositionBefore: [camPosBefore.x, camPosBefore.y, camPosBefore.z],
      cameraTargetBefore: [camTargetBefore.x, camTargetBefore.y, camTargetBefore.z],
      cameraPositionAfter: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      cameraTargetAfter: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      cameraNear: this.camera.near,
      cameraFar: this.camera.far,
      orbitControlsUpdated: true,
    };

    console.log('[AssetDoctor Focus in Viewport Diagnostics]', focusLog);
  }

  public focusPosition(point: [number, number, number], targetDist?: number) {
    const target = new THREE.Vector3(point[0], point[1], point[2]);
    const currentDir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (currentDir.lengthSq() < 1e-8) {
      currentDir.set(1, 0.7, 1.2);
    }
    currentDir.normalize();

    const fallbackDistance = Math.max(
      0.05,
      this.camera.position.distanceTo(this.controls.target) * 0.4
    );
    const dist = Math.max(0.01, targetDist ?? fallbackDistance);

    this.controls.target.copy(target);
    this.camera.position.copy(target).add(currentDir.multiplyScalar(dist));

    // Focus can jump from whole-model framing to a tiny diagnostic region or bone.
    // Keep clipping planes proportional to that new working distance.
    this.camera.near = Math.max(0.001, dist / 500);
    this.camera.far = Math.max(1000, dist * 100);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.controls.update();
  }

  public setViewPreset(preset: 'perspective' | 'front' | 'top' | 'right') {
    const target = this.controls.target.clone();
    const currentDist = this.camera.position.distanceTo(target);

    switch (preset) {
      case 'perspective': {
        const dir = new THREE.Vector3(1, 0.7, 1.2).normalize();
        this.camera.position.copy(target).add(dir.multiplyScalar(currentDist));
        break;
      }
      case 'front': {
        this.camera.position.set(target.x, target.y, target.z + currentDist);
        break;
      }
      case 'top': {
        this.camera.position.set(target.x, target.y + currentDist, target.z + 0.0001);
        break;
      }
      case 'right': {
        this.camera.position.set(target.x + currentDist, target.y, target.z);
        break;
      }
    }
    this.camera.updateMatrixWorld(true);
    this.controls.update();
  }

  public update() {
    this.controls.update();
  }

  public dispose() {
    this.controls.dispose();
  }
}
