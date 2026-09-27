# Asset Doctor — Pre-Tauri Regression v1

Purpose: final browser-core acceptance pass before freezing Asset Doctor Core and beginning the Tauri shell.

This is a manual/runtime matrix, not a replacement for CI.

## A. Core smoke assets

Use at least these asset classes:

A. Static simple GLB
- one/few meshes
- one material
- no rig
- no animation

B. Segmented PBR model
- many nodes / meshes
- multiple materials
- several textures

C. Rigged animated character
- skeleton + skin
- multiple clips
- root motion if available

D. Heavy production model
- high vertex / triangle count
- many textures/materials
- realistic memory pressure

E. Compressed assets
- Draco GLB
- Meshopt GLB
- KTX2/BasisU GLB

## B. Doctor regression flow

For each appropriate asset:

`Open → Scene Tree → Render modes → Lighting → Health → Focus → Rig/Animation → Rescan`

Verify:
- viewport remains responsive;
- PBR / Unlit / Base Color / Normals / Wireframe / diagnostic modes can be switched repeatedly;
- no white-screen/render-loop failure;
- Scene Tree belongs to the active asset;
- diagnostics finish or explicitly report UNKNOWN/error instead of hanging forever;
- animation seek/pause/frame-step remains synchronized.

## C. Surgical Heal regression

Use Test Patient plus at least one real repairable model.

Run:

`Preview → Apply → Rescan → Verify → Undo → Apply again → Export → Reopen → Verify`

Then run Safe Repair Queue on a model with dependent candidates.

Verify:
- original source bytes are never overwritten;
- Undo restores the expected live geometry;
- REGRESSION/PARTIAL stops the queue;
- multi-repair sessions retain earlier verified repairs;
- repaired export contains all active verified repairs;
- reopen verification rejects stale or semantically unsafe output.

## D. Unsaved repair protection

1. Apply at least one repair and leave it unexported.
2. Attempt to open another file.
3. Confirm the Asset Doctor modal offers:
   - Cancel
   - Discard and open
   - Export and open (only when export is currently allowed)
4. Test all available branches.
5. With unexported repairs still active, reload/close the browser tab and confirm the browser before-unload warning is triggered.

Expected: no asset switch silently destroys an active repair session.

## E. Multi-Asset Compare regression

Load five mixed assets.

Grid:
- 5 models render in 3+2 layout;
- select A→B→C→D→E;
- left read-only hierarchy follows selection;
- Sync Cameras ON/OFF;
- tune one camera independently, re-enable sync;
- Solo and return;
- synchronized animation phase with different clip durations.

Lineup:
- Real Scale;
- Normalize Height;
- hold RMB + mouse wheel over one model: only that model changes presentation scale;
- ordinary mouse wheel still zooms camera;
- no simultaneous camera zoom during RMB+wheel model scaling;
- manual scale persists across Doctor → Compare transitions;
- PBR, Unlit, Base Color, Normals, Wireframe, Wireframe Overlay and diagnostic modes survive repeated switching;
- all lighting presets can be changed;
- Compare Metrics remains outside the viewport and fits without hiding the fifth model.

Doctor handoff:
- select a Compare model;
- press `Doctor · X`;
- confirm the selected source opens as a fresh Doctor asset;
- return to Compare;
- confirm the 5-model Compare session and manual Lineup scales remain in memory.

## F. Compression compatibility

Draco:
- load while network access is disabled;
- inspect and render normally.

Meshopt:
- load while network access is disabled;
- inspect and render normally.

KTX2 / BasisU:
- load while network access is disabled;
- texture must render normally after GPU capability detection;
- repaired export is intentionally NOT certified as VERIFIED while `KHR_texture_basisu` preservation is unproven.

Expected: viewing support and repaired-export certification remain separate concepts.

## G. Heavy-model / soak pass

Run for 30–60 minutes with at least one heavy production asset and one five-asset Compare session.

Suggested stress sequence:

1. Open heavy asset.
2. Rescan ×10.
3. Switch render modes repeatedly for 2–3 minutes.
4. Preview/Cancel safe repairs repeatedly.
5. Apply/Undo a verified operation ×5–10 where possible.
6. Export/reopen verification at least twice.
7. Enter Compare with 5 assets.
8. Grid ↔ Lineup ×20.
9. Normalize Height ↔ Real Scale ×20.
10. RMB+wheel manual scale on all five assets.
11. Doctor → Compare → Doctor transitions ×10.
12. Remove and replace Compare assets repeatedly.

Observe `window.__ASSET_DOCTOR_PERF__` in DevTools when available.

Look for:
- monotonically increasing JS heap after operations have settled;
- repeated growth of live geometry unrelated to currently retained assets/Undo history;
- stale topology work continuing after asset replacement;
- progressive FPS degradation;
- WebGL context loss;
- long main-thread stalls;
- render-mode material corruption;
- detached/blank viewport after repeated transitions.

A short transient memory peak is acceptable. Persistent unbounded growth is not.

## H. Error-path checks

Test intentionally:
- invalid GLB;
- ordinary multi-file `.gltf` with missing sibling resources;
- unsupported semantic extension during repaired export;
- topology worker failure/cancel path where practical;
- switching assets during analysis;
- Undo during/around export attempts.

Expected:
- explicit actionable error/UNKNOWN state;
- never convert incomplete data into false OK;
- source remains untouched.

## I. Browser-core freeze gate

Asset Doctor Core may be frozen for Tauri when:

- CI is green;
- the above smoke matrix has no P0/P1 runtime defect;
- no reproducible white-screen/render-loop failure remains;
- no silent loss of a repair session remains;
- heavy soak shows no clear unbounded memory growth;
- Draco/Meshopt/KTX2 viewing works offline as defined by policy;
- repaired export remains conservative for semantics it cannot prove preserved;
- Compare/Doctor handoff is stable;
- EN/RU core UI remains usable.

After this gate, avoid broad browser-core refactors. Tauri should wrap the proven core rather than changing its diagnostic/heal behavior.
