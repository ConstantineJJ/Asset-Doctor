import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Columns3,
  FileUp,
  Layers,
  Lightbulb,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import type { RenderMode, SurfaceType } from '../types';
import type { CompareAssetRecord } from '../compare/CompareTypes';
import { CompareViewport } from './CompareViewport';
import { useI18n } from '../i18n';

interface ViewportProps {
  onCanvasMount: (container: HTMLElement) => void | (() => void);
  onFileDrop: (file: File) => void;
  isLoading: boolean;
  fileName?: string;
  renderMode: RenderMode;
  triangleCount: number;
  modelHeight: number;
  surface?: SurfaceType;
  onSetSurface?: (surface: SurfaceType) => void;
  modelRotation?: number;
  onSetModelRotation?: (deg: number) => void;
  autoRotate?: boolean;
  onToggleAutoRotate?: () => void;
  autoRotateSpeed?: number;
  onSetAutoRotateSpeed?: (speed: number) => void;
  isLightBulbVisible?: boolean;
  onToggleLightBulb?: () => void;
}

export const Viewport: React.FC<ViewportProps> = ({
  onCanvasMount,
  onFileDrop,
  isLoading,
  fileName,
  renderMode,
  triangleCount,
  modelHeight,
  surface = 'grid',
  onSetSurface,
  modelRotation = 0,
  onSetModelRotation,
  autoRotate = false,
  onToggleAutoRotate,
  autoRotateSpeed = 1.0,
  onSetAutoRotateSpeed,
  isLightBulbVisible = true,
  onToggleLightBulb,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [showRotationControls, setShowRotationControls] = useState(true);
  const [showSurfaceMenu, setShowSurfaceMenu] = useState(false);
  const { language } = useI18n();

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let cleanup: void | (() => void);

    const timer = window.setTimeout(() => {
      cleanup = onCanvasMount(container);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [onCanvasMount]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!compareOpen) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (compareOpen) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')) {
        onFileDrop(file);
      }
    }
  };

  const openCompareAssetInDoctor = (asset: CompareAssetRecord) => {
    if (!asset.sourceBuffer) return;
    const mime = asset.fileName.toLowerCase().endsWith('.gltf')
      ? 'model/gltf+json'
      : 'model/gltf-binary';
    const file = new File([asset.sourceBuffer], asset.fileName, { type: mime });
    onFileDrop(file);
    setCompareOpen(false);
  };

  const surfaces: Array<{ id: SurfaceType; labelRu: string; labelEn: string; icon: string }> = [
    { id: 'grid', labelRu: 'Сетка студии', labelEn: 'Studio Grid', icon: '📐' },
    { id: 'grass', labelRu: 'Газон (Трава)', labelEn: 'Lawn (Grass)', icon: '🌿' },
    { id: 'road', labelRu: 'Дорога / тротуар', labelEn: 'Road & Sidewalk', icon: '🛣️' },
    { id: 'sand', labelRu: 'Песок', labelEn: 'Sand', icon: '🏖️' },
    { id: 'tile', labelRu: 'Керамогранит', labelEn: 'Porcelain Tile', icon: '🏛️' },
    { id: 'wood', labelRu: 'Деревянный пол', labelEn: 'Wood Floor', icon: '🪵' },
    { id: 'none', labelRu: 'Без поверхности', labelEn: 'No Surface', icon: '🚫' },
  ];

  const currentSurfaceObj = surfaces.find((s) => s.id === surface) || surfaces[0];

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex-1 h-full bg-[#131518] overflow-hidden focus:outline-none select-none"
    >
      {/* Top Left: Asset info tag & draggable lightbulb indicator */}
      {fileName && !compareOpen && (
        <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-2 bg-[#191b21]/85 backdrop-blur-xs border border-[#2d313b] px-2.5 py-1 rounded text-xs text-gray-200 shadow-md">
            <Box className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold">{fileName}</span>
            <span className="text-[#4b5563]">•</span>
            <span className="font-mono text-gray-400">{triangleCount.toLocaleString()} tri</span>
            <span className="text-[#4b5563]">•</span>
            <span className="uppercase text-[10px] text-blue-400 font-mono">{renderMode}</span>
          </div>

          {isLightBulbVisible && (
            <div
              className="hidden sm:flex items-center gap-1.5 bg-amber-950/70 border border-amber-600/60 px-2 py-1 rounded text-[11px] text-amber-200 shadow-md animate-pulse cursor-help"
              title={
                language === 'ru'
                  ? 'Лампочка видна в сцене! Перетаскивайте её мышкой прямо во вьюпорте.'
                  : 'Light bulb is active in the scene! Click and drag it directly in the viewport.'
              }
            >
              <span>💡</span>
              <span className="font-medium">
                {language === 'ru' ? 'Перетаскивайте лампочку мышкой' : 'Drag bulb with mouse'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Top Right: Compare button & Quick Surface menu */}
      {!compareOpen && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
          {/* Surface quick switcher */}
          {onSetSurface && (
            <div className="relative">
              <button
                onClick={() => setShowSurfaceMenu(!showSurfaceMenu)}
                className="flex items-center gap-1.5 rounded-md border border-[#3b414d] bg-[#1a1c22]/90 backdrop-blur-xs px-2.5 py-1.5 text-xs font-medium text-gray-200 hover:border-cyan-500 hover:text-white transition shadow-md cursor-pointer"
                title={language === 'ru' ? 'Выбрать поверхность пола' : 'Choose ground surface'}
              >
                <span>{currentSurfaceObj.icon}</span>
                <span className="hidden sm:inline">
                  {language === 'ru' ? currentSurfaceObj.labelRu : currentSurfaceObj.labelEn}
                </span>
                <span className="text-gray-400 text-[10px]">▼</span>
              </button>

              {showSurfaceMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-52 rounded-lg border border-[#323642] bg-[#191c22]/95 backdrop-blur-md p-1.5 shadow-2xl z-30 space-y-1">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase text-cyan-400 border-b border-[#292d37]">
                    {language === 'ru' ? 'Поверхность под моделью' : 'Ground Surfaces'}
                  </div>
                  {surfaces.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        onSetSurface(s.id);
                        setShowSurfaceMenu(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition text-left cursor-pointer ${
                        surface === s.id
                          ? 'bg-cyan-950/60 border border-cyan-700/60 text-cyan-200 font-semibold'
                          : 'text-gray-300 hover:bg-[#232732] hover:text-white'
                      }`}
                    >
                      <span className="text-sm">{s.icon}</span>
                      <span className="flex-1">
                        {language === 'ru' ? s.labelRu : s.labelEn}
                      </span>
                      {surface === s.id && <span className="text-cyan-400 text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setCompareOpen(true)}
            className="flex items-center gap-2 rounded-md border border-cyan-800 bg-cyan-950/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 shadow-lg backdrop-blur-xs transition hover:border-cyan-600 hover:bg-cyan-950/55 cursor-pointer"
            title="Open persistent Multi-Asset Compare workspace"
          >
            <Columns3 className="h-4 w-4 text-cyan-300" />
            Compare
          </button>
        </div>
      )}

      {/* Model Height Scale Bar */}
      {modelHeight > 0 && !compareOpen && (
        <div
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 h-36 w-12 pointer-events-none text-[9px] font-mono text-gray-400"
          title={`Model height: ${modelHeight.toFixed(3)} m`}
        >
          <div className="absolute right-2 top-0 bottom-0 w-px bg-gray-500/50" />
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <div
              key={fraction}
              className="absolute right-2 flex items-center"
              style={{ top: `${fraction * 100}%`, transform: 'translateY(-50%)' }}
            >
              <span className="w-2 h-px bg-gray-500/60 mr-1" />
              {(fraction === 0 || fraction === 0.5 || fraction === 1) && (
                <span className="whitespace-nowrap">
                  {((1 - fraction) * modelHeight).toFixed(modelHeight >= 10 ? 1 : 2)}m
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bottom Center: Model Axis Rotation & Turntable Control Bar */}
      {fileName && !compareOpen && onSetModelRotation && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-[#181a20]/90 backdrop-blur-md border border-[#2d313c] px-3 py-1.5 rounded-full shadow-2xl text-xs text-gray-200">
          {/* Turntable Auto-Rotate Play/Pause */}
          {onToggleAutoRotate && (
            <button
              onClick={onToggleAutoRotate}
              className={`p-1.5 rounded-full transition cursor-pointer flex items-center justify-center ${
                autoRotate
                  ? 'bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30'
                  : 'bg-[#252830] text-gray-300 hover:text-white hover:bg-[#2f333e]'
              }`}
              title={
                autoRotate
                  ? (language === 'ru' ? 'Остановить авто-вращение' : 'Pause turntable auto-rotation')
                  : (language === 'ru' ? 'Запустить авто-вращение модели вокруг оси' : 'Start turntable auto-rotation')
              }
            >
              {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>
          )}

          {/* Model Axis Rotation Header & Angle badge */}
          <div className="flex items-center gap-1.5 pl-1 pr-2 border-r border-[#2d313c]">
            <RotateCw className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] font-medium hidden md:inline text-gray-300">
              {language === 'ru' ? 'Ось Y:' : 'Axis Y:'}
            </span>
            <span className="font-mono text-[11px] font-bold text-cyan-300 w-10 text-right">
              {Math.round(modelRotation)}°
            </span>
          </div>

          {/* Continuous Rotation Slider */}
          <input
            type="range"
            min="0"
            max="360"
            value={Math.round(modelRotation)}
            onChange={(e) => onSetModelRotation(Number(e.target.value))}
            className="w-24 sm:w-36 h-1.5 accent-cyan-400 cursor-pointer"
            title={language === 'ru' ? 'Вращение 3D модели вокруг своей оси (0°–360°)' : 'Rotate 3D model around its axis'}
          />

          {/* Quick Angle Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSetModelRotation(((modelRotation - 90) % 360 + 360) % 360)}
              className="px-1.5 py-0.5 rounded bg-[#252830] hover:bg-[#2f333e] text-[10px] font-mono text-gray-300 hover:text-white transition cursor-pointer"
              title="-90°"
            >
              -90°
            </button>
            <button
              onClick={() => onSetModelRotation((modelRotation + 90) % 360)}
              className="px-1.5 py-0.5 rounded bg-[#252830] hover:bg-[#2f333e] text-[10px] font-mono text-gray-300 hover:text-white transition cursor-pointer"
              title="+90°"
            >
              +90°
            </button>
            <button
              onClick={() => onSetModelRotation(0)}
              className="p-1 rounded bg-[#252830] hover:bg-[#2f333e] text-gray-400 hover:text-cyan-300 transition cursor-pointer"
              title={language === 'ru' ? 'Сбросить вращение на 0°' : 'Reset rotation to 0°'}
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          {/* Turntable Speed Multiplier */}
          {autoRotate && onSetAutoRotateSpeed && (
            <div className="flex items-center gap-1 pl-2 border-l border-[#2d313c]">
              {[0.5, 1.0, 2.0].map((spd) => (
                <button
                  key={spd}
                  onClick={() => onSetAutoRotateSpeed(spd)}
                  className={`px-1 py-0.5 rounded text-[9px] font-mono cursor-pointer ${
                    autoRotateSpeed === spd
                      ? 'bg-cyan-600 text-white font-bold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom Left: Mouse control tips */}
      {!compareOpen && (
        <div className="absolute bottom-3 left-3 z-10 hidden xl:flex items-center space-x-1.5 pointer-events-none text-[10px] text-gray-400 font-mono">
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">ЛКМ: Вращение камеры</span>
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">ПКМ: Панорама</span>
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">Колесо: Масштаб</span>
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">💡 Лампочка: Перетаскивание</span>
        </div>
      )}

      {isDragOver && !compareOpen && (
        <div className="absolute inset-0 z-40 bg-blue-950/70 backdrop-blur-xs border-4 border-dashed border-cyan-400 flex flex-col items-center justify-center text-white pointer-events-none transition-all">
          <FileUp className="w-12 h-12 text-cyan-400 mb-2 animate-bounce" />
          <h3 className="text-lg font-bold">Drop GLB / GLTF Asset Here</h3>
          <p className="text-xs text-cyan-200 mt-1">Immediate parsing, viewport framing, and background diagnostics</p>
        </div>
      )}

      {isLoading && !compareOpen && (
        <div className="absolute inset-0 z-30 bg-[#131518]/80 backdrop-blur-xs flex flex-col items-center justify-center text-gray-200 pointer-events-none">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-2" />
          <span className="text-xs font-medium">Parsing 3D Asset Buffers...</span>
        </div>
      )}

      <CompareViewport
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        onOpenInDoctor={openCompareAssetInDoctor}
        renderMode={renderMode}
        surface={surface}
        onSetSurface={onSetSurface}
      />
    </div>
  );
};
