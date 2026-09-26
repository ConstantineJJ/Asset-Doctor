import * as THREE from 'three';
import type { TextureInfo } from '../types';
import { getAuthoredMaterials } from '../viewer/AuthoredMaterialState';
import type { GltfSourceAudit } from '../loaders/GltfSourceAudit';

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

    const bytesEstimate = width > 0 && height > 0 ? width * height * 4 : 0;

    let formatStr = 'RGBA';
    if (texture.format === THREE.RGBFormat) formatStr = 'RGB';
    else if (texture.format === THREE.RedFormat) formatStr = 'R';
    else if (texture.format === THREE.RGFormat) formatStr = 'RG';

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

  // LoadingManager records failed dependent resources. Represent them explicitly
  // as invalid texture entries so Health cannot collapse "missing" into N/A.
  const sourceAudit = root.userData.__assetDoctorSourceAudit as GltfSourceAudit | undefined;
  for (const [index, url] of (sourceAudit?.resourceErrors ?? []).entries()) {
    result.push({
      uuid: `missing-resource-${index}-${url}`,
      name: `Missing resource: ${url}`,
      width: 0,
      height: 0,
      format: 'UNRESOLVED',
      colorSpace: 'unknown',
      uncompressedBytesEstimate: 0,
      materialsUsed: [],
    });
  }

  return result;
}