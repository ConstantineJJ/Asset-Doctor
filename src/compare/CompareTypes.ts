import * as THREE from 'three';
import type { AssetSummary, LightingPreset, RenderMode } from '../types';

export type CompareViewMode = 'grid' | 'lineup';
export type CompareScaleMode = 'real' | 'normalize-height';

export interface CompareAssetRecord {
  id: string;
  slot: 'A' | 'B' | 'C' | 'D' | 'E';
  fileName: string;
  fileSizeBytes?: number;
  /** Pristine source bytes kept so a Compare asset can be reopened in Doctor safely. */
  sourceBuffer?: ArrayBuffer;
  root: THREE.Group;
  animations: THREE.AnimationClip[];
  summary: AssetSummary;
  textureVramBytes: number;
  drawCalls: number;
  selectedClipIndex: number;
  /** Presentation-only multiplier used by Lineup. Never mutates the source asset. */
  manualScale: number;
}

export interface CompareMetricAsset {
  id: string;
  slot: CompareAssetRecord['slot'];
  fileName: string;
  fileSizeBytes?: number;
  triangleCount: number;
  vertexCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  boneCount: number;
  animationCount: number;
  drawCalls: number;
  textureVramBytes: number;
  height: number;
  manualScale: number;
}

export interface CompareSessionSnapshot {
  assets: CompareMetricAsset[];
  activeAssetId: string | null;
  viewMode: CompareViewMode;
  scaleMode: CompareScaleMode;
  syncCameras: boolean;
  syncAnimations: boolean;
  renderMode: RenderMode;
  lightingPreset: LightingPreset;
}

export interface CompareViewportRect {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
