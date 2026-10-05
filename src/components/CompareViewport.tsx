import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Grid2X2,
  Layers,
  Loader2,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Scale,
  Stethoscope,
  Sun,
  X,
} from 'lucide-react';
import { GLBLoaderService } from '../loaders/GLBLoaderService';
import { analyzeGeometry } from '../analysis/GeometryAnalyzer';
import { analyzeTextures } from '../analysis/TextureAnalyzer';
import { CompareSceneManager } from '../viewer/CompareSceneManager';
import { CompareInspectorPanel } from './CompareInspectorPanel';
import { CompareSceneTreePanel } from './CompareSceneTreePanel';
import type { LightingPreset, RenderMode, SurfaceType } from '../types';
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
  renderMode: RenderMode;
  surface?: SurfaceType;
  onSetSurface?: (surface: SurfaceType) => void;
  isTreeCollapsed?: boolean;
  onToggleTreeCollapse?: () => void;
}

const SLOT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

function relabelAssets(assets: CompareAssetRecord[]): CompareAssetRecord[] {
  return assets.map((asset, index) => ({
    ...asset,
    slot: SLOT_NAMES[index] || `S${index + 1}`,
  }));
}

export const CompareViewport: React.FC<CompareViewportProps> = ({
  open,
  onClose,
  onOpenInDoctor,
  renderMode,
  surface = 'grid',
  onSetSurface,
  isTreeCollapsed: propIsTreeCollapsed,
  onToggleTreeCollapse,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loaderRef = useRef<GLBLoaderService | null>(null);
  const managerRef = useRef<CompareSceneManager | null>(null);

  const [assets, setAssets] = useState<CompareAssetRecord[]>([]);
  const [viewMode, setViewMode] = useState<CompareViewMode>('grid');
  const [scaleMode, setScaleMode] = useState<CompareScaleMode>('real');
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('neutral-studio');
  const [currentSurface, setCurrentSurface] = useState<SurfaceType>(surface);
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

  // Lineup controls
  const [modelRotation, setModelRotation] = useState(0);
  const [isAutoRotating, setIsAutoRotating] = useState(false);

  // Tree panel collapse state
  const [internalTreeCollapsed, setInternalTreeCollapsed] = useState(false);
  const isTreeCollapsed = propIsTreeCollapsed !== undefined ? propIsTreeCollapsed : internalTreeCollapsed;

  const handleToggleTreeCollapse = () => {
    if (onToggleTreeCollapse) {
      onToggleTreeCollapse();
    } else {
      setInternalTreeCollapsed((prev) => !prev);
    }
    requestAnimationFrame(() => managerRef.current?.resize());
  };

  const assetIdentity = useMemo(() => assets.map((asset) => asset.id).join('|'), [assets]);

  const snapshot = useMemo<CompareSessionSnapshot>(() => ({
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
    surface: currentSurface,
  }), [
    assets,
    activeAssetId,
    viewMode,
    scaleMode,
    syncCameras,
    syncAnimations,
    renderMode,
    lightingPreset,
    currentSurface,
  ]);

  useEffect(() => {
    loaderRef.current = new GLBLoaderService();
    if (!hostRef.current) return;

    const manager = new CompareSceneManager(hostRef.current, {
      onActiveAssetChange: (assetId) => setActiveAssetId(assetId || null),
      onSoloRequest: setSoloAssetId,
      onAnimationProgress: setAnimationProgress,
      onModelRotationChange: (rot) => setModelRotation(rot),
      onManualScaleChange: (assetId, manualScale) => {
        setAssets((previous) => previous.map((asset) =>
          asset.id === assetId ? { ...asset, manualScale } : asset
        ));
      },
    });
    managerRef.current = manager;
    loaderRef.current.configureRenderer(manager.renderer);
    manager.setActive(open);
    manager.setRenderMode(renderMode);
    manager.setLightingPreset(lightingPreset);
    manager.setSurface(currentSurface);

    return () => {
      manager.dispose();
      managerRef.current = null;
      loaderRef.current?.dispose();
      loaderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { managerRef.current?.setActive(open); }, [open]);

  useEffect(() => {
    managerRef.current?.setAssets(assets);
    if (assets.length > 0 && !activeAssetId) setActiveAssetId(assets[0].id);
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
    if (surface && surface !== currentSurface) {
      setCurrentSurface(surface);
      managerRef.current?.setSurface(surface);
    }
  }, [surface, currentSurface]);

  useEffect(() => {
    managerRef.current?.resize();
    const t = setTimeout(() => managerRef.current?.resize(), 220);
    return () => clearTimeout(t);
  }, [isTreeCollapsed, open]);

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

  // Prevent default window drag/drop so dropping files does not trigger browser navigation
  useEffect(() => {
    if (!open) return;
    const preventDrag = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventDrag);
    window.addEventListener('drop', preventDrag);
    return () => {
      window.removeEventListener('dragover', preventDrag);
      window.removeEventListener('drop', preventDrag);
    };
  }, [open]);

  const addFiles = async (files: File[]) => {
    const loader = loaderRef.current;
    if (!loader || files.length === 0) return;

    const accepted = files.filter((file) => /\.(glb|gltf)$/i.test(file.name));
    const available = Math.max(0, 8 - assets.length);
    const queue = accepted.slice(0, available);
    if (queue.length === 0) {
      if (available === 0) setLoadError('В мульти-обзоре поддерживается максимум 8 моделей.');
      return;
    }

    setLoading(true);
    setLoadError(null);
    const loaded: CompareAssetRecord[] = [];

    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      // Yield to the browser between files to allow UI rendering and event loop handling
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      try {
        const result = await loader.loadFromFile(file);
        const summary = analyzeGeometry(result.root, result.fileName, result.fileSizeBytes);
        const textures = analyzeTextures(result.root);
        const id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `asset_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        loaded.push({
          id,
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
        const next = relabelAssets([...previous, ...loaded].slice(0, 8));
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

  const moveAsset = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= assets.length) return;
    setAssets((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return relabelAssets(next);
    });
  };

  const reorderAssets = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= assets.length ||
      toIndex >= assets.length
    ) {
      return;
    }
    setAssets((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return relabelAssets(next);
    });
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
      className={`fixed left-0 right-0 top-12 bottom-0 z-[60] flex overflow-hidden bg-[#111318] text-gray-100 transition-opacity duration-150 ${
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

      {/* Left: Collapsible Scene Tree Panel for Compare Mode */}
      <CompareSceneTreePanel
        assetId={activeAsset?.id ?? null}
        root={activeAsset?.root ?? null}
        fileName={activeAsset?.fileName}
        slot={activeAsset?.slot}
        isCollapsed={isTreeCollapsed}
        onToggleCollapse={handleToggleTreeCollapse}
      />

      {/* Center: 3D Canvas Host and Compare HUD Overlays */}
      <div className="relative flex-1 h-full overflow-hidden">
        <div ref={hostRef} className="absolute inset-0" />

        {/* Compare Command Bar */}
        <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-1.5 rounded-md border border-[#323743] bg-[#171a20]/95 p-1.5 shadow-xl backdrop-blur-sm">
          <button
            onClick={() => activeAsset ? onOpenInDoctor(activeAsset) : onClose()}
            className="flex items-center gap-2 rounded border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 shadow hover:border-cyan-600 hover:bg-cyan-950/60"
            title={activeAsset ? `Open ${activeAsset.slot} in Asset Doctor` : 'Return to Asset Doctor'}
          >
            <Stethoscope className="h-4 w-4 text-cyan-300" />
            Doctor{activeAsset ? ` · ${activeAsset.slot}` : ''}
          </button>

          {activeAsset && (
            <button
              onClick={onClose}
              className="rounded border border-[#3a404c] bg-[#22262e] p-1.5 text-gray-400 hover:text-white"
              title="Return to the current Doctor asset without replacing it"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Tree Toggle Button */}
          <button
            onClick={handleToggleTreeCollapse}
            className={`flex items-center gap-1 rounded px-2 py-1.5 text-[10px] ${
              !isTreeCollapsed
                ? 'bg-cyan-950/50 text-cyan-300 border border-cyan-900/60'
                : 'border border-[#343946] bg-[#20232a] text-gray-400 hover:bg-[#282d36] hover:text-gray-200'
            }`}
            title={isTreeCollapsed ? 'Развернуть дерево сцены' : 'Свернуть дерево сцены'}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Дерево</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={assets.length >= 8 || loading}
            className="flex items-center gap-1 rounded border border-cyan-900 bg-cyan-950/30 px-2 py-1.5 text-[10px] text-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Добавить {assets.length}/8
          </button>

          <div className="h-5 w-px bg-[#343946]" />

          <button
            onClick={() => setViewMode('grid')}
            className={`flex items-center gap-1 rounded px-2 py-1.5 text-[10px] ${
              viewMode === 'grid' ? 'bg-cyan-950/50 text-cyan-300 border border-cyan-900/60' : 'text-gray-400 hover:bg-[#252932]'
            }`}
          >
            <Grid2X2 className="h-3.5 w-3.5" /> Сетка
          </button>
          <button
            onClick={() => setViewMode('lineup')}
            className={`flex items-center gap-1 rounded px-2 py-1.5 text-[10px] ${
              viewMode === 'lineup' ? 'bg-cyan-950/50 text-cyan-300 border border-cyan-900/60' : 'text-gray-400 hover:bg-[#252932]'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5" /> В линейку
          </button>

          {viewMode === 'grid' && (
            <label className="flex cursor-pointer items-center gap-1 px-1.5 text-[10px] text-gray-300">
              <input
                type="checkbox"
                checked={syncCameras}
                onChange={(event) => setSyncCameras(event.target.checked)}
                className="accent-cyan-400"
              />
              Синхр. камер
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
                {scaleMode === 'normalize-height' ? 'Норм. высота' : 'Реал. масштаб'}
              </button>

              {activeAsset && (
                <div className="flex items-center rounded border border-[#3a404c] bg-[#20232a] text-[10px] text-gray-300">
                  <button
                    onClick={() => adjustActiveScale(-0.05)}
                    className="p-1.5 hover:bg-[#2b3039] hover:text-white"
                    title="Уменьшить масштаб выбранной модели"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => managerRef.current?.setManualScale(activeAsset.id, 1, false)}
                    className="min-w-14 border-x border-[#343946] px-2 py-1.5 font-mono text-violet-300 hover:bg-[#2b3039]"
                    title="Сбросить ручной масштаб"
                  >
                    {activeAsset.manualScale.toFixed(2)}×
                  </button>
                  <button
                    onClick={() => adjustActiveScale(0.05)}
                    className="p-1.5 hover:bg-[#2b3039] hover:text-white"
                    title="Увеличить масштаб выбранной модели"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Turntable / Rotation Controls in Lineup Mode */}
              <div className="flex items-center gap-1 rounded border border-[#3a404c] bg-[#20232a] px-1.5 py-1 text-[10px]">
                <button
                  onClick={() => {
                    const next = !isAutoRotating;
                    setIsAutoRotating(next);
                    managerRef.current?.setAutoRotate(next);
                  }}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
                    isAutoRotating ? 'bg-cyan-900/60 text-cyan-200' : 'text-gray-400 hover:text-white'
                  }`}
                  title="Автоповорот вокруг оси (Turntable)"
                >
                  <RotateCw className={`h-3 w-3 ${isAutoRotating ? 'animate-spin' : ''}`} />
                  Вращение
                </button>
                <button
                  onClick={() => {
                    const next = (modelRotation - 45 + 360) % 360;
                    setModelRotation(next);
                    managerRef.current?.setModelRotation(next);
                  }}
                  className="px-1 text-gray-400 hover:text-white cursor-pointer font-bold"
                  title="Повернуть на -45°"
                >
                  ↺
                </button>
                <span className="font-mono text-[9px] text-gray-300 min-w-7 text-center">{modelRotation}°</span>
                <button
                  onClick={() => {
                    const next = (modelRotation + 45) % 360;
                    setModelRotation(next);
                    managerRef.current?.setModelRotation(next);
                  }}
                  className="px-1 text-gray-400 hover:text-white cursor-pointer font-bold"
                  title="Повернуть на +45°"
                >
                  ↻
                </button>
              </div>
            </>
          )}

          {/* Floor Surface Selector */}
          <div className="ml-auto flex items-center gap-1 rounded border border-[#3a404c] bg-[#20232a] px-1.5 py-1 text-[10px]">
            <Box className="h-3.5 w-3.5 text-cyan-400" />
            <select
              value={currentSurface}
              onChange={(event) => {
                const next = event.target.value as SurfaceType;
                setCurrentSurface(next);
                managerRef.current?.setSurface(next);
                onSetSurface?.(next);
              }}
              className="bg-transparent text-gray-300 outline-none cursor-pointer"
              title="Выбор поверхности пола"
            >
              <option value="grid" className="bg-[#1e2127]">Сетка</option>
              <option value="tile" className="bg-[#1e2127]">✨ Плитка (глянец)</option>
              <option value="cobblestone" className="bg-[#1e2127]">🏛️ Брусчатка</option>
              <option value="factory" className="bg-[#1e2127]">🏭 Завод / Цех</option>
              <option value="moon" className="bg-[#1e2127]">🌑 Лунная поверхность</option>
              <option value="countryside" className="bg-[#1e2127]">🌾 Сельская местность</option>
              <option value="grass" className="bg-[#1e2127]">🌱 Газон</option>
              <option value="wood" className="bg-[#1e2127]">🪵 Деревянный пол</option>
              <option value="road" className="bg-[#1e2127]">🛣️ Дорога / Тротуар</option>
              <option value="sand" className="bg-[#1e2127]">🏖️ Песок</option>
              <option value="none" className="bg-[#1e2127]">Без пола</option>
            </select>
          </div>

          {/* Lighting Preset Selector */}
          <div className="flex items-center gap-1 rounded border border-[#3a404c] bg-[#20232a] px-1.5 py-1 text-[10px]">
            <Sun className="h-3.5 w-3.5 text-amber-400" />
            <select
              value={lightingPreset}
              onChange={(event) => setLightingPreset(event.target.value as LightingPreset)}
              className="bg-transparent text-gray-300 outline-none cursor-pointer"
              title="Освещение"
            >
              <option value="neutral-studio" className="bg-[#1e2127]">Neutral Studio</option>
              <option value="soft-studio" className="bg-[#1e2127]">Soft Studio</option>
              <option value="hard-studio" className="bg-[#1e2127]">Hard Studio</option>
              <option value="outdoor" className="bg-[#1e2127]">Outdoor</option>
              <option value="sunset" className="bg-[#1e2127]">Sunset</option>
              <option value="top-light" className="bg-[#1e2127]">Top Light</option>
              <option value="rim-light" className="bg-[#1e2127]">Rim Light</option>
              <option value="dark-studio" className="bg-[#1e2127]">Dark Studio</option>
            </select>
          </div>

          <button
            onClick={() => managerRef.current?.resetCameras()}
            className="rounded p-1.5 text-gray-400 hover:bg-[#252932] hover:text-white"
            title="Сбросить камеры сравнения"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Asset Strip with Reorder Controls and Animations */}
        <div className="absolute left-3 right-3 top-[62px] z-20 flex gap-1.5 overflow-x-auto pb-1">
          {assets.map((asset, index) => (
            <div
              key={asset.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleFiles(e.dataTransfer.files);
                  return;
                }
                const text = e.dataTransfer.getData('text/plain');
                if (text !== '') {
                  const from = Number(text);
                  if (!isNaN(from)) reorderAssets(from, index);
                }
              }}
              onClick={() => {
                setActiveAssetId(asset.id);
                managerRef.current?.setActiveAssetId(asset.id);
              }}
              className={`group flex min-w-0 max-w-72 items-center gap-1.5 rounded border px-2 py-1 text-left text-[10px] shadow cursor-pointer transition select-none ${
                activeAsset?.id === asset.id
                  ? 'border-cyan-600 bg-cyan-950/55 text-cyan-100 ring-1 ring-cyan-700/40'
                  : 'border-[#343946] bg-[#181b21]/90 text-gray-300 hover:bg-[#20242c]'
              }`}
            >
              {/* Lineup Reordering Arrows */}
              {viewMode === 'lineup' && (
                <div className="flex items-center -ml-0.5 mr-0.5 gap-0.5 opacity-60 group-hover:opacity-100 transition">
                  <button
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveAsset(index, -1);
                    }}
                    className="p-0.5 rounded text-gray-400 hover:bg-[#2b303a] hover:text-cyan-300 disabled:opacity-20 disabled:hover:bg-transparent"
                    title="Сдвинуть влево в линейке"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <button
                    disabled={index === assets.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveAsset(index, 1);
                    }}
                    className="p-0.5 rounded text-gray-400 hover:bg-[#2b303a] hover:text-cyan-300 disabled:opacity-20 disabled:hover:bg-transparent"
                    title="Сдвинуть вправо в линейке"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              )}

              <span className="rounded bg-[#2a3039] px-1 font-mono text-cyan-300">{asset.slot}</span>
              <span className="min-w-0 flex-1 truncate" title={asset.fileName}>{asset.fileName}</span>
              {viewMode === 'lineup' && asset.manualScale !== 1 && (
                <span className="font-mono text-[9px] text-violet-300">{asset.manualScale.toFixed(2)}×</span>
              )}
              {asset.animations.length > 0 && (
                <select
                  value={asset.selectedClipIndex}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setClip(asset.id, Number(event.target.value))}
                  className="max-w-24 rounded border border-[#3a404c] bg-[#1d2027] px-1 text-[9px] text-gray-300"
                  title="Анимация"
                >
                  {asset.animations.map((clip, clipIndex) => (
                    <option key={`${clip.name}-${clipIndex}`} value={clipIndex}>
                      {clip.name || `Clip ${clipIndex + 1}`}
                    </option>
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
                title="Удалить из сравнения"
              >
                <X className="h-3 w-3" />
              </span>
            </div>
          ))}
        </div>

        {/* Animation Scrubber */}
        {anyAnimations && assets.length > 0 && (
          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[#343946] bg-[#171a20]/95 px-2.5 py-1.5 shadow-xl backdrop-blur-sm">
            <button
              onClick={() => setPlaying((value) => !value)}
              className="rounded p-1 text-cyan-300 hover:bg-[#252932]"
              title={playing ? 'Пауза' : 'Воспроизведение'}
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
              title="Шкала анимации"
            />
            <label className="flex cursor-pointer items-center gap-1 text-[9px] text-gray-300">
              <input
                type="checkbox"
                checked={syncAnimations}
                onChange={(event) => setSyncAnimations(event.target.checked)}
                className="accent-cyan-400"
              />
              Синхр. времени
            </label>
            <label className="flex cursor-pointer items-center gap-1 text-[9px] text-gray-300">
              <input
                type="checkbox"
                checked={looping}
                onChange={(event) => setLooping(event.target.checked)}
                className="accent-cyan-400"
              />
              Цикл
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
            <Maximize2 className="h-3.5 w-3.5" /> Соло-режим · дважды кликните или Esc для возврата
          </div>
        )}

        {assets.length === 0 && !loading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="max-w-md rounded-lg border border-dashed border-[#46505e] bg-[#171a20]/90 px-8 py-7 text-center shadow-2xl backdrop-blur-sm">
              <Grid2X2 className="mx-auto mb-3 h-9 w-9 text-cyan-400" />
              <div className="text-sm font-semibold text-gray-100">Мульти-обзор моделей</div>
              <div className="mt-1 text-[11px] leading-relaxed text-gray-400">
                Перетащите сюда или добавьте от 2 до 8 3D-моделей (GLB/GLTF). Доступен обзор в Сетку и в Линейку с отражающим полом.
              </div>
              <div className="mt-3 text-[10px] text-gray-500">Сетка: 2 · 2+1 · 2+2 · 3+2 · 3+3 · 4+3 · 4+4</div>
            </div>
          </div>
        )}

        {loading && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs text-cyan-200">
            <Loader2 className="h-9 w-9 animate-spin text-cyan-400 mb-2" />
            <div className="text-sm font-semibold text-white">Загрузка и подготовка 3D-моделей...</div>
            <div className="text-[11px] text-gray-400 mt-1">Парсинг геометрии и размещение в сцене</div>
          </div>
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-cyan-400 bg-cyan-950/35 text-sm font-semibold text-cyan-200 backdrop-blur-sm">
            Перетащите модели в мульти-обзор · свободно слотов: {Math.max(0, 8 - assets.length)}
          </div>
        )}

        {loadError && (
          <div className="absolute bottom-3 left-3 z-30 max-w-lg rounded border border-rose-800 bg-rose-950/80 px-2.5 py-1.5 text-[10px] text-rose-200 shadow-xl">
            {loadError}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 z-10 text-[9px] text-gray-500">
          {viewMode === 'lineup'
            ? 'Клик по модели для выбора · Стрелки/drag в полосе для смены мест · ПКМ + колесо мыши для ручного масштаба'
            : 'Клик по ячейке для выбора · Двойной клик для Solo-режима · Нормализованные камеры'}
        </div>
      </div>

      {/* Right: Technical Inspector Snapshot */}
      <CompareInspectorPanel snapshot={snapshot} />
    </div>
  );
};
