import type * as THREE from 'three';
import type {RigSnapshot} from './RigEditSession';
import {binaryBytes,geometryArrays} from '../performance/MemoryBudget';

/** Numeric samples stay in unique backing buffers, never cached JSON strings.
 * Per-state metadata and small rest signatures are counted separately. */
export function rigSnapshotMetadata(state:RigSnapshot,signature?:string){
 const tracks=state.clips.flatMap(clip=>clip.tracks);
 return state.nodes.size*1024+state.clips.reduce((sum,clip)=>sum+clip.name.length*2+256,0)+tracks.reduce((sum,track)=>sum+track.name.length*2+256,0)
  +(signature===undefined?state.nodes.size*1024:signature.length*2);
}
export function rigHistoryBytes(states:RigSnapshot[],owned:Iterable<THREE.BufferGeometry>,signatures:WeakMap<RigSnapshot,string>){
 const unique=[...new Set(states)],arrays:ArrayBufferView[]=[];
 const geometries=new Set(owned);
 for(const state of unique){for(const geometry of state.geometries.values())geometries.add(geometry);for(const clip of state.clips)for(const track of clip.tracks)arrays.push(track.times,track.values);}
 for(const geometry of geometries)arrays.push(...geometryArrays(geometry));
 return binaryBytes(arrays)+unique.reduce((sum,state)=>sum+rigSnapshotMetadata(state,signatures.get(state)),0);
}
