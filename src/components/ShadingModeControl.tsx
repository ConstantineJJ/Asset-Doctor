import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import {
  getShadingMode,
  setShadingMode,
  subscribeShadingMode,
  type ShadingMode,
} from '../viewer/ShadingMode';

/**
 * Small global viewport preference mounted into the existing Render Mode card.
 * It intentionally stays outside App analysis state: shading is presentation-only
 * and is shared by Doctor, Compare Grid and Lineup RenderModeManagers.
 */
export const ShadingModeControl: React.FC = () => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<ShadingMode>(getShadingMode);
  const { language } = useI18n();

  useEffect(() => subscribeShadingMode(setMode), []);

  useEffect(() => {
    const locateHost = () => {
      const nextHost = document.getElementById('select-render-mode')?.parentElement ?? null;
      setHost((current) => current === nextHost ? current : nextHost);
    };

    locateHost();
    const observer = new MutationObserver(locateHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!host) return null;

  const title = language === 'ru'
    ? 'Шейдинг: Hybrid показывает авторские нормали, Smooth временно пересчитывает сглаженные нормали, Flat показывает каждую грань отдельно.'
    : 'Shading: Hybrid shows authored normals, Smooth temporarily recomputes smooth normals, Flat shows each face separately.';

  return createPortal(
    <>
      <div className="mx-1 h-4 w-px shrink-0 bg-[#343946]" />
      <span className="hidden 2xl:inline text-[10px] text-gray-500">
        {language === 'ru' ? 'Шейдинг' : 'Shading'}
      </span>
      <select
        id="select-shading-mode"
        aria-label={language === 'ru' ? 'Режим шейдинга' : 'Shading mode'}
        title={title}
        value={mode}
        onChange={(event) => setShadingMode(event.target.value as ShadingMode)}
        className="bg-transparent text-cyan-200 text-[11px] focus:outline-none cursor-pointer font-medium"
      >
        <option value="hybrid" className="bg-[#1e2127]">Hybrid</option>
        <option value="smooth" className="bg-[#1e2127]">Smooth</option>
        <option value="flat" className="bg-[#1e2127]">Flat</option>
      </select>
    </>,
    host
  );
};
