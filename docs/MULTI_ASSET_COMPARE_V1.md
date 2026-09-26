# Asset Doctor — Multi-Asset Compare v1

Status: implemented on `main`.

## Product rule

Compare is a **viewing and comparison workspace**, not five simultaneous Doctors.

When Compare is open:

- Health is not duplicated per viewport;
- Heal is not run across several assets;
- no `Fix All Models` behavior exists;
- the normal Asset Doctor scene remains the analysis / repair workspace.

This keeps diagnosis and Surgical Heal scoped to one active Doctor asset at a time.

## Capacity

Up to **5 GLB / GLTF assets** can be loaded into one Compare session.

Slots are labeled:

`A / B / C / D / E`

Models are decoded sequentially to avoid an unnecessary CPU / RAM spike when several heavy files are selected together.

## Renderer architecture

Compare uses:

`one canvas + one THREE.WebGLRenderer`

Grid cells are rendered with `viewport + scissor` rectangles.

Each asset owns an independent:

- scene;
- camera;
- OrbitControls state;
- AnimationMixer;
- selected animation clip.

Assets cannot mutate each other's scene state.

## Adaptive Grid

Accepted layouts:

- 2 assets → `1 + 1`
- 3 assets → `2 + 1`
- 4 assets → `2 + 2`
- 5 assets → **`3 + 2`**

Double-clicking a cell enters **Solo View**. Double-click again or press `Esc` to return.

## Sync Cameras

Grid mode supports synchronized cameras.

Synchronization uses normalized framing rather than absolute world coordinates:

- camera orientation follows the source view;
- camera distance is normalized against each model's bounds;
- each model keeps its own bounds center / scale.

This allows assets with different real dimensions to remain comparably framed.

## Lineup

Lineup places all loaded models in one shared presentation view.

Modes:

### Real Scale

Original relative dimensions are preserved.

Useful for detecting incorrect export scale immediately.

### Normalize Height

Presentation-only scaling makes the compared models the same height.

The source model is not modified.

Useful for silhouette and proportion comparison.

## Animation comparison

Each asset may select its own animation clip.

Compare exposes:

- Play / Pause;
- normalized timeline `0…1`;
- Loop;
- playback speed;
- `Sync Time` toggle.

Normalized seeking makes clips of different durations comparable at the same relative phase.

Further clip mapping is intentionally deferred.

## Metrics table

Compare displays factual measurements only:

- Triangles
- Vertices
- Meshes
- Materials
- Textures
- Bones
- Clips
- estimated Draw Calls
- estimated raw Texture VRAM
- Height

No winner / quality score is produced.

## Scope limits

v1 intentionally does not include:

- Health panels for all five assets;
- multi-asset Heal;
- persistent Compare workspaces;
- Asset Library integration;
- cross-model rig retargeting;
- semantic model matching;
- automatic winner selection.

Those are separate future features.
