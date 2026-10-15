import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';
import {memoryLimits} from '../performance/MemoryBudget';
import { confirmRepairQueue, pickModelFiles, saveBinaryFile, requestDesktopClose, protectDesktopClose, visitPickedModelFiles } from './FileIO';

export async function runFileIOTests() {
  const results: { name: string; passed: boolean; actual?: unknown; expected?: unknown }[] = [];
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  Object.defineProperty(globalThis, 'window', { value: { crypto }, configurable: true });
  Object.defineProperty(globalThis, 'isTauri', { value: true, configurable: true });
  try {
    mockWindows('main');
    let closeCalls=0,destroyCalls=0,dialogAnswer='Cancel',blockClose=true;
    let closeHandler:((event:unknown)=>Promise<void>)|undefined;
    const closeCommands:string[]=[];
    mockIPC(async(command,args)=>{
      closeCommands.push(command);
      if(command==='plugin:event|listen'){
        const callbackId=(args as {handler:number}).handler;
        const callbacks=(window as unknown as {__TAURI_INTERNALS__:{callbacks:Map<number,(event:unknown)=>Promise<void>>}}).__TAURI_INTERNALS__.callbacks;
        closeHandler=callbacks.get(callbackId);return callbackId;
      }
      if(command==='plugin:window|close'){closeCalls++;await closeHandler?.({event:'tauri://close-requested',id:1,payload:null});}
      else if(command==='plugin:window|destroy')destroyCalls++;
      else if(command==='plugin:dialog|message')return dialogAnswer;
      else if(command!=='plugin:event|unlisten')throw new Error('Unexpected exit command: '+command);
    });
    const unprotect=await protectDesktopClose(()=>blockClose,'Unsaved rig');
    await requestDesktopClose();
    results.push({name:'Menu exit requests normal close and preserves unsaved edits on Cancel',passed:closeCalls===1&&destroyCalls===0&&closeCommands.includes('plugin:dialog|message')});
    dialogAnswer='Ok';await requestDesktopClose();
    results.push({name:'Menu exit destroys only after unsaved edits are explicitly confirmed',passed:closeCalls===2&&destroyCalls===1});
    blockClose=false;closeCommands.length=0;await requestDesktopClose();
    results.push({name:'Saved menu exit follows normal close without a discard prompt',passed:closeCalls===3&&destroyCalls===2&&!closeCommands.includes('plugin:dialog|message')});
    await unprotect();
    mockIPC(()=>{throw new Error('close ACL denied');});
    let exitError='';try{await requestDesktopClose();}catch(cause){exitError=String(cause);}
    results.push({name:'Native exit reports close failure',passed:exitError.includes('close ACL denied')});

    let messageCalls = 0;
    let releaseConfirm!: (result: string) => void;
    const confirmationBarrier = new Promise<string>(resolve => { releaseConfirm = resolve; });
    mockIPC(command => {
      if (command === 'plugin:dialog|message') { messageCalls++; return confirmationBarrier; }
      throw new Error(`Unexpected confirmation command: ${command}`);
    });
    let confirmationSettled = false;
    const confirmation = confirmRepairQueue('Repair?').then(value => { confirmationSettled = true; return value; });
    for (let i = 0; i < 20 && !messageCalls; i++) await new Promise(resolve => setImmediate(resolve));
    results.push({ name: 'Native repair confirmation waits for the message dialog response',
      passed: messageCalls === 1 && !confirmationSettled });
    releaseConfirm('Ok');
    results.push({ name: 'Native Confirm authorizes repair', passed: await confirmation === true });
    mockIPC(command => {
      if (command === 'plugin:dialog|message') return 'Cancel';
      throw new Error(`Unexpected confirmation command: ${command}`);
    });
    results.push({ name: 'Native Cancel never authorizes repair', passed: await confirmRepairQueue('Repair?') === false });
    mockIPC(() => { throw new Error('dialog ACL denied'); });
    let confirmationError = '';
    try { await confirmRepairQueue('Repair?'); } catch (error) { confirmationError = String(error); }
    results.push({ name: 'Native Dialog Error is propagated instead of affirmative approval',
      passed: confirmationError.includes('dialog ACL denied') });

    let writes = 0;
    mockIPC((command) => {
      if (command === 'plugin:dialog|save') return null;
      if (command === 'plugin:fs|write_file') writes++;
    });
    const cancelled = await saveBinaryFile('repaired.glb', new Uint8Array([1, 2, 3]).buffer);
    results.push({ name: 'Native save cancellation leaves the repaired copy unsaved', passed: cancelled === false && writes === 0 });

    let releaseSave!:(path:string)=>void;
    let dialogOpened=false, current=true;
    const saveBarrier=new Promise<string>(resolve=>{releaseSave=resolve;});
    mockIPC(command=>{
      if(command==='plugin:dialog|save') {dialogOpened=true;return saveBarrier;}
      if(command==='plugin:fs|write_file') writes++;
    });
    const staleSave=saveBinaryFile('edited.glb',new ArrayBuffer(4),()=>current);
    for(let i=0;i<20&&!dialogOpened;i++) await new Promise(resolve=>setImmediate(resolve));
    current=false; releaseSave('C:\\Models\\edited.glb');
    results.push({name:'Native save refuses stale bytes before filesystem writing after dialog invalidation',passed:await staleSave===false&&writes===0});

    let completeWrite!: () => void;
    const writeBarrier = new Promise<void>((resolve) => { completeWrite = resolve; });
    let written: Uint8Array | undefined;
    mockIPC((command, args) => {
      if (command === 'plugin:dialog|save') return 'C:\\Модели\\исправленная.glb';
      if (command === 'plugin:fs|write_file') {
        written = args as unknown as Uint8Array;
        return writeBarrier;
      }
    });
    let settled = false;
    const pendingSave = saveBinaryFile('repaired.glb', new Uint8Array([4, 5, 6]).buffer)
      .then((value) => { settled = true; return value; });
    // Drain import/IPC microtasks without using a timing-dependent assertion.
    for (let i = 0; i < 20 && !written; i++) await new Promise((resolve) => setImmediate(resolve));
    results.push({ name: 'Native save is pending until the filesystem finishes writing', passed: Boolean(written) && !settled });
    completeWrite();
    const saved = await pendingSave;
    results.push({ name: 'Native save preserves binary model bytes', passed: saved && String(written) === '4,5,6' });

    mockIPC((command) => {
      if (command === 'plugin:dialog|save') return 'C:\\Модели\\исправленная.glb';
      if (command === 'plugin:fs|write_file') throw new Error('disk full');
    });
    let writeError = '';
    try { await saveBinaryFile('repaired.glb', new ArrayBuffer(4)); }
    catch (error) { writeError = (error as Error).message; }
    results.push({ name: 'Native write failure is reported instead of claiming a saved copy', passed: writeError === 'disk full' });

    mockIPC((command) => {
      if (command === 'plugin:dialog|open') return ['C:\\Модели\\кошка.glb', '/tmp/robot.gltf'];
      if (command === 'plugin:fs|stat') return {size:3};
      if (command === 'plugin:fs|read_file') return new Uint8Array([7, 8, 9]).buffer;
    });
    const files = await pickModelFiles(true);
    results.push({ name: 'Native model picker preserves Unicode basenames and bytes', passed: files.length === 2 && files[0].name === 'кошка.glb' && files[1].name === 'robot.gltf' && String(new Uint8Array(await files[0].arrayBuffer())) === '7,8,9' });

    let oversizedReads=0;
    mockIPC(command=>{if(command==='plugin:dialog|open')return 'C:/huge.glb';if(command==='plugin:fs|stat')return {size:1024*1024*1024};if(command==='plugin:fs|read_file'){oversizedReads++;return new Uint8Array([1]).buffer;}});
    let admissionError='';try{await pickModelFiles();}catch(cause){admissionError=String(cause);}
    results.push({name:'F07 oversized native files are rejected from metadata before readFile',passed:oversizedReads===0&&admissionError.includes('memory')});

    const reads:string[]=[],visited:string[]=[];
    let slots=2,releaseVisit!:(()=>void),opened=0;
    const visitBarrier=new Promise<void>(resolve=>{releaseVisit=resolve;});
    mockIPC((command,args)=>{
      if(command==='plugin:dialog|open'){opened++;return ['C:/A.glb','C:/B.glb','C:/C.glb'];}
      if(command==='plugin:fs|stat')return {size:2};
      if(command==='plugin:fs|read_file'){reads.push((args as {path:string}).path);return new Uint8Array([1,2]).buffer;}
      throw new Error('Unexpected import command: '+command);
    });
    const visiting=visitPickedModelFiles(()=>slots,async file=>{visited.push(file.name);if(visited.length===1)await visitBarrier;slots--;});
    for(let i=0;i<20&&!visited.length;i++)await new Promise(resolve=>setImmediate(resolve));
    results.push({name:'F07 native picker waits for one imported file before reading the next',passed:reads.length===1&&visited.length===1});
    releaseVisit();const admission=await visiting;
    results.push({name:'F07 excess Compare paths are rejected before native readFile',passed:reads.join(',')==='C:/A.glb,C:/B.glb'&&visited.join(',')==='A.glb,B.glb'&&admission.skipped===1});
    const beforeFull=opened;await visitPickedModelFiles(()=>0,async()=>{throw new Error('Full Compare must not import');});
    results.push({name:'F07 full Compare does not even open a native dialog',passed:opened===beforeFull&&reads.length===2});
    slots=1;reads.length=0;
    mockIPC((command)=>{if(command==='plugin:dialog|open'){slots=0;return ['C:/A.glb'];}if(command==='plugin:fs|read_file')reads.push('unexpected');});
    await visitPickedModelFiles(()=>slots,async()=>{throw new Error('Stale capacity');});
    results.push({name:'F07 capacity is checked again after the asynchronous native dialog',passed:reads.length===0});
    slots=2;reads.length=0;
    mockIPC(command=>{if(command==='plugin:dialog|open')return ['C:/A.glb','C:/B.glb'];if(command==='plugin:fs|stat')return {size:1};if(command==='plugin:fs|read_file'){reads.push('read');return new Uint8Array([1]).buffer;}});
    let visitError='';try{await visitPickedModelFiles(()=>slots,async()=>{throw new Error('import cancelled');});}catch(cause){visitError=String(cause);}
    results.push({name:'F07 failed or cancelled consumer stops further native reads',passed:reads.length===1&&visitError.includes('import cancelled')});
    reads.length=0;let compareLimit='';
    try{await visitPickedModelFiles(()=>2,async()=>{},()=>0);}catch(cause){compareLimit=String(cause);}
    results.push({name:'F07 Compare remaining-byte budget is enforced before reading the next selected file',passed:reads.length===0&&compareLimit.includes('memory')});
    reads.length=0;let batchLimit='';
    mockIPC(command=>{if(command==='plugin:dialog|open')return ['C:/A.glb','C:/B.glb','C:/C.glb'];if(command==='plugin:fs|stat')return {size:2};if(command==='plugin:fs|read_file'){reads.push('read');return new Uint8Array([1,2]).buffer;}});
    try{await visitPickedModelFiles(()=>3,async()=>{},()=>3);}catch(cause){batchLimit=String(cause);}
    results.push({name:'F07 native batch byte admission does not depend on React publishing occupied bytes',passed:reads.length===1&&batchLimit.includes('memory')});

    reads.length=0;
    mockIPC(command=>{if(command==='plugin:dialog|open')return ['C:/Cloth_capushon_Q_554.glb'];if(command==='plugin:fs|stat')return {size:29858524};if(command==='plugin:fs|read_file'){reads.push('read');return new Uint8Array([1]).buffer;}});
    let eighthVisited=false;
    try{await visitPickedModelFiles(()=>1,async()=>{eighthVisited=true;},()=>memoryLimits.compareSources-128257268);}catch{}
    results.push({name:'F07 native eighth-slot metadata admission accepts the owner corpus beyond the former 128 MiB cap',passed:eighthVisited&&reads.length===1});

    mockIPC(() => null);
    results.push({ name: 'Native open cancellation returns no model', passed: (await pickModelFiles()).length === 0 });
  } finally {
    clearMocks();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldTauri) Object.defineProperty(globalThis, 'isTauri', oldTauri);
    else Reflect.deleteProperty(globalThis, 'isTauri');
  }
  return results;
}
