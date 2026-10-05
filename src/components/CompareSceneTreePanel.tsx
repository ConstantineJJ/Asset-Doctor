import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { SceneNodeInfo } from '../types';
import { useI18n } from '../i18n';

interface CompareSceneTreePanelProps {
  assetId: string | null;
  root: THREE.Group | null;
  fileName?: string;
  slot?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

function buildSceneTree(object: THREE.Object3D): SceneNodeInfo {
  let type: SceneNodeInfo['type'] = 'Object3D';
  let triangleCount = 0;
  let vertexCount = 0;

  if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
    type = 'SkinnedMesh';
  } else if ((object as THREE.Mesh).isMesh) {
    type = 'Mesh';
  } else if ((object as THREE.Bone).isBone) {
    type = 'Bone';
  } else if ((object as THREE.Light).isLight) {
    type = 'Light';
  } else if ((object as THREE.Camera).isCamera) {
    type = 'Camera';
  } else if ((object as THREE.Scene).isScene) {
    type = 'Scene';
  } else if ((object as THREE.Group).isGroup) {
    type = 'Group';
  }

  if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry) {
    const geometry = (object as THREE.Mesh).geometry;
    const position = geometry.getAttribute('position');
    triangleCount = geometry.index
      ? Math.floor(geometry.index.count / 3)
      : position
        ? Math.floor(position.count / 3)
        : 0;
    vertexCount = position?.count ?? 0;
  }

  const children = object.children
    .filter((child) => !child.name?.startsWith('__ascope_internal_'))
    .map((child) => buildSceneTree(child));

  return {
    uuid: object.uuid,
    name: object.name || `${type}_${object.id}`,
    type,
    visible: object.visible,
    triangleCount,
    vertexCount,
    children,
  };
}

export const CompareSceneTreePanel: React.FC<CompareSceneTreePanelProps> = ({
  assetId,
  root,
  fileName,
  slot,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const { t, language } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  // root is stable across manual Lineup scaling, so changing presentation size
  // does not rebuild a potentially large hierarchy. Selection of another asset does.
  const treeRoot = useMemo(() => (root ? buildSceneTree(root) : null), [assetId, root]);

  useEffect(() => {
    setSearchQuery('');
    if (!treeRoot) {
      setCollapsedNodes({});
      return;
    }

    const next: Record<string, boolean> = {};
    const visit = (node: SceneNodeInfo, depth: number) => {
      if (node.children?.length) {
        next[node.uuid] = depth >= 1;
        node.children.forEach((child) => visit(child, depth + 1));
      }
    };
    visit(treeRoot, 0);
    setCollapsedNodes(next);
  }, [treeRoot?.uuid]);

  const getNodeIcon = (type: SceneNodeInfo['type']) => {
    switch (type) {
      case 'Mesh':
        return <Box className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
      case 'SkinnedMesh':
        return <Zap className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
      case 'Bone':
        return <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
      case 'Group':
      case 'Scene':
        return <Layers className="h-3.5 w-3.5 shrink-0 text-gray-400" />;
      default:
        return <Box className="h-3.5 w-3.5 shrink-0 text-gray-400" />;
    }
  };

  const toggleCollapse = (uuid: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCollapsedNodes((previous) => ({ ...previous, [uuid]: !previous[uuid] }));
  };

  const renderNode = (node: SceneNodeInfo, depth = 0): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = searchQuery ? false : !!collapsedNodes[node.uuid];
    const matchesSearch = !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase());

    return (
      <div key={node.uuid} className="select-none">
        {matchesSearch && (
          <div className="group flex items-center border-l-2 border-transparent py-1 pl-1 pr-2 text-xs text-gray-300 hover:bg-[#20232a] hover:text-gray-100">
            <div className="flex min-w-0 items-center gap-1 overflow-hidden pr-2">
              {depth > 0 && <span aria-hidden="true" className="h-px w-1.5 shrink-0 bg-[#39404b]" />}
              {hasChildren ? (
                <button
                  onClick={(event) => toggleCollapse(node.uuid, event)}
                  className="rounded p-0.5 text-gray-400 hover:bg-[#2e323c]"
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              ) : (
                <div className="w-3.5" />
              )}
              {getNodeIcon(node.type)}
              <span className="truncate" title={node.name}>{node.name}</span>
              {node.triangleCount > 0 && (
                <span className="hidden font-mono text-[10px] text-gray-400 group-hover:inline">
                  {node.triangleCount.toLocaleString()}t
                </span>
              )}
            </div>
          </div>
        )}

        {hasChildren && !isCollapsed && (
          <div className="ml-1 border-l border-[#2b313a]">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (isCollapsed) {
    return (
      <aside className="flex h-full w-10 shrink-0 select-none flex-col items-center border-r border-[#262932] bg-[#16181d] py-2">
        <button
          onClick={onToggleCollapse}
          className="rounded p-1.5 text-cyan-400 hover:bg-[#20232a] hover:text-cyan-300 transition cursor-pointer"
          title={language === 'ru' ? 'Развернуть дерево сцены' : 'Expand scene tree'}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {slot && (
          <span className="mt-2 rounded border border-cyan-900 bg-cyan-950/40 px-1 py-0.5 font-mono text-[9px] text-cyan-300">
            {slot}
          </span>
        )}
        <div
          onClick={onToggleCollapse}
          className="mt-6 flex cursor-pointer flex-col items-center gap-3 group"
          title={language === 'ru' ? 'Развернуть дерево сцены' : 'Expand scene tree'}
        >
          <Layers className="h-4 w-4 text-cyan-400 group-hover:text-cyan-300 transition" />
          <span className="text-[10px] font-medium tracking-wider uppercase text-gray-400 group-hover:text-gray-200 [writing-mode:vertical-lr] rotate-180 select-none">
            {t('scene.title')}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 select-none flex-col border-r border-[#262932] bg-[#16181d]">
      <div className="flex h-10 items-center justify-between border-b border-[#262932] bg-[#1a1c22] px-3">
        <div className="flex min-w-0 items-center space-x-2">
          <Layers className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-200">
            {t('scene.title')}
          </span>
        </div>
        <div className="flex items-center space-x-1.5">
          {slot && (
            <span className="rounded border border-cyan-900 bg-cyan-950/30 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">
              {slot}
            </span>
          )}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="rounded p-1 text-gray-400 hover:bg-[#20232a] hover:text-gray-200 transition cursor-pointer"
              title={language === 'ru' ? 'Свернуть дерево сцены' : 'Collapse scene hierarchy'}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-[#262932] p-2">
        <div className="flex items-center rounded border border-[#2d313a] bg-[#1e2127] px-2 py-1 text-xs">
          <Search className="mr-1.5 h-3 w-3 shrink-0 text-gray-400" />
          <input
            type="text"
            placeholder={t('scene.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full bg-transparent text-xs text-gray-200 placeholder-gray-400 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-[10px] text-gray-400 hover:text-gray-200">×</button>
          )}
        </div>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto py-1">
        {treeRoot ? renderNode(treeRoot) : (
          <div className="p-6 text-center text-xs text-gray-400">{t('scene.empty')}</div>
        )}
      </div>

      {treeRoot && (
        <div className="flex items-center justify-between gap-2 border-t border-[#262932] bg-[#141519] p-2 text-[10px] text-gray-400">
          <span className="truncate" title={fileName || treeRoot.name}>{fileName || treeRoot.name}</span>
          <span className="shrink-0 font-mono">{treeRoot.children?.length || 0} {t('scene.topNodes')}</span>
        </div>
      )}
    </aside>
  );
};
