import { isTauri } from '@tauri-apps/api/core';

export { isTauri as isDesktop };

/** The dialog grants scope for selected paths; no whole-disk capability is needed. */
export async function pickModelFiles(multiple = false): Promise<File[]> {
  const [{ open }, { readFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const selected = await open({
    multiple,
    directory: false,
    filters: [{ name: '3D models', extensions: ['glb', 'gltf'] }],
  });
  const paths = selected === null ? [] : Array.isArray(selected) ? selected : [selected];
  const files: File[] = [];
  for (const path of paths) {
    const bytes = await readFile(path);
    const name = path.split(/[\\/]/).pop() || 'model.glb';
    files.push(new File([bytes], name, { type: name.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json' }));
  }
  return files;
}

/** True means a completed write; cancellation and unconfirmed browser downloads return false. */
export async function saveBinaryFile(fileName: string, buffer: ArrayBuffer): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: 'Binary glTF', extensions: ['glb'] }],
    });
    if (path === null) return false;
    await writeFile(path, new Uint8Array(buffer));
    return true;
  }

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
