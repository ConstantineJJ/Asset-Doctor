import * as THREE from 'three';
import type { BoneInfo, DiagnosticLocation } from '../types';
import { skinnedVertexWorldPosition } from './SkinWeightMeasure';
import type { GltfSourceAudit } from '../loaders/GltfSourceAudit';

export interface SkinningStats {
  skinnedMeshCount: number;
  skeletonCount: number;
  totalBones: number;
  rootBoneNames: string[];
  maxInfluencesPerVertex: number;
  zeroWeightVertices: number;
  invalidWeightSumVertices: number;
  unusedBonesCount: number;
  redundantInfluenceVertices: number;
  bones: BoneInfo[];
  invalidWeightLocations?: DiagnosticLocation[];
  zeroWeightLocations?: DiagnosticLocation[];
  redundantInfluenceLocations?: DiagnosticLocation[];
}

export function analyzeSkeletonAndSkinning(root: THREE.Object3D): SkinningStats {
  root.updateMatrixWorld(true);
  const bonesMap = new Map<string, THREE.Bone>();
  const skeletonsSet = new Set<THREE.Skeleton>();
  const skinnedMeshes: THREE.SkinnedMesh[] = [];

  root.traverse((obj) => {
    if (obj.name?.startsWith('__ascope_internal_')) return;
    if ((obj as THREE.Bone).isBone) bonesMap.set(obj.uuid, obj as THREE.Bone);
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = obj as THREE.SkinnedMesh;
      skinnedMeshes.push(sm);
      if (sm.skeleton) skeletonsSet.add(sm.skeleton);
    }
  });

  const rootBones: string[] = [];
  const referencedBones = new Set<string>();
  const bones: BoneInfo[] = [];
  for (const bone of bonesMap.values()) {
    const parent = bone.parent;
    const isRoot = !parent || !(parent as THREE.Bone).isBone;
    if (isRoot) rootBones.push(bone.name || bone.uuid.slice(0, 8));

    const childrenNames: string[] = [];
    for (const child of bone.children) {
      if ((child as THREE.Bone).isBone) childrenNames.push(child.name || child.uuid.slice(0, 8));
    }

    bones.push({
      uuid: bone.uuid,
      name: bone.name || `Bone_${bone.id}`,
      parentName: parent && (parent as THREE.Bone).isBone ? parent.name : undefined,
      childrenNames,
      position: [bone.position.x, bone.position.y, bone.position.z],
      rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z],
      scale: [bone.scale.x, bone.scale.y, bone.scale.z],
    });
  }

  let maxInfluences = 0;
  let zeroWeightVertices = 0;
  let invalidWeightSumVertices = 0;
  let redundantInfluenceVertices = 0;
  const zeroWeightLocations: DiagnosticLocation[] = [];
  const invalidWeightLocations: DiagnosticLocation[] = [];
  const redundantInfluenceLocations: DiagnosticLocation[] = [];

  for (const sm of skinnedMeshes) {
    const geom = sm.geometry;
    if (!geom) continue;
    const skinIndex = geom.attributes.skinIndex;
    const skinWeight = geom.attributes.skinWeight;

    if (skinIndex && skinWeight) {
      for (let i = 0; i < skinWeight.count; i++) {
        let weightSum = 0;
        let activeInfluences = 0;
        let redundantActiveInfluence = false;
        const activeBoneIndices = new Set<number>();

        for (let j = 0; j < skinWeight.itemSize; j++) {
          const w = skinWeight.getComponent(i, j);
          const bIdx = skinIndex.getComponent(i, j);
          if (w > 0.001) {
            activeInfluences++;
            weightSum += w;
            if (activeBoneIndices.has(bIdx)) redundantActiveInfluence = true;
            activeBoneIndices.add(bIdx);
            if (sm.skeleton && sm.skeleton.bones[bIdx]) referencedBones.add(sm.skeleton.bones[bIdx].uuid);
          }
        }

        if (redundantActiveInfluence) {
          redundantInfluenceVertices++;
          if (redundantInfluenceLocations.length < 16) {
            redundantInfluenceLocations.push({
              meshUuid: sm.uuid,
              meshName: sm.name || `SkinnedMesh_${sm.id}`,
              affectedElement: 'vertex',
              affectedIndices: [i],
              focusPosition: skinnedVertexWorldPosition(sm, i),
            });
          }
        }

        maxInfluences = Math.max(maxInfluences, activeInfluences);
        if (activeInfluences === 0 || weightSum < 0.001) {
          zeroWeightVertices++;
          if (zeroWeightLocations.length < 16) {
            zeroWeightLocations.push({
              meshUuid: sm.uuid,
              meshName: sm.name || `SkinnedMesh_${sm.id}`,
              affectedElement: 'vertex',
              affectedIndices: [i],
              focusPosition: skinnedVertexWorldPosition(sm, i),
            });
          }
        } else if (Math.abs(weightSum - 1.0) > 0.05) {
          invalidWeightSumVertices++;
          if (invalidWeightLocations.length < 16) {
            invalidWeightLocations.push({
              meshUuid: sm.uuid,
              meshName: sm.name || `SkinnedMesh_${sm.id}`,
              affectedElement: 'vertex',
              affectedIndices: [i],
              focusPosition: skinnedVertexWorldPosition(sm, i),
            });
          }
        }
      }
    }
  }

  // GLTFLoader normalizes skin weights on the display geometry. SourceAudit is
  // measured directly from WEIGHTS_0 before that normalization, so diagnostics
  // must retain defects that would otherwise disappear merely by opening a file.
  const sourceAudit = root.userData.__assetDoctorSourceAudit as GltfSourceAudit | undefined;
  if (sourceAudit?.rawSkinWeights) {
    invalidWeightSumVertices = Math.max(
      invalidWeightSumVertices,
      sourceAudit.rawSkinWeights.invalidSumVertices
    );
    zeroWeightVertices = Math.max(
      zeroWeightVertices,
      sourceAudit.rawSkinWeights.zeroWeightVertices
    );
  }

  let unusedBonesCount = 0;
  if (skinnedMeshes.length > 0) {
    for (const boneUuid of bonesMap.keys()) {
      if (!referencedBones.has(boneUuid)) unusedBonesCount++;
    }
  }

  return {
    skinnedMeshCount: skinnedMeshes.length,
    skeletonCount: skeletonsSet.size,
    totalBones: bonesMap.size,
    rootBoneNames: rootBones,
    maxInfluencesPerVertex: maxInfluences,
    zeroWeightVertices,
    invalidWeightSumVertices,
    unusedBonesCount,
    redundantInfluenceVertices,
    bones,
    invalidWeightLocations,
    zeroWeightLocations,
    redundantInfluenceLocations,
  };
}

export const analyzeSkeleton = analyzeSkeletonAndSkinning;