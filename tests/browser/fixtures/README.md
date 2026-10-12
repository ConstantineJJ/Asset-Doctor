# Draco regression fixture

`box-draco.gltf` and `box-draco.bin` are the **Box** sample, copyright 2017
Cesium, licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

Source: [Khronos glTF Sample Assets / Box](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box).
Downloaded 2026-10-05. Files are stored unchanged; the test embeds the binary
buffer as a data URI in memory to exercise self-contained import and offline Draco.

Original attribution: Cesium for Everything.

## F01 source-fidelity fixture

`two-scenes.glb` is the synthetic Asset Doctor review fixture generated on
2026-10-12 and copied unchanged from `Asset_Doctor_review_evidence.zip`.
SHA-256: `65d9e61cc389782c51b74eb6732fc98f553b68381f05d5792ea5c308e9875997`.
It contains two scenes, including `SecondaryOnly`, and an indexed grid with
one degenerate triangle. No third-party artwork is included.

The F01 tests also derive single-scene variants in memory to check unreachable
nodes and preservation of non-mesh anchors without editing the archived bytes.
