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
  const result=cloneClips(clips);
  for(const clip of result) for(const track of clip.tracks) {
    const path=THREE.PropertyBinding.parseTrackName(track.name);
    const target=THREE.PropertyBinding.findNode(root,path.nodeName) as THREE.Object3D | null;
    const delta=target && changes.get(target.uuid);
    if(!delta) continue;
    if(path.objectName || path.propertyIndex) throw new Error('Nested animation bindings cannot be rebased safely.');
    const cubic=isGltfCubic(track), property=path.propertyName;
    if(!['position','quaternion','scale','morphTargetInfluences'].includes(property)) throw new Error('Unsupported animation channel on edited joint.');
    if(property!=='position' && property!=='quaternion') continue;
    const size=property==='position'?3:4;
    if(track.values.length !== track.times.length*size*(cubic?3:1)) throw new Error('Unexpected animation sample layout.');
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
  }
  return result;
}
