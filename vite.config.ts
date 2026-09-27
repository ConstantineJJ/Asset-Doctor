import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const DRACO_FILES = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'] as const;
const DRACO_SOURCE = path.resolve(import.meta.dirname, 'node_modules/three/examples/jsm/libs/draco/gltf');
const BASIS_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'] as const;
const BASIS_SOURCE = path.resolve(import.meta.dirname, 'node_modules/three/examples/jsm/libs/basis');

function serveStaticDecoder(
  req: any,
  res: any,
  next: () => void,
  routePrefix: string,
  sourceDir: string,
  allowedFiles: readonly string[]
) {
  const requestPath = (req.url ?? '').split('?')[0];
  if (!requestPath.startsWith(routePrefix)) return next();

  const fileName = path.basename(requestPath);
  if (!allowedFiles.includes(fileName)) return next();

  const source = path.join(sourceDir, fileName);
  if (!fs.existsSync(source)) return next();
  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8'
  );
  fs.createReadStream(source).pipe(res);
}

async function copyDecoderFiles(sourceDir: string, targetDir: string, files: readonly string[]) {
  await fsp.mkdir(targetDir, { recursive: true });
  await Promise.all(
    files.map((fileName) =>
      fsp.copyFile(path.join(sourceDir, fileName), path.join(targetDir, fileName))
    )
  );
}

/**
 * Asset Doctor must not depend on decoder CDNs once it becomes a desktop app.
 * Serve Three's pinned Draco and BasisU packages locally in dev, and copy the
 * same files into dist for production/Tauri builds.
 */
function localModelDecoders() {
  return {
    name: 'asset-doctor-local-model-decoders',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const requestPath = (req.url ?? '').split('?')[0];
        if (requestPath.startsWith('/draco/')) {
          return serveStaticDecoder(req, res, next, '/draco/', DRACO_SOURCE, DRACO_FILES);
        }
        if (requestPath.startsWith('/basis/')) {
          return serveStaticDecoder(req, res, next, '/basis/', BASIS_SOURCE, BASIS_FILES);
        }
        return next();
      });
    },
    async closeBundle() {
      await Promise.all([
        copyDecoderFiles(
          DRACO_SOURCE,
          path.resolve(import.meta.dirname, 'dist/draco'),
          DRACO_FILES
        ),
        copyDecoderFiles(
          BASIS_SOURCE,
          path.resolve(import.meta.dirname, 'dist/basis'),
          BASIS_FILES
        ),
      ]);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), localModelDecoders()],
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