import type * as THREE from 'three';
import type { GltfSourceAudit } from './GltfSourceAudit';

const audits = new WeakMap<THREE.Object3D,GltfSourceAudit>();
// glTF extras may be any JSON value, including arrays, scalars and null.
const documentExtras = new WeakMap<THREE.Object3D,unknown>();
const textureExtras = new WeakMap<THREE.Texture,unknown>();
export interface SourceAssociation { nodes?:number; meshes?:number; primitives?:number; textures?:number }
const documents = new WeakMap<THREE.Object3D,Record<string,any>>();
const sourceAssociations = new WeakMap<THREE.Object3D,SourceAssociation>();
const legacyKeys = ['__assetDoctorSourceAudit','__assetDoctorAuthoredMaterials','__assetDoctorCompareGrounded'];

function authorExtras(value: unknown) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const extras = {...value} as Record<string,unknown>;
  for (const key of legacyKeys) delete extras[key];
  return extras;
}

/** Remove only known legacy runtime fields; unrelated author extras stay intact. */
export function removeLegacyRuntimeMetadata(root: THREE.Object3D) {
  const clean = (object: {userData: Record<string,unknown>}) => {
    for (const key of legacyKeys) delete object.userData[key];
  };
  root.traverse(object => {
    clean(object);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) clean(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      clean(material);
      for (const value of Object.values(material)) if (value?.isTexture) clean(value);
    }
  });
}

export function captureSourceMetadata(
  root: THREE.Object3D, audit: GltfSourceAudit | undefined,
  document: {extras?:unknown;textures?:{extras?:unknown}[]},
  associations: Map<THREE.Object3D | THREE.Material | THREE.Texture,SourceAssociation>,
) {
  removeLegacyRuntimeMetadata(root);
  documents.set(root,document);
  if (audit) audits.set(root,audit);
  const extras = authorExtras(document.extras);
  if (extras !== undefined) documentExtras.set(root,extras);
  for (const [object,association] of associations) {
    if ((object as THREE.Object3D).isObject3D) sourceAssociations.set(object as THREE.Object3D,{...association});
    if (!(object as THREE.Texture).isTexture || association.textures === undefined) continue;
    const extras = authorExtras(document.textures?.[association.textures]?.extras);
    if (extras !== undefined) textureExtras.set(object as THREE.Texture,extras);
  }
}

export const getSourceAudit = (root: THREE.Object3D) => audits.get(root);
export const getDocumentExtras = (root: THREE.Object3D) => documentExtras.get(root);
export const getTextureExtras = (texture: THREE.Texture) => textureExtras.get(texture);
/** Parser source and canonical identities are read-only runtime facts, never extras. */
export const getSourceDocument = (root: THREE.Object3D) => documents.get(root);
export const getSourceAssociation = (node: THREE.Object3D) => sourceAssociations.get(node);

/** Source facts and author extras are shared read-only by presentation clones. */
export function copySourceMetadata(source: THREE.Object3D, clone: THREE.Object3D) {
  const audit=audits.get(source); if(audit) audits.set(clone,audit);
  const extras=documentExtras.get(source); if(extras !== undefined) documentExtras.set(clone,extras);
}
