# Animation Rig Extension — authored rest and clip core

18 new regressions pass; complete unit suite 171/171, TypeScript and production frontend build pass. This increment implements the isolated editing model; interactive UI and edited export are subsequent increments.

Rest edits preserve vertex/joint/weight arrays and existing mesh bind matrices. Inverse bind compensation is `inverse(new joint world) * old joint world * old IBM`; authoritative local rest transforms are stored separately from pose. Animation rebasing applies a rigid local rest delta to affected translation/quaternion channels, including cubic values and derivatives. Clip retiming clones aliased arrays and scales cubic derivatives inversely with duration. Undo/Redo restores exact prior state; preview authoring remains separate.

Real GLTFLoader fixture: four joints in child-first order, transformed non-joint anchor, valid nonidentity bind shape, shared animation accessors, LINEAR/STEP/genuine CUBICSPLINE and morph animation. Independent baseline skin error is approximately `1.02e-15`. Tests inspect actual world skin vertices, raw arrays, real cubic interpolation, history, finite/representable durations and atomic rejection.

Limits enforced: zero/nearly singular transforms; holding children requiring shear or changed scale; holding non-joint attachments; nested animated property bindings; terminal guide collision with scalar/array/null or occupied author extras. Follow-chain edits move rigid attachments with their parent. Leaf endpoints are nondeforming guides, not fabricated joints.

Additional Codex CLI review ran read-only and ephemeral. Findings 1, 2, 8, 10 and 11 are actionable core boundaries and receive guards/regressions here. Findings 3–7 concern raw GLB export/provenance/worker transport and remain requirements for the export increment: new uncompressed views, untouched source weights and primitive modes, canonical channel mapping, function-free clip packets and explicit matrix updates. Finding 9 concerns native Save invalidation and will be guarded immediately before filesystem writing. No export verification is claimed by this core increment.

Author source metadata and canonical parser associations remain in WeakMaps, outside serializable extras (F05).
