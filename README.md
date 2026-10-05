# Asset Doctor

Local React/Three.js viewer, diagnostics and verified repaired GLB copies, with
a Tauri 2 desktop shell. The original source file is kept separately from viewer
presentation and repaired output.

## Web development

Requires Node.js 24. `package-lock.json` is the canonical dependency lockfile;
the previous Bun lockfile was replaced when preparing the desktop build.

```sh
npm ci
npm run dev
```

The development server uses port 3000 and fails if it is occupied.

## Windows desktop

Install the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/):
Rust stable, Visual Studio C++ build tools and the Windows SDK. WebView2 is the
runtime used by the app.

```sh
npm ci
npm run desktop:dev
npm run desktop:check
npm run desktop:build
```

The build embeds `dist` and creates
`src-tauri/target/release/bundle/nsis/Asset Doctor_0.0.0_x64-setup.exe`.
Version `0.0.0` is retained from the existing project; this is an unsigned
development installer, without an updater or public release.

The installer downloads WebView2 only if the machine needs it. The application
itself bundles its model decoders. For installation on disconnected machines
without WebView2, use a Tauri configuration override with
`bundle.windows.webviewInstallMode.type = "offlineInstaller"` as described in
the [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/).

## File and repair contract

- Open accepts self-contained GLB and glTF, including embedded data URIs.
  External `.bin`, image, HTTPS and `file://` references are rejected, regardless
  of the filename. Multi-file glTF packages are not yet supported.
- Desktop Open/Compare and repaired-copy Save use native dialogs. Only selected
  paths are granted filesystem access. Save cancellation and write failures
  preserve unsaved-repair protection.
- Building a verified export does **not** count as saving. The desktop app
  clears protection after the native write finishes. Browser downloads have
  no reliable completion signal, so their protection remains: download the
  copy, check it, then explicitly choose **Discard and open** to switch assets.
- Closing the desktop window with unsaved repairs asks for confirmation.
  HTML5 file drag-and-drop is retained by disabling Tauri's drag/drop handler.
- Draco, Meshopt and BasisU/KTX2 decoder assets are bundled. Viewing support
  does not imply lossless repaired-export certification for every glTF extension.

## Verification

```sh
npm run lint
npm test
npx playwright install chromium
npm run test:browser:production
npm run desktop:check
```

Browser tests use installed Edge on Windows and Playwright Chromium elsewhere.
Close a running development server before testing production, so the test suite
starts the production preview itself. CI runs frontend regression checks and
builds a Windows installer artifact; it does not publish a release.

See [the current review](docs/TAURI_PREPARATION_REVIEW.md) and the broader
[manual acceptance matrix](docs/PRE_TAURI_REGRESSION_V1.md).
