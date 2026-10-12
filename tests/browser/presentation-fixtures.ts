import { readFileSync } from 'node:fs';

/** Small source fixture with authored TRS and optional real joint animation. */
export function presentationFixture(skinned = false): Buffer {
  const original = readFileSync('tests/browser/fixtures/two-scenes.glb');
  const jsonLength = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20,20+jsonLength).toString().trim());
  json.scenes = [{name:'AuthoredScene',nodes:[0]}];
  json.meshes = [json.meshes[0]];
  json.nodes = [
    {name:'AuthoredPivot',translation:[3,5,7],rotation:[0,Math.sin(0.2),0,Math.cos(0.2)],scale:[1.25,1,0.75],children:skinned?[1,2]:[1]},
    {name:'Grid',mesh:0},
  ];
  const chunks: Buffer[] = [original.subarray(28+jsonLength,28+jsonLength+json.buffers[0].byteLength)];
  let offset = chunks[0].length;
  function append(data: Uint16Array | Float32Array, type: string, count: number, min?: number[], max?: number[]) {
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.byteLength});
    chunks.push(Buffer.from(data.buffer)); offset += data.byteLength;
    const index = json.accessors.length;
    json.accessors.push({bufferView,componentType:data instanceof Uint16Array?5123:5126,type,count,...(min?{min,max}:{})});
    return index;
  }
  if (skinned) {
    json.nodes[1].skin = 0;
    json.nodes.push({name:'Joint'});
    json.skins = [{joints:[2],skeleton:2}];
    const attributes = json.meshes[0].primitives[0].attributes;
    attributes.JOINTS_0 = append(new Uint16Array(16),'VEC4',4);
    attributes.WEIGHTS_0 = append(new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]),'VEC4',4);
    const input = append(new Float32Array([0,1]),'SCALAR',2,[0],[1]);
    const output = append(new Float32Array([0,0,0,0,0.5,0]),'VEC3',2);
    json.animations = [{name:'JointMotion',samplers:[{input,output,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:2,path:'translation'}}]}];
  }
  json.buffers[0].byteLength = offset;
  const encoded = Buffer.from(JSON.stringify(json));
  const paddedJson = Math.ceil(encoded.length/4)*4;
  const binary = Buffer.concat(chunks);
  const result = Buffer.alloc(28+paddedJson+binary.length);
  original.copy(result,0,0,12); result.writeUInt32LE(result.length,8);
  result.writeUInt32LE(paddedJson,12); result.writeUInt32LE(0x4e4f534a,16);
  result.fill(32,20,20+paddedJson); encoded.copy(result,20);
  result.writeUInt32LE(binary.length,20+paddedJson); result.writeUInt32LE(0x004e4942,24+paddedJson);
  binary.copy(result,28+paddedJson);
  return result;
}
