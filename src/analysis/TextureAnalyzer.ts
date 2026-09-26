import * as THREE from 'three';
import type { TextureInfo } from '../types';
import { getAuthoredMaterials } from '../viewer/AuthoredMaterialState';

export function analyzeTextures(root: THREE.Object3D): TextureInfo[] {
  const texturesMap = new Map<string, { texture: THREE.Texture; materials: Set<string> }>();

  root.traverse((obj) => {
    if (obj.name?.startsWith('__ascope_internal_')) return;
    if (!(obj as THREE.Mesh).isMesh) return;

    const mesh = obj as THREE.Mesh;
    const mats = getAuthoredMaterials(mesh);

    for (const m of mats) {
      if (!m) continue;
      const matName = m.name || `Material_${(m as any).id || m.uuid.slice(0, 6)}`;
      const std = m as THREE.MeshStandardMaterial;

      const checkTex = (tex: THREE.Texture | null | undefined) => {
        if (!tex) return;
        let entry = texturesMap.get(tex.uuid);
        if (!entry) {
          entry = { texture: tex, materials: new Set<string>() };
          texturesMap.set(tex.uuid, entry);
        }
        entry.materials.add(matName);
      };

      checkTex(std.map);
      checkTex(std.normalMap);
      checkTex(std.roughnessMap);
      checkTex(std.metalnessMap);
      checkTex(std.aoMap);
      checkTex(std.emissiveMap);
    }
  });

  const result: TextureInfo[] = [];

  for (const { texture, materials } of texturesMap.values()) {
    let width = 0;
    let height = 0;

    const img = texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | null;
    if (img) {
      width = img.width || img.naturalWidth || 0;
      height = img.height || img.naturalHeight || 0;
    }

    // Conservative RGBA8 estimate. Compressed GPU formats are reported elsewhere
    // when explicit metadata is available; do not pretend this is file size.
    const bytesEstimate = width > 0 && height > 0 ? width * height * 4 : 0;

    let formatStr = 'RGBA';
    if (texture.format === THREE.RGBFormat) formatStr = 'RGB';
    else if (texture.format === THREE.RedFormat) formatStr = 'R';
    else if (texture.format === THREE.RGFormat) formatStr = 'RG';

    // Three.js uses an empty colorSpace for data textures such as normal,
    // roughness and metalness. Empty must not be silently relabelled as sRGB.
    const colorSpace = texture.colorSpace || 'none/data';

    result.push({
      uuid: texture.uuid,
      name: texture.name || `Texture_${texture.id}`,
      width,
      height,
      format: formatStr,
      colorSpace,
      uncompressedBytesEstimate: bytesEstimate,
      materialsUsed: Array.from(materials),
    });
  }

  return result;
}