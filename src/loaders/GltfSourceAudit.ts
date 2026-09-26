import type { HealthIssue } from '../types';

export interface RawSkinWeightAudit {
  accessorCount: number;
  vertexCount: number;
  invalidSumVertices: number;
  zeroWeightVertices: number;
  unreadableAccessors: number;
}

export interface GltfSourceAudit {
  format: 'glb' | 'gltf' | 'unknown';
  extensionsUsed: string[];
  extensionsRequired: string[];
  semanticExtensions: string[];
  externalUris: string[];
  materialCount: number;
  textureCount: number;
  imageCount: number;
  animationCount: number;
  rawSkinWeights?: RawSkinWeightAudit;
  resourceErrors: string[];
}

const TRANSPORT_ONLY_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
]);

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

interface ParsedSource {
  json: any;
  bin?: Uint8Array;
  format: GltfSourceAudit['format'];
}

function decodeJson(bytes: Uint8Array) {
  const text = new TextDecoder('utf-8').decode(bytes).replace(/\u0000+$/g, '').trim();
  return JSON.parse(text);
}

function parseSource(buffer: ArrayBuffer): ParsedSource | null {
  if (buffer.byteLength >= 12) {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) === GLB_MAGIC) {
      let offset = 12;
      let json: any = null;
      let bin: Uint8Array | undefined;
      while (offset + 8 <= buffer.byteLength) {
        const length = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        const start = offset + 8;
        const end = start + length;
        if (end > buffer.byteLength) break;
        if (type === JSON_CHUNK) json = decodeJson(new Uint8Array(buffer, start, length));
        if (type === BIN_CHUNK && !bin) bin = new Uint8Array(buffer, start, length);
        offset = end;
      }
      return json ? { json, bin, format: 'glb' } : null;
    }
  }

  try {
    return { json: decodeJson(new Uint8Array(buffer)), format: 'gltf' };
  } catch {
    return null;
  }
}

function collectExternalUris(json: any): string[] {
  const uris = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0) return;
    if (/^(data:|blob:)/i.test(value)) return;
    uris.add(value);
  };
  for (const buffer of json?.buffers ?? []) add(buffer?.uri);
  for (const image of json?.images ?? []) add(image?.uri);
  return Array.from(uris);
}

function componentReader(componentType: number): ((view: DataView, offset: number) => number) | null {
  switch (componentType) {
    case 5120: return (view, offset) => view.getInt8(offset);
    case 5121: return (view, offset) => view.getUint8(offset);
    case 5122: return (view, offset) => view.getInt16(offset, true);
    case 5123: return (view, offset) => view.getUint16(offset, true);
    case 5125: return (view, offset) => view.getUint32(offset, true);
    case 5126: return (view, offset) => view.getFloat32(offset, true);
    default: return null;
  }
}

function componentBytes(componentType: number) {
  switch (componentType) {
    case 5120:
    case 5121: return 1;
    case 5122:
    case 5123: return 2;
    case 5125:
    case 5126: return 4;
    default: return 0;
  }
}

function normalizedValue(raw: number, componentType: number, normalized: boolean) {
  if (!normalized || componentType === 5126) return raw;
  switch (componentType) {
    case 5120: return Math.max(raw / 127, -1);
    case 5121: return raw / 255;
    case 5122: return Math.max(raw / 32767, -1);
    case 5123: return raw / 65535;
    case 5125: return raw / 4294967295;
    default: return raw;
  }
}

function inspectRawSkinWeights(json: any, bin?: Uint8Array): RawSkinWeightAudit | undefined {
  const weightAccessorIds = new Set<number>();
  for (const mesh of json?.meshes ?? []) {
    for (const primitive of mesh?.primitives ?? []) {
      const id = primitive?.attributes?.WEIGHTS_0;
      if (Number.isInteger(id)) weightAccessorIds.add(id);
    }
  }
  if (weightAccessorIds.size === 0) return undefined;

  const result: RawSkinWeightAudit = {
    accessorCount: weightAccessorIds.size,
    vertexCount: 0,
    invalidSumVertices: 0,
    zeroWeightVertices: 0,
    unreadableAccessors: 0,
  };

  if (!bin) {
    result.unreadableAccessors = weightAccessorIds.size;
    return result;
  }

  const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (const accessorId of weightAccessorIds) {
    const accessor = json?.accessors?.[accessorId];
    const bufferView = json?.bufferViews?.[accessor?.bufferView];
    const reader = componentReader(accessor?.componentType);
    const bytes = componentBytes(accessor?.componentType);
    const itemSize = accessor?.type === 'VEC4' ? 4 : 0;
    if (!accessor || !bufferView || !reader || !bytes || !itemSize || accessor.sparse) {
      result.unreadableAccessors++;
      continue;
    }
    const stride = bufferView.byteStride ?? bytes * itemSize;
    const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const count = accessor.count ?? 0;
    result.vertexCount += count;
    try {
      for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let j = 0; j < itemSize; j++) {
          const raw = reader(binView, base + i * stride + j * bytes);
          sum += normalizedValue(raw, accessor.componentType, Boolean(accessor.normalized));
        }
        if (Math.abs(sum) < 0.001) result.zeroWeightVertices++;
        else if (Math.abs(sum - 1) > 0.05) result.invalidSumVertices++;
      }
    } catch {
      result.unreadableAccessors++;
    }
  }
  return result;
}

export function auditGltfSource(buffer: ArrayBuffer): GltfSourceAudit {
  const parsed = parseSource(buffer);
  if (!parsed) {
    return {
      format: 'unknown',
      extensionsUsed: [],
      extensionsRequired: [],
      semanticExtensions: [],
      externalUris: [],
      materialCount: 0,
      textureCount: 0,
      imageCount: 0,
      animationCount: 0,
      resourceErrors: [],
    };
  }

  const extensionsUsed = Array.from(new Set<string>(parsed.json.extensionsUsed ?? []));
  return {
    format: parsed.format,
    extensionsUsed,
    extensionsRequired: Array.from(new Set<string>(parsed.json.extensionsRequired ?? [])),
    semanticExtensions: extensionsUsed.filter((name) => !TRANSPORT_ONLY_EXTENSIONS.has(name)),
    externalUris: collectExternalUris(parsed.json),
    materialCount: parsed.json.materials?.length ?? 0,
    textureCount: parsed.json.textures?.length ?? 0,
    imageCount: parsed.json.images?.length ?? 0,
    animationCount: parsed.json.animations?.length ?? 0,
    rawSkinWeights: inspectRawSkinWeights(parsed.json, parsed.bin),
    resourceErrors: [],
  };
}

export function sourceAuditIssues(audit?: GltfSourceAudit): HealthIssue[] {
  if (!audit) return [];
  const issues: HealthIssue[] = [];

  if (audit.resourceErrors.length > 0) {
    issues.push({
      id: 'source-resource-load-failed',
      category: 'Textures',
      severity: 'ERROR',
      layer: 'Integrity',
      title: `Referenced resources failed to load: ${audit.resourceErrors.length}`,
      description: 'The source references resources that the loader could not resolve. A missing resource must not be interpreted as an intentionally texture-free asset.',
      count: audit.resourceErrors.length,
      evidence: audit.resourceErrors.slice(0, 8).join(' · '),
      whyItMatters: 'Diagnostics based on an incompletely loaded glTF can be false or incomplete.',
      suggestedAction: 'Restore the missing resource or convert the asset to a self-contained GLB before repair/export.',
      repairability: 'MANUAL',
    });
  }

  const weights = audit.rawSkinWeights;
  if (weights && weights.invalidSumVertices > 0) {
    issues.push({
      id: 'source-skin-invalid-sum',
      category: 'Skinning',
      severity: 'WARNING',
      layer: 'Integrity',
      title: `Source skin weights were not normalized: ${weights.invalidSumVertices}`,
      description: `${weights.invalidSumVertices} source vertex/vertices had WEIGHTS_0 sums differing from 1.0 by > 0.05 before Three.js display normalization.`,
      count: weights.invalidSumVertices,
      evidence: 'Measured directly from the source glTF accessor before GLTFLoader creates the display scene.',
      whyItMatters: 'GLTFLoader normalizes weights for runtime display, so inspecting only the loaded BufferGeometry would hide this source-data defect.',
      suggestedAction: 'Treat this as a source integrity finding. Do not assume the displayed normalized weights were authored that way.',
      repairability: 'MANUAL',
    });
  }

  if (weights && weights.zeroWeightVertices > 0) {
    issues.push({
      id: 'source-skin-zero-weight',
      category: 'Skinning',
      severity: 'ERROR',
      layer: 'Integrity',
      title: `Source zero-weight vertices: ${weights.zeroWeightVertices}`,
      description: `${weights.zeroWeightVertices} source vertex/vertices have a zero WEIGHTS_0 sum.`,
      count: weights.zeroWeightVertices,
      evidence: 'Measured directly from the source glTF accessor before display normalization.',
      whyItMatters: 'A zero-weight source vertex has no authored skeletal influence and requires author intent to repair safely.',
      suggestedAction: 'Manual repair recommended; choose the intended bone influence in a DCC tool.',
      repairability: 'MANUAL',
    });
  }

  return issues;
}

export function sourceHasSemanticExtensions(audit?: GltfSourceAudit) {
  return Boolean(audit && audit.semanticExtensions.length > 0);
}
