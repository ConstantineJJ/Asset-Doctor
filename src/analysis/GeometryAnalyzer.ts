import * as THREE from 'three';
import type { AssetSummary, BoundingBoxInfo, SceneNodeInfo } from '../types';
import { performanceCore } from '../performance/PerformanceProfiler';
import { documentBounds } from '../viewer/AssetPresentation';

export function calculateBoundingBox(object: THREE.Object3D): BoundingBoxInfo {
  const box = documentBounds(object);
  if (box.isEmpty()) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0],
      diagonal: 0,
    };
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const diagonal = size.length();

  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
    diagonal,
  };
}

export function buildSceneTree(root: THREE.Object3D, parentId?: string): SceneNodeInfo {
  let nodeType: SceneNodeInfo['type'] = 'Object3D';
  if ((root as THREE.SkinnedMesh).isSkinnedMesh) {
    nodeType = 'SkinnedMesh';
  } else if ((root as THREE.Mesh).isMesh) {
    nodeType = 'Mesh';
  } else if ((root as THREE.Bone).isBone) {
    nodeType = 'Bone';
  } else if ((root as THREE.Group).isGroup) {
    nodeType = 'Group';
  } else if ((root as THREE.Light).isLight) {
    nodeType = 'Light';
  } else if ((root as THREE.Camera).isCamera) {
    nodeType = 'Camera';
  } else if ((root as THREE.Scene).isScene) {
    nodeType = 'Scene';
  }

  let triangleCount = 0;
  let vertexCount = 0;
  const materialNames: string[] = [];

  if ((root as THREE.Mesh).isMesh && (root as THREE.Mesh).geometry) {
    const geom = (root as THREE.Mesh).geometry;
    if (geom.index) {
      triangleCount = Math.floor(geom.index.count / 3);
      vertexCount = geom.attributes.position ? geom.attributes.position.count : 0;
    } else if (geom.attributes.position) {
      vertexCount = geom.attributes.position.count;
      triangleCount = Math.floor(vertexCount / 3);
    }

    const mat = (root as THREE.Mesh).material;
    if (Array.isArray(mat)) {
      mat.forEach((m) => materialNames.push(m.name || 'Unnamed Material'));
    } else if (mat) {
      materialNames.push(mat.name || 'Unnamed Material');
    }
  }

  const children: SceneNodeInfo[] = [];
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    // Exclude internal Three.js helpers
    if (child.name?.startsWith('__ascope_internal_')) continue;
    children.push(buildSceneTree(child, root.uuid));
  }

  return {
    uuid: root.uuid,
    name: root.name || `${nodeType}_${root.id}`,
    type: nodeType,
    visible: root.visible,
    triangleCount,
    vertexCount,
    materialNames,
    children,
    parentId,
  };
}

export function analyzeAssetGeometry(
  root: THREE.Object3D,
  fileName: string,
  fileSizeBytes?: number
): AssetSummary {
  // This becomes a committed profiling cycle only if WorkerManager follows with
  // the heavy topology stage; export-only geometry summaries do not pollute F1.
  performanceCore.noteGeometryPassStart(root.uuid);

  let nodeCount = 0;
  let meshCount = 0;
  let primitiveCount = 0;
  let vertexCount = 0;
  let indexedVertexCount = 0;
  let triangleCount = 0;
  let lineCount = 0;
  let pointCount = 0;
  let skinnedMeshCount = 0;
  let boneCount = 0;
  let skeletonCount = 0;

  const countedSkeletons = new Set<THREE.Skeleton>();
  const countedMaterials = new Set<string>();
  const countedTextures = new Set<string>();

  root.traverse((obj) => {
    if (obj.name?.startsWith('__ascope_internal_')) return;
    nodeCount++;

    if ((obj as THREE.Bone).isBone) {
      boneCount++;
    }

    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      skinnedMeshCount++;
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.skeleton && !countedSkeletons.has(skinned.skeleton)) {
        countedSkeletons.add(skinned.skeleton);
        skeletonCount++;
      }
    }

    if ((obj as THREE.Mesh).isMesh) {
      meshCount++;
      primitiveCount++;
      const mesh = obj as THREE.Mesh;
      const geom = mesh.geometry;
      if (geom) {
        if (geom.attributes.position) {
          const vCount = geom.attributes.position.count;
          vertexCount += vCount;
          if (geom.index) {
            indexedVertexCount += vCount;
            triangleCount += Math.floor(geom.index.count / 3);
          } else {
            triangleCount += Math.floor(vCount / 3);
          }
        }
      }

      // Collect materials
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m) {
          countedMaterials.add(m.uuid);
          const standard = m as THREE.MeshStandardMaterial;
          if (standard.map) countedTextures.add(standard.map.uuid);
          if (standard.normalMap) countedTextures.add(standard.normalMap.uuid);
          if (standard.roughnessMap) countedTextures.add(standard.roughnessMap.uuid);
          if (standard.metalnessMap) countedTextures.add(standard.metalnessMap.uuid);
          if (standard.aoMap) countedTextures.add(standard.aoMap.uuid);
          if (standard.emissiveMap) countedTextures.add(standard.emissiveMap.uuid);
        }
      }
    } else if ((obj as THREE.Line).isLine) {
      lineCount++;
    } else if ((obj as THREE.Points).isPoints) {
      pointCount++;
    }
  });

  const bbox = calculateBoundingBox(root);

  // Animation clips will be filled by AnimationAnalyzer
  return {
    fileName,
    fileSizeBytes,
    nodeCount,
    meshCount,
    primitiveCount,
    vertexCount,
    indexedVertexCount,
    triangleCount,
    lineCount,
    pointCount,
    materialCount: countedMaterials.size,
    textureCount: countedTextures.size,
    skeletonCount,
    boneCount,
    skinnedMeshCount,
    clipCount: 0,
    clips: [],
    boundingBox: bbox,
  };
}

export const analyzeGeometry = analyzeAssetGeometry;
