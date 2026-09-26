import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns3,
  Grid2X2,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scale,
  Table2,
  X,
} from 'lucide-react';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { analyzeGeometry } from '../analysis/GeometryAnalyzer';
import { analyzeTextures } from '../analysis/TextureAnalyzer';
import { CompareSceneManager } from '../viewer/CompareSceneManager';
import type {
  CompareAssetRecord,
  CompareScaleMode,
  CompareViewMode,
} from '../compare/CompareTypes';

interface CompareViewportProps {
  onClose: () => void;
}

const SLOT_NAMES = ['A', 'B', 'C', 'D', 'E'] as const;

function relabelAssets(assets: CompareAssetRecord[]): CompareAssetRecord[] {
  return assets.map((asset, index) => ({ ...asset, slot: SLOT_NAMES[index] }));
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, power)).toFixed(power >= 2 ? 1 : 0)} ${units[power]}`;
}

export const CompareViewport: React.FC<CompareViewportProps> = ({ onClose }) => {
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
  const [showMetrics, setShowMetrics] = useState(true);
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
    });
    managerRef.current = manager;

    return () => {
      manager.dispose();
      managerRef.current = null;
      loaderRef.current?.dispose();
      loaderRef.current = null;
    };
  }, []);

  useEffect(() => {
    managerRef.current?.setAssets(assets);
    if (assets.length > 0 && !activeAssetId) setActiveAssetId(assets[0].id);
    // selectedClipIndex changes do not rebuild scenes; clip changes use setClip().
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && soloAssetId) {
        setSoloAssetId(null);
        managerRef.current?.setSoloAssetId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [soloAssetId]);

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

    // Load sequentially on purpose. Five large GLBs should not decode in parallel
    // and create an avoidable peak in CPU and memory pressure.
    for (const file of queue) {
      try {
        const result = await loader.loadFromFile(file);
        const summary = analyzeGeometry(
          result.root,
          result.fileName,
          result.fileSizeBytes
        );
        const textures = analyzeTextures(result.root);
        loaded.push({
          id: crypto.randomUUID(),
          slot: 'A',
          fileName: result.fileName,
          fileSizeBytes: result.fileSizeBytes,
          root: result.root,
          animations: result.animations,
          summary,
          textureVramBytes: textures.reduce(
            (total, texture) => total + texture.uncompressedBytesEstimate,
            0
          ),
          drawCalls: summary.primitiveCount || summary.meshCount,
          selectedClipIndex: 0,
        });
      } catch (error) {
        setLoadError(
          `${file.name}: ${error instanceof Error ? error.message : String(error)}`
        );
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
      className="absolute inset-0 z-50 bg-[#111318] text-gray-100"
      onDragOver={(event) => {
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

      {/* Compare command bar */}
      <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-1.5 rounded-md border border-[#323743] bg-[#171a20]/95 p-1.5 shadow-xl backdrop-blur-sm">
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded border border-[#3a404c] bg-[#22262e] px-2 py-1 text-[10px] text-gray-300 hover:text-white"
          title="Return to Asset Doctor"
        >
          <X className="h-3.5 w-3.5" /> Doctor
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={assets.length >= 5 || loading}
          className="flex items-center gap-1 rounded border border-cyan-900 bg-cyan-950/30 px-2 py-1 text-[10px] text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add model {assets.length}/5
        </button>

        <div className="h-5 w-px bg-[#343946]" />

        <button
          onClick={() => setViewMode('grid')}
          className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
            viewMode === 'grid' ? 'bg-cyan-950/50 text-cyan-300' : 'text-gray-400 hover:bg-[#252932]'
          }`}
        >
          <Grid2X2 className="h-3.5 w-3.5" /> Grid
        </button>
        <button
          onClick={() => setViewMode('lineup')}
          className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
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
          <button
            onClick={() => setScaleMode((mode) => mode === 'real' ? 'normalize-height' : 'real')}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] ${
              scaleMode === 'normalize-height'
                ? 'border-violet-700 bg-violet-950/40 text-violet-300'
                : 'border-[#3a404c] bg-[#22262e] text-gray-300'
            }`}
          >
            <Scale className="h-3.5 w-3.5" />
            {scaleMode === 'normalize-height' ? 'Normalize Height' : 'Real Scale'}
          </button>
        )}

        <button
          onClick={() => managerRef.current?.resetCameras()}
          className="rounded p-1 text-gray-400 hover:bg-[#252932] hover:text-white"
          title="Reset compare cameras"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => setShowMetrics((value) => !value)}
          className={`ml-auto flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
            showMetrics ? 'bg-[#2a2f39] text-gray-100' : 'text-gray-400 hover:bg-[#252932]'
          }`}
        >
          <Table2 className="h-3.5 w-3.5" /> Metrics
        </button>
      </div>

      {/* Asset strip and per-asset animation clip selection */}
      <div className="absolute left-3 right-3 top-[54px] z-20 flex gap-1.5 overflow-x-auto pb-1">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => {
              setActiveAssetId(asset.id);
              managerRef.current?.setActiveAssetId(asset.id);
            }}
            className={`group flex min-w-0 max-w-56 items-center gap-1.5 rounded border px-2 py-1 text-left text-[10px] shadow ${
              activeAsset?.id === asset.id
                ? 'border-cyan-700 bg-cyan-950/50 text-cyan-100'
                : 'border-[#343946] bg-[#181b21]/90 text-gray-300'
            }`}
          >
            <span className="rounded bg-[#2a3039] px-1 font-mono text-cyan-300">{asset.slot}</span>
            <span className="min-w-0 flex-1 truncate">{asset.fileName}</span>
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
        <div className="absolute right-3 top-[88px] z-20 flex items-center gap-1 rounded border border-violet-700 bg-violet-950/70 px-2 py-1 text-[10px] text-violet-200">
          <Maximize2 className="h-3.5 w-3.5" /> Solo View · double-click or Esc to return
        </div>
      )}

      {assets.length === 0 && !loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="max-w-md rounded-lg border border-dashed border-[#46505e] bg-[#171a20]/90 px-8 py-7 text-center shadow-2xl backdrop-blur-sm">
            <Grid2X2 className="mx-auto mb-3 h-9 w-9 text-cyan-400" />
            <div className="text-sm font-semibold text-gray-100">Multi-Asset Compare</div>
            <div className="mt-1 text-[11px] leading-relaxed text-gray-400">
              Add or drop 2–5 GLB/GLTF models. Compare mode is view-only: Health and Heal stay in Asset Doctor.
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

      {showMetrics && assets.length > 0 && (
        <div className="absolute bottom-3 right-3 z-20 max-h-[42%] max-w-[72%] overflow-auto rounded-md border border-[#343946] bg-[#171a20]/95 shadow-xl backdrop-blur-sm">
          <table className="min-w-[620px] text-[9px] text-gray-300">
            <thead className="sticky top-0 bg-[#1d2027] text-gray-400">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Metric</th>
                {assets.map((asset) => (
                  <th key={asset.id} className="max-w-32 truncate px-2 py-1 text-right font-medium">
                    {asset.slot} · {asset.fileName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {[
                ['Triangles', (asset: CompareAssetRecord) => asset.summary.triangleCount.toLocaleString()],
                ['Vertices', (asset: CompareAssetRecord) => asset.summary.vertexCount.toLocaleString()],
                ['Meshes', (asset: CompareAssetRecord) => asset.summary.meshCount.toLocaleString()],
                ['Materials', (asset: CompareAssetRecord) => asset.summary.materialCount.toLocaleString()],
                ['Textures', (asset: CompareAssetRecord) => asset.summary.textureCount.toLocaleString()],
                ['Bones', (asset: CompareAssetRecord) => asset.summary.boneCount.toLocaleString()],
                ['Clips', (asset: CompareAssetRecord) => asset.animations.length.toLocaleString()],
                ['Draw calls', (asset: CompareAssetRecord) => asset.drawCalls.toLocaleString()],
                ['Texture VRAM', (asset: CompareAssetRecord) => formatBytes(asset.textureVramBytes)],
                ['Height', (asset: CompareAssetRecord) => `${asset.summary.boundingBox.size[1].toFixed(3)} m`],
              ].map(([label, formatter]) => (
                <tr key={String(label)} className="border-t border-[#2a2e37]">
                  <th className="px-2 py-1 text-left font-normal text-gray-500">{String(label)}</th>
                  {assets.map((asset) => (
                    <td key={asset.id} className="px-2 py-1 text-right text-gray-200">
                      {(formatter as (asset: CompareAssetRecord) => string)(asset)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 text-[9px] text-gray-500">
        Click a cell to control it · Double-click for Solo · cameras use normalized framing
      </div>
    </div>
  );
};
