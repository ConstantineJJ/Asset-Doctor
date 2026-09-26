import * as THREE from 'three';
import type { AssetSummary } from '../types';

export type CompareViewMode = 'grid' | 'lineup';
export type CompareScaleMode = 'real' | 'normalize-height';

export interface CompareAssetRecord {
  id: string;
  slot: 'A' | 'B' | 'C' | 'D' | 'E';
  fileName: string;
  fileSizeBytes?: number;
  root: THREE.Group;
  animations: THREE.AnimationClip[];
  summary: AssetSummary;
  textureVramBytes: number;
  drawCalls: number;
  selectedClipIndex: number;
}

export interface CompareViewportRect {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
