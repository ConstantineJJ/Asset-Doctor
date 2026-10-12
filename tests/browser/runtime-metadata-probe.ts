import type { Page } from '@playwright/test';

// Read actual rendered models, including Lineup clones, without a product debug API.
export async function metadataState(page: Page, compare=false) {
  return page.evaluate(compare=>{
    const container=document.getElementById('root');
    const key=container && Object.keys(container).find(k=>k.startsWith('__reactContainer$'));
    const attached=container && key && Reflect.get(container,key);
    const fibers=[Reflect.get(window,'qaFiberRoot')?.current ?? attached?.stateNode?.current ?? attached];
    while(fibers.length) {
      const fiber=fibers.pop();if(!fiber)continue;
      if(fiber.child)fibers.push(fiber.child);if(fiber.sibling)fibers.push(fiber.sibling);
      for(let hook=fiber.memoizedState;hook;hook=hook.next) {
        const manager=hook.memoizedState?.current;
        if(!manager?.renderer || (compare?!manager.assets:!manager.currentAssetRoot))continue;
        const entries:any[]=compare?(manager.lineup?.roots ?? manager.slots):[{root:manager.currentAssetRoot,mixer:manager.animationMixer,action:manager.activeAnimationAction}];
        return entries.map(entry=>{
          const root=entry.root ?? entry.asset.root;
          const mode=compare?(manager.lineup?.renderModeManager ?? entry.renderModeManager):manager.renderModeManager;
          const meshes:any[]=[];
          root.traverse((mesh:any)=>{
            if(!mesh.isMesh)return;
            const materials=mode?.originalMaterials?.get(mesh) ?? mesh.material;
            meshes.push({extras:mesh.userData,materials:(Array.isArray(materials)?materials:[materials]).map((mat:any)=>{
              const tex=mat.map;let pixels:number[]|undefined;
              if(tex?.image) {
                const canvas=document.createElement('canvas');canvas.width=tex.image.width;canvas.height=tex.image.height;
                const ctx=canvas.getContext('2d')!;ctx.drawImage(tex.image,0,0);pixels=Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data);
              }
              return {type:mat.type,isMaterial:mat.isMaterial,color:mat.color?.toArray(),opacity:mat.opacity,transparent:mat.transparent,
                side:mat.side,roughness:mat.roughness,metalness:mat.metalness,extras:mat.userData,
                texture:tex && {width:tex.image.width,height:tex.image.height,pixels,wrapS:tex.wrapS,wrapT:tex.wrapT,
                  minFilter:tex.minFilter,magFilter:tex.magFilter,colorSpace:tex.colorSpace,flipY:tex.flipY}};
            }),skin:mesh.isSkinnedMesh?{joints:mesh.skeleton.bones.map((b:any)=>b.name),jointPosition:mesh.skeleton.bones[0].position.toArray(),
              weights:Array.from(mesh.geometry.attributes.skinWeight.array),indices:Array.from(mesh.geometry.attributes.skinIndex.array),
              inverse:mesh.skeleton.boneInverses.map((m:any)=>m.toArray())}:null});
          });
          return {uuid:root.uuid,sourceUuid:entry.asset?.root.uuid ?? root.uuid,extras:root.userData,
            pivotExtras:root.getObjectByName('AuthoredPivot')?.userData,meshes,mixerOwnsRoot:!entry.mixer || entry.mixer.getRoot()===root,
            time:entry.action?.time ?? 0,clip:entry.action?.getClip().name};
        });
      }
    }
    return null;
  },compare);
}
