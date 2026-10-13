export function largeFixture(): Buffer {
const side=500,vertices=(side+1)*(side+1);
const pos=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),uv=new Float32Array(vertices*2),indices=new Uint32Array(500001*3);
for(let y=0;y<=side;y++)for(let x=0;x<=side;x++) {const v=y*(side+1)+x;pos[v*3]=x/side;pos[v*3+1]=y/side;normals[v*3+2]=1;uv[v*2]=x/side;uv[v*2+1]=y/side;}
let t=0;for(let y=0;y<side;y++)for(let x=0;x<side;x++) {const a=y*(side+1)+x,b=a+1,c=a+side+1,d=c+1;indices.set([a,b,c,b,d,c],t);t+=6;}
indices.set([0,0,0],t);
const arrays=[pos,normals,uv,indices],views:any[]=[];let offset=0;
for(const a of arrays){views.push({buffer:0,byteOffset:offset,byteLength:a.byteLength});offset+=a.byteLength;}
const json={asset:{version:'2.0',generator:'F02 deterministic 500x500 grid'},scene:0,scenes:[{nodes:[0],extras:{ownerNote:'Preserve scene'}}],nodes:[{mesh:0,name:'F02Grid',extras:{ownerNote:'Preserve mesh'}}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{name:'ControlPBR',pbrMetallicRoughness:{baseColorFactor:[0.8,0.6,0.4,1],metallicFactor:0,roughnessFactor:0.8}}],buffers:[{byteLength:offset}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:vertices,min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,type:'VEC3',count:vertices},{bufferView:2,componentType:5126,type:'VEC2',count:vertices},{bufferView:3,componentType:5125,type:'SCALAR',count:indices.length}],extras:{ownerNote:'Preserve document'}};
const text=Buffer.from(JSON.stringify(json)),padded=Math.ceil(text.length/4)*4;
const output=Buffer.alloc(20+padded+8+offset);output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);output.writeUInt32LE(padded,12);output.writeUInt32LE(0x4e4f534a,16);output.fill(32,20,20+padded);text.copy(output,20);output.writeUInt32LE(offset,20+padded);output.writeUInt32LE(0x004e4942,24+padded);offset=28+padded;for(const a of arrays){Buffer.from(a.buffer).copy(output,offset);offset+=a.byteLength;}
return output;
}
