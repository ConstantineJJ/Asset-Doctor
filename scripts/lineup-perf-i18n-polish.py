from pathlib import Path
import re


def replace(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    found = text.count(old)
    if found < count:
        raise SystemExit(f'{path}: expected {count} occurrence(s), found {found}: {old[:100]!r}')
    text = text.replace(old, new, count)
    p.write_text(text, encoding='utf-8')


# ---------------------------------------------------------------------------
# Lineup performance: stop cloning all assets on every Alt+wheel notch or
# Normalize Height toggle. Build clones once, cache authored bounds, then update
# only presentation transforms in O(number of lineup assets).
# ---------------------------------------------------------------------------
p = Path('src/viewer/CompareSceneManager.ts')
text = p.read_text(encoding='utf-8')

old = '''interface LineupRootRuntime {
  asset: CompareAssetRecord;
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
}

interface LineupRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  roots: LineupRootRuntime[];
  lightingManager: LightingManager;
  renderModeManager: RenderModeManager;
}'''
new = '''interface LineupRootRuntime {
  asset: CompareAssetRecord;
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  /** Bounds captured once from the authored presentation clone before lineup scaling. */
  sourceBounds: THREE.Box3;
  sourceSize: THREE.Vector3;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
}

interface LineupRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  roots: LineupRootRuntime[];
  lightingManager: LightingManager;
  renderModeManager: RenderModeManager;
  /** Current analytically maintained lineup bounds; avoids expandByObject on UI input. */
  bounds: THREE.Box3;
}'''
if old not in text:
    raise SystemExit('CompareSceneManager: lineup interfaces pattern missing')
text = text.replace(old, new, 1)

old = '''  public setScaleMode(mode: CompareScaleMode) {
    this.scaleMode = mode;
    if (this.viewMode === 'lineup') this.rebuildLineup(true);
  }'''
new = '''  public setScaleMode(mode: CompareScaleMode) {
    this.scaleMode = mode;
    if (this.viewMode === 'lineup') this.updateLineupLayout(true, true);
  }'''
if old not in text:
    raise SystemExit('CompareSceneManager: setScaleMode pattern missing')
text = text.replace(old, new, 1)

old = '''  public setManualScale(assetId: string, scale: number, reframe = false) {
    if (!this.assets.some((asset) => asset.id === assetId)) return;
    const next = this.clampManualScale(scale);
    this.manualScales.set(assetId, next);
    this.callbacks.onManualScaleChange?.(assetId, next);
    if (this.viewMode === 'lineup') this.rebuildLineup(reframe);
  }'''
new = '''  public setManualScale(assetId: string, scale: number, reframe = false) {
    if (!this.assets.some((asset) => asset.id === assetId)) return;
    const next = this.clampManualScale(scale);
    this.manualScales.set(assetId, next);
    this.callbacks.onManualScaleChange?.(assetId, next);
    if (this.viewMode === 'lineup') this.updateLineupLayout(reframe, reframe);
  }'''
if old not in text:
    raise SystemExit('CompareSceneManager: setManualScale pattern missing')
text = text.replace(old, new, 1)

old = '''  public resetManualScales() {
    for (const asset of this.assets) {
      this.manualScales.set(asset.id, 1);
      this.callbacks.onManualScaleChange?.(asset.id, 1);
    }
    if (this.viewMode === 'lineup') this.rebuildLineup(true);
  }'''
new = '''  public resetManualScales() {
    for (const asset of this.assets) {
      this.manualScales.set(asset.id, 1);
      this.callbacks.onManualScaleChange?.(asset.id, 1);
    }
    if (this.viewMode === 'lineup') this.updateLineupLayout(true, true);
  }'''
if old not in text:
    raise SystemExit('CompareSceneManager: resetManualScales pattern missing')
text = text.replace(old, new, 1)

pattern = re.compile(r"  private rebuildLineup\(reframe: boolean\) \{.*?\n  private seekAction\(", re.S)
match = pattern.search(text)
if not match:
    raise SystemExit('CompareSceneManager: rebuildLineup/frameLineup region not found')
replacement = r'''  private rebuildLineup(reframe: boolean) {
    const progress = this.getReferenceNormalizedTime();
    this.clearLineup();
    if (this.assets.length === 0) return;

    const scene = this.createScene();
    const roots: LineupRootRuntime[] = [];

    // Cloning a production GLB (especially a skinned/textured one) is expensive.
    // Do it once when Lineup is created, never for interactive scale changes.
    for (const asset of this.assets) {
      const root = this.cloneAuthoredAsset(asset);
      root.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(root);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const basePosition = root.position.clone();
      const baseScale = root.scale.clone();
      scene.add(root);

      const mixer = asset.animations.length > 0 ? new THREE.AnimationMixer(root) : null;
      let action: THREE.AnimationAction | null = null;
      if (mixer) {
        const clipIndex = THREE.MathUtils.clamp(asset.selectedClipIndex, 0, asset.animations.length - 1);
        action = this.createAction(mixer, asset.animations[clipIndex]);
      }
      roots.push({
        asset,
        root,
        mixer,
        action,
        sourceBounds,
        sourceSize,
        basePosition,
        baseScale,
      });
    }

    const lightingManager = new LightingManager(scene);
    lightingManager.applyPreset(this.lightingPreset);
    const renderModeManager = new RenderModeManager(scene);
    for (const entry of roots) {
      entry.root.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) renderModeManager.registerMesh(object as THREE.Mesh);
      });
      renderModeManager.applyMode(this.renderMode, entry.root);
    }

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    this.lineup = {
      scene,
      camera,
      controls,
      roots,
      lightingManager,
      renderModeManager,
      bounds: new THREE.Box3(),
    };
    this.updateLineupLayout(reframe, true);
    scene.updateMatrixWorld(true);
    this.seekNormalized(progress);
    this.updateControlEnablement();
  }

  private updateLineupLayout(reframe: boolean, refreshGrid: boolean) {
    if (!this.lineup || this.lineup.roots.length === 0) return;

    const maxHeight = Math.max(
      0,
      ...this.lineup.roots.map((entry) => entry.sourceSize.y)
    );
    const targetHeight = Math.max(maxHeight, 1);
    const gap = Math.max(targetHeight * 0.18, 0.25);
    const combined = new THREE.Box3();
    let cursorX = 0;

    for (const entry of this.lineup.roots) {
      const normalizeScale =
        this.scaleMode === 'normalize-height' && entry.sourceSize.y > 1e-6
          ? targetHeight / entry.sourceSize.y
          : 1;
      const manualScale = this.manualScales.get(entry.asset.id) ?? 1;
      const factor = normalizeScale * manualScale;

      // sourceBounds were measured with baseScale already applied. Uniformly
      // scaling their offsets around the root origin lets us update bounds and
      // placement without traversing thousands of meshes/vertices again.
      const minOffset = entry.sourceBounds.min.clone().sub(entry.basePosition).multiplyScalar(factor);
      const maxOffset = entry.sourceBounds.max.clone().sub(entry.basePosition).multiplyScalar(factor);

      entry.root.scale.copy(entry.baseScale).multiplyScalar(factor);
      entry.root.position.copy(entry.basePosition);

      const currentMinX = entry.root.position.x + minOffset.x;
      entry.root.position.x += cursorX - currentMinX;
      const currentMinY = entry.root.position.y + minOffset.y;
      entry.root.position.y -= currentMinY;
      entry.root.updateMatrixWorld(true);

      const min = entry.root.position.clone().add(minOffset);
      const max = entry.root.position.clone().add(maxOffset);
      combined.expandByPoint(min);
      combined.expandByPoint(max);

      cursorX += entry.sourceSize.x * factor + gap;
    }

    this.lineup.bounds.copy(combined);
    if (refreshGrid) this.refreshLineupGrid();
    if (reframe) this.frameLineup();
  }

  private refreshLineupGrid() {
    if (!this.lineup || this.lineup.bounds.isEmpty()) return;
    const stale = this.lineup.scene.children.filter(
      (child) => child.name === '__asset_doctor_compare_grid'
    );
    for (const child of stale) {
      this.lineup.scene.remove(child);
      if ((child as THREE.GridHelper).isGridHelper) {
        (child as THREE.GridHelper).geometry.dispose();
        const material = (child as THREE.GridHelper).material;
        if (Array.isArray(material)) material.forEach((value) => value.dispose());
        else material.dispose();
      }
    }
    this.addGrid(this.lineup.scene, this.lineup.bounds);
  }

  private frameLineup() {
    if (!this.lineup || this.lineup.bounds.isEmpty()) return;
    const bounds = this.lineup.bounds;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.1);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(this.lineup.camera.fov * 0.5)) * 1.2;
    this.lineup.camera.position.copy(center).add(new THREE.Vector3(0.25, 0.18, 1).normalize().multiplyScalar(distance));
    this.lineup.camera.near = Math.max(distance / 2000, 0.001);
    this.lineup.camera.far = Math.max(distance * 100, 100);
    this.lineup.camera.updateProjectionMatrix();
    this.lineup.controls.target.copy(center);
    this.lineup.controls.update();
  }

  private seekAction('''
text = text[:match.start()] + replacement + text[match.end():]
p.write_text(text, encoding='utf-8')


# ---------------------------------------------------------------------------
# Diagnostic card RU localization. Diagnostic logic stays language-neutral;
# only presentation text changes, preserving stable ids for Heal and Focus.
# ---------------------------------------------------------------------------
p = Path('src/components/InspectorPanel.tsx')
text = p.read_text(encoding='utf-8')

anchor = "import { useI18n } from '../i18n';\n"
insert = """import { useI18n } from '../i18n';
import {
  categoryLabel,
  diagnosticElementLabel,
  diagnosticLayerLabel,
  localizeHealthIssue,
  repairabilityLabel,
  severityLabel,
} from '../health/HealthIssueLocalization';
"""
if anchor not in text:
    raise SystemExit('InspectorPanel: i18n import anchor missing')
text = text.replace(anchor, insert, 1)

old = "  const { t } = useI18n();\n"
new = """  const { t, language } = useI18n();
  const localizedIssue = (issue: HealthIssue) => localizeHealthIssue(issue, language);
"""
if old not in text:
    raise SystemExit('InspectorPanel: useI18n destructure missing')
text = text.replace(old, new, 1)

text = text.replace(
    "    const element = current.affectedElement ? ` · ${current.affectedElement}` : '';",
    "    const element = current.affectedElement ? ` · ${diagnosticElementLabel(current.affectedElement, language)}` : '';",
    1,
)

text = text.replace(
    '<div className="text-[11px] font-semibold text-gray-200">Diagnostic card</div>',
    '<div className="text-[11px] font-semibold text-gray-200">{language === \'ru\' ? \'Диагностическая карточка\' : \'Diagnostic card\'}</div>',
    1,
)
text = text.replace(
    'title="Move viewport camera to affected coordinates"',
    "title={language === 'ru' ? 'Переместить камеру к найденной области' : 'Move viewport camera to affected coordinates'}",
    1,
)

# Visible issue prose and labels. Keep original issue object for Focus/Heal logic.
text = text.replace('{issue.title}', '{localizedIssue(issue).title}')
text = text.replace('{issue.description}', '{localizedIssue(issue).description}')
text = text.replace('{issue.technicalDetails}', '{localizedIssue(issue).technicalDetails}')
text = text.replace('{issue.evidence}</span>', '{localizedIssue(issue).evidence}</span>')
text = text.replace('{issue.whyItMatters}</span>', '{localizedIssue(issue).whyItMatters}</span>')
text = text.replace('{issue.suggestedAction}</span>', '{localizedIssue(issue).suggestedAction}</span>')
text = text.replace('issue.whyItMatters !== issue.description', 'localizedIssue(issue).whyItMatters !== localizedIssue(issue).description')

text = text.replace('[{issue.category}]', '[{categoryLabel(issue.category, language)}]')
text = text.replace("{issue.layer ?? 'Health'}", "{diagnosticLayerLabel(issue.layer, language)}")
text = text.replace('{issue.severity}', '{severityLabel(issue.severity, language)}')
text = text.replace("{issue.repairability ?? 'NONE'}", '{repairabilityLabel(issue.repairability, language)}')

# Queue fallback title should respect the selected language too.
text = text.replace(
    ': repairQueue[0].issue.title}',
    ': localizedIssue(repairQueue[0].issue).title}',
    1,
)

p.write_text(text, encoding='utf-8')
print('lineup performance and diagnostic localization polish applied')
