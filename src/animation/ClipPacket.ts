import * as THREE from 'three';
import { isGltfCubic } from './ClipEdits';

export interface ClipPacket {name:string;duration:number;tracks:{name:string;type:string;times:Float32Array;values:Float32Array;interpolation:number;cubic:boolean}[]}
export function packClips(clips:THREE.AnimationClip[]):ClipPacket[] {
  return clips.map(clip=>({name:clip.name,duration:clip.duration,tracks:clip.tracks.map(track=>({name:track.name,type:track.ValueTypeName,times:Float32Array.from(track.times),values:Float32Array.from(track.values),interpolation:track.getInterpolation(),cubic:isGltfCubic(track)}))}));
}

/** glTF Appendix C Hermite evaluation, transported without executable factories. */
class Cubic extends THREE.Interpolant {
  constructor(times:Float32Array,values:Float32Array,size:number,result:THREE.TypedArray|undefined,private quaternion:boolean) {super(times,values,size,result);}
  copySampleValue_(index:number) {
    for(let i=0;i<this.valueSize;i++)this.resultBuffer[i]=this.sampleValues[(index*3+1)*this.valueSize+i];
    return this.resultBuffer;
  }
  interpolate_(index:number,t0:number,time:number,t1:number) {
    const dt=t1-t0,u=(time-t0)/dt,u2=u*u,u3=u2*u,size=this.valueSize,previous=(index-1)*3*size,current=index*3*size;
    for(let i=0;i<size;i++)this.resultBuffer[i]=(2*u3-3*u2+1)*this.sampleValues[previous+size+i]+(u3-2*u2+u)*dt*this.sampleValues[previous+2*size+i]+(-2*u3+3*u2)*this.sampleValues[current+size+i]+(u3-u2)*dt*this.sampleValues[current+i];
    if(this.quaternion)new THREE.Quaternion().fromArray(this.resultBuffer).normalize().toArray(this.resultBuffer);
    return this.resultBuffer;
  }
}

export function unpackClips(packets:ClipPacket[]):THREE.AnimationClip[] {
  return packets.map(clip=>new THREE.AnimationClip(clip.name,clip.duration,clip.tracks.map(packet=>{
    const Constructor=packet.type==='quaternion'?THREE.QuaternionKeyframeTrack:packet.type==='vector'?THREE.VectorKeyframeTrack:packet.type==='number'?THREE.NumberKeyframeTrack:null;
    if(!Constructor)throw new Error('Unsupported worker animation track type.');
    const track=new Constructor(packet.name,packet.times,packet.values,packet.interpolation as THREE.InterpolationModes);
    if(packet.cubic) {
      const factory=(result?:THREE.TypedArray)=>new Cubic(packet.times,packet.values,track.getValueSize()/3,result,packet.type==='quaternion');
      Object.assign(factory,{isInterpolantFactoryMethodGLTFCubicSpline:true});
      (track as any).createInterpolant=factory;
    }
    return track;
  })));
}
