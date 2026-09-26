import type {
  AssetSummary,
  DiagnosticLayer,
  DiagnosticProfileId,
  HealthCategory,
  HealthIssue,
  HealthSeverity,
  Repairability,
  MaterialInfo,
  SkinningStats,
  TextureInfo,
  TopologyStats,
} from '../types';
import { getDiagnosticProfile } from './DiagnosticProfiles';

export function aggregateTopologyIssues(topologyResults: TopologyStats[]): HealthIssue[] {
  const issues: HealthIssue[] = [];

  const total = (selector: (stat: TopologyStats) => number) =>
    topologyResults.reduce((sum, stat) => sum + selector(stat), 0);

  const ratio = (count: number, denominator: number): string | undefined => {
    if (!Number.isFinite(count) || !Number.isFinite(denominator) || denominator <= 0) return undefined;
    const percent = (count / denominator) * 100;
    return `${percent < 0.1 && count > 0 ? percent.toFixed(3) : percent.toFixed(1)}% (${count}/${denominator})`;
  };

  const localize = (
    selector: (stat: TopologyStats) => number,
    localizationKey: keyof NonNullable<TopologyStats['localization']>
  ): Partial<HealthIssue> => {
    const locations = topologyResults.flatMap((stat) => {
      if (selector(stat) <= 0) return [];
      const samples =
        stat.localizationSamples?.[localizationKey] ??
        (stat.localization?.[localizationKey] ? [stat.localization[localizationKey]!] : []);
      return samples.map((sample) => ({
        meshUuid: stat.meshUuid,
        meshName: stat.meshName,
        affectedElement: sample.element,
        affectedIndices: sample.affectedIndices,
        focusPosition: sample.focusPoint,
      }));
    });

    const first = locations[0];
    if (!first) return {};

    return {
      meshUuid: first.meshUuid,
      meshName: first.meshName,
      affectedIndices: first.affectedIndices,
      affectedElement: first.affectedElement,
      focusPosition: first.focusPosition,
      locations,
    };
  };

  const totalTriangles = total((s) => s.triangleCount);
  const totalVertices = total((s) => s.vertexCount);
  const totalComponents = total((s) => s.componentsCount);
  const totalDegenerate = total((s) => s.degenerateTriangles);
  const totalBoundary = total((s) => s.boundaryEdges);
  const totalNonManifold = total((s) => s.nonManifoldEdges);
  const totalIsolated = total((s) => s.isolatedVertices);
  const totalTinyComponents = total((s) => s.tinyComponentsCount);
  const totalThinTriangles = total((s) => s.thinTriangles);
  const totalDuplicates = total((s) => s.potentialDuplicatePositions);
  const totalDuplicateTriangles = total((s) => s.duplicateTriangles);

  if (totalDegenerate > 0) {
    issues.push({
      id: 'topo-degenerate-triangles',
      category: 'Topology',
      severity: 'WARNING',
      layer: 'Health',
      title: `Degenerate triangles: ${totalDegenerate}`,
      description: `${totalDegenerate} triangle(s) have collinear or zero-length edges with near-zero surface area. Can cause unstable shading, baking or downstream geometry processing.`,
      count: totalDegenerate,
      ratio: ratio(totalDegenerate, totalTriangles),
      technicalDetails: 'Triangle area is at or below the deterministic area epsilon.',
      ...localize((s) => s.degenerateTriangles, 'degenerate'),
    });
  } else {
    issues.push({
      id: 'topo-degenerate-ok',
      category: 'Topology',
      severity: 'OK',
      title: 'Zero degenerate triangles',
      description: 'All evaluated triangles have valid non-zero surface area.',
    });
  }

  if (totalNonManifold > 0) {
    issues.push({
      id: 'topo-non-manifold-edges',
      category: 'Topology',
      severity: 'WARNING',
      layer: 'Health',
      title: `Non-manifold index edges: ${totalNonManifold}`,
      description: `${totalNonManifold} indexed edge(s) are shared by more than two faces. This is an index-connectivity finding; inspect the spatial surface before deciding whether the authored geometry is invalid.`,
      count: totalNonManifold,
      repairability: 'MANUAL',
      technicalDetails: 'Indexed edge shared by > 2 triangles.',
      suggestedAction: 'Manual repair recommended. Inspect the affected edge fan and decide the intended surface connectivity before editing topology.',
      ...localize((s) => s.nonManifoldEdges, 'nonManifold'),
    });
  } else {
    issues.push({
      id: 'topo-non-manifold-ok',
      category: 'Topology',
      severity: 'OK',
      title: 'No non-manifold index edges',
      description: 'No indexed edges shared by more than 2 faces were detected.',
    });
  }

  if (totalBoundary > 0) {
    issues.push({
      id: 'topo-boundary-edges',
      category: 'Topology',
      severity: 'INFO',
      title: `Index-boundary edges: ${totalBoundary}`,
      description: `${totalBoundary} edge(s) belong to only one triangle in the indexed vertex graph. This is not proof of a geometric hole: glTF commonly duplicates positions at UV seams, material splits and hard-normal boundaries.`,
      count: totalBoundary,
      repairability: 'MANUAL',
      technicalDetails: 'Single-triangle incident edges in index connectivity; spatially coincident seam vertices remain distinct.',
      suggestedAction: 'Inspect the spatial surface only if watertight geometry is required. Confirm a real geometric opening before changing topology; do not weld attribute seams merely to reduce this count.',
      ...localize((s) => s.boundaryEdges, 'boundary'),
    });
  } else {
    issues.push({
      id: 'topo-watertight-ok',
      category: 'Topology',
      severity: 'OK',
      title: 'No index-boundary edges',
      description: 'No single-triangle incident edges were found in index connectivity.',
    });
  }

  if (totalIsolated > 0) {
    issues.push({
      id: 'topo-isolated-vertices',
      category: 'Topology',
      severity: 'WARNING',
      layer: 'Health',
      title: `Unreferenced vertices: ${totalIsolated}`,
      description: `${totalIsolated} vertex position(s) exist in the buffer but are not referenced by any indexed face.`,
      count: totalIsolated,
      ratio: ratio(totalIsolated, totalVertices),
      technicalDetails: 'Unreferenced positions in the indexed vertex buffer.',
      ...localize((s) => s.isolatedVertices, 'isolated'),
    });
  }

  if (totalTinyComponents > 0) {
    issues.push({
      id: 'topo-tiny-components',
      category: 'Topology',
      severity: 'WARNING',
      layer: 'Health',
      title: `Tiny index-connected components: ${totalTinyComponents}`,
      description: `${totalTinyComponents} small component(s) were found in index connectivity. Attribute seams can split a visually continuous surface into several index components, so this is not automatically floating debris.`,
      count: totalTinyComponents,
      ratio: ratio(totalTinyComponents, totalComponents),
      repairability: 'MANUAL',
      suggestedAction: 'Manual review recommended. Confirm that a component is spatially detached and unwanted before deleting or welding it.',
      ...localize((s) => s.tinyComponentsCount, 'tinyComponent'),
    });
  }

  if (totalThinTriangles > 0) {
    issues.push({
      id: 'topo-thin-triangles',
      category: 'Topology',
      severity: 'INFO',
      title: `Needle triangles: ${totalThinTriangles}`,
      description: `${totalThinTriangles} triangle(s) have an extreme aspect ratio (> 35:1). This can contribute to shading shimmer or fragile baking.`,
      count: totalThinTriangles,
      ratio: ratio(totalThinTriangles, totalTriangles),
      repairability: 'MANUAL',
      suggestedAction: 'Manual repair recommended if these faces cause visible shading, deformation, or baking problems. Preserve intentional thin geometry.',
      ...localize((s) => s.thinTriangles, 'thinTriangle'),
    });
  }

  if (totalDuplicates > 0) {
    issues.push({
      id: 'topo-duplicate-positions',
      category: 'Topology',
      severity: 'INFO',
      title: `Coincident vertex positions: ${totalDuplicates}`,
      description: `${totalDuplicates} vertices share near-identical spatial cells. glTF and real-time meshes may intentionally split vertices at UV seams and hard normal boundaries.`,
      count: totalDuplicates,
      ratio: ratio(totalDuplicates, totalVertices),
      repairability: 'CONDITIONAL',
      suggestedAction: 'Preview exact-duplicate merge. Only vertices with identical position and every vertex/morph attribute are eligible; topology-changing merges are blocked.',
      ...localize((s) => s.potentialDuplicatePositions, 'duplicatePosition'),
    });
  }

  if (totalDuplicateTriangles > 0) {
    issues.push({
      id: 'topo-exact-duplicate-triangles',
      category: 'Topology',
      severity: 'INFO',
      layer: 'Health',
      title: `Exact duplicate triangles: ${totalDuplicateTriangles}`,
      description: `${totalDuplicateTriangles} indexed triangle(s) repeat an earlier triangle with the same vertex indices and winding. Reversed-winding backfaces are not counted.`,
      count: totalDuplicateTriangles,
      ratio: ratio(totalDuplicateTriangles, totalTriangles),
      repairability: 'CONDITIONAL',
      evidence: 'Only same-winding cyclic index duplicates are counted.',
      whyItMatters: 'Exact duplicate faces add redundant rasterization and can create depth or shading ambiguity in some material pipelines.',
      suggestedAction: 'Preview duplicate-triangle removal. Automatic removal is offered only when material, draw-range, sharing, and topology safety gates pass.',
      ...localize((s) => s.duplicateTriangles, 'duplicateTriangle'),
    });
  }

  return issues;
}

export function evaluateSkinningIssues(
  stats: SkinningStats,
  profileId: DiagnosticProfileId = 'general'
): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const profile = getDiagnosticProfile(profileId);

  if (stats.skeletonCount === 0) {
    issues.push({
      id: 'skin-static-ok',
      category: 'Skeleton',
      severity: 'N/A',
      layer: 'Health',
      title: 'Rig-specific checks not applicable',
      description: 'Asset does not contain skeletal armatures or skinned mesh nodes, so skinning-specific diagnostics do not apply.',
      evidence: 'No Skeleton / SkinnedMesh detected.',
      whyItMatters: 'Absence of a rig is not a defect for static assets.',
      suggestedAction: 'No action required unless a rig was expected for the intended use.',
      repairability: 'NONE',
    });
    return issues;
  }

  issues.push({
    id: 'skin-rig-detected',
    category: 'Skeleton',
    severity: 'OK',
    title: `Skeletal rig verified: ${stats.totalBones} bones`,
    description: `Contains ${stats.skeletonCount} skeleton(s), ${stats.skinnedMeshCount} skinned mesh(es), and ${stats.rootBoneNames.length} root bone(s): [${stats.rootBoneNames.join(', ')}].`,
    count: stats.totalBones,
  });

  if (stats.maxInfluencesPerVertex > profile.maxBoneInfluencesWarning) {
    issues.push({
      id: 'skin-max-influences',
      category: 'Skinning',
      severity: 'WARNING',
      title: `Max bone influences: ${stats.maxInfluencesPerVertex}`,
      description: `Vertices use up to ${stats.maxInfluencesPerVertex} active bone weights, above the ${profile.label} reference threshold of ${profile.maxBoneInfluencesWarning}.`,
      count: stats.maxInfluencesPerVertex,
    });
  } else if (stats.maxInfluencesPerVertex > 0) {
    issues.push({
      id: 'skin-influences-ok',
      category: 'Skinning',
      severity: 'OK',
      title: `Bone influences compliant (${stats.maxInfluencesPerVertex}/vertex)`,
      description: `Bone influence count is within the ${profile.label} reference threshold (${profile.maxBoneInfluencesWarning}/vertex).`,
    });
  }

  if (stats.zeroWeightVertices > 0) {
    const first = stats.zeroWeightLocations?.[0];
    issues.push({
      id: 'skin-zero-weight',
      category: 'Skinning',
      severity: 'ERROR',
      title: `Unweighted vertices: ${stats.zeroWeightVertices}`,
      description: `${stats.zeroWeightVertices} vertex/vertices have zero bone weight influence. They will remain frozen in bind pose when playing animations.`,
      count: stats.zeroWeightVertices,
      repairability: 'MANUAL',
      ...(first
        ? {
            meshUuid: first.meshUuid,
            meshName: first.meshName,
            affectedElement: first.affectedElement,
            affectedIndices: first.affectedIndices,
            focusPosition: first.focusPosition,
            locations: stats.zeroWeightLocations,
          }
        : {}),
    });
  }

  if (stats.invalidWeightSumVertices > 0) {
    const first = stats.invalidWeightLocations?.[0];
    issues.push({
      id: 'skin-invalid-sum',
      category: 'Skinning',
      severity: 'WARNING',
      title: `Unnormalized bone weights: ${stats.invalidWeightSumVertices}`,
      description: first
        ? `${stats.invalidWeightSumVertices} vertices have weight sums differing from 1.0 by > 0.05.`
        : `${stats.invalidWeightSumVertices} source vertex/vertices had weight sums differing from 1.0 before GLTFLoader normalized the display geometry.`,
      count: stats.invalidWeightSumVertices,
      repairability: first ? 'CONDITIONAL' : 'MANUAL',
      evidence: first
        ? 'Measured on the currently addressable skinned mesh geometry.'
        : 'Measured from source WEIGHTS_0 before Three.js runtime normalization; exact display-vertex localization is unavailable.',
      suggestedAction: first
        ? 'Preview normalization of non-zero skin weights. Zero-weight vertices are never guessed automatically.'
        : 'Repair the source weights in a DCC tool or re-export them normalized. Asset Doctor will not blindly modify a source-only finding it cannot localize.',
      ...(first
        ? {
            meshUuid: first.meshUuid,
            meshName: first.meshName,
            affectedElement: first.affectedElement,
            affectedIndices: first.affectedIndices,
            focusPosition: first.focusPosition,
            locations: stats.invalidWeightLocations,
          }
        : {}),
    });
  }

  if (stats.redundantInfluenceVertices > 0) {
    const first = stats.redundantInfluenceLocations?.[0];
    issues.push({
      id: 'skin-redundant-influences',
      category: 'Skinning',
      severity: 'INFO',
      layer: 'Health',
      title: `Redundant skin influences: ${stats.redundantInfluenceVertices}`,
      description: `${stats.redundantInfluenceVertices} vertex/vertices contain the same active bone index in more than one influence slot.`,
      count: stats.redundantInfluenceVertices,
      repairability: 'CONDITIONAL',
      evidence: 'Two or more non-zero influence slots reference the same bone on a vertex.',
      whyItMatters: 'Duplicate slots waste influence capacity and make skin data harder to inspect without changing the intended weighted transform.',
      suggestedAction: 'Preview consolidation. Duplicate weights are summed onto one slot; no new bone influence is guessed.',
      ...(first
        ? {
            meshUuid: first.meshUuid,
            meshName: first.meshName,
            affectedElement: first.affectedElement,
            affectedIndices: first.affectedIndices,
            focusPosition: first.focusPosition,
            locations: stats.redundantInfluenceLocations,
          }
        : {}),
    });
  }

  if (stats.unusedBonesCount > 0) {
    issues.push({
      id: 'skin-unused-bones',
      category: 'Skeleton',
      severity: 'INFO',
      title: `Unused bones: ${stats.unusedBonesCount}`,
      description: `${stats.unusedBonesCount} bone(s) in skeleton do not bind to any vertex weights (e.g. attachment sockets or locator nodes).`,
      count: stats.unusedBonesCount,
      ratio:
        stats.totalBones > 0
          ? `${((stats.unusedBonesCount / stats.totalBones) * 100).toFixed(1)}% (${stats.unusedBonesCount}/${stats.totalBones})`
          : undefined,
      repairability: 'MANUAL',
      whyItMatters: 'Unused bones can be intentional sockets, locators, control helpers, or genuinely stale rig data. Weight usage alone cannot determine author intent.',
      suggestedAction: 'Manual repair recommended. Keep sockets/locators that have runtime meaning; remove a bone only after confirming no animation, attachment, constraint, or engine workflow depends on it.',
    });
  }

  return issues;
}

export function evaluateMaterialIssues(materials: MaterialInfo[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  let doubleSidedCount = 0;
  let transparentCount = 0;

  for (const m of materials) {
    if (m.doubleSided) doubleSidedCount++;
    if (m.alphaMode === 'BLEND') transparentCount++;
  }

  if (materials.length === 0) {
    issues.push({
      id: 'mat-none',
      category: 'Materials',
      severity: 'WARNING',
      title: 'No materials assigned',
      description: 'Meshes are relying on fallback default shading.',
    });
    return issues;
  }

  issues.push({
    id: 'mat-count-ok',
    category: 'Materials',
    severity: 'OK',
    title: `Defined materials: ${materials.length}`,
    description: `${materials.length} unique PBR material instance(s) loaded.`,
    count: materials.length,
  });

  if (doubleSidedCount > 0) {
    issues.push({
      id: 'mat-double-sided',
      category: 'Materials',
      severity: 'INFO',
      title: `Double-sided materials: ${doubleSidedCount}`,
      description: `${doubleSidedCount} material(s) disable backface culling. Disables early depth rejection on some rasterizers.`,
      count: doubleSidedCount,
      ratio: `${((doubleSidedCount / materials.length) * 100).toFixed(1)}% (${doubleSidedCount}/${materials.length})`,
    });
  }

  if (transparentCount > 0) {
    issues.push({
      id: 'mat-alpha-blend',
      category: 'Materials',
      severity: 'INFO',
      title: `Alpha blend materials: ${transparentCount}`,
      description: `${transparentCount} material(s) use alpha blending, which requires depth-sorting of transparent fragments.`,
      count: transparentCount,
      ratio: `${((transparentCount / materials.length) * 100).toFixed(1)}% (${transparentCount}/${materials.length})`,
    });
  }

  return issues;
}

export function evaluateTextureIssues(textures: TextureInfo[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  let nonPowerOfTwoCount = 0;
  let invalidDimensionCount = 0;

  function isPowerOfTwo(n: number) {
    return n > 0 && (n & (n - 1)) === 0;
  }

  for (const t of textures) {
    if (!Number.isFinite(t.width) || !Number.isFinite(t.height) || t.width <= 0 || t.height <= 0) {
      invalidDimensionCount++;
      continue;
    }
    if (!isPowerOfTwo(t.width) || !isPowerOfTwo(t.height)) {
      nonPowerOfTwoCount++;
    }
  }

  if (invalidDimensionCount > 0) {
    issues.push({
      id: 'tex-invalid-dimensions',
      category: 'Textures',
      severity: 'ERROR',
      layer: 'Integrity',
      title: `Invalid or unresolved textures: ${invalidDimensionCount}`,
      description: `${invalidDimensionCount} texture resource(s) have missing, unresolved, non-finite, or non-positive dimensions.`,
      count: invalidDimensionCount,
      ratio:
        textures.length > 0
          ? `${((invalidDimensionCount / textures.length) * 100).toFixed(1)}% (${invalidDimensionCount}/${textures.length})`
          : undefined,
      repairability: 'MANUAL',
      suggestedAction: 'Restore the missing image/resource or repair the source package before trusting material diagnostics.',
    });
  } else if (textures.length > 0) {
    issues.push({
      id: 'tex-metadata-readable',
      category: 'Textures',
      severity: 'OK',
      layer: 'Integrity',
      title: 'Texture metadata is readable',
      description: `All ${textures.length} detected texture(s) expose valid dimensions.`,
      count: textures.length,
      repairability: 'NONE',
    });
  } else {
    issues.push({
      id: 'tex-none',
      category: 'Textures',
      severity: 'N/A',
      layer: 'Health',
      title: 'No textures detected',
      description: 'No texture images were detected in the loaded asset.',
      repairability: 'NONE',
    });
  }

  if (nonPowerOfTwoCount > 0) {
    issues.push({
      id: 'tex-npot',
      category: 'Textures',
      severity: 'INFO',
      layer: 'Health',
      title: `Non-power-of-two textures: ${nonPowerOfTwoCount}`,
      description: `${nonPowerOfTwoCount} texture(s) do not use power-of-two dimensions. Modern WebGL2 supports them, so this is informational rather than a defect.`,
      count: nonPowerOfTwoCount,
      ratio:
        textures.length > 0
          ? `${((nonPowerOfTwoCount / textures.length) * 100).toFixed(1)}% (${nonPowerOfTwoCount}/${textures.length})`
          : undefined,
      repairability: 'NONE',
    });
  }

  return issues;
}

export function countIssuesBySeverity(issues: HealthIssue[]): Record<HealthSeverity, number> {
  const counts: Record<HealthSeverity, number> = {
    OK: 0,
    INFO: 0,
    WARNING: 0,
    ERROR: 0,
    'N/A': 0,
    UNKNOWN: 0,
  };
  for (const issue of issues) {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
  }
  return counts;
}

export function filterIssuesByCategory(
  issues: HealthIssue[],
  category: HealthCategory
): HealthIssue[] {
  return issues.filter((i) => i.category === category);
}

export interface HealthAggregateParams {
  summary: AssetSummary;
  profileId?: DiagnosticProfileId;
  materials: MaterialInfo[];
  textures: TextureInfo[];
  skeleton: SkinningStats;
  animations?: import('../types').AnimationClipInfo[];
  integrity?: HealthIssue[];
  animationDiagnostics?: HealthIssue[];
  transforms?: HealthIssue[];
  performance?: { stats?: any; issues?: HealthIssue[] } | HealthIssue[];
  normalsAndUv?: HealthIssue[];
  topology: TopologyStats[];
}

function evaluateIntegrity(summary: AssetSummary): HealthIssue[] {
  const countValues = [
    summary.nodeCount,
    summary.meshCount,
    summary.vertexCount,
    summary.triangleCount,
    summary.materialCount,
    summary.textureCount,
    ...summary.boundingBox.size,
    summary.boundingBox.diagonal,
  ];
  const coordinateValues = [
    ...summary.boundingBox.min,
    ...summary.boundingBox.max,
    ...summary.boundingBox.center,
  ];

  const hasInvalidNumber =
    countValues.some((value) => !Number.isFinite(value) || value < 0) ||
    coordinateValues.some((value) => !Number.isFinite(value));

  if (hasInvalidNumber) {
    return [{
      id: 'integrity-core-numeric-invalid',
      category: 'Geometry',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Invalid core asset data',
      description: 'One or more parsed scene/geometry metrics contain invalid, negative, NaN, or infinite values.',
      evidence: 'Core scene metrics failed finite/non-negative validation.',
      whyItMatters: 'Invalid numeric data can break camera framing, rendering, physics, export, or downstream repair operations.',
      suggestedAction: 'Inspect the source asset and parser diagnostics before attempting any repair.',
      repairability: 'MANUAL',
    }];
  }

  if (summary.meshCount === 0) {
    return [{
      id: 'integrity-no-meshes',
      category: 'Geometry',
      severity: 'INFO',
      layer: 'Integrity',
      title: 'No renderable meshes detected',
      description: 'The scene parsed successfully but contains no mesh primitives.',
      evidence: `meshCount=${summary.meshCount}, nodeCount=${summary.nodeCount}`,
      whyItMatters: 'This may be intentional for a helper/animation-only scene, but there is no visible surface to inspect.',
      suggestedAction: 'Confirm that a mesh-free scene is intentional.',
      repairability: 'NONE',
    }];
  }

  return [{
    id: 'integrity-core-readable',
    category: 'Geometry',
    severity: 'OK',
    layer: 'Integrity',
    title: 'Core scene data is structurally readable',
    description: 'Scene hierarchy, mesh counts and bounding data were parsed into finite values.',
    evidence: `${summary.meshCount} mesh(es), ${summary.vertexCount.toLocaleString()} vertices, ${summary.triangleCount.toLocaleString()} triangles.`,
    whyItMatters: 'This establishes a trustworthy base for deeper Health and Fitness diagnostics.',
    suggestedAction: 'No action required.',
    repairability: 'NONE',
  }];
}

function evaluateProfileExpectations(
  summary: AssetSummary,
  profileId: DiagnosticProfileId
): HealthIssue[] {
  const profile = getDiagnosticProfile(profileId);
  const issues: HealthIssue[] = [];

  if (profile.expectsRig === true && summary.skeletonCount === 0) {
    issues.push({
      id: 'fitness-rig-expected-missing',
      category: 'Skeleton',
      severity: 'WARNING',
      layer: 'Fitness',
      title: 'Rig expected by diagnostic profile',
      description: `${profile.label} expects a skeletal rig, but none was detected.`,
      evidence: `skeletonCount=${summary.skeletonCount}, profile=${profile.label}`,
      whyItMatters: 'The asset may be structurally valid, but it may not satisfy the intended character workflow.',
      suggestedAction: 'Confirm the intended use. Add or restore a rig only if this asset is meant to be skeletal.',
      repairability: 'MANUAL',
      profileDependent: true,
    });
  }

  if (profile.expectsAnimations === true && summary.clipCount === 0) {
    issues.push({
      id: 'fitness-animation-expected-missing',
      category: 'Animations',
      severity: 'WARNING',
      layer: 'Fitness',
      title: 'Animation clips expected by diagnostic profile',
      description: `${profile.label} expects animation clips, but none were detected.`,
      evidence: `clipCount=${summary.clipCount}, profile=${profile.label}`,
      whyItMatters: 'The file can still be healthy, but it may not be ready for the intended animated-character workflow.',
      suggestedAction: 'Confirm whether animation is expected before changing the asset.',
      repairability: 'MANUAL',
      profileDependent: true,
    });
  }

  return issues;
}

function defaultLayer(issue: HealthIssue): DiagnosticLayer {
  if (issue.layer) return issue.layer;
  if (issue.category === 'Performance') return 'Fitness';
  if (
    issue.id.startsWith('perf-') ||
    issue.id === 'tex-over-4096' ||
    issue.id === 'skin-max-influences'
  ) {
    return 'Fitness';
  }
  return 'Health';
}

function defaultRepairability(issue: HealthIssue): Repairability {
  if (issue.repairability) return issue.repairability;
  if (issue.severity === 'OK' || issue.severity === 'INFO' || issue.severity === 'N/A') return 'NONE';

  if (
    issue.id === 'topo-non-manifold-edges' ||
    issue.id === 'topo-duplicate-positions' ||
    issue.id === 'transform-negative-scale'
  ) {
    return 'MANUAL';
  }

  if (
    issue.id === 'topo-degenerate-triangles' ||
    issue.id === 'topo-isolated-vertices' ||
    issue.id === 'topo-tiny-components' ||
    issue.id === 'normals-zero' ||
    issue.id === 'skin-invalid-sum' ||
    issue.id === 'transform-root-scale' ||
    issue.id === 'transform-extreme-scale'
  ) {
    return 'CONDITIONAL';
  }

  return issue.severity === 'ERROR' ? 'MANUAL' : 'NONE';
}

function suggestedActionFor(issue: HealthIssue): string {
  if (issue.suggestedAction) return issue.suggestedAction;

  switch (issue.repairability ?? defaultRepairability(issue)) {
    case 'SAFE':
      return 'A deterministic non-destructive repair may be offered after preview and revalidation.';
    case 'CONDITIONAL':
      return 'Inspect the affected region first. Any repair must be previewed and followed by revalidation.';
    case 'MANUAL':
      return 'Manual or external-tool repair is recommended. Do not auto-fix this condition.';
    default:
      return 'No repair action is required.';
  }
}

function decorateIssue(issue: HealthIssue, profileId: DiagnosticProfileId): HealthIssue {
  const layer = defaultLayer(issue);
  const repairability = defaultRepairability(issue);

  return {
    ...issue,
    layer,
    repairability,
    profileId,
    profileDependent: issue.profileDependent ?? layer === 'Fitness',
    evidence:
      issue.evidence ??
      (issue.count !== undefined
        ? `Observed count: ${issue.count}`
        : issue.technicalDetails ?? issue.description),
    whyItMatters: issue.whyItMatters ?? issue.description,
    suggestedAction: suggestedActionFor({ ...issue, repairability }),
  };
}

export class HealthEngine {
  public static aggregate(params: HealthAggregateParams): HealthIssue[] {
    const issues: HealthIssue[] = [];
    const profileId = params.profileId ?? 'general';
    getDiagnosticProfile(profileId);

    issues.push(...evaluateIntegrity(params.summary));
    if (params.integrity && Array.isArray(params.integrity)) {
      issues.push(...params.integrity);
    }

    issues.push(...evaluateMaterialIssues(params.materials));
    issues.push(...evaluateTextureIssues(params.textures));
    issues.push(...evaluateSkinningIssues(params.skeleton, profileId));
    issues.push(...evaluateProfileExpectations(params.summary, profileId));

    if (params.animationDiagnostics && Array.isArray(params.animationDiagnostics)) {
      issues.push(...params.animationDiagnostics);
    }

    if (params.transforms && Array.isArray(params.transforms)) {
      issues.push(...params.transforms);
    }

    if (params.performance) {
      if (Array.isArray(params.performance)) {
        issues.push(...params.performance);
      } else if (params.performance.issues) {
        issues.push(...params.performance.issues);
      }
    }

    if (params.normalsAndUv && Array.isArray(params.normalsAndUv)) {
      issues.push(...params.normalsAndUv);
    }

    if (params.topology && params.topology.length > 0) {
      issues.push(...aggregateTopologyIssues(params.topology));
    }

    return issues.map((issue) => decorateIssue(issue, profileId));
  }
}
