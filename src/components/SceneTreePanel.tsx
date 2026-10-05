import React, { useEffect, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Focus,
  Layers,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { SceneNodeInfo } from '../types';
import { useI18n } from '../i18n';

interface SceneTreePanelProps {
  treeRoot: SceneNodeInfo | null;
  selectedUuid: string | null;
  onSelectNode: (uuid: string) => void;
  onToggleVisibility: (uuid: string) => void;
  onIsolateNode: (uuid: string) => void;
  onShowAll: () => void;
  onFocusNode: (uuid: string) => void;
  isCollapsed?: boolean;
  onTogglePanelCollapse?: () => void;
}

export const SceneTreePanel: React.FC<SceneTreePanelProps> = ({
  treeRoot,
  selectedUuid,
  onSelectNode,
  onToggleVisibility,
  onIsolateNode,
  onShowAll,
  onFocusNode,
  isCollapsed = false,
  onTogglePanelCollapse,
}) => {
  const { language, t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  // Keep the root visible, but start complex assets folded at the first real branch.
  // This prevents rigs / segmented models from exploding into hundreds of rows on load.
  useEffect(() => {
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

  const toggleCollapse = (uuid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => ({ ...prev, [uuid]: !prev[uuid] }));
  };

  const getNodeIcon = (type: SceneNodeInfo['type']) => {
    switch (type) {
      case 'Mesh':
        return <Box className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      case 'SkinnedMesh':
        return <Zap className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      case 'Bone':
        return <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'Group':
      case 'Scene':
        return <Layers className="w-3.5 h-3.5 text-gray-400 shrink-0" />;
      default:
        return <Box className="w-3.5 h-3.5 text-gray-400 shrink-0" />;
    }
  };

  const renderNode = (node: SceneNodeInfo, depth: number = 0) => {
    const isSelected = selectedUuid === node.uuid;
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = searchQuery ? false : !!collapsedNodes[node.uuid];

    const matchesSearch =
      !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase());

    return (
      <div key={node.uuid} className="select-none">
        {matchesSearch && (
          <div
            onClick={() => onSelectNode(node.uuid)}
            className={`group relative flex items-center justify-between pr-2 pl-1 py-1 text-xs cursor-pointer border-l-2 transition-colors ${
              isSelected
                ? 'bg-blue-600/25 border-blue-500 text-white font-medium'
                : 'border-transparent text-gray-300 hover:bg-[#20232a] hover:text-gray-100'
            }`}
          >
            {/* Left: compact lineage connector, expander, icon, name */}
            <div className="flex items-center gap-1 overflow-hidden pr-2 min-w-0">
              {depth > 0 && (
                <span
                  aria-hidden="true"
                  className="w-1.5 h-px bg-[#39404b] shrink-0"
                />
              )}
              {hasChildren ? (
                <button
                  onClick={(e) => toggleCollapse(node.uuid, e)}
                  className="p-0.5 hover:bg-[#2e323c] rounded text-gray-400"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              ) : (
                <div className="w-3.5" />
              )}

              {getNodeIcon(node.type)}

              <span className="truncate" title={node.name}>
                {node.name}
              </span>

              {node.triangleCount > 0 && (
                <span className="text-[10px] text-gray-400 font-mono hidden group-hover:inline">
                  {node.triangleCount.toLocaleString()}t
                </span>
              )}
            </div>

            {/* Right: Actions (Visibility, Isolate, Focus) */}
            <div className="flex items-center space-x-1 opacity-60 group-hover:opacity-100 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusNode(node.uuid);
                }}
                className="p-1 hover:bg-[#323642] rounded text-gray-400 hover:text-cyan-400"
                title={t('scene.focusTitle')}
              >
                <Focus className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onIsolateNode(node.uuid);
                }}
                className="px-1 py-0.5 hover:bg-[#323642] rounded text-[10px] text-gray-400 hover:text-amber-400 font-mono"
                title={t('scene.isolateTitle')}
              >
                ISO
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(node.uuid);
                }}
                className={`p-1 hover:bg-[#323642] rounded ${
                  node.visible ? 'text-gray-400 hover:text-white' : 'text-red-400'
                }`}
                title={node.visible ? t('scene.hideTitle') : t('scene.showTitle')}
              >
                {node.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
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
      <aside className="w-10 bg-[#16181d] border-r border-[#262932] flex flex-col items-center py-2 h-full shrink-0 select-none transition-all duration-200 z-10">
        <button
          onClick={onTogglePanelCollapse}
          className="p-1.5 rounded hover:bg-[#20232a] text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
          title={language === 'ru' ? 'Развернуть дерево сцены' : 'Expand scene tree'}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div
          onClick={onTogglePanelCollapse}
          className="mt-6 flex flex-col items-center gap-3 cursor-pointer group"
          title={language === 'ru' ? 'Развернуть дерево сцены' : 'Expand scene tree'}
        >
          <Layers className="w-4 h-4 text-cyan-400 group-hover:text-cyan-300 transition" />
          <span
            className="text-[10px] text-gray-400 group-hover:text-gray-200 font-medium tracking-wider uppercase [writing-mode:vertical-lr] rotate-180 select-none transition"
          >
            {t('scene.title')}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-72 bg-[#16181d] border-r border-[#262932] flex flex-col h-full shrink-0 select-none transition-all duration-200">
      {/* Panel Header */}
      <div className="h-10 px-3 border-b border-[#262932] flex items-center justify-between bg-[#1a1c22]">
        <div className="flex items-center space-x-2">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-xs text-gray-200 tracking-wide uppercase">
            {t('scene.title')}
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={onShowAll}
            className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium px-2 py-0.5 rounded bg-[#20232a] hover:bg-[#292d37] transition cursor-pointer"
            title={t('scene.showAllTitle')}
          >
            {t('scene.showAll')}
          </button>
          {onTogglePanelCollapse && (
            <button
              onClick={onTogglePanelCollapse}
              className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-[#20232a] transition cursor-pointer"
              title={language === 'ru' ? 'Свернуть дерево сцены' : 'Collapse scene hierarchy'}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Search */}
      <div className="p-2 border-b border-[#262932]">
        <div className="flex items-center px-2 py-1 bg-[#1e2127] rounded border border-[#2d313a] text-xs">
          <Search className="w-3 h-3 text-gray-400 mr-1.5 shrink-0" />
          <input
            type="text"
            placeholder={t('scene.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-gray-200 text-xs focus:outline-none placeholder-gray-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-gray-400 hover:text-gray-200 text-[10px]"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto py-1 custom-scrollbar">
        {treeRoot ? (
          renderNode(treeRoot)
        ) : (
          <div className="p-6 text-center text-xs text-gray-400">
            {t('scene.empty')}
          </div>
        )}
      </div>

      {/* Footer Info */}
      {treeRoot && (
        <div className="p-2 border-t border-[#262932] bg-[#141519] text-[10px] text-gray-400 flex items-center justify-between">
          <span>{treeRoot.name}</span>
          <span className="font-mono">
            {treeRoot.children?.length || 0} {t('scene.topNodes')}
          </span>
        </div>
      )}
    </aside>
  );
};
