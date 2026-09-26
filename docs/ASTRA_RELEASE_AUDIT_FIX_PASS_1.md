# Asset Doctor — Astra Release Audit Fix Pass 1

Audit baseline: `4468391d12bd9de9dcac541d7b3068f69ee19aa7`

This document records the first repair pass after Astra's independent release-readiness audit. It is deliberately conservative: a finding is marked fixed only when code changed to address the reported failure mode. Tauri-specific tasks remain outside this pass.

## P1 findings

### 1. Export could report VERIFIED after source semantic loss — FIXED / CONSERVATIVE GATE

- Added raw glTF/GLB source audit before Three.js scene conversion.
- Repaired export now compares source semantic capabilities with serialized output.
- Source semantic extensions such as `KHR_materials_variants` cannot silently receive VERIFIED.
- Raw source material / texture / image / animation definition counts are checked in addition to scene-vs-scene verification.

Current policy is intentionally conservative: semantic extensions without an explicit preservation contract block VERIFIED repaired export.

### 2. GLTFLoader normalized bad skin weights before diagnostics — FIXED

- `WEIGHTS_0` is inspected directly from the source GLB buffer before GLTFLoader normalization.
- Source invalid-sum and zero-weight counts survive into skeleton diagnostics.
- Source-only findings without safe mesh/vertex localization are manual-only; Asset Doctor does not blindly normalize them.

### 3. Viewport presentation mutated material diagnostics — FIXED

- Authored material state is captured before viewport instrumentation.
- Material and texture diagnostics read authored material snapshots rather than active render-mode substitutions.
- Render modes restore authored materials before presentation overrides and dispose temporary GPU materials.

### 4. Missing texture could become `No textures / N/A` — FIXED FOR CURRENT SINGLE-FILE CONTRACT

- LoadingManager resource failures are surfaced as invalid/unresolved texture resources.
- A normal `.gltf` package with external `.bin` / image URIs is explicitly rejected by single-file import instead of silently loading incomplete data.
- Self-contained GLB remains the fully supported browser-core import contract.

Full multi-file glTF package import remains a later desktop/native file-dialog task.

### 5. First launch could stay in ANALYZING — FIXED

- Viewport initialization is deferred until the parent App service effect has created WorkerManager.
- This removes the reproduced child-effect-before-worker startup race.

### 6. Compare animation phase / Lineup playback — FIXED

- Lineup clones now own their own AnimationMixer and selected action.
- `Sync Time` means normalized phase sync during playback, not merely synchronized seeking.
- 2-second and 4-second clips remain at the same normalized phase.

### 7. Undo during async export could publish stale VERIFIED output — FIXED

- Export snapshots a fingerprint of every repaired mesh involved in the active repair session.
- The fingerprint is checked again after async serialization and reopen verification.
- Undo / Heal mutation during export invalidates the pending result rather than publishing it.

## P2 findings

### 8. Slow old load could replace newer selection — FIXED FOR FINAL STATE

- `loadFromFile` requests are serialized so completion order follows user selection order.
- A slow earlier file can no longer become the final model after a later selection has completed.

A future cancellation/token implementation can reduce wasted work, but the stale-final-state bug is closed.

### 9. Lineup could remember substituted Wireframe material as PBR — FIXED

- Lineup cloning is performed while authored materials are temporarily restored.
- RenderModeManager supports one manager across several Lineup roots without clearing previous roots on the same mode.

### 10. Index seams were described as geometric holes — FIXED SEMANTICS

- `Boundary / open edges` is now `Index-boundary edges`.
- Diagnostic text explicitly states that UV, material and hard-normal seams can duplicate positions.
- Tiny components are described as index-connected components, not automatically floating debris.
- Automatic welding remains prohibited unless complete attributes and regression guards permit the existing exact-duplicate repair.

### 11. Some modes / metrics overclaimed what was measured — FIXED / RELABELLED

- Roughness view samples the G channel.
- Metallic view samples the B channel.
- AO view samples the R channel.
- Empty Three.js texture color space is reported as `none/data`, not guessed as sRGB.
- Material analysis distinguishes MASK via alphaTest.
- The fake `Triangle Density Heatmap` label is removed; the current mode is explicitly `Triangle Wireframe` until a real density scalar field exists.

### 12. GPU disposal / heavy synchronous work — PARTIAL

Fixed now:
- render-mode temporary materials and overlays are disposed when replaced;
- Compare slot / Lineup presentation managers clean up temporary render resources.

Still open before final desktop release:
- profile heavy synchronous Heal/export topology passes on production-scale assets;
- move or chunk any confirmed long UI-thread passes;
- long-session memory / GPU soak test.

### 13. 1366x768 toolbar / Space shortcut — FIXED

- Toolbar now progressively collapses labels/groups at smaller desktop widths and keeps a horizontal fallback instead of losing commands.
- Space playback shortcut is handled where the current animation callback/state is available, avoiding the stale App closure.

## Added regression coverage

New CI coverage includes:
- semantic-extension source audit;
- source skin-weight defect detection before Three.js normalization;
- raw source semantic definition counts;
- external glTF package dependency detection;
- authored material opacity / side / alpha-mode preservation;
- MASK vs OPAQUE classification;
- data-texture color-space handling.

Current suite after this pass: **98/98 PASS**, plus TypeScript and production build.

## Still intentionally open before Tauri

1. Heavy-model performance / long-session soak pass.
2. Bundle Draco decoders locally; remove browser runtime dependence on Google CDN.
3. Explicit Meshopt and KTX2 support / preservation policy.
4. Native file-open/save, Unicode paths and multi-file glTF package behavior.
5. Tauri drag-and-drop policy, CSP/capabilities, WebView2 installer behavior.
6. Unsaved-repair close/switch warning policy.
7. Signing + updater / patch channel design.

Tauri migration should begin only after the remaining browser-core release issues have been tested on real assets.
