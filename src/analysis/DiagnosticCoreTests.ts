import type {
  AssetSummary,
  HealthIssue,
  MaterialInfo,
  SkinningStats,
  TextureInfo,
  TopologyStats,
} from '../types';
import { HealthEngine, aggregateTopologyIssues } from '../health/HealthEngine';
import { analyzePerformance } from './PerformanceAnalyzer';
import { DIAGNOSTIC_PROFILES } from '../health/DiagnosticProfiles';
import type {DiagnosticProfileId} from '../types';

export interface DiagnosticCoreTestResult {
  name: string;
  description: string;
  expected: string;
  actual: string;
  passed: boolean;
}

function makeSummary(overrides: Partial<AssetSummary> = {}): AssetSummary {
  return {
    fileName: 'synthetic.glb',
    nodeCount: 2,
    meshCount: 1,
    primitiveCount: 1,
    vertexCount: 24,
    indexedVertexCount: 24,
    triangleCount: 12,
    lineCount: 0,
    pointCount: 0,
    materialCount: 1,
    textureCount: 0,
    skeletonCount: 0,
    boneCount: 0,
    skinnedMeshCount: 0,
    clipCount: 0,
    clips: [],
    boundingBox: {
      min: [-0.5, 0, -0.5],
      max: [0.5, 1, 0.5],
      size: [1, 1, 1],
      center: [0, 0.5, 0],
      diagonal: Math.sqrt(3),
    },
    ...overrides,
  };
}

const emptySkeleton: SkinningStats = {
  skinnedMeshCount: 0,
  skeletonCount: 0,
  totalBones: 0,
  rootBoneNames: [],
  maxInfluencesPerVertex: 0,
  zeroWeightVertices: 0,
  invalidWeightSumVertices: 0,
  unusedBonesCount: 0,
  redundantInfluenceVertices: 0,
  bones: [],
};

function aggregate(
  summary: AssetSummary,
  profileId: Parameters<typeof HealthEngine.aggregate>[0]['profileId'] = 'general',
  textures: TextureInfo[] = []
): HealthIssue[] {
  const performance = analyzePerformance(summary, textures, 0, profileId);
  return HealthEngine.aggregate({
    summary,
    profileId,
    materials: [] as MaterialInfo[],
    textures,
    skeleton: emptySkeleton,
    animations: [],
    transforms: [],
    performance,
    normalsAndUv: [],
    topology: [],
  });
}

export function runDiagnosticCoreTests(): DiagnosticCoreTestResult[] {
  const results: DiagnosticCoreTestResult[] = [];

  for (const profileId of Object.keys(DIAGNOSTIC_PROFILES) as DiagnosticProfileId[]) {
    const summary = makeSummary({triangleCount:350000,primitiveCount:70,skeletonCount:1,boneCount:10,clipCount:0});
    const skeleton = {...emptySkeleton,skeletonCount:1,totalBones:10,maxInfluencesPerVertex:6,zeroWeightVertices:2};
    const textures:TextureInfo[] = [{uuid:'profile-texture',name:'Large',width:8192,height:8192,format:'RGBA',colorSpace:'srgb',uncompressedBytesEstimate:268435456,materialsUsed:[]}];
    const params = {summary,skeleton,textures,materials:[],topology:[]};
    const previous = HealthEngine.aggregate({...params,profileId:'general',performance:analyzePerformance(summary,textures,0,'general')});
    const unknown:HealthIssue={id:'worker-failure',category:'Topology',layer:'Health',severity:'UNKNOWN',title:'Unavailable',description:'Controlled failure'};
    previous.push(unknown);
    const original = JSON.stringify(previous);
    const next = HealthEngine.reinterpretFitness(previous,{summary,skeleton,profileId,performance:analyzePerformance(summary,textures,0,profileId)});
    const expected = HealthEngine.aggregate({...params,profileId,performance:analyzePerformance(summary,textures,0,profileId)}).filter(issue=>issue.layer==='Fitness');
    const technical = previous.filter(issue=>issue.layer!=='Fitness');
    const actualTechnical = next.filter(issue=>issue.layer!=='Fitness');
    results.push({name:`F09 cached Fitness ${profileId}`,description:'Profile rules match a full report while preserving technical findings, failure evidence and input data.',expected:'Same Fitness; identical technical object references; immutable input',actual:next.map(issue=>issue.id).join(','),
      passed:JSON.stringify(next.filter(issue=>issue.layer==='Fitness'))===JSON.stringify(expected)&&technical.length===actualTechnical.length&&technical.every((issue,index)=>issue===actualTechnical[index])&&next.includes(unknown)&&JSON.stringify(previous)===original});
  }

  {
    const issues = aggregate(makeSummary());
    const integrity = issues.find((i) => i.id === 'integrity-core-readable');
    results.push({
      name: 'Integrity Layer Test',
      description: 'Valid finite scene metrics must produce a readable Integrity result.',
      expected: 'OK issue in Integrity layer',
      actual: integrity ? `${integrity.severity} / ${integrity.layer}` : 'missing',
      passed: integrity?.severity === 'OK' && integrity.layer === 'Integrity',
    });
  }

  {
    const issues = aggregate(makeSummary());
    const rig = issues.find((i) => i.id === 'skin-static-ok');
    results.push({
      name: 'N/A Semantics Test',
      description: 'A static asset must not be marked unhealthy merely because it has no rig.',
      expected: 'Skeleton check = N/A',
      actual: rig ? `${rig.severity} / ${rig.layer}` : 'missing',
      passed: rig?.severity === 'N/A' && rig.layer === 'Health',
    });
  }

  {
    const issues = aggregate(makeSummary(), 'mobile-game-character');
    const rigFitness = issues.find((i) => i.id === 'fitness-rig-expected-missing');
    const animFitness = issues.find((i) => i.id === 'fitness-animation-expected-missing');
    results.push({
      name: 'Profile Expectation Test',
      description: 'A mobile character profile should reinterpret missing rig/animation as Fitness warnings.',
      expected: '2 Fitness warnings',
      actual: `${[rigFitness, animFitness].filter(Boolean).length} matching finding(s)`,
      passed:
        rigFitness?.severity === 'WARNING' &&
        rigFitness.layer === 'Fitness' &&
        animFitness?.severity === 'WARNING' &&
        animFitness.layer === 'Fitness',
    });
  }

  {
    const summary = makeSummary({ triangleCount: 120000 });
    const general = analyzePerformance(summary, [], 0, 'general').issues;
    const mobile = analyzePerformance(summary, [], 0, 'mobile-game-character').issues;
    const generalWarn = general.some((i) => i.id === 'perf-triangle-high');
    const mobileWarn = mobile.some((i) => i.id === 'perf-triangle-high');
    results.push({
      name: 'Fitness Threshold Test',
      description: 'The same raw triangle count must be interpreted differently by different target profiles.',
      expected: 'General: no warning; Mobile: warning',
      actual: `General=${generalWarn ? 'warning' : 'ok'}, Mobile=${mobileWarn ? 'warning' : 'ok'}`,
      passed: !generalWarn && mobileWarn,
    });
  }

  {
    const badTexture: TextureInfo = {
      uuid: 'bad-texture',
      name: 'bad',
      width: 0,
      height: 2048,
      format: 'RGBA',
      colorSpace: 'srgb',
      uncompressedBytesEstimate: 0,
      materialsUsed: [],
    };
    const issues = aggregate(makeSummary({ textureCount: 1 }), 'general', [badTexture]);
    const finding = issues.find((i) => i.id === 'tex-invalid-dimensions');
    results.push({
      name: 'Invalid Texture Integrity Test',
      description: 'Non-positive texture dimensions are invalid data, not a target-profile preference.',
      expected: 'ERROR in Integrity layer',
      actual: finding ? `${finding.severity} / ${finding.layer}` : 'missing',
      passed: finding?.severity === 'ERROR' && finding.layer === 'Integrity',
    });
  }

  {
    const topology: TopologyStats[] = [{
      meshUuid: 'mesh',
      meshName: 'mesh',
      degenerateTriangles: 2,
      degenerateIndices: [0, 1],
      boundaryEdges: 0,
      nonManifoldEdges: 1,
      isolatedVertices: 0,
      componentsCount: 1,
      tinyComponentsCount: 0,
      thinTriangles: 0,
      potentialDuplicatePositions: 0,
      duplicateTriangles: 0,
      minTriangleArea: 0,
      maxTriangleArea: 1,
      avgTriangleArea: 0.5,
      denseTrianglesCount: 0,
      triangleCount: 12,
      vertexCount: 24,
      localization: {
        degenerate: {
          focusPoint: [1, 2, 3],
          affectedIndices: [0],
          element: 'triangle',
        },
        nonManifold: {
          focusPoint: [2, 3, 4],
          affectedIndices: [4, 5],
          element: 'edge',
        },
      },
    }];
    const findings = aggregateTopologyIssues(topology);
    const degenerate = findings.find((i) => i.id === 'topo-degenerate-triangles');
    const nonManifold = findings.find((i) => i.id === 'topo-non-manifold-edges');
    results.push({
      name: 'Topology Health Classification Test',
      description: 'Topology anomalies should be Health warnings by default, not structural Integrity errors.',
      expected: 'Degenerate + non-manifold = WARNING',
      actual: `${degenerate?.severity ?? 'missing'} / ${nonManifold?.severity ?? 'missing'}`,
      passed: degenerate?.severity === 'WARNING' && nonManifold?.severity === 'WARNING',
    });
  }

  {
    const topology: TopologyStats[] = [{
      meshUuid: 'localized-mesh',
      meshName: 'Body',
      degenerateTriangles: 1,
      degenerateIndices: [7],
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      isolatedVertices: 0,
      componentsCount: 1,
      tinyComponentsCount: 0,
      thinTriangles: 0,
      potentialDuplicatePositions: 0,
      duplicateTriangles: 0,
      minTriangleArea: 0,
      maxTriangleArea: 1,
      avgTriangleArea: 0.5,
      denseTrianglesCount: 0,
      triangleCount: 12,
      vertexCount: 24,
      localization: {
        degenerate: {
          focusPoint: [1, 2, 3],
          affectedIndices: [7],
          element: 'triangle',
        },
      },
    }];
    const finding = aggregateTopologyIssues(topology).find((i) => i.id === 'topo-degenerate-triangles');
    results.push({
      name: 'Issue Localization Contract Test',
      description: 'A localizable topology finding must retain its mesh UUID, affected indices and world-space focus point.',
      expected: 'Body / triangle 7 / focus [1,2,3]',
      actual: finding
        ? `${finding.meshName ?? 'none'} / ${finding.affectedIndices?.[0] ?? 'none'} / [${finding.focusPosition?.join(',') ?? 'none'}]`
        : 'missing',
      passed:
        finding?.meshUuid === 'localized-mesh' &&
        finding.meshName === 'Body' &&
        finding.affectedElement === 'triangle' &&
        finding.affectedIndices?.[0] === 7 &&
        finding.focusPosition?.[0] === 1 &&
        finding.focusPosition?.[1] === 2 &&
        finding.focusPosition?.[2] === 3,
    });
  }

  {
    const topology: TopologyStats[] = [{
      meshUuid: 'multi-mesh',
      meshName: 'Body',
      degenerateTriangles: 2,
      degenerateIndices: [1, 8],
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      isolatedVertices: 0,
      componentsCount: 1,
      tinyComponentsCount: 0,
      thinTriangles: 0,
      potentialDuplicatePositions: 0,
      duplicateTriangles: 0,
      minTriangleArea: 0,
      maxTriangleArea: 1,
      avgTriangleArea: 0.5,
      denseTrianglesCount: 0,
      triangleCount: 12,
      vertexCount: 24,
      localizationSamples: {
        degenerate: [
          { focusPoint: [1, 1, 1], affectedIndices: [1], element: 'triangle' },
          { focusPoint: [2, 2, 2], affectedIndices: [8], element: 'triangle' },
        ],
      },
    }];
    const finding = aggregateTopologyIssues(topology).find((i) => i.id === 'topo-degenerate-triangles');
    results.push({
      name: 'Multiple Issue Locations Test',
      description: 'One diagnostic finding can expose multiple representative locations for Previous/Next navigation.',
      expected: '2 locations: triangles 1 and 8',
      actual: finding?.locations
        ? `${finding.locations.length} locations: ${finding.locations.map((loc) => loc.affectedIndices?.[0]).join(',')}`
        : 'missing',
      passed:
        finding?.locations?.length === 2 &&
        finding.locations[0].affectedIndices?.[0] === 1 &&
        finding.locations[1].affectedIndices?.[0] === 8,
    });
  }

  {
    const topology: TopologyStats[] = [{
      meshUuid: 'manual-mesh',
      meshName: 'ManualMesh',
      degenerateTriangles: 1,
      degenerateIndices: [0],
      boundaryEdges: 3,
      nonManifoldEdges: 1,
      isolatedVertices: 0,
      componentsCount: 4,
      tinyComponentsCount: 1,
      thinTriangles: 2,
      potentialDuplicatePositions: 0,
      duplicateTriangles: 0,
      minTriangleArea: 0,
      maxTriangleArea: 1,
      avgTriangleArea: 0.25,
      denseTrianglesCount: 0,
      triangleCount: 10,
      vertexCount: 20,
    }];
    const findings = aggregateTopologyIssues(topology);
    const nonManifold = findings.find((issue) => issue.id === 'topo-non-manifold-edges');
    const boundary = findings.find((issue) => issue.id === 'topo-boundary-edges');
    const tiny = findings.find((issue) => issue.id === 'topo-tiny-components');
    const thin = findings.find((issue) => issue.id === 'topo-thin-triangles');
    const degenerate = findings.find((issue) => issue.id === 'topo-degenerate-triangles');

    results.push({
      name: 'Diagnostic Explanation Manual Clarity Test',
      description: 'Intent-dependent topology findings must be explicitly manual-only while deterministic counts expose reliable ratios.',
      expected: 'manual non-manifold/boundary/tiny/thin + degenerate ratio 10.0% (1/10)',
      actual: `repairs=${[
        nonManifold?.repairability,
        boundary?.repairability,
        tiny?.repairability,
        thin?.repairability,
      ].join(',')}; ratio=${degenerate?.ratio ?? 'missing'}`,
      passed:
        nonManifold?.repairability === 'MANUAL' &&
        boundary?.repairability === 'MANUAL' &&
        tiny?.repairability === 'MANUAL' &&
        thin?.repairability === 'MANUAL' &&
        degenerate?.ratio === '10.0% (1/10)',
    });
  }

  return results;
}
