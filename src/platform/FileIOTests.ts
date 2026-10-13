import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { confirmRepairQueue, pickModelFiles, saveBinaryFile } from './FileIO';

export async function runFileIOTests() {
  const results: { name: string; passed: boolean; actual?: unknown; expected?: unknown }[] = [];
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  Object.defineProperty(globalThis, 'window', { value: { crypto }, configurable: true });
  Object.defineProperty(globalThis, 'isTauri', { value: true, configurable: true });
  try {
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
      if (command === 'plugin:fs|read_file') return new Uint8Array([7, 8, 9]).buffer;
    });
    const files = await pickModelFiles(true);
    results.push({ name: 'Native model picker preserves Unicode basenames and bytes', passed: files.length === 2 && files[0].name === 'кошка.glb' && files[1].name === 'robot.gltf' && String(new Uint8Array(await files[0].arrayBuffer())) === '7,8,9' });

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
