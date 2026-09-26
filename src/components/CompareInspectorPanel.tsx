import React from 'react';
import { BarChart3, Box, Columns3, Gauge, Layers3, Scale, Table2 } from 'lucide-react';
import type { CompareMetricAsset, CompareSessionSnapshot } from '../compare/CompareTypes';

interface CompareInspectorPanelProps {
  snapshot: CompareSessionSnapshot;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, power)).toFixed(power >= 2 ? 1 : 0)} ${units[power]}`;
}

const METRICS: Array<[string, (asset: CompareMetricAsset) => string]> = [
  ['Triangles', (asset) => asset.triangleCount.toLocaleString()],
  ['Vertices', (asset) => asset.vertexCount.toLocaleString()],
  ['Meshes', (asset) => asset.meshCount.toLocaleString()],
  ['Materials', (asset) => asset.materialCount.toLocaleString()],
  ['Textures', (asset) => asset.textureCount.toLocaleString()],
  ['Bones', (asset) => asset.boneCount.toLocaleString()],
  ['Clips', (asset) => asset.animationCount.toLocaleString()],
  ['Draw calls', (asset) => asset.drawCalls.toLocaleString()],
  ['Texture VRAM', (asset) => formatBytes(asset.textureVramBytes)],
  ['Height', (asset) => `${asset.height.toFixed(3)} m`],
  ['Lineup scale', (asset) => `${asset.manualScale.toFixed(2)}×`],
];

export const CompareInspectorPanel: React.FC<CompareInspectorPanelProps> = ({ snapshot }) => {
  const active = snapshot.assets.find((asset) => asset.id === snapshot.activeAssetId) ?? snapshot.assets[0] ?? null;

  return (
    <aside className="w-96 bg-[#16181d] border-l border-[#262932] flex flex-col h-full shrink-0 select-none text-xs text-gray-200">
      <div className="h-10 px-2 border-b border-[#262932] flex items-center gap-2 bg-[#1a1c22]">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#252830] text-cyan-400 border border-[#373b46]">
          <Table2 className="w-3.5 h-3.5" />
          <span className="font-medium">Compare Metrics</span>
        </div>
        <span className="ml-auto text-[10px] font-mono text-gray-500">{snapshot.assets.length}/5</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-[#2d313a] bg-[#1b1e24] p-2">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-gray-500">
              <Columns3 className="w-3 h-3" /> View
            </div>
            <div className="mt-1 text-[11px] text-gray-200 capitalize">{snapshot.viewMode}</div>
          </div>
          <div className="rounded border border-[#2d313a] bg-[#1b1e24] p-2">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-gray-500">
              <Scale className="w-3 h-3" /> Scale
            </div>
            <div className="mt-1 text-[11px] text-gray-200">
              {snapshot.scaleMode === 'normalize-height' ? 'Normalize Height' : 'Real Scale'}
            </div>
          </div>
        </div>

        <div className="rounded border border-[#2d313a] bg-[#1b1e24] p-2 text-[10px] text-gray-400">
          <div className="flex items-center justify-between gap-2">
            <span>Sync Cameras</span>
            <span className={snapshot.syncCameras ? 'text-emerald-300' : 'text-gray-500'}>{snapshot.syncCameras ? 'ON' : 'OFF'}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>Sync Animation Time</span>
            <span className={snapshot.syncAnimations ? 'text-emerald-300' : 'text-gray-500'}>{snapshot.syncAnimations ? 'ON' : 'OFF'}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>Render</span>
            <span className="text-cyan-300 uppercase font-mono">{snapshot.renderMode}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>Lighting</span>
            <span className="text-amber-300 font-mono">{snapshot.lightingPreset}</span>
          </div>
        </div>

        {active && (
          <div className="rounded border border-cyan-900/70 bg-cyan-950/15 p-2.5">
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-950 px-1.5 py-0.5 font-mono text-cyan-300">{active.slot}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-gray-100">{active.fileName}</div>
                <div className="text-[9px] text-gray-500">Selected compare asset</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px] font-mono">
              <div className="rounded border border-[#2b3039] bg-[#17191e] p-1.5">
                <span className="block text-gray-500">Triangles</span>
                <span className="text-gray-200">{active.triangleCount.toLocaleString()}</span>
              </div>
              <div className="rounded border border-[#2b3039] bg-[#17191e] p-1.5">
                <span className="block text-gray-500">Height</span>
                <span className="text-gray-200">{active.height.toFixed(3)} m</span>
              </div>
              <div className="rounded border border-[#2b3039] bg-[#17191e] p-1.5">
                <span className="block text-gray-500">Draw calls</span>
                <span className="text-gray-200">{active.drawCalls}</span>
              </div>
              <div className="rounded border border-[#2b3039] bg-[#17191e] p-1.5">
                <span className="block text-gray-500">Manual size</span>
                <span className="text-violet-300">{active.manualScale.toFixed(2)}×</span>
              </div>
            </div>
          </div>
        )}

        <div className="rounded border border-[#2d313a] bg-[#1b1e24] overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-[#2d313a] px-2.5 py-2 text-[10px] uppercase tracking-wider text-gray-400">
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" /> Metric Matrix
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[620px] w-full text-[9px] text-gray-300">
              <thead className="bg-[#1d2027] text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Metric</th>
                  {snapshot.assets.map((asset) => (
                    <th key={asset.id} className={`max-w-32 px-2 py-1.5 text-right font-medium ${asset.id === active?.id ? 'text-cyan-300' : ''}`}>
                      {asset.slot}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {METRICS.map(([label, formatter]) => (
                  <tr key={label} className="border-t border-[#2a2e37]">
                    <th className="px-2 py-1.5 text-left font-normal text-gray-500">{label}</th>
                    {snapshot.assets.map((asset) => (
                      <td key={asset.id} className={`px-2 py-1.5 text-right ${asset.id === active?.id ? 'text-cyan-200' : 'text-gray-200'}`}>
                        {formatter(asset)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded border border-[#2d313a] bg-[#17191e] p-2 text-[9px] leading-relaxed text-gray-500">
          <div className="mb-1 flex items-center gap-1 text-gray-400"><Gauge className="w-3 h-3" /> Compare mode is view-only.</div>
          Click a model to select it. Use the large Doctor button to open that selected source as a fresh Doctor asset. In Lineup, hold <span className="text-gray-300">Alt + mouse wheel</span> over a model for presentation-only size adjustment.
        </div>
      </div>
    </aside>
  );
};
