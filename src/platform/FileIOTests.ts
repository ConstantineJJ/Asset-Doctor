import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { pickModelFiles, saveBinaryFile } from './FileIO';

export async function runFileIOTests() {
  const results: { name: string; passed: boolean; actual?: unknown; expected?: unknown }[] = [];
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  Object.defineProperty(globalThis, 'window', { value: { crypto }, configurable: true });
  Object.defineProperty(globalThis, 'isTauri', { value: true, configurable: true });
  try {
    let writes = 0;
    mockIPC((command) => {
      if (command === 'plugin:dialog|save') return null;
      if (command === 'plugin:fs|write_file') writes++;
    });
    const cancelled = await saveBinaryFile('repaired.glb', new Uint8Array([1, 2, 3]).buffer);
    results.push({ name: 'Native save cancellation leaves the repaired copy unsaved', passed: cancelled === false && writes === 0 });

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
