import * as THREE from 'three';
import type { DiagnosticLocation, HealthIssue } from '../types';
import { documentMatrix } from '../viewer/AssetPresentation';

const MAX_LOCATION_SAMPLES = 16;

function meshLabel(mesh: THREE.Mesh): string {
  return mesh.name || `Mesh_${mesh.id}`;
}

function pushVertexLocation(
  list: DiagnosticLocation[],
  mesh: THREE.Mesh,
  vertexIndex: number
): void {
  if (list.length >= MAX_LOCATION_SAMPLES) return;

  const position = mesh.geometry?.getAttribute('position');
  if (!position || vertexIndex < 0 || vertexIndex >= position.count) return;

  const x = position.getX(vertexIndex);
  const y = position.getY(vertexIndex);
  const z = position.getZ(vertexIndex);
  if (![x, y, z].every(Number.isFinite)) return;

  const world = new THREE.Vector3(x, y, z).applyMatrix4(documentMatrix(mesh));
  if (![world.x, world.y, world.z].every(Number.isFinite)) return;

  list.push({
    meshUuid: mesh.uuid,
    meshName: meshLabel(mesh),
    affectedElement: 'vertex',
    affectedIndices: [vertexIndex],
    focusPosition: [world.x, world.y, world.z],
  });
}

function getAttributeComponent(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertexIndex: number,
  componentIndex: number
): number {
  return attribute.getComponent(vertexIndex, componentIndex);
}

export function analyzeIntegrity(root: THREE.Object3D): HealthIssue[] {
  const issues: HealthIssue[] = [];
  root.updateMatrixWorld(true);

  const sceneBoneUuids = new Set<string>();
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) sceneBoneUuids.add(object.uuid);
  });

  let missingPositionMeshes = 0;
  let invalidIndexCount = 0;
  let malformedIndexBuffers = 0;
  let nonFinitePositionValues = 0;
  let nonFiniteAttributeValues = 0;
  let malformedAttributeCounts = 0;
  let malformedMorphCounts = 0;
  let invalidSkinIndices = 0;
  let brokenSkeletonReferences = 0;
  let incompleteSkinAttributePairs = 0;

  const invalidIndexLocations: DiagnosticLocation[] = [];
  const invalidSkinLocations: DiagnosticLocation[] = [];
  const malformedAttributeMeshes = new Set<string>();
  const nonFiniteAttributeMeshes = new Set<string>();
  const brokenSkeletonMeshes = new Set<string>();

  root.traverse((object) => {
    if (object.name?.startsWith('__ascope_internal_')) return;
    if (!(object as THREE.Mesh).isMesh) return;

    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry;
    if (!geometry) return;

    const position = geometry.getAttribute('position');
    if (!position) {
      missingPositionMeshes++;
      malformedAttributeMeshes.add(meshLabel(mesh));
      return;
    }

    if (position.itemSize < 3 || position.count < 0 || !Number.isFinite(position.count)) {
      malformedAttributeCounts++;
      malformedAttributeMeshes.add(meshLabel(mesh));
    }

    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
      for (let component = 0; component < Math.min(position.itemSize, 3); component++) {
        const value = getAttributeComponent(position, vertexIndex, component);
        if (!Number.isFinite(value)) nonFinitePositionValues++;
      }
    }

    const index = geometry.index;
    if (index) {
      if (index.count % 3 !== 0) malformedIndexBuffers++;

      for (let i = 0; i < index.count; i++) {
        const vertexIndex = index.getX(i);
        if (
          !Number.isFinite(vertexIndex) ||
          !Number.isInteger(vertexIndex) ||
          vertexIndex < 0 ||
          vertexIndex >= position.count
        ) {
          invalidIndexCount++;
          const fallbackIndex =
            Number.isFinite(vertexIndex) && vertexIndex >= 0 && vertexIndex < position.count
              ? vertexIndex
              : 0;
          pushVertexLocation(invalidIndexLocations, mesh, fallbackIndex);
        }
      }
    }

    for (const [attributeName, attribute] of Object.entries(geometry.attributes)) {
      if (!attribute) continue;

      if (attribute.count !== position.count) {
        malformedAttributeCounts++;
        malformedAttributeMeshes.add(meshLabel(mesh));
      }

      if (
        !Number.isFinite(attribute.itemSize) ||
        attribute.itemSize <= 0 ||
        !Number.isInteger(attribute.itemSize)
      ) {
        malformedAttributeCounts++;
        malformedAttributeMeshes.add(meshLabel(mesh));
        continue;
      }

      // Position values are reported separately so the geometry failure is obvious.
      if (attributeName === 'position') continue;

      for (let vertexIndex = 0; vertexIndex < attribute.count; vertexIndex++) {
        for (let component = 0; component < attribute.itemSize; component++) {
          const value = getAttributeComponent(attribute, vertexIndex, component);
          if (!Number.isFinite(value)) {
            nonFiniteAttributeValues++;
            nonFiniteAttributeMeshes.add(meshLabel(mesh));
          }
        }
      }
    }

    for (const morphSet of Object.values(geometry.morphAttributes)) {
      for (const morphAttribute of morphSet ?? []) {
        if (morphAttribute.count !== position.count) {
          malformedMorphCounts++;
          malformedAttributeMeshes.add(meshLabel(mesh));
        }
        for (let vertexIndex = 0; vertexIndex < morphAttribute.count; vertexIndex++) {
          for (let component = 0; component < morphAttribute.itemSize; component++) {
            const value = getAttributeComponent(morphAttribute, vertexIndex, component);
            if (!Number.isFinite(value)) {
              nonFiniteAttributeValues++;
              nonFiniteAttributeMeshes.add(meshLabel(mesh));
            }
          }
        }
      }
    }

    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = mesh as THREE.SkinnedMesh;
      const skinIndex = geometry.getAttribute('skinIndex');
      const skinWeight = geometry.getAttribute('skinWeight');

      if ((skinIndex && !skinWeight) || (!skinIndex && skinWeight)) {
        incompleteSkinAttributePairs++;
      }

      if (!skinned.skeleton) {
        brokenSkeletonReferences++;
        brokenSkeletonMeshes.add(meshLabel(mesh));
        return;
      }

      if (skinned.skeleton.boneInverses.length !== skinned.skeleton.bones.length) {
        brokenSkeletonReferences++;
        brokenSkeletonMeshes.add(meshLabel(mesh));
      }

      for (const bone of skinned.skeleton.bones) {
        if (!bone || !sceneBoneUuids.has(bone.uuid)) {
          brokenSkeletonReferences++;
          brokenSkeletonMeshes.add(meshLabel(mesh));
        }
      }

      if (skinIndex) {
        for (let vertexIndex = 0; vertexIndex < skinIndex.count; vertexIndex++) {
          for (let component = 0; component < skinIndex.itemSize; component++) {
            const boneIndex = skinIndex.getComponent(vertexIndex, component);
            if (
              !Number.isFinite(boneIndex) ||
              !Number.isInteger(boneIndex) ||
              boneIndex < 0 ||
              boneIndex >= skinned.skeleton.bones.length
            ) {
              invalidSkinIndices++;
              pushVertexLocation(invalidSkinLocations, mesh, vertexIndex);
            }
          }
        }
      }
    }
  });

  if (missingPositionMeshes > 0) {
    issues.push({
      id: 'integrity-missing-position',
      category: 'Geometry',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Mesh geometry is missing POSITION data',
      description: `${missingPositionMeshes} mesh(es) do not expose a usable position attribute.`,
      count: missingPositionMeshes,
      evidence: `Meshes without POSITION: ${missingPositionMeshes}`,
      whyItMatters: 'Renderable mesh geometry requires valid vertex positions for inspection, bounds, topology and export.',
      suggestedAction: 'Repair or re-export the source asset before attempting geometry surgery.',
      repairability: 'MANUAL',
    });
  }

  if (invalidIndexCount > 0 || malformedIndexBuffers > 0) {
    const first = invalidIndexLocations[0];
    issues.push({
      id: 'integrity-invalid-indices',
      category: 'Geometry',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Invalid geometry indices detected',
      description: `${invalidIndexCount} out-of-range/non-integer index value(s) and ${malformedIndexBuffers} triangle index buffer(s) with a non-multiple-of-three length were detected.`,
      count: invalidIndexCount + malformedIndexBuffers,
      evidence: `invalidIndices=${invalidIndexCount}, malformedTriangleIndexBuffers=${malformedIndexBuffers}`,
      whyItMatters: 'Invalid indices can address missing vertices, corrupt triangles, crash downstream processing or invalidate export assumptions.',
      suggestedAction: 'Inspect the source mesh and re-export or repair the index buffer in a modeling tool.',
      repairability: 'MANUAL',
      ...(first
        ? {
            meshUuid: first.meshUuid,
            meshName: first.meshName,
            affectedElement: first.affectedElement,
            affectedIndices: first.affectedIndices,
            focusPosition: first.focusPosition,
            locations: invalidIndexLocations,
          }
        : {}),
    });
  }

  if (nonFinitePositionValues > 0) {
    issues.push({
      id: 'integrity-nonfinite-positions',
      category: 'Geometry',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'NaN / Infinity found in vertex positions',
      description: `${nonFinitePositionValues} non-finite position component(s) were detected.`,
      count: nonFinitePositionValues,
      evidence: `Non-finite POSITION components: ${nonFinitePositionValues}`,
      whyItMatters: 'NaN or infinite positions can poison bounds, transforms, rendering, topology measurements and export.',
      suggestedAction: 'Repair the source geometry; Asset Doctor must not guess replacement coordinates.',
      repairability: 'MANUAL',
    });
  }

  if (nonFiniteAttributeValues > 0) {
    issues.push({
      id: 'integrity-nonfinite-attributes',
      category: 'Geometry',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'NaN / Infinity found in geometry attributes',
      description: `${nonFiniteAttributeValues} non-finite component(s) were found outside POSITION across ${nonFiniteAttributeMeshes.size} mesh(es).`,
      count: nonFiniteAttributeValues,
      evidence: `Affected meshes: ${[...nonFiniteAttributeMeshes].slice(0, 8).join(', ') || 'unknown'}`,
      whyItMatters: 'Non-finite normals, UVs, colors, morphs or skin data can produce undefined rendering or deformation results.',
      suggestedAction: 'Inspect the affected attribute in the source asset and correct it explicitly.',
      repairability: 'MANUAL',
    });
  }

  if (malformedAttributeCounts > 0 || malformedMorphCounts > 0) {
    issues.push({
      id: 'integrity-malformed-attribute-counts',
      category: 'Geometry',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Malformed vertex-domain attribute counts',
      description: `${malformedAttributeCounts} base attribute mismatch(es) and ${malformedMorphCounts} morph attribute mismatch(es) were detected.`,
      count: malformedAttributeCounts + malformedMorphCounts,
      evidence: `Affected meshes: ${[...malformedAttributeMeshes].slice(0, 8).join(', ') || 'unknown'}`,
      whyItMatters: 'Vertex-domain attributes must align with the geometry they describe; mismatches make deterministic repair unsafe.',
      suggestedAction: 'Re-export or manually repair the affected mesh attributes.',
      repairability: 'MANUAL',
    });
  }

  if (incompleteSkinAttributePairs > 0) {
    issues.push({
      id: 'integrity-incomplete-skin-attributes',
      category: 'Skinning',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Incomplete skin attribute pair',
      description: `${incompleteSkinAttributePairs} skinned mesh(es) contain skinIndex without skinWeight, or skinWeight without skinIndex.`,
      count: incompleteSkinAttributePairs,
      whyItMatters: 'Skin indices and weights are a paired vertex-domain contract for skeletal deformation.',
      suggestedAction: 'Restore the missing skin attribute in the source rig/export.',
      repairability: 'MANUAL',
    });
  }

  if (invalidSkinIndices > 0) {
    const first = invalidSkinLocations[0];
    issues.push({
      id: 'integrity-invalid-skin-indices',
      category: 'Skinning',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Invalid skin indices detected',
      description: `${invalidSkinIndices} skin index value(s) reference a bone outside the bound skeleton.`,
      count: invalidSkinIndices,
      whyItMatters: 'Out-of-range bone references make skeletal deformation undefined.',
      suggestedAction: 'Repair skin indices and weights in the source rig; do not remap them by guesswork.',
      repairability: 'MANUAL',
      ...(first
        ? {
            meshUuid: first.meshUuid,
            meshName: first.meshName,
            affectedElement: first.affectedElement,
            affectedIndices: first.affectedIndices,
            focusPosition: first.focusPosition,
            locations: invalidSkinLocations,
          }
        : {}),
    });
  }

  if (brokenSkeletonReferences > 0) {
    issues.push({
      id: 'integrity-broken-skeleton-references',
      category: 'Skeleton',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Broken skeleton references detected',
      description: `${brokenSkeletonReferences} skeleton reference inconsistency/inconsistencies were detected across ${brokenSkeletonMeshes.size} skinned mesh(es).`,
      count: brokenSkeletonReferences,
      evidence: `Affected meshes: ${[...brokenSkeletonMeshes].slice(0, 8).join(', ') || 'unknown'}`,
      whyItMatters: 'A skinned mesh must reference a coherent skeleton with matching bone inverse data.',
      suggestedAction: 'Repair or rebind the skeleton in a DCC tool before attempting weight cleanup.',
      repairability: 'MANUAL',
    });
  }

  if (
    missingPositionMeshes === 0 &&
    invalidIndexCount === 0 &&
    malformedIndexBuffers === 0 &&
    nonFinitePositionValues === 0 &&
    nonFiniteAttributeValues === 0 &&
    malformedAttributeCounts === 0 &&
    malformedMorphCounts === 0 &&
    invalidSkinIndices === 0 &&
    brokenSkeletonReferences === 0 &&
    incompleteSkinAttributePairs === 0
  ) {
    issues.push({
      id: 'integrity-geometry-buffers-ok',
      category: 'Geometry',
      severity: 'OK',
      layer: 'Integrity',
      title: 'Geometry buffers pass integrity checks',
      description: 'Indices, vertex-domain attributes, morph attributes and detectable skin references are structurally coherent.',
      whyItMatters: 'Deterministic diagnostics and repairs can rely on the parsed geometry buffers.',
      suggestedAction: 'No action required.',
      repairability: 'NONE',
    });
  }

  return issues;
}
