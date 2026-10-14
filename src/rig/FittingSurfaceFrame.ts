import * as THREE from 'three';
import type {WeightedPoint} from './FittingSurface';

/** Exact affine-weight covariance, measured near the joint to avoid large-origin cancellation. */
export class FittingSurfaceFrame {
 mass=0;sum=new THREE.Vector3();second=new Array<number>(9).fill(0);
 constructor(private origin:THREE.Vector3){}
 add(polygon:WeightedPoint[]) {
  for(let i=1;i+1<polygon.length;i++){
   const vertices=[polygon[0],polygon[i],polygon[i+1]],points=vertices.map(v=>v.point.clone().sub(this.origin));
   const area=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).length()*.5,weight=vertices.reduce((s,v)=>s+v.weight,0);
   this.mass+=area*weight/3;points.forEach((p,j)=>this.sum.addScaledVector(p,area*(weight+vertices[j].weight)/12));
   const total=points.reduce((s,p)=>s.add(p),new THREE.Vector3()),weighted=points.reduce((s,p,j)=>s.addScaledVector(p,vertices[j].weight),new THREE.Vector3());
   for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    const products=points.map(p=>p.getComponent(row)*p.getComponent(col));
    this.second[row*3+col]+=area/60*(weight*(total.getComponent(row)*total.getComponent(col)+products.reduce((s,v)=>s+v,0))+total.getComponent(row)*weighted.getComponent(col)+weighted.getComponent(row)*total.getComponent(col)+2*products.reduce((s,v,j)=>s+v*vertices[j].weight,0));
   }
  }
 }
 axis(reference:THREE.Vector3):THREE.Vector3|null {
  if(this.mass<=0)return null;
  const centre=this.sum.clone().divideScalar(this.mass),a=this.second.map((value,i)=>value/this.mass-centre.getComponent(Math.floor(i/3))*centre.getComponent(i%3));
  const vectors=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)];
  const scale=Math.max(...a.map(Math.abs));if(!Number.isFinite(scale)||scale<=1e-30)return null;
  // Symmetric Jacobi rotations. The eigenvectors depend on the surface, not the edited chain.
  for(let iteration=0;iteration<24;iteration++){
   let p=0,q=1;for(const [i,j]of [[0,2],[1,2]])if(Math.abs(a[i*3+j])>Math.abs(a[p*3+q])){p=i;q=j;}
   if(Math.abs(a[p*3+q])<=scale*1e-12)break;
   const angle=.5*Math.atan2(2*a[p*3+q],a[q*3+q]-a[p*3+p]),c=Math.cos(angle),s=Math.sin(angle),app=a[p*3+p],aqq=a[q*3+q],apq=a[p*3+q];
   for(let k=0;k<3;k++)if(k!==p&&k!==q){const kp=a[k*3+p],kq=a[k*3+q];a[k*3+p]=a[p*3+k]=c*kp-s*kq;a[k*3+q]=a[q*3+k]=s*kp+c*kq;}
   a[p*3+p]=c*c*app-2*s*c*apq+s*s*aqq;a[q*3+q]=s*s*app+2*s*c*apq+c*c*aqq;a[p*3+q]=a[q*3+p]=0;
   const vp=vectors[p].clone(),vq=vectors[q].clone();vectors[p].copy(vp).multiplyScalar(c).addScaledVector(vq,-s);vectors[q].copy(vp).multiplyScalar(s).addScaledVector(vq,c);
  }
  const selected=vectors.map((axis,i)=>({axis,i,alignment:Math.abs(axis.dot(reference))})).sort((a,b)=>b.alignment-a.alignment)[0];
  // A repeated eigenvalue supplies no unique direction; reject arbitrary axes in a sphere/plane.
  if([0,1,2].some(i=>i!==selected.i&&Math.abs(a[i*3+i]-a[selected.i*3+selected.i])<=scale*1e-5))return null;
  return selected.axis.normalize();
 }
}
export const surfaceAxisAngle=25*Math.PI/180;
