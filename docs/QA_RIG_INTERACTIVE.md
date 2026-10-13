# Animation Rig Extension — interactive editing and preview

TypeScript passes; 173/173 unit tests and 28/28 production browser tests pass, including existing F01/F03/F05/F02 tests and the 500001-triangle performance gate.

The isolated panel exposes Inspect, Edit Skeleton and Pose Preview; actual TransformControls handles support translation/rotation, local/world space, joint/end selection and Follow/Hold children. Drag previews compensate the real skin and finish as one Undo transaction. Numerical position/rotation and child-distance controls offer precise edits. Leaf endpoints remain explicitly nondeforming guides. Clip duration edits are distinct from the existing 0.25–2x playback controls.

Actual pointer regression covers joint selection, gizmo drag, authoring, Undo, temporary preview rotation, preview exit, playback Stop and clip retiming. Mixer caches are detached before authoring; Stop/reset explicitly restore stored local rest rather than deriving rest from IBMs. Clicking a joint origin takes precedence over incident links.

This increment has no completed edited-GLB export yet. The new editor remains under implementation and will receive source-preserving export, independent reimport/deformation verification and a Windows acceptance build before delivery.

Native Save receives a current-result predicate and tests refusal to write invalidated bytes after an asynchronous dialog. The UI protects both rig changes and existing repair changes from silent asset replacement/close.
