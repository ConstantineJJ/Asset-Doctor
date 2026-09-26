import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const DRACO_FILES = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'] as const;
const DRACO_SOURCE = path.resolve(import.meta.dirname, 'node_modules/three/examples/jsm/libs/draco/gltf');

/**
 * Asset Doctor must not depend on a decoder CDN once it becomes a desktop app.
 * Serve Three's pinned decoder package locally in dev, and copy the same files
 * into dist/draco for production/Tauri builds.
 */
function localDracoDecoder() {
  return {
    name: 'asset-doctor-local-draco',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const requestPath = (req.url ?? '').split('?')[0];
        if (!requestPath.startsWith('/draco/')) return next();

        const fileName = path.basename(requestPath);
        if (!DRACO_FILES.includes(fileName as (typeof DRACO_FILES)[number])) return next();

        const source = path.join(DRACO_SOURCE, fileName);
        if (!fs.existsSync(source)) return next();
        res.statusCode = 200;
        res.setHeader(
          'Content-Type',
          fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8'
        );
        fs.createReadStream(source).pipe(res);
      });
    },
    async closeBundle() {
      const target = path.resolve(import.meta.dirname, 'dist/draco');
      await fsp.mkdir(target, { recursive: true });
      await Promise.all(
        DRACO_FILES.map((fileName) =>
          fsp.copyFile(path.join(DRACO_SOURCE, fileName), path.join(target, fileName))
        )
      );
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), localDracoDecoder()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});