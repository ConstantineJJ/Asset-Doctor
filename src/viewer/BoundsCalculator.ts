import * as THREE from 'three';

export interface AccurateBoundsResult {
  box: THREE.Box3;
  sphere: THREE.Sphere;
  isValid: boolean;
  warning?: string;
  isSkinned: boolean;
  diagnostics: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    size: [number, number, number];
    radius: number;
    hasNaN: boolean;
    hasInfinity: boolean;
    isZeroSize: boolean;
    isExtreme: boolean;
  };
}

/**
 * Computes world-space bounding box and bounding sphere for any Object3D,
 * with special deterministic handling for SkinnedMesh and Bone objects.
 */
export class BoundsCalculator {
  /**
   * Calculate true world-space bounds for any object (Mesh, SkinnedMesh, Bone, Group, Scene).
   */
  public static computeAccurateWorldBounds(object: THREE.Object3D): AccurateBoundsResult {
    // 1. Ensure object and descendants have up-to-date world matrices
    object.updateWorldMatrix(true, false);
    object.updateMatrixWorld(true);

    const worldBox = new THREE.Box3();
    let isSkinned = false;
    let foundGeometry = false;

    // If object is a Bone, handle specially
    if ((object as THREE.Bone).isBone) {
      return this.computeBoneBounds(object as THREE.Bone);
    }

    // Traverse all descendants
    object.traverse((node) => {
      if (node.name?.startsWith('__ascope_internal_')) return;
      if (!node.visible) return;

      if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
        isSkinned = true;
        foundGeometry = true;
        const skinnedBox = this.computeSkinnedMeshWorldBounds(node as THREE.SkinnedMesh);
        if (!skinnedBox.isEmpty()) {
          worldBox.union(skinnedBox);
        }
      } else if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry && mesh.geometry.attributes.position) {
          foundGeometry = true;
          mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            const meshBox = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
            worldBox.union(meshBox);
          }
        }
      }
    });

    // If no geometry found (e.g. pure bone hierarchy or empty group), use positions
    if (!foundGeometry || worldBox.isEmpty()) {
      object.traverse((node) => {
        if (node.name?.startsWith('__ascope_internal_')) return;
        const pos = new THREE.Vector3();
        node.getWorldPosition(pos);
        if (!Number.isNaN(pos.x) && !Number.isNaN(pos.y) && !Number.isNaN(pos.z)) {
          worldBox.expandByPoint(pos);
        }
      });
      // Expand slightly if it's a single point
      if (!worldBox.isEmpty() && worldBox.min.distanceTo(worldBox.max) < 0.001) {
        worldBox.expandByScalar(0.5);
      }
    }

    return this.validateAndBuildResult(worldBox, isSkinned);
  }

  /**
   * Deterministically calculates world-space bounds for a SkinnedMesh by evaluating
   * vertices transformed by bone matrices and inverse bind matrices.
   */
  public static computeSkinnedMeshWorldBounds(skinnedMesh: THREE.SkinnedMesh): THREE.Box3 {
    skinnedMesh.updateWorldMatrix(true, false);
    skinnedMesh.updateMatrixWorld(true);
    const box = new THREE.Box3();

    const skeleton = skinnedMesh.skeleton;
    const geom = skinnedMesh.geometry;
    if (!geom || !geom.attributes.position) {
      return box;
    }

    const posAttr = geom.attributes.position;
    const skinIdxAttr = geom.attributes.skinIndex;
    const skinWeightAttr = geom.attributes.skinWeight;

    // If skeleton or skin attributes are missing, fallback to regular matrixWorld
    if (!skeleton || !skeleton.bones || skeleton.bones.length === 0 || !skinIdxAttr || !skinWeightAttr) {
      geom.computeBoundingBox();
      if (geom.boundingBox) {
        box.copy(geom.boundingBox).applyMatrix4(skinnedMesh.matrixWorld);
      }
      return box;
    }

    // Ensure skeleton bone inverses are computed if missing
    if (!skeleton.boneInverses || skeleton.boneInverses.length === 0) {
      skeleton.calculateInverses();
    }

    // Ensure all bones and mesh have up-to-date world matrices
    skinnedMesh.updateWorldMatrix(true, true);
    for (let i = 0; i < skeleton.bones.length; i++) {
      if (skeleton.bones[i]) {
        skeleton.bones[i].updateWorldMatrix(true, false);
      }
    }
    skeleton.update();

    // Precompute bone world transformation matrices:
    // BoneWorldMatrix_j = bone[j].matrixWorld * boneInverses[j] * bindMatrix
    const bindMatrix = skinnedMesh.bindMatrix;
    const boneMatrices: THREE.Matrix4[] = [];

    for (let i = 0; i < skeleton.bones.length; i++) {
      const bone = skeleton.bones[i];
      const boneInverse = skeleton.boneInverses ? skeleton.boneInverses[i] : null;
      const m = new THREE.Matrix4();
      if (bone && boneInverse) {
        m.multiplyMatrices(bone.matrixWorld, boneInverse);
        m.multiply(bindMatrix);
      } else if (bone) {
        m.copy(bone.matrixWorld);
      }
      boneMatrices.push(m);
    }

    const vLocal = new THREE.Vector3();
    const vTransformed = new THREE.Vector3();
    const vAcc = new THREE.Vector3();

    const vertexCount = posAttr.count;
    // For large vertex counts, sample dynamically to maintain < 4ms budget
    const step = vertexCount > 15000 ? Math.ceil(vertexCount / 10000) : 1;

    for (let i = 0; i < vertexCount; i += step) {
      vLocal.fromBufferAttribute(posAttr, i);
      vAcc.set(0, 0, 0);

      const w0 = skinWeightAttr.getX(i);
      const w1 = skinWeightAttr.getY(i);
      const w2 = skinWeightAttr.getZ(i);
      const w3 = skinWeightAttr.getW(i);

      const b0 = skinIdxAttr.getX(i);
      const b1 = skinIdxAttr.getY(i);
      const b2 = skinIdxAttr.getZ(i);
      const b3 = skinIdxAttr.getW(i);

      let totalWeight = 0;

      if (w0 > 0.0001 && boneMatrices[b0]) {
        vTransformed.copy(vLocal).applyMatrix4(boneMatrices[b0]);
        vAcc.addScaledVector(vTransformed, w0);
        totalWeight += w0;
      }
      if (w1 > 0.0001 && boneMatrices[b1]) {
        vTransformed.copy(vLocal).applyMatrix4(boneMatrices[b1]);
        vAcc.addScaledVector(vTransformed, w1);
        totalWeight += w1;
      }
      if (w2 > 0.0001 && boneMatrices[b2]) {
        vTransformed.copy(vLocal).applyMatrix4(boneMatrices[b2]);
        vAcc.addScaledVector(vTransformed, w2);
        totalWeight += w2;
      }
      if (w3 > 0.0001 && boneMatrices[b3]) {
        vTransformed.copy(vLocal).applyMatrix4(boneMatrices[b3]);
        vAcc.addScaledVector(vTransformed, w3);
        totalWeight += w3;
      }

      // If vertex is unweighted, fallback to bind matrix; otherwise normalize weights
      if (totalWeight < 0.001) {
        vAcc.copy(vLocal).applyMatrix4(skinnedMesh.matrixWorld);
      } else if (Math.abs(totalWeight - 1.0) > 0.001) {
        vAcc.divideScalar(totalWeight);
      }

      if (!Number.isNaN(vAcc.x) && !Number.isNaN(vAcc.y) && !Number.isNaN(vAcc.z)) {
        box.expandByPoint(vAcc);
      }
    }

    // Also encompass all skeleton bone world positions so that bones, appendages, and rigs are fully enclosed
    const boneWorldPos = new THREE.Vector3();
    for (let i = 0; i < skeleton.bones.length; i++) {
      if (skeleton.bones[i]) {
        skeleton.bones[i].getWorldPosition(boneWorldPos);
        if (!Number.isNaN(boneWorldPos.x)) {
          box.expandByPoint(boneWorldPos);
        }
      }
    }

    // IMPORTANT: Fix Three.js frustum culling for SkinnedMesh!
    // In Three.js, skinned meshes must have frustumCulled disabled or safe infinite sphere
    // to prevent vanishing during skeletal movements and animations!
    this.fixSkinnedMeshFrustumSphere(skinnedMesh, box);

    return box;
  }

  /**
   * Solves the notorious Three.js issue where SkinnedMeshes are culled because
   * geometry.boundingSphere is in unskinned bind-pose.
   * Disables frustum culling on the SkinnedMesh and sets generous bounding spheres.
   */
  public static fixSkinnedMeshFrustumSphere(skinnedMesh: THREE.SkinnedMesh, worldBox: THREE.Box3) {
    // Explicitly disable frustum culling on the SkinnedMesh
    skinnedMesh.frustumCulled = false;

    // Provide infinite/safe bounding spheres so that sorting or manual checks never cull
    skinnedMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);

    if (skinnedMesh.geometry) {
      if (!worldBox.isEmpty()) {
        const centerWorld = new THREE.Vector3();
        worldBox.getCenter(centerWorld);
        const sizeWorld = new THREE.Vector3();
        worldBox.getSize(sizeWorld);
        const worldRadius = Math.max(1.0, sizeWorld.length() * 2.0);

        const invMatrix = new THREE.Matrix4().copy(skinnedMesh.matrixWorld).invert();
        const centerLocal = centerWorld.clone().applyMatrix4(invMatrix);

        skinnedMesh.geometry.boundingSphere = new THREE.Sphere(centerLocal, worldRadius * 2.0);
        skinnedMesh.geometry.boundingBox = worldBox.clone().applyMatrix4(invMatrix).expandByScalar(worldRadius);
      } else {
        skinnedMesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);
      }
    }
  }

  /**
   * Determine bounds for a selected Bone from its position, child bones,
   * or associated parent SkinnedMesh.
   */
  public static computeBoneBounds(bone: THREE.Bone): AccurateBoundsResult {
    bone.updateMatrixWorld(true);
    const boneWorldPos = new THREE.Vector3();
    bone.getWorldPosition(boneWorldPos);

    const box = new THREE.Box3();
    box.expandByPoint(boneWorldPos);

    // If bone has children, expand by children positions
    if (bone.children.length > 0) {
      bone.children.forEach((child) => {
        child.updateMatrixWorld(true);
        const childPos = new THREE.Vector3();
        child.getWorldPosition(childPos);
        box.expandByPoint(childPos);
      });
    }

    // If box is just a point or very small, expand by a sensible radius (e.g. 0.3m)
    const size = box.getSize(new THREE.Vector3());
    if (size.length() < 0.2) {
      box.expandByScalar(0.25);
    }

    return this.validateAndBuildResult(box, true);
  }

  /**
   * Validates calculated box and returns structured result with diagnostics.
   */
  private static validateAndBuildResult(box: THREE.Box3, isSkinned: boolean): AccurateBoundsResult {
    const min = box.min;
    const max = box.max;

    const hasNaN =
      Number.isNaN(min.x) || Number.isNaN(min.y) || Number.isNaN(min.z) ||
      Number.isNaN(max.x) || Number.isNaN(max.y) || Number.isNaN(max.z);

    const hasInfinity =
      !Number.isFinite(min.x) || !Number.isFinite(min.y) || !Number.isFinite(min.z) ||
      !Number.isFinite(max.x) || !Number.isFinite(max.y) || !Number.isFinite(max.z);

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    if (!hasNaN && !hasInfinity && !box.isEmpty()) {
      box.getSize(size);
      box.getCenter(center);
    } else {
      // Safe fallback box centered at origin
      box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
      box.getSize(size);
      box.getCenter(center);
    }

    const maxDim = Math.max(size.x, Math.max(size.y, size.z));
    const isZeroSize = maxDim < 1e-6;
    const isExtreme = maxDim > 50000 || maxDim < 0.001 || center.length() > 50000;

    let isValid = !hasNaN && !hasInfinity && !isZeroSize && !isExtreme;
    let warning: string | undefined;

    if (hasNaN) warning = 'Bounds contain NaN values';
    else if (hasInfinity) warning = 'Bounds contain infinite values';
    else if (isZeroSize) warning = 'Bounds have zero spatial volume';
    else if (isExtreme) warning = `Extreme bounds detected (max dimension: ${maxDim.toFixed(2)})`;

    // Ensure fallback box if invalid
    if (!isValid) {
      box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
      box.getSize(size);
      box.getCenter(center);
    }

    const sphere = new THREE.Sphere(center, Math.max(0.5, size.length() * 0.5));

    return {
      box,
      sphere,
      isValid,
      warning,
      isSkinned,
      diagnostics: {
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
        center: [center.x, center.y, center.z],
        size: [size.x, size.y, size.z],
        radius: sphere.radius,
        hasNaN,
        hasInfinity,
        isZeroSize,
        isExtreme,
      },
    };
  }
}
