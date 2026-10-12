import * as THREE from 'three';
import type { HealthIssue } from '../types';
import { documentBounds } from '../viewer/AssetPresentation';

const SCALE_EPSILON = 0.001;
const ROTATION_INFO_THRESHOLD_DEG = 1;

export function analyzeTransforms(root: THREE.Object3D): HealthIssue[] {
  const issues: HealthIssue[] = [];

  // Root scale is a fact worth surfacing, but not a reason to reset transforms automatically.
  const sx = root.scale.x;
  const sy = root.scale.y;
  const sz = root.scale.z;

  if (
    Math.abs(sx - 1.0) > SCALE_EPSILON ||
    Math.abs(sy - 1.0) > SCALE_EPSILON ||
    Math.abs(sz - 1.0) > SCALE_EPSILON
  ) {
    issues.push({
      id: 'transform-root-scale',
      category: 'Transforms',
      severity: 'WARNING',
      layer: 'Health',
      title: 'Root scale is not 1.0',
      description: `Root object scale is (${sx.toFixed(3)}, ${sy.toFixed(3)}, ${sz.toFixed(3)}). This may be intentional, imported unit conversion, or unapplied scale.`,
      technicalDetails: `Reference scale [1, 1, 1]. Found: [${sx}, ${sy}, ${sz}]`,
      whyItMatters: 'Non-unit root scale can affect physics, authored distances, animation assumptions and engine import behavior.',
      suggestedAction: 'Inspect the source units and intended engine scale before changing anything.',
      repairability: 'MANUAL',
    });
  }

  const rootRotationAngleDeg =
    new THREE.Quaternion().setFromEuler(root.rotation).angleTo(new THREE.Quaternion()) *
    (180 / Math.PI);

  if (rootRotationAngleDeg > ROTATION_INFO_THRESHOLD_DEG) {
    issues.push({
      id: 'transform-root-rotation',
      category: 'Transforms',
      severity: 'INFO',
      layer: 'Health',
      title: 'Root object has a non-zero rotation',
      description: `Root rotation differs from identity by approximately ${rootRotationAngleDeg.toFixed(2)}°.`,
      evidence: `Euler radians: [${root.rotation.x.toFixed(4)}, ${root.rotation.y.toFixed(4)}, ${root.rotation.z.toFixed(4)}]`,
      whyItMatters: 'Root rotation can be intentional axis conversion, but it may surprise engine-side placement or animation tooling.',
      suggestedAction: 'Confirm the intended forward/up axes. Do not reset the rotation automatically.',
      repairability: 'NONE',
    });
  }

  let negativeScaleCount = 0;
  let extremeScaleCount = 0;
  let suspiciousCombinationCount = 0;
  const suspiciousSamples: string[] = [];

  root.traverse((obj) => {
    if (obj.name?.startsWith('__ascope_internal_')) return;

    const absX = Math.abs(obj.scale.x);
    const absY = Math.abs(obj.scale.y);
    const absZ = Math.abs(obj.scale.z);

    if (obj.scale.x < 0 || obj.scale.y < 0 || obj.scale.z < 0) {
      negativeScaleCount++;
    }

    const maxS = Math.max(absX, absY, absZ);
    const minS = Math.min(absX, absY, absZ);
    if (maxS > 1000 || minS === 0 || (minS < 0.0001 && minS > 0)) {
      extremeScaleCount++;
    }

    const nonUniformScale =
      Math.abs(absX - absY) > SCALE_EPSILON ||
      Math.abs(absY - absZ) > SCALE_EPSILON ||
      Math.abs(absX - absZ) > SCALE_EPSILON;
    const rotationAngle = obj.quaternion.angleTo(new THREE.Quaternion());

    if (nonUniformScale && rotationAngle > THREE.MathUtils.degToRad(1)) {
      suspiciousCombinationCount++;
      if (suspiciousSamples.length < 8) {
        suspiciousSamples.push(obj.name || `${obj.type}_${obj.id}`);
      }
    }
  });

  if (negativeScaleCount > 0) {
    issues.push({
      id: 'transform-negative-scale',
      category: 'Transforms',
      severity: 'WARNING',
      layer: 'Health',
      title: 'Negative scale detected',
      description: `${negativeScaleCount} object(s) have negative scale components, which can invert winding and interact with normal/tangent conventions.`,
      count: negativeScaleCount,
      technicalDetails: `Found ${negativeScaleCount} node(s) with scale < 0`,
      whyItMatters: 'Negative scale is legal but can complicate culling, tangent space, physics and downstream transform decomposition.',
      suggestedAction: 'Inspect the affected nodes in context. Do not apply or reset scale automatically.',
      repairability: 'MANUAL',
    });
  }

  if (extremeScaleCount > 0) {
    issues.push({
      id: 'transform-extreme-scale',
      category: 'Transforms',
      severity: 'WARNING',
      layer: 'Health',
      title: 'Extreme scale values detected',
      description: `${extremeScaleCount} object(s) have zero, >1000×, or <0.0001× scale magnitudes.`,
      count: extremeScaleCount,
      whyItMatters: 'Extreme scale can reduce numerical precision and may indicate unit conversion or import problems.',
      suggestedAction: 'Inspect units and hierarchy transforms before changing scale.',
      repairability: 'MANUAL',
    });
  }

  if (suspiciousCombinationCount > 0) {
    issues.push({
      id: 'transform-suspicious-combinations',
      category: 'Transforms',
      severity: 'INFO',
      layer: 'Health',
      title: 'Non-uniform scale combined with rotation',
      description: `${suspiciousCombinationCount} object(s) combine non-uniform scale and non-zero rotation.`,
      count: suspiciousCombinationCount,
      evidence: `Sample nodes: ${suspiciousSamples.join(', ') || 'unavailable'}`,
      whyItMatters: 'This transform combination can make decomposition, physics proxies and cross-tool round trips harder to reason about.',
      suggestedAction: 'Treat as inspection information. Do not normalize transforms automatically.',
      repairability: 'NONE',
    });
  }

  // Check model distance from origin.
  const box = documentBounds(root);
  if (!box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const distFromOrigin = center.length();
    const size = box.getSize(new THREE.Vector3()).length();

    if (distFromOrigin > Math.max(50, size * 5)) {
      issues.push({
        id: 'transform-far-origin',
        category: 'Transforms',
        severity: 'WARNING',
        layer: 'Health',
        title: 'Model center is far from origin',
        description: `Model center is ${distFromOrigin.toFixed(1)} units away from (0,0,0).`,
        technicalDetails: `Center: [${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}]`,
        whyItMatters: 'Large world offsets can reduce precision and make placement or pivot assumptions less predictable.',
        suggestedAction: 'Confirm that the offset is intentional before moving the asset.',
        repairability: 'NONE',
      });
    }
  }

  return issues;
}
