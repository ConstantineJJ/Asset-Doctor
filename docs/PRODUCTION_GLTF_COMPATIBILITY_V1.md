# Asset Doctor — Production glTF Compatibility v1

This document defines the pre-Tauri compatibility policy for compressed production assets.

## Loading support

### Draco — supported offline
- Extension: `KHR_draco_mesh_compression`
- Decoder is served from the pinned Three.js package in development.
- Decoder files are copied into `dist/draco` for production/Tauri builds.
- No CDN/network fallback is required.

### Meshopt — supported offline
- Extension: `EXT_meshopt_compression`
- Uses the bundled Three.js `MeshoptDecoder` module.
- No external decoder download is required.

### KTX2 / BasisU — supported for viewing offline
- Extension: `KHR_texture_basisu`
- Basis transcoder files are served locally in development and copied into `dist/basis` for production/Tauri builds.
- GPU target-format support is detected before KTX2 decode.
- Loader instances without the main viewport renderer may use a temporary WebGL capability probe.

## Repaired export policy

Asset Doctor distinguishes transport compression from source semantics.

- Draco and Meshopt are treated as transport-only geometry compression. A repaired export may be serialized as ordinary uncompressed GLB as long as the independent reopen verification proves the resulting geometry/material/rig/animation structure.
- `KHR_texture_basisu` remains a protected source extension for repaired export. Loading/viewing KTX2 is supported, but Asset Doctor does **not** currently claim that `GLTFExporter` preserves the authored KTX2/BasisU texture container and extension contract.
- Therefore a source using `KHR_texture_basisu` may be inspected normally, but repaired export must not receive `VERIFIED` merely because the decoded Three.js scene looks equivalent. The raw-source extension gate remains authoritative.

This is deliberate: successful display is not proof of round-trip semantic preservation.

## External .gltf packages

The browser build still treats a normal multi-file `.gltf` package as unsupported when sibling `.bin` or image files are required. A single browser `File` cannot resolve the package safely. Use self-contained GLB for the browser core.

Native multi-file package selection can be implemented during the Tauri filesystem phase.

## Pre-Tauri acceptance

Before freezing the browser core, smoke-test at least one real asset for each available category:

1. ordinary GLB;
2. Draco GLB;
3. Meshopt GLB;
4. KTX2/BasisU GLB;
5. rigged + animated GLB;
6. heavy production GLB.

For repaired assets, always run:

`Open → Analyze → Heal → Undo → Heal → Export → Reopen → Verify`

A loader success alone is not a repair/export certification.
