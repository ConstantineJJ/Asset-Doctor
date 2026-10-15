import { isTauri } from '@tauri-apps/api/core';
import {assertMemoryBytes,memoryLimits} from '../performance/MemoryBudget';

export { isTauri as isDesktop };

/** Request normal window close so the existing unsaved-change guard can veto exit. */
export async function requestDesktopClose():Promise<void>{
  if(!isTauri())throw new Error('Desktop exit is unavailable in the browser');
  const {getCurrentWindow}=await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

/** Only an affirmative answer authorizes repair; dialog errors reject to the caller. */
export async function confirmRepairQueue(message: string): Promise<boolean> {
  if (isTauri()) {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    return await confirm(message, { title: 'Asset Doctor — Safe Repair Queue', kind: 'warning' }) === true;
  }
  // The frontend regression harness also exercises asynchronous dialog results.
  return await window.confirm(message) === true;
}

/** The dialog grants scope for selected paths; no whole-disk capability is needed. */
async function pickModelPaths(multiple:boolean):Promise<string[]> {
  const {open}=await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple,
    directory: false,
    filters: [{ name: '3D models', extensions: ['glb', 'gltf'] }],
  });
  return selected === null ? [] : Array.isArray(selected) ? selected : [selected];
}

async function readModelFile(path:string,maxBytes:number=memoryLimits.modelFile):Promise<File>{
  const {readFile,stat}=await import('@tauri-apps/plugin-fs');
  const limit=Math.min(memoryLimits.modelFile,maxBytes);
  const name=path.split(/[\\/]/).pop() || 'model.glb';
  const label=`File "${name}" size`;
  assertMemoryBytes((await stat(path)).size,limit,label);
  const bytes=await readFile(path);
  assertMemoryBytes(bytes.byteLength,limit,label);
  return new File([bytes],name,{type:/\.glb$/i.test(name)?'model/gltf-binary':'model/gltf+json'});
}

/** Apply the live Compare capacity before reading bytes, with only one File in flight. */
export async function visitPickedModelFiles(capacity:()=>number,visit:(file:File)=>Promise<void>,maxBytes:()=>number=()=>memoryLimits.modelFile):Promise<{skipped:number}> {
  const free=()=>Math.max(0,Math.floor(capacity()));
  if(free()===0)return {skipped:0};
  const paths=(await pickModelPaths(true)).filter(path=>/\.(glb|gltf)$/i.test(path));
  const admitted=paths.slice(0,free());
  const initialBytes=maxBytes();
  let consumed=0,consumedBytes=0;
  for(const path of admitted){
    if(free()===0)break;
    const file=await readModelFile(path,Math.min(maxBytes(),initialBytes-consumedBytes));
    consumedBytes+=file.size;
    await visit(file);
    consumed++;
  }
  return {skipped:paths.length-consumed};
}

export async function pickModelFiles(multiple = false): Promise<File[]> {
  const paths=await pickModelPaths(multiple);
  const files: File[] = [];
  for (const path of paths) {
    files.push(await readModelFile(path));
  }
  return files;
}

/** True means a completed write; cancellation and unconfirmed browser downloads return false. */
export async function saveBinaryFile(fileName: string, buffer: ArrayBuffer, stillCurrent:()=>boolean=()=>true): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: 'Binary glTF', extensions: ['glb'] }],
    });
    if (path === null || !stillCurrent()) return false;
    await writeFile(path, new Uint8Array(buffer));
    return true;
  }

  if(!stillCurrent()) return false;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to accept the download before revoking its source.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // An anchor download has no completion/cancellation signal. Only a confirmed
  // native write may clear repair protection; web users explicitly Discard.
  return false;
}

export async function protectDesktopClose(shouldBlock: () => boolean, message: string) {
  if (!isTauri()) return () => {};
  const [{ getCurrentWindow }, { confirm }] = await Promise.all([
    import('@tauri-apps/api/window'),
    import('@tauri-apps/plugin-dialog'),
  ]);
  const window = getCurrentWindow();
  let confirming = false;
  return window.onCloseRequested(async (event) => {
    if (!shouldBlock()) return;
    event.preventDefault();
    if (confirming) return;
    confirming = true;
    try {
      if (await confirm(message, { title: 'Asset Doctor', kind: 'warning' })) {
        await window.destroy();
      }
    } finally {
      confirming = false;
    }
  });
}
