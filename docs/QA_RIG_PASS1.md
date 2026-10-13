# Animation Rig Extension — PASS 1

Baseline: accepted F02 `f744a3f`. Windows/Tauri, application version unchanged.

The lightning button now enables skeleton links and joints together, with X-Ray immediately active. Joint markers use one instanced draw call. Selection keeps the authored transforms intact and uses the existing hierarchy inspector. Bounds are cached when the asset loads rather than rescanned during selection.

Validation: TypeScript passed; 153 unit regressions passed; all 27 production browser tests passed, including actual pointer selection, automatic X-Ray, joint visibility and unchanged joint TRS. Browser tests exercise the desktop frontend. Native Windows acceptance will accompany the completed editor build; this increment does not claim native acceptance.

Next increments separate authored rest, temporary pose and clip timing. Fresh-context review and an additional read-only Codex CLI review identified inverse-bind rest reconstruction, aliased clip arrays, singular compensation, channel provenance and native-save invalidation as required regression boundaries. The editor export will patch the source GLB so untouched skins, attributes, materials, extras and binary ranges retain their original representation.

Sources: [Three.js Skeleton](https://threejs.org/docs/pages/Skeleton.html), [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html), [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html). Exact installed Three.js loader, mixer and exporter code was inspected.
