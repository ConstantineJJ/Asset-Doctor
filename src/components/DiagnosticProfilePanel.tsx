import type {DiagnosticProfileId, HealthIssue} from '../types';
import {DIAGNOSTIC_PROFILES} from '../health/DiagnosticProfiles';
import {useI18n} from '../i18n';

const copy:Record<DiagnosticProfileId, {en:[string,string];ru:[string,string]}> = {
  general: {en:['General inspection','Conservative inspection without a target platform.'],ru:['Общая проверка','Проверка без привязки к целевой платформе.']},
  'desktop-game-character': {en:['Desktop game character','Real-time character for desktop games; rig and animation expected.'],ru:['Персонаж для ПК','Персонаж для игры на ПК; ожидаются скелет и анимации.']},
  'mobile-game-character': {en:['Mobile game character','Character for mobile games with stricter resource budgets.'],ru:['Мобильный персонаж','Персонаж для мобильной игры с более строгими бюджетами ресурсов.']},
  'static-prop': {en:['Static prop','Static game object; rig and animation are optional.'],ru:['Статичный объект','Статичный игровой объект; скелет и анимации необязательны.']},
  'animated-character': {en:['Animated character','Animated character without a specific target platform.'],ru:['Анимированный персонаж','Персонаж с анимациями без привязки к платформе.']},
  'mechanical-asset': {en:['Mechanical asset','Technical asset; separate parts may be intentional.'],ru:['Механический объект','Техническая модель; раздельные детали могут быть намеренными.']},
  visualization: {en:['Visualization / render','High-detail visualization with more generous resource budgets.'],ru:['Визуализация / рендер','Детальная визуализация с более свободными бюджетами ресурсов.']},
};

export function DiagnosticProfilePanel({profileId,onChange,issues,disabled,onViewFit}:{profileId:DiagnosticProfileId;onChange:(id:DiagnosticProfileId)=>void;issues:HealthIssue[];disabled:boolean;onViewFit:()=>void}) {
  const {language}=useI18n(),ru=language==='ru';
  const text=(id:DiagnosticProfileId)=>copy[id][ru?'ru':'en'];
  const warnings=issues.filter(issue=>issue.layer==='Fitness'&&['WARNING','ERROR','UNKNOWN'].includes(issue.severity)).length;
  return <section aria-label={ru?'Профиль диагностики':'Diagnostic profile'} className="shrink-0 border-b border-[#343944] p-3 space-y-1.5">
    <label htmlFor="diagnostic-profile" className="block font-semibold">{ru?'Профиль диагностики':'Diagnostic profile'}</label>
    <select id="diagnostic-profile" value={profileId} onChange={event=>onChange(event.target.value as DiagnosticProfileId)} disabled={disabled}
      aria-describedby="diagnostic-profile-description" className="w-full min-w-0 cursor-pointer disabled:opacity-50">
      {(Object.keys(DIAGNOSTIC_PROFILES) as DiagnosticProfileId[]).map(id=><option key={id} value={id}>{text(id)[0]}</option>)}
    </select>
    <p className="text-cyan-300 break-words">{ru?'Активный профиль: ':'Active profile: '}{text(profileId)[0]}</p>
    <p id="diagnostic-profile-description" className="text-[11px] text-gray-400 leading-relaxed">{text(profileId)[1]} {ru?'Меняет оценку пригодности. Геометрия и технические результаты проверки сохраняются.':'Changes target-fit judgments. Geometry and technical findings stay unchanged.'}</p>
    <button onClick={onViewFit} disabled={disabled} className="text-cyan-300 underline cursor-pointer disabled:opacity-50">
      {ru?`Пригодность: замечаний ${warnings} · Показать`:`View profile fit · ${warnings} warning(s)`}
    </button>
  </section>;
}
