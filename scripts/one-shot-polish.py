from pathlib import Path


def patch(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    found = text.count(old)
    if found < count:
        raise SystemExit(f'{path}: expected at least {count} occurrence(s), found {found}: {old[:100]!r}')
    text = text.replace(old, new, count)
    p.write_text(text, encoding='utf-8')


# Compare Lineup: rebuild presentation clones only while Lineup is active.
patch(
    'src/viewer/CompareSceneManager.ts',
    "    this.rebuildLineup(false);\n    this.seekNormalized(progress);\n    this.updateControlEnablement();",
    "    if (this.viewMode === 'lineup') {\n      this.rebuildLineup(true);\n    } else {\n      this.seekNormalized(progress);\n    }\n    this.updateControlEnablement();"
)
patch(
    'src/viewer/CompareSceneManager.ts',
    "  public setViewMode(mode: CompareViewMode) {\n    this.viewMode = mode;\n    if (mode === 'lineup' && !this.lineup) this.rebuildLineup(true);\n    this.updateControlEnablement();\n  }",
    "  public setViewMode(mode: CompareViewMode) {\n    this.viewMode = mode;\n    if (mode === 'lineup') {\n      // Lineup is presentation-only. Rebuild from authored source each time we\n      // enter it instead of reusing stale clones created while Grid was active.\n      this.rebuildLineup(true);\n    } else {\n      // Release presentation clones/mixers while Grid is active. Session state\n      // such as manual scales and selected assets is stored outside the clones.\n      this.clearLineup();\n    }\n    this.updateControlEnablement();\n  }"
)
patch(
    'src/viewer/CompareSceneManager.ts',
    "  public setScaleMode(mode: CompareScaleMode) {\n    this.scaleMode = mode;\n    this.rebuildLineup(true);\n  }",
    "  public setScaleMode(mode: CompareScaleMode) {\n    this.scaleMode = mode;\n    if (this.viewMode === 'lineup') this.rebuildLineup(true);\n  }"
)
patch(
    'src/viewer/CompareSceneManager.ts',
    "    this.lineup = { scene, camera, controls, roots, lightingManager, renderModeManager };\n    this.seekNormalized(progress);\n    if (reframe) this.frameLineup();\n    else this.frameLineup();\n    this.updateControlEnablement();",
    "    this.lineup = { scene, camera, controls, roots, lightingManager, renderModeManager };\n    scene.updateMatrixWorld(true);\n    this.seekNormalized(progress);\n    // Every newly rebuilt Lineup needs a deterministic frame.\n    this.frameLineup();\n    this.updateControlEnablement();"
)

# Compare Metrics: all five columns fit inside one card without horizontal scroll.
p = Path('src/components/CompareInspectorPanel.tsx')
text = p.read_text(encoding='utf-8')
replacements = {
    "['Triangles',": "['Tris',",
    "['Vertices',": "['Verts',",
    "['Materials',": "['Mats',",
    "['Textures',": "['Tex',",
    "['Draw calls',": "['Draw',",
    "['Texture VRAM',": "['VRAM',",
    "['Lineup scale',": "['Scale',",
    '<div className="overflow-x-auto">': '<div className="overflow-hidden">',
    '<table className="min-w-[620px] w-full text-[9px] text-gray-300">': '<table className="w-full table-fixed text-[8px] text-gray-300">',
    '<th className="px-2 py-1.5 text-left font-medium">Metric</th>': '<th className="w-[30%] px-1.5 py-1.5 text-left font-medium">Metric</th>',
    "className={`max-w-32 px-2 py-1.5 text-right font-medium ${asset.id === active?.id ? 'text-cyan-300' : ''}`}": "className={`px-1 py-1.5 text-right font-medium ${asset.id === active?.id ? 'text-cyan-300' : ''}`}",
    '<th className="px-2 py-1.5 text-left font-normal text-gray-500">{label}</th>': '<th className="truncate px-1.5 py-1.5 text-left font-normal text-gray-500" title={label}>{label}</th>',
    "className={`px-2 py-1.5 text-right ${asset.id === active?.id ? 'text-cyan-200' : 'text-gray-200'}`}": "className={`px-1 py-1.5 text-right tabular-nums ${asset.id === active?.id ? 'text-cyan-200' : 'text-gray-200'}`}",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'CompareInspectorPanel.tsx: missing pattern {old!r}')
    text = text.replace(old, new)
p.write_text(text, encoding='utf-8')

# Health: one larger diagnostic card at a time with previous/next paging.
patch('src/components/InspectorPanel.tsx', "  ChevronRight,\n", "  ChevronLeft,\n  ChevronRight,\n")
patch(
    'src/components/InspectorPanel.tsx',
    "  const [locationIndexByIssue, setLocationIndexByIssue] = useState<Record<string, number>>({});\n",
    "  const [locationIndexByIssue, setLocationIndexByIssue] = useState<Record<string, number>>({});\n  const [issuePageIndex, setIssuePageIndex] = useState(0);\n"
)
patch(
    'src/components/InspectorPanel.tsx',
    "  const filteredIssues = technicalHealthIssues.filter((issue) => {\n    if (severityFilter !== 'ALL' && issue.severity !== severityFilter) return false;\n    return true;\n  });\n",
    "  const filteredIssues = technicalHealthIssues.filter((issue) => {\n    if (severityFilter !== 'ALL' && issue.severity !== severityFilter) return false;\n    return true;\n  });\n  const currentIssueIndex = filteredIssues.length > 0\n    ? Math.min(issuePageIndex, filteredIssues.length - 1)\n    : 0;\n  const currentIssue = filteredIssues[currentIssueIndex] ?? null;\n  const changeSeverityFilter = (next: HealthSeverity | 'ALL') => {\n    setSeverityFilter(next);\n    setIssuePageIndex(0);\n  };\n"
)
for severity in ['ERROR', 'WARNING', 'INFO', 'OK']:
    patch(
        'src/components/InspectorPanel.tsx',
        f"onClick={{() => setSeverityFilter(severityFilter === '{severity}' ? 'ALL' : '{severity}')}}",
        f"onClick={{() => changeSeverityFilter(severityFilter === '{severity}' ? 'ALL' : '{severity}')}}"
    )
patch(
    'src/components/InspectorPanel.tsx',
    "onClick={() => setSeverityFilter('ALL')}",
    "onClick={() => changeSeverityFilter('ALL')}"
)
patch(
    'src/components/InspectorPanel.tsx',
    "            {filteredIssues.map((issue) => (\n",
    """            {filteredIssues.length > 0 && (
              <div className=\"flex items-center justify-between rounded border border-[#303541] bg-[#191c22] px-2.5 py-2\">
                <button
                  onClick={() => setIssuePageIndex((currentIssueIndex - 1 + filteredIssues.length) % filteredIssues.length)}
                  className=\"rounded border border-[#39404c] bg-[#22262e] p-1.5 text-gray-300 hover:border-cyan-800 hover:text-cyan-200\"
                  title={t('inspector.previous')}
                >
                  <ChevronLeft className=\"h-4 w-4\" />
                </button>
                <div className=\"text-center\">
                  <div className=\"text-[11px] font-semibold text-gray-200\">Diagnostic card</div>
                  <div className=\"font-mono text-[10px] text-gray-500\">{currentIssueIndex + 1} / {filteredIssues.length}</div>
                </div>
                <button
                  onClick={() => setIssuePageIndex((currentIssueIndex + 1) % filteredIssues.length)}
                  className=\"rounded border border-[#39404c] bg-[#22262e] p-1.5 text-gray-300 hover:border-cyan-800 hover:text-cyan-200\"
                  title={t('inspector.nextIssue')}
                >
                  <ChevronRight className=\"h-4 w-4\" />
                </button>
              </div>
            )}

            {currentIssue && [currentIssue].map((issue) => (
"""
)
patch(
    'src/components/InspectorPanel.tsx',
    'className="bg-[#1c1e24] border border-[#2c3039] rounded p-2.5 flex flex-col space-y-1.5 hover:border-[#3d4250] transition"',
    'className="bg-[#1c1e24] border border-[#2c3039] rounded p-4 flex flex-col space-y-3 text-sm hover:border-[#3d4250] transition"'
)
patch(
    'src/components/InspectorPanel.tsx',
    '<h4 className="font-semibold text-gray-100 mt-0.5">{issue.title}</h4>',
    '<h4 className="mt-1 text-sm font-semibold leading-snug text-gray-100">{issue.title}</h4>'
)
patch(
    'src/components/InspectorPanel.tsx',
    '<p className="text-gray-300 text-[11px] leading-relaxed pl-6">',
    '<p className="pl-7 text-[13px] leading-relaxed text-gray-200">'
)
patch(
    'src/components/InspectorPanel.tsx',
    'className="ml-6 pt-1.5 border-t border-[#262932] space-y-1.5 text-[10px]"',
    'className="ml-7 space-y-2 border-t border-[#262932] pt-2 text-[11px]"'
)

# Empty startup: Test Patient stays in Examples, but no geometry auto-loads.
patch(
    'src/App.tsx',
    "  const [fileName, setFileName] = useState<string>('Explorer_Drone_MK4.glb');",
    "  const [fileName, setFileName] = useState<string>('');"
)
patch(
    'src/App.tsx',
    '  // Mount Viewport & Load Default Model\n',
    '  // Mount an empty viewport. Built-in specimens remain available from Examples.\n'
)
patch(
    'src/App.tsx',
    "        // Load the single deterministic Asset Doctor test patient.\n        const defaultSample = createAssetDoctorTestPatient();\n        loadAsset(\n          defaultSample.root,\n          defaultSample.animations,\n          'Asset_Doctor_Test_Patient.glb',\n          1024 * 180,\n          { kind: 'sample', sampleId: 'test-patient' }\n        );\n\n",
    ""
)
patch(
    'src/App.tsx',
    "    [loadAsset]\n  );\n\n  // Update selectedNode state when selectedUuid changes",
    "    []\n  );\n\n  // Update selectedNode state when selectedUuid changes"
)

print('one-shot polish applied')
