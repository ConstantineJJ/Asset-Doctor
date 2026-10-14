import * as THREE from 'three';

export interface WeightedPoint {point:THREE.Vector3;weight:number}
function clipPolygon(polygon:WeightedPoint[],distance:(vertex:WeightedPoint)=>number):WeightedPoint[] {
 const output:WeightedPoint[]=[];
 for(let i=0;i<polygon.length;i++) {
  const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b);
  const insideA=da>=0,insideB=db>=0;
  if(insideA)output.push(a);
  if(insideA!==insideB){const t=da/(da-db);output.push({point:a.point.clone().lerp(b.point,t),weight:a.weight+(b.weight-a.weight)*t});}
 }
 return output;
}
/** Clip a triangle/polygon to a halfspace, interpolating its affine skin weight. */
export function clipSurface(polygon:WeightedPoint[],normal:THREE.Vector3,origin:THREE.Vector3,limit:number,above:boolean):WeightedPoint[] {
 const offset=origin.dot(normal)+limit,sign=above?1:-1;return clipPolygon(polygon,vertex=>(vertex.point.dot(normal)-offset)*sign);
}
/** A continuous influence domain, rather than all-or-nothing triangle eligibility. */
export function clipInfluence(polygon:WeightedPoint[],minimum:number):WeightedPoint[] {return clipPolygon(polygon,vertex=>vertex.weight-minimum);}
/** Exact first moment of affine weights over the clipped triangle surface. */
export function surfaceMoment(polygon:WeightedPoint[]) {
 const sum=new THREE.Vector3();let mass=0;
 for(let i=1;i+1<polygon.length;i++) {
  const a=polygon[0],b=polygon[i],c=polygon[i+1],area=b.point.clone().sub(a.point).cross(c.point.clone().sub(a.point)).length()*.5;
  const weight=a.weight+b.weight+c.weight;
  mass+=area*weight/3;
  sum.addScaledVector(a.point,area*(weight+a.weight)/12).addScaledVector(b.point,area*(weight+b.weight)/12).addScaledVector(c.point,area*(weight+c.weight)/12);
 }
 return {mass,sum};
}
