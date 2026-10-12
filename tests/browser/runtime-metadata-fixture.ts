import { deflateSync } from 'node:zlib';
import { presentationFixture } from './presentation-fixtures';

export const pixels = [255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255];
export const authorExtras = { authorTag:'Keep me', nested:{revision:7,tags:['source','test']}, __assetDoctorUserNote:'Author-owned key' };
function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type),data]);
  let crc = 0xffffffff;
  for(const byte of body) {crc ^= byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const result=Buffer.alloc(data.length+12); result.writeUInt32BE(data.length,0); body.copy(result,4); result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);
  return result;
}
function png() {
  const header=Buffer.alloc(13); header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),
    pngChunk('IDAT',deflateSync(Buffer.from([0,...pixels.slice(0,8),0,...pixels.slice(8)]))),pngChunk('IEND',Buffer.alloc(0))]);
}
export function metadataFixture(legacy = false, multipleClips=false, simpleExtras?:unknown): Buffer {
  const source=presentationFixture(true);const length=source.readUInt32LE(12);
  const json=JSON.parse(source.subarray(20,20+length).toString().trim());
  json.extras={...authorExtras,documentTag:'Document extras'};
  json.scenes[0].extras={...authorExtras,sceneTag:'Scene extras'};
  json.nodes[0].extras=authorExtras;
  json.nodes[1].extras={meshNodeTag:'Mesh node extras'};
  json.materials[0].extras={materialTag:'Material extras'};
  json.materials[0].pbrMetallicRoughness.baseColorFactor=[0.8,0.6,0.4,0.75];
  json.materials[0].alphaMode='BLEND'; json.materials[0].doubleSided=false;
  json.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};
  json.textures=[{source:0,sampler:0,extras:{textureTag:'Texture extras'}}];
  if(simpleExtras !== undefined) {json.extras=simpleExtras;json.textures[0].extras=simpleExtras;}
  json.samplers=[{magFilter:9728,minFilter:9728,wrapS:10497,wrapT:33648}];
  json.images=[{name:'AuthorChecker',uri:'data:image/png;base64,'+png().toString('base64')}];
  if(multipleClips)json.animations.push({...json.animations[0],name:'AlternateMotion'});
  if(legacy) {
    json.scenes[0].extras.__assetDoctorSourceAudit={obsolete:true};
    json.nodes[1].extras.__assetDoctorAuthoredMaterials={images:[{url:json.images[0].uri}]};
  }
  const binary=source.subarray(20+length);
  const encoded=Buffer.from(JSON.stringify(json));const padded=Math.ceil(encoded.length/4)*4;
  const output=Buffer.alloc(20+padded+binary.length);source.copy(output,0,0,12);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(padded,12);output.writeUInt32LE(0x4e4f534a,16);output.fill(32,20,20+padded);encoded.copy(output,20);binary.copy(output,20+padded);
  return output;
}
