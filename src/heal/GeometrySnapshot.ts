import * as THREE from 'three';

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
interface SnapshotEntry { layout: string; bytes: Uint8Array }
export interface GeometrySnapshot { layout: string; entries: SnapshotEntry[] }

export function captureAttribute(attribute: Attribute): SnapshotEntry {
  const interleaved = attribute as THREE.InterleavedBufferAttribute;
  const array = attribute.array;
  return {
    layout: JSON.stringify([attribute.itemSize, attribute.count, attribute.normalized,
      array.constructor.name, interleaved.offset, interleaved.data?.stride]),
    bytes: new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice(),
  };
}

/** Exact byte comparison also catches in-place edits that did not set needsUpdate. */
export function captureGeometry(geometry: THREE.BufferGeometry): GeometrySnapshot {
  const names = Object.keys(geometry.attributes).sort();
  const morphs = geometry.morphAttributes as Record<string, Attribute[]>;
  const morphNames = Object.keys(morphs).sort();
  const attributes = names.map(name => geometry.attributes[name]);
  for (const name of morphNames) attributes.push(...morphs[name]);
  if (geometry.index) attributes.push(geometry.index);
  return {
    layout: JSON.stringify([geometry.uuid, names, morphNames.map(name => [name, morphs[name].length]),
      geometry.morphTargetsRelative, geometry.groups,
      [String(geometry.drawRange.start), String(geometry.drawRange.count)], Boolean(geometry.index)]),
    entries: attributes.map(captureAttribute),
  };
}

export function geometrySnapshotByteLength(snapshot: GeometrySnapshot): number {
  return snapshot.entries.reduce((total, entry) => total + entry.bytes.byteLength, 0);
}

export function geometryMatches(geometry: THREE.BufferGeometry, snapshot: GeometrySnapshot): boolean {
  const current = captureGeometry(geometry);
  if(current.layout!==snapshot.layout || current.entries.length!==snapshot.entries.length)return false;
  for(let i=0;i<current.entries.length;i++) {
    const value=current.entries[i],expected=snapshot.entries[i];
    if(value.layout!==expected.layout || value.bytes.length!==expected.bytes.length)return false;
    // Exact word comparison reduces loop work while retaining every byte, including tails.
    const count=Math.floor(value.bytes.length/4);
    if(value.bytes.byteOffset%4===0 && expected.bytes.byteOffset%4===0) {
      const left=new Uint32Array(value.bytes.buffer,value.bytes.byteOffset,count),right=new Uint32Array(expected.bytes.buffer,expected.bytes.byteOffset,count);
      for(let j=0;j<count;j++)if(left[j]!==right[j])return false;
      for(let j=count*4;j<value.bytes.length;j++)if(value.bytes[j]!==expected.bytes[j])return false;
    } else for(let j=0;j<value.bytes.length;j++) if(value.bytes[j]!==expected.bytes[j])return false;
  }
  return true;
}
