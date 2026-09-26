import React, { useEffect, useRef, useState } from 'react';
import { Box, Columns3, FileUp, Loader2 } from 'lucide-react';
import type { RenderMode } from '../types';
import { CompareViewport } from './CompareViewport';

interface ViewportProps {
  onCanvasMount: (container: HTMLElement) => void | (() => void);
  onFileDrop: (file: File) => void;
  isLoading: boolean;
  fileName?: string;
  renderMode: RenderMode;
  triangleCount: number;
  modelHeight: number;
}

export const Viewport: React.FC<ViewportProps> = ({
  onCanvasMount,
  onFileDrop,
  isLoading,
  fileName,
  renderMode,
  triangleCount,
  modelHeight,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    return onCanvasMount(containerRef.current);
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
      if (
        file.name.toLowerCase().endsWith('.glb') ||
        file.name.toLowerCase().endsWith('.gltf')
      ) {
        onFileDrop(file);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex-1 h-full bg-[#131518] overflow-hidden focus:outline-none select-none"
    >
      {/* Top Left HUD Overlay */}
      {fileName && (
        <div className="absolute top-3 left-3 z-10 flex items-center space-x-2 bg-[#191b21]/80 backdrop-blur-xs border border-[#2d313b] px-2.5 py-1 rounded text-xs text-gray-200 pointer-events-none shadow-md">
          <Box className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold">{fileName}</span>
          <span className="text-[#4b5563]">•</span>
          <span className="font-mono text-gray-400">
            {triangleCount.toLocaleString()} triangles
          </span>
          <span className="text-[#4b5563]">•</span>
          <span className="uppercase text-[10px] text-blue-400 font-mono">
            {renderMode}
          </span>
        </div>
      )}

      {/* Compare is intentionally a separate view-only workspace. It does not
          duplicate Health/Heal panels or mutate the active Doctor asset. */}
      {!compareOpen && (
        <button
          onClick={() => setCompareOpen(true)}
          className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded border border-[#39414d] bg-[#191c22]/90 px-2.5 py-1 text-[10px] font-medium text-gray-300 shadow-md backdrop-blur-xs transition hover:border-cyan-800 hover:text-cyan-200"
          title="Compare 2–5 models in one viewport"
        >
          <Columns3 className="h-3.5 w-3.5 text-cyan-400" />
          Compare 2–5
        </button>
      )}

      {/* Subtle model-height ruler. Uses real asset units (glTF meters). */}
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

      {/* Orientation gizmo is injected by SceneManager so it follows the live camera. */}

      {/* Bottom Left Navigation Hints */}
      {!compareOpen && (
        <div className="absolute bottom-3 left-3 z-10 hidden md:flex items-center space-x-1.5 pointer-events-none text-[10px] text-gray-400 font-mono">
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">
            L-Click: Orbit
          </span>
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">
            R-Click: Pan
          </span>
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">
            Scroll: Zoom
          </span>
          <span className="bg-[#181a20]/80 backdrop-blur-xs px-2 py-0.5 rounded border border-[#2c303a]">
            Click Mesh: Select
          </span>
        </div>
      )}

      {/* Drag & Drop Overlay */}
      {isDragOver && !compareOpen && (
        <div className="absolute inset-0 z-40 bg-blue-950/70 backdrop-blur-xs border-4 border-dashed border-cyan-400 flex flex-col items-center justify-center text-white pointer-events-none transition-all">
          <FileUp className="w-12 h-12 text-cyan-400 mb-2 animate-bounce" />
          <h3 className="text-lg font-bold">Drop GLB / GLTF Asset Here</h3>
          <p className="text-xs text-cyan-200 mt-1">
            Immediate parsing, viewport framing, and background diagnostics
          </p>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && !compareOpen && (
        <div className="absolute inset-0 z-30 bg-[#131518]/80 backdrop-blur-xs flex flex-col items-center justify-center text-gray-200 pointer-events-none">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-2" />
          <span className="text-xs font-medium">Parsing 3D Asset Buffers...</span>
        </div>
      )}

      {compareOpen && <CompareViewport onClose={() => setCompareOpen(false)} />}
    </div>
  );
};
