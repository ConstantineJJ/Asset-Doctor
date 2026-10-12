# Windows icon update — QA

2026-10-13. Source: owner-provided `Asset_Doctor_icon_small.png`, 128×128 RGBA.
Version remains 0.0.0. Source is copied byte-for-byte into `src-tauri/icons`;
128×128 bundle PNG is identical. No redesign or additional elements.

Tauri icon generator creates 32×32 and 256×256 PNGs and Windows ICO frames
16/24/32/48/64/256. The 256 frame is an upscale of the 128 source; no extra detail
is claimed. ICO 256 pixels match generated 256 PNG exactly (`icon-verify.json`).

Windows bundle configuration uses these PNGs and ICO; old ICNS reference is removed.
Unrelated old resources are retained. NSIS installer/uninstaller require explicit
`installerIcon` / `uninstallerIcon`: `bundle.icon` alone retained NSIS's default icon.
Generated NSIS script now points both paths to the new ICO (`nsis-icon-paths.txt`).

PASS: TypeScript; 145/145 unit/integration tests; Tauri release build and NSIS
rebundle. EXE and freshly copied installer PE icons extracted and visually checked:
`exe-resource-icon.png`, `nsis-resource-icon-final.png`. Native titlebar shows the
owner's red/blue icon (`native-window-icon.png`). Tauri uses this default window
icon for Windows window/taskbar representation; existing pinned shortcuts may
retain Windows shell cache. Taskbar/pinned shortcut visual acceptance remains manual.

SKIP: clean-machine installation/uninstallation, different DPI and shell-cache
refresh. Installer remains unsigned. Owner should launch EXE and check titlebar,
taskbar, installer icon and installed shortcut on their desktop.
