import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns3,
  Grid2X2,
  Loader2,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scale,
  Stethoscope,
  X,
} from 'lucide-react';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { analyzeGeometry } from '../analysis/GeometryAnalyzer';
import { analyzeTextures } from '../analysis/TextureAnalyzer';
import { CompareSceneManager } from '../viewer/CompareSceneManager';
import type { LightingPreset, RenderMode } from '../types';
import type {
  CompareAssetRecord,
  CompareScaleMode,
  CompareSessionSnapshot,
  CompareViewMode,
} from '../compare/CompareTypes';

interface CompareViewportProps {
  open: boolean;
  onClose: () => void;
  onOpenInDoctor: (asset: CompareAssetRecord) => void;
  onSnapshotChange: (snapshot: CompareSessionSnapshot) => void;
  renderMode: RenderMode;
  lightingPreset: LightingPreset;
}

const SLOT_NAMES = ['A', 'B', 'C', 'D', 'E'] as const;

function relabelAssets(assets: CompareAssetRecord[]): CompareAssetRecord[] {
  return assets.map((asset, index) => ({ ...asset, slot: SLOT_NAMES[index] }));
}

export const CompareViewport: React.FC<CompareViewportProps> = ({
  open,
  onClose,
  onOpenInDoctor,
  onSnapshotChange,
  renderMode,
  lightingPreset,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loaderRef = useRef<GLBLoaderService | null>(null);
  const managerRef = useRef<CompareSceneManager | null>(null);

  const [assets, setAssets] = useState<CompareAssetRecord[]>([]);
  const [viewMode, setViewMode] = useState<CompareViewMode>('grid');
  const [scaleMode, setScaleMode] = useState<CompareScaleMode>('real');
  const [syncCameras, setSyncCameras] = useState(true);
  const [syncAnimations, setSyncAnimations] = useState(true);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [soloAssetId, setSoloAssetId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const assetIdentity = useMemo(() => assets.map((asset) => asset.id).join('|'), [assets]);

  useEffect(() => {
    loaderRef.current = new GLBLoaderService();
    if (!hostRef.current) return;

    const manager = new CompareSceneManager(hostRef.current, {
      onActiveAssetChange: (assetId) => setActiveAssetId(assetId || null),
      onSoloRequest: setSoloAssetId,
      onAnimationProgress: setAnimationProgress,
      onManualScaleChange: (assetId, manualScale) => {
        setAssets((previous) => previous.map((asset) =>
          asset.id === assetId ? { ...asset, manualScale } : asset
        ));
      },
    });
    managerRef.current = manager;
    manager.setActive(open);
    manager.setRenderMode(renderMode);
    manager.setLightingPreset(lightingPreset);

    return () => {
      manager.dispose();
      managerRef.current = null;
      loaderRef.current?.dispose();
      loaderRef.current = null;
    };
    // Compare manager owns a persistent session for the lifetime of the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { managerRef.current?.setActive(open); }, [open]);

  useEffect(() => {
    managerRef.current?.setAssets(assets);
    if (assets.length > 0 && !activeAssetId) setActiveAssetId(assets[0].id);
    // Clip and manual scale changes are applied directly and must not rebuild scenes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetIdentity]);

  useEffect(() => { managerRef.current?.setViewMode(viewMode); }, [viewMode]);
  useEffect(() => { managerRef.current?.setScaleMode(scaleMode); }, [scaleMode]);
  useEffect(() => { managerRef.current?.setSyncCameras(syncCameras); }, [syncCameras]);
  useEffect(() => { managerRef.current?.setSyncAnimations(syncAnimations); }, [syncAnimations]);
  useEffect(() => { managerRef.current?.setSoloAssetId(soloAssetId); }, [soloAssetId]);
  useEffect(() => { managerRef.current?.setPlaying(playing); }, [playing]);
  useEffect(() => { managerRef.current?.setLooping(looping); }, [looping]);
  useEffect(() => { managerRef.current?.setAnimationSpeed(speed); }, [speed]);
  useEffect(() => { managerRef.current?.setRenderMode(renderMode); }, [renderMode]);
  useEffect(() => { managerRef.current?.setLightingPreset(lightingPreset); }, [lightingPreset]);

  useEffect(() => {
    onSnapshotChange({
      assets: assets.map((asset) => ({
        id: asset.id,
        slot: asset.slot,
        fileName: asset.fileName,
        fileSizeBytes: asset.fileSizeBytes,
        triangleCount: asset.summary.triangleCount,
        vertexCount: asset.summary.vertexCount,
        meshCount: asset.summary.meshCount,
        materialCount: asset.summary.materialCount,
        textureCount: asset.summary.textureCount,
        boneCount: asset.summary.boneCount,
        animationCount: asset.animations.length,
        drawCalls: asset.drawCalls,
        textureVramBytes: asset.textureVramBytes,
        height: asset.summary.boundingBox.size[1],
        manualScale: asset.manualScale,
      })),
      activeAssetId,
      viewMode,
      scaleMode,
      syncCameras,
      syncAnimations,
      renderMode,
      lightingPreset,
    });
  }, [
    assets,
    activeAssetId,
    viewMode,
    scaleMode,
    syncCameras,
    syncAnimations,
    renderMode,
    lightingPreset,
    onSnapshotChange,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === 'Escape' && soloAssetId) {
        setSoloAssetId(null);
        managerRef.current?.setSoloAssetId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, soloAssetId]);

  const addFiles = async (files: File[]) => {
    const loader = loaderRef.current;
    if (!loader || files.length === 0) return;

    const accepted = files.filter((file) => /\.(glb|gltf)$/i.test(file.name));
    const available = Math.max(0, 5 - assets.length);
    const queue = accepted.slice(0, available);
    if (queue.length === 0) {
      if (available === 0) setLoadError('Compare is limited to five assets.');
      return;
    }

    setLoading(true);
    setLoadError(null);
    const loaded: CompareAssetRecord[] = [];

    // Intentionally sequential: five production GLBs must not create a decode
    // and memory spike merely because they were dropped together.
    for (const file of queue) {
      try {
        const result = await loader.loadFromFile(file);
        const summary = analyzeGeometry(result.root, result.fileName, result.fileSizeBytes);
        const textures = analyzeTextures(result.root);
        loaded.push({
          id: crypto.randomUUID(),
          slot: 'A',
          fileName: result.fileName,
          fileSizeBytes: result.fileSizeBytes,
          sourceBuffer: result.sourceBuffer,
          root: result.root,
          animations: result.animations,
          summary,
          textureVramBytes: textures.reduce(
            (total, texture) => total + texture.uncompressedBytesEstimate,
            0
          ),
          drawCalls: summary.primitiveCount || summary.meshCount,
          selectedClipIndex: 0,
          manualScale: 1,
        });
      } catch (error) {
        setLoadError(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (loaded.length > 0) {
      setAssets((previous) => {
        const next = relabelAssets([...previous, ...loaded].slice(0, 5));
        if (!activeAssetId) setActiveAssetId(next[0]?.id ?? null);
        return next;
      });
    }
    setLoading(false);
  };

  const removeAsset = (assetId: string) => {
    setAssets((previous) => relabelAssets(previous.filter((asset) => asset.id !== assetId)));
    if (activeAssetId === assetId) setActiveAssetId(null);
    if (soloAssetId === assetId) setSoloAssetId(null);
  };

  const setClip = (assetId: string, clipIndex: number) => {
    setAssets((previous) => previous.map((asset) =>
      asset.id === assetId ? { ...asset, selectedClipIndex: clipIndex } : asset
    ));
    managerRef.current?.setClip(assetId, clipIndex);
  };

  const adjustActiveScale = (delta: number) => {
    const active = assets.find((asset) => asset.id === activeAssetId) ?? assets[0];
    if (!active) return;
    managerRef.current?.setManualScale(active.id, active.manualScale + delta, false);
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    void addFiles(Array.from(fileList));
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    handleFiles(event.dataTransfer.files);
  };

  const activeAsset = assets.find((asset) => asset.id === activeAssetId) ?? assets[0] ?? null;
  const anyAnimations = assets.some((asset) => asset.animations.length > 0);

  return (
    <div
      className={`absolute inset-0 z-50 bg-[#111318] text-gray-100 transition-opacity duration-150 ${
        open ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
      }`}
      onDragOver={(event) => {
        if (!open) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".glb,.gltf"
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div ref={hostRef} className="absolute inset-0" />

      {/* Compare command bar. Doctor is deliberately large because it is the
          primary mode switch and opens the selected compare source for analysis. */}
      <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-1.5 rounded-md border border-[#323743] bg-[#171a20]/95 p-1.5 shadow-xl backdrop-blur-sm">
        <button
          onClick={() => activeAsset ? onOpenInDoctor(activeAsset) : onClose()}
          className="flex items-center gap-2 rounded border border-cyan-800 bg-cyan-950/40 px-3.5 py-2 text-[11px] font-semibold text-cyan-100 shadow hover:border-cyan-600 hover:bg-cyan-950/60"
          title={activeAsset ? `Open ${activeAsset.slot} in Asset Doctor` : 'Return to Asset Doctor'}
        >
          <Stethoscope className="h-4 w-4 text-cyan-300" />
          Doctor{activeAsset ? ` · ${activeAsset.slot}` : ''}
        </button>

        {activeAsset && (
          <button
            onClick={onClose}
            className="rounded border border-[#3a404c] bg-[#22262e] p-2 text-gray-400 hover:text-white"
            title="Return to the current Doctor asset without replacing it"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={assets.length >= 5 || loading}
          className="flex items-center gap-1 rounded border border-cyan-900 bg-cyan-950/30 px-2 py-1.5 text-[10px] text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add model {assets.length}/5
        </button>

        <div className="h-5 w-px bg-[#343946]" />

        <button
          onClick={() => setViewMode('grid')}
          className={`flex items-center gap-1 rounded px-2 py-1.5 text-[10px] ${
            viewMode === 'grid' ? 'bg-cyan-950/50 text-cyan-300' : 'text-gray-400 hover:bg-[#252932]'
          }`}
        >
          <Grid2X2 className="h-3.5 w-3.5" /> Grid
        </button>
        <button
          onClick={() => setViewMode('lineup')}
          className={`flex items-center gap-1 rounded px-2 py-1.5 text-[10px] ${
            viewMode === 'lineup' ? 'bg-cyan-950/50 text-cyan-300' : 'text-gray-400 hover:bg-[#252932]'
          }`}
        >
          <Columns3 className="h-3.5 w-3.5" /> Lineup
        </button>

        {viewMode === 'grid' && (
          <label className="flex cursor-pointer items-center gap-1 px-1.5 text-[10px] text-gray-300">
            <input
              type="checkbox"
              checked={syncCameras}
              onChange={(event) => setSyncCameras(event.target.checked)}
              className="accent-cyan-400"
            />
            Sync Cameras
          </label>
        )}

        {viewMode === 'lineup' && (
          <>
            <button
              onClick={() => setScaleMode((mode) => mode === 'real' ? 'normalize-height' : 'real')}
              className={`flex items-center gap-1 rounded border px-2 py-1.5 text-[10px] ${
                scaleMode === 'normalize-height'
                  ? 'border-violet-700 bg-violet-950/40 text-violet-300'
                  : 'border-[#3a404c] bg-[#22262e] text-gray-300'
              }`}
            >
              <Scale className="h-3.5 w-3.5" />
              {scaleMode === 'normalize-height' ? 'Normalize Height' : 'Real Scale'}
            </button>

            {activeAsset && (
              <div className="flex items-center rounded border border-[#3a404c] bg-[#20232a] text-[10px] text-gray-300">
                <button
                  onClick={() => adjustActiveScale(-0.05)}
                  className="p-1.5 hover:bg-[#2b3039] hover:text-white"
                  title="Reduce selected model presentation size"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <button
                  onClick={() => managerRef.current?.setManualScale(activeAsset.id, 1, false)}
                  className="min-w-14 border-x border-[#343946] px-2 py-1.5 font-mono text-violet-300 hover:bg-[#2b3039]"
                  title="Reset selected model manual size"
                >
                  {activeAsset.manualScale.toFixed(2)}×
                </button>
                <button
                  onClick={() => adjustActiveScale(0.05)}
                  className="p-1.5 hover:bg-[#2b3039] hover:text-white"
                  title="Increase selected model presentation size"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            )}
          </>
        )}

        <button
          onClick={() => managerRef.current?.resetCameras()}
          className="rounded p-1.5 text-gray-400 hover:bg-[#252932] hover:text-white"
          title="Reset compare cameras"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Asset strip and per-asset animation clip selection */}
      <div className="absolute left-3 right-3 top-[62px] z-20 flex gap-1.5 overflow-x-auto pb-1">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => {
              setActiveAssetId(asset.id);
              managerRef.current?.setActiveAssetId(asset.id);
            }}
            className={`group flex min-w-0 max-w-64 items-center gap-1.5 rounded border px-2 py-1 text-left text-[10px] shadow ${
              activeAsset?.id === asset.id
                ? 'border-cyan-600 bg-cyan-950/55 text-cyan-100 ring-1 ring-cyan-700/40'
                : 'border-[#343946] bg-[#181b21]/90 text-gray-300'
            }`}
          >
            <span className="rounded bg-[#2a3039] px-1 font-mono text-cyan-300">{asset.slot}</span>
            <span className="min-w-0 flex-1 truncate">{asset.fileName}</span>
            {viewMode === 'lineup' && asset.manualScale !== 1 && (
              <span className="font-mono text-[9px] text-violet-300">{asset.manualScale.toFixed(2)}×</span>
            )}
            {asset.animations.length > 0 && (
              <select
                value={asset.selectedClipIndex}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setClip(asset.id, Number(event.target.value))}
                className="max-w-24 rounded border border-[#3a404c] bg-[#1d2027] px-1 text-[9px] text-gray-300"
                title="Animation clip"
              >
                {asset.animations.map((clip, index) => (
                  <option key={`${clip.name}-${index}`} value={index}>{clip.name || `Clip ${index + 1}`}</option>
                ))}
              </select>
            )}
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                removeAsset(asset.id);
              }}
              className="rounded p-0.5 text-gray-500 hover:bg-rose-950/50 hover:text-rose-300"
              title="Remove from comparison"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ))}
      </div>

      {/* Animation comparison transport */}
      {anyAnimations && assets.length > 0 && (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[#343946] bg-[#171a20]/95 px-2.5 py-1.5 shadow-xl backdrop-blur-sm">
          <button
            onClick={() => setPlaying((value) => !value)}
            className="rounded p-1 text-cyan-300 hover:bg-[#252932]"
            title={playing ? 'Pause comparison animations' : 'Play comparison animations'}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={animationProgress}
            onInput={(event) => {
              const next = Number((event.target as HTMLInputElement).value);
              setAnimationProgress(next);
              managerRef.current?.seekNormalized(next);
            }}
            className="w-40 accent-cyan-400"
            title="Normalized animation time"
          />
          <label className="flex cursor-pointer items-center gap-1 text-[9px] text-gray-300">
            <input
              type="checkbox"
              checked={syncAnimations}
              onChange={(event) => setSyncAnimations(event.target.checked)}
              className="accent-cyan-400"
            />
            Sync Time
          </label>
          <label className="flex cursor-pointer items-center gap-1 text-[9px] text-gray-300">
            <input
              type="checkbox"
              checked={looping}
              onChange={(event) => setLooping(event.target.checked)}
              className="accent-cyan-400"
            />
            Loop
          </label>
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="rounded border border-[#3a404c] bg-[#1d2027] px-1 text-[9px] text-gray-300"
          >
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </div>
      )}

      {soloAssetId && (
        <div className="absolute right-3 top-[98px] z-20 flex items-center gap-1 rounded border border-violet-700 bg-violet-950/70 px-2 py-1 text-[10px] text-violet-200">
          <Maximize2 className="h-3.5 w-3.5" /> Solo View · double-click or Esc to return
        </div>
      )}

      {assets.length === 0 && !loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="max-w-md rounded-lg border border-dashed border-[#46505e] bg-[#171a20]/90 px-8 py-7 text-center shadow-2xl backdrop-blur-sm">
            <Grid2X2 className="mx-auto mb-3 h-9 w-9 text-cyan-400" />
            <div className="text-sm font-semibold text-gray-100">Multi-Asset Compare</div>
            <div className="mt-1 text-[11px] leading-relaxed text-gray-400">
              Add or drop 2–5 GLB/GLTF models. The session stays in memory when you return to Doctor.
            </div>
            <div className="mt-3 text-[10px] text-gray-500">Grid layouts: 2 · 2+1 · 2+2 · 3+2</div>
          </div>
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-cyan-400 bg-cyan-950/35 text-sm font-semibold text-cyan-200 backdrop-blur-sm">
          Drop models into Compare · {Math.max(0, 5 - assets.length)} slot(s) free
        </div>
      )}

      {loadError && (
        <div className="absolute bottom-3 left-3 z-30 max-w-lg rounded border border-rose-800 bg-rose-950/80 px-2.5 py-1.5 text-[10px] text-rose-200 shadow-xl">
          {loadError}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 text-[9px] text-gray-500">
        {viewMode === 'lineup'
          ? 'Click model to select · Alt + wheel over model = manual size · top toolbar controls lighting/render mode'
          : 'Click a cell to select · Double-click for Solo · cameras use normalized framing'}
      </div>
    </div>
  );
};
