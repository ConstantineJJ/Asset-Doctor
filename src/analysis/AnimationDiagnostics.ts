import * as THREE from 'three';
import type { HealthIssue } from '../types';
import { analyzeAnimations } from './AnimationAnalyzer';
import { documentBounds } from '../viewer/AssetPresentation';
import {isGltfCubic} from '../animation/ClipEdits';

function getRootBoneNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (!(object as THREE.Bone).isBone) return;
    const parent = object.parent;
    if (!parent || !(parent as THREE.Bone).isBone) {
      names.push(object.name || object.uuid);
    }
  });
  return names;
}

function targetExists(root: THREE.Object3D, trackName: string): boolean {
  try {
    const parsed = THREE.PropertyBinding.parseTrackName(trackName);

    if (parsed.objectName === 'bones' && parsed.objectIndex !== undefined) {
      const boneName = String(parsed.objectIndex);
      let found = false;
      root.traverse((object) => {
        if ((object as THREE.Bone).isBone && object.name === boneName) found = true;
      });
      return found;
    }

    if (!parsed.nodeName || parsed.nodeName === '.') return true;
    return Boolean(THREE.PropertyBinding.findNode(root, parsed.nodeName));
  } catch {
    return false;
  }
}

function isStaticTrack(track: THREE.KeyframeTrack): boolean {
  if (track.times.length < 2) return true;
  const stride=track.getValueSize(),cubic=isGltfCubic(track),valueSize=cubic?stride/3:stride;
  if (!Number.isFinite(valueSize) || valueSize <= 0 || !Number.isInteger(valueSize)) return false;
  if (track.values.length < valueSize * 2) return true;

  for (let keyIndex = 1; keyIndex < track.times.length; keyIndex++) {
    for (let component = 0; component < valueSize; component++) {
      const baseline = track.values[(cubic?valueSize:0)+component];
      const current = track.values[keyIndex * stride + (cubic?valueSize:0) + component];
      if (!Number.isFinite(baseline) || !Number.isFinite(current)) return false;
      if (Math.abs(current - baseline) > 1e-7) return false;
      // Hermite curves can move between equal keys. Only interval tangents
      // participate: the first incoming and final outgoing tangent are unused.
      if(cubic){
        const outgoing=track.values[(keyIndex-1)*stride+2*valueSize+component],incoming=track.values[keyIndex*stride+component];
        const interval=track.times[keyIndex]-track.times[keyIndex-1];
        if(!Number.isFinite(interval)||interval<=0||!Number.isFinite(outgoing)||!Number.isFinite(incoming)||Math.abs(outgoing*interval)>1e-7||Math.abs(incoming*interval)>1e-7)return false;
      }
    }
  }
  return true;
}

export function analyzeAnimationDiagnostics(
  clips: THREE.AnimationClip[],
  root: THREE.Object3D
): HealthIssue[] {
  const issues: HealthIssue[] = [];
  if (clips.length === 0) return issues;

  root.updateMatrixWorld(true);

  let invalidTargetTracks = 0;
  let malformedTracks = 0;
  let nonFiniteTimeKeys = 0;
  let nonFiniteValues = 0;
  let duplicateTimestamps = 0;
  let staticChannels = 0;
  let scaleChannels = 0;
  let extremePositionJumps = 0;

  const invalidTargetSamples: string[] = [];
  const malformedSamples: string[] = [];
  const staticSamples: string[] = [];
  const scaleSamples: string[] = [];
  const jumpSamples: string[] = [];
  const invalidTargetClipNames = new Set<string>();
  const malformedClipNames = new Set<string>();
  const nonFiniteClipNames = new Set<string>();
  const duplicateTimestampClipNames = new Set<string>();
  const staticClipNames = new Set<string>();
  const scaleClipNames = new Set<string>();
  const jumpClipNames = new Set<string>();

  const oneClip = (names: Set<string>): string | undefined =>
    names.size === 1 ? Array.from(names)[0] : undefined;

  const bounds = documentBounds(root);
  const diagonal = bounds.isEmpty() ? 0 : bounds.getSize(new THREE.Vector3()).length();
  const jumpThreshold = Math.max(1, diagonal * 2);

  for (const clip of clips) {
    for (const track of clip.tracks) {
      const times = track.times;
      const values = track.values;
      const valueSize = track.getValueSize();
      const clipName = clip.name || 'Unnamed';

      const malformed =
        times.length === 0 ||
        values.length === 0 ||
        !Number.isFinite(valueSize) ||
        valueSize <= 0 ||
        !Number.isInteger(valueSize) ||
        values.length !== times.length * valueSize;

      if (malformed) {
        malformedTracks++;
        malformedClipNames.add(clipName);
        if (malformedSamples.length < 8) malformedSamples.push(`${clipName}: ${track.name}`);
      }

      if (!targetExists(root, track.name)) {
        invalidTargetTracks++;
        invalidTargetClipNames.add(clipName);
        if (invalidTargetSamples.length < 8) invalidTargetSamples.push(`${clipName}: ${track.name}`);
      }

      for (let i = 0; i < times.length; i++) {
        if (!Number.isFinite(times[i])) {
          nonFiniteTimeKeys++;
          nonFiniteClipNames.add(clipName);
        }
        if (i > 0 && Number.isFinite(times[i]) && Number.isFinite(times[i - 1]) && Math.abs(times[i] - times[i - 1]) <= 1e-9) {
          duplicateTimestamps++;
          duplicateTimestampClipNames.add(clipName);
        }
      }

      for (let i = 0; i < values.length; i++) {
        if (!Number.isFinite(values[i])) {
          nonFiniteValues++;
          nonFiniteClipNames.add(clipName);
        }
      }

      if (!malformed && isStaticTrack(track)) {
        staticChannels++;
        staticClipNames.add(clipName);
        if (staticSamples.length < 8) staticSamples.push(`${clipName}: ${track.name}`);
      }

      if (track.name.endsWith('.scale')) {
        scaleChannels++;
        scaleClipNames.add(clipName);
        if (scaleSamples.length < 8) scaleSamples.push(`${clipName}: ${track.name}`);
      }

      if (!malformed && track.name.endsWith('.position') && valueSize >= 3 && times.length >= 2) {
        const valueOffset=isGltfCubic(track)?valueSize/3:0;
        for (let keyIndex = 1; keyIndex < times.length; keyIndex++) {
          const prevOffset = (keyIndex - 1) * valueSize + valueOffset;
          const nextOffset = keyIndex * valueSize + valueOffset;
          const dx = values[nextOffset] - values[prevOffset];
          const dy = values[nextOffset + 1] - values[prevOffset + 1];
          const dz = values[nextOffset + 2] - values[prevOffset + 2];

          if (![dx, dy, dz].every(Number.isFinite)) continue;
          const jump = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (jump > jumpThreshold) {
            extremePositionJumps++;
            jumpClipNames.add(clipName);
            if (jumpSamples.length < 8) {
              jumpSamples.push(`${clipName}: ${track.name} (${jump.toFixed(3)})`);
            }
          }
        }
      }
    }
  }

  if (invalidTargetTracks > 0) {
    issues.push({
      id: 'animation-invalid-targets',
      category: 'Animations',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Animation tracks target missing nodes',
      description: `${invalidTargetTracks} animation track(s) could not be resolved to a node or bone in the loaded scene.`,
      count: invalidTargetTracks,
      clipName: oneClip(invalidTargetClipNames),
      evidence: invalidTargetSamples.join('; '),
      whyItMatters: 'A track with no valid target cannot drive the intended transform or property.',
      suggestedAction: 'Restore the missing target or remove/retarget the track in an animation authoring tool.',
      repairability: 'MANUAL',
    });
  }

  if (malformedTracks > 0) {
    issues.push({
      id: 'animation-malformed-tracks',
      category: 'Animations',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'Malformed animation tracks detected',
      description: `${malformedTracks} track(s) have empty data or a key/value shape that does not match the track value size.`,
      count: malformedTracks,
      clipName: oneClip(malformedClipNames),
      evidence: malformedSamples.join('; '),
      whyItMatters: 'Malformed keyframe tracks cannot be evaluated or edited deterministically.',
      suggestedAction: 'Repair or re-export the affected clips before applying animation patches.',
      repairability: 'MANUAL',
    });
  }

  if (nonFiniteTimeKeys > 0 || nonFiniteValues > 0) {
    issues.push({
      id: 'animation-nonfinite-keys',
      category: 'Animations',
      severity: 'ERROR',
      layer: 'Integrity',
      title: 'NaN / Infinity found in animation keys',
      description: `${nonFiniteTimeKeys} non-finite timestamp(s) and ${nonFiniteValues} non-finite animation value component(s) were detected.`,
      count: nonFiniteTimeKeys + nonFiniteValues,
      clipName: oneClip(nonFiniteClipNames),
      evidence: `timestamps=${nonFiniteTimeKeys}, values=${nonFiniteValues}`,
      whyItMatters: 'Non-finite animation data can poison interpolation, playback and export.',
      suggestedAction: 'Correct the source animation data; do not synthesize replacement keys automatically.',
      repairability: 'MANUAL',
    });
  }

  if (
    invalidTargetTracks === 0 &&
    malformedTracks === 0 &&
    nonFiniteTimeKeys === 0 &&
    nonFiniteValues === 0
  ) {
    issues.push({
      id: 'animation-integrity-ok',
      category: 'Animations',
      severity: 'OK',
      layer: 'Integrity',
      title: 'Animation track integrity verified',
      description: 'Animation targets resolve and keyframe arrays contain finite, structurally coherent data.',
      repairability: 'NONE',
    });
  }

  if (duplicateTimestamps > 0) {
    issues.push({
      id: 'animation-duplicate-timestamps',
      category: 'Animations',
      severity: 'WARNING',
      layer: 'Health',
      title: 'Duplicate animation timestamps detected',
      description: `${duplicateTimestamps} adjacent duplicate timestamp(s) were found in animation tracks.`,
      count: duplicateTimestamps,
      clipName: oneClip(duplicateTimestampClipNames),
      whyItMatters: 'Duplicate timestamps can create ambiguous interpolation or redundant keys.',
      suggestedAction: 'Inspect the affected clips. A future verified AnimationPatch may remove redundant duplicates safely.',
      repairability: 'MANUAL',
    });
  }

  if (staticChannels > 0) {
    issues.push({
      id: 'animation-static-channels',
      category: 'Animations',
      severity: 'INFO',
      layer: 'Health',
      title: 'Static animation channels detected',
      description: `${staticChannels} track(s) keep the same value for the entire clip.`,
      count: staticChannels,
      clipName: oneClip(staticClipNames),
      evidence: staticSamples.join('; '),
      whyItMatters: 'Static channels are often harmless but may be redundant runtime/export data.',
      suggestedAction: 'No action required. Preserve them unless a later verified cleanup patch proves they are redundant.',
      repairability: 'NONE',
    });
  }

  const rootBoneNames = getRootBoneNames(root);
  const metadata = analyzeAnimations(clips, rootBoneNames);
  const rootMotionClips = metadata.filter((clip) => clip.rootMotionDetected);
  if (rootMotionClips.length > 0) {
    issues.push({
      id: 'animation-root-motion',
      category: 'Animations',
      severity: 'INFO',
      layer: 'Health',
      title: 'Root motion detected',
      description: `${rootMotionClips.length} clip(s) contain significant root translation.`,
      count: rootMotionClips.length,
      clipName: rootMotionClips.length === 1 ? rootMotionClips[0].name : undefined,
      evidence: rootMotionClips
        .slice(0, 8)
        .map((clip) => `${clip.name}: ${clip.rootMotionTranslation ?? 0}m`)
        .join('; '),
      whyItMatters: 'Root motion may be intentional or may conflict with in-place runtime locomotion.',
      suggestedAction: 'Confirm the intended gameplay/runtime motion model before changing the clip.',
      repairability: 'NONE',
    });
  }

  if (scaleChannels > 0) {
    issues.push({
      id: 'animation-scale-channels',
      category: 'Animations',
      severity: 'INFO',
      layer: 'Health',
      title: 'Scale animation detected',
      description: `${scaleChannels} animation track(s) modify node or bone scale.`,
      count: scaleChannels,
      clipName: oneClip(scaleClipNames),
      evidence: scaleSamples.join('; '),
      whyItMatters: 'Animated scale may be intentional, but it can complicate retargeting, physics and engine assumptions.',
      suggestedAction: 'Inspect the clips before deciding whether scale animation should be retained.',
      repairability: 'NONE',
    });
  }

  if (extremePositionJumps > 0) {
    issues.push({
      id: 'animation-extreme-position-jumps',
      category: 'Animations',
      severity: 'WARNING',
      layer: 'Health',
      title: 'Extreme animation position jumps detected',
      description: `${extremePositionJumps} adjacent key transition(s) exceed the conservative jump threshold of ${jumpThreshold.toFixed(3)} scene units.`,
      count: extremePositionJumps,
      clipName: oneClip(jumpClipNames),
      evidence: jumpSamples.join('; '),
      whyItMatters: 'Very large single-key position changes can indicate a discontinuity, unit mismatch or broken export.',
      suggestedAction: 'Inspect the affected track in context. Do not smooth or clamp it automatically.',
      repairability: 'MANUAL',
    });
  }

  return issues;
}
