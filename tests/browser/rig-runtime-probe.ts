import type {Page} from '@playwright/test';

/** Inspect the actual viewer through React refs; no product debug surface. */
export async function rigViewerState(page:Page,stop=false) {
 return page.evaluate(stop=>{
  const container=document.getElementById('root')!;
  const key=Object.keys(container).find(name=>name.startsWith('__reactContainer$'))!;
  const attached=Reflect.get(container,key);
  const fibers=[attached?.stateNode?.current ?? attached];
  while(fibers.length){
   const fiber=fibers.pop();if(!fiber)continue;
   if(fiber.child)fibers.push(fiber.child);if(fiber.sibling)fibers.push(fiber.sibling);
   for(let hook=fiber.memoizedState;hook;hook=hook.next){
    const viewer=hook.memoizedState?.current;
    if(!viewer?.renderer || !viewer.currentAssetRoot)continue;
    if(stop)viewer.stopAnimation();
    const bones:any[]=[];
    viewer.currentAssetRoot.updateMatrixWorld(true);
    viewer.currentAssetRoot.traverse((node:any)=>{
     if(!node.isBone)return;
     const world=node.position.clone();node.getWorldPosition(world);world.project(viewer.camera);
     const rect=viewer.renderer.domElement.getBoundingClientRect();
     bones.push({uuid:node.uuid,name:node.name,position:node.position.toArray(),quaternion:node.quaternion.toArray(),
      screen:[rect.x+(world.x+1)*rect.width/2,rect.y+(1-world.y)*rect.height/2]});
    });
    return {bones,selected:viewer.selectedMeshUuid,skeletonVisible:viewer.skeletonHelper?.visible,
     xray:viewer.skeletonHelper?.material.depthTest===false,jointCount:viewer.skeletonJoints?.count ?? 0,
     jointsVisible:viewer.skeletonJoints?.visible ?? false};
   }
  }
  throw new Error('Viewer not found');
 },stop);
}
