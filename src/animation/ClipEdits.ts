import * as THREE from 'three';

export function isGltfCubic(track: THREE.KeyframeTrack): boolean {
  return !!(track as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline;
}

export function cloneClips(clips: THREE.AnimationClip[]) {
  return clips.map(clip => clip.clone());
}

function finiteArray(values: ArrayLike<number>) {
  for (let i=0;i<values.length;i++) if (!Number.isFinite(values[i])) throw new Error('Animation contains nonfinite serialized values.');
}

/** Change exported key times; playback speed remains viewer-only. */
export function retimeClip(clip: THREE.AnimationClip, duration: number): THREE.AnimationClip {
  if (!(duration>0) || !Number.isFinite(duration) || !(clip.duration>0)) throw new Error('Clip duration must be finite and positive.');
  const factor=duration/clip.duration;
  const result=clip.clone();
  for (const track of result.tracks) {
    const size=track.getValueSize()/(isGltfCubic(track)?3:1);
    for(let i=0;i<track.times.length;i++) {
      track.times[i]*=factor;
      if (i && !(track.times[i]>track.times[i-1])) throw new Error('Duration collapses distinct Float32 key times.');
    }
    if (isGltfCubic(track)) for(let i=0;i<track.values.length;i++) {
      if (Math.floor(i/size)%3!==1) track.values[i]/=factor;
    }
    finiteArray(track.times); finiteArray(track.values);
  }
  result.duration=duration;
  return result;
}

export interface RestDelta { oldPosition: THREE.Vector3; newPosition: THREE.Vector3; rotation: THREE.Quaternion }

/** Left-multiply the local animation by the rigid change of authored rest. */
export function rebaseClips(root: THREE.Object3D, clips: THREE.AnimationClip[], changes: Map<string,RestDelta>) {
  // Session histories own these streams immutably. Copy only rewritten values;
  // unchanged tracks and key times can be shared by every rest snapshot.
  return clips.map(source=>{
  let edited=false;
  const tracks=source.tracks.map(original=>{
    let track=original;
    const path=THREE.PropertyBinding.parseTrackName(track.name);
    const target=THREE.PropertyBinding.findNode(root,path.nodeName) as THREE.Object3D | null;
    const delta=target && changes.get(target.uuid);
    if(!delta) return original;
    if(path.objectName || path.propertyIndex) throw new Error('Nested animation bindings cannot be rebased safely.');
    const cubic=isGltfCubic(track), property=path.propertyName;
    if(!['position','quaternion','scale','morphTargetInfluences'].includes(property)) throw new Error('Unsupported animation channel on edited joint.');
    if(property!=='position' && property!=='quaternion') return original;
    // A translation-only rest edit must not rewrite authored rotation samples.
    if(property==='quaternion'&&Math.abs(delta.rotation.x)+Math.abs(delta.rotation.y)+Math.abs(delta.rotation.z)<1e-12&&Math.abs(delta.rotation.w-1)<1e-12)return original;
    const size=property==='position'?3:4;
    if(track.values.length !== track.times.length*size*(cubic?3:1)) throw new Error('Unexpected animation sample layout.');
    track=original.clone();track.times=original.times;edited=true;
    for(let i=0;i<track.values.length;i+=size) {
      const tangent=cubic && Math.floor(i/size)%3!==1;
      if(property==='position') {
        const vector=new THREE.Vector3().fromArray(track.values,i);
        if(!tangent) vector.sub(delta.oldPosition);
        vector.applyQuaternion(delta.rotation);
        if(!tangent) vector.add(delta.newPosition);
        vector.toArray(track.values,i);
      } else {
        const quaternion=new THREE.Quaternion().fromArray(track.values,i);
        quaternion.premultiply(delta.rotation);
        if(!tangent) quaternion.normalize();
        quaternion.toArray(track.values,i);
      }
    }
    finiteArray(track.values);
    return track;
  });
  return edited?new THREE.AnimationClip(source.name,source.duration,tracks,source.blendMode):source;
  });
}

/** Exact comparisons, with shared-stream fast paths; no probabilistic hash or
 * retained text expansion of numeric animation samples. */
export function equalClipData(a:THREE.AnimationClip[],b:THREE.AnimationClip[]){
 const equal=(x:ArrayLike<number>,y:ArrayLike<number>)=>{if(x===y)return true;if(x.length!==y.length)return false;for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;return true;};
 return a===b||a.length===b.length&&a.every((clip,i)=>{
  const other=b[i];return clip===other||clip.name===other.name&&clip.duration===other.duration&&clip.blendMode===other.blendMode&&clip.tracks.length===other.tracks.length&&clip.tracks.every((track,j)=>{
   const t=other.tracks[j];return track===t||track.name===t.name&&track.ValueTypeName===t.ValueTypeName&&(track as any).createInterpolant===(t as any).createInterpolant&&equal(track.times,t.times)&&equal(track.values,t.values);
  });
 });
}
