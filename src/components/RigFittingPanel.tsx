import React from 'react';
import {useI18n} from '../i18n';
import type {FittingReview} from '../rig/RigFittingService';
import type {FitStatus} from '../rig/RigFitting';

export function RigFittingPanel({review,selected,activeUuid,busy,blocked,edit,error,onAnalyze,onCancel,onToggle,onPick,onApply}:{review:FittingReview|null;selected:Set<string>;activeUuid:string|null;busy:boolean;blocked:boolean;edit:boolean;error:string|null;onAnalyze:()=>void;onCancel:()=>void;onToggle:(uuid:string,checked:boolean)=>void;onPick:(uuid:string)=>void;onApply:()=>void}) {
 const {language}=useI18n(),label=(en:string,ru:string)=>language==='ru'?ru:en;
 const status:Record<FitStatus,string>={suggested:label('Suggested','Предложение'),aligned:label('Near section centre','У центра участка'),insufficient:label('Too little weighted surface','Мало поверхности с весами'),'axis-missing':label('Ambiguous bone direction','Неоднозначное направление'),'outside':label('Outside local section','Вне локального участка'),uncertain:label('Manual correction required','Требуется ручная коррекция')};
 const reasons={branch:label('Branching joint: no unique section axis','Разветвление: нет единственной оси участка'),coverage:label('Surface does not sufficiently surround the joint','Поверхность недостаточно окружает сустав'),'large-shift':label('Shift exceeds 35% of bone length','Смещение превышает 35% длины кости'),'unstable-section':label('Neighbouring sections disagree','Соседние участки дают разные центры')};
 const button='rounded px-2 py-1.5 border text-xs';
 return <section data-testid="rig-fitting" className="rounded border border-blue-700 bg-[#1c1e24] p-2 space-y-2 text-xs">
  <h4 className="font-semibold text-blue-200">{label('Rig Fitting · Local Sections','Подгонка скелета · Локальные участки')}</h4>
  <p className="text-blue-200">{label('Uses weighted surface area and checks neighbouring sections. Large or unsupported shifts require manual correction. Blue markers are proposals; the model changes only when you Apply.','Учитывает площадь поверхности с весами и проверяет соседние участки. Большие или недостаточно обоснованные смещения требуют ручной коррекции. Синие маркеры — предложения; модель меняется только после применения.')}</p>
  <div className="flex gap-1 flex-wrap"><button data-testid="fit-analyze" data-tone="info" className={button} disabled={blocked||busy||!edit} onClick={onAnalyze}>{busy?label('Analyzing…','Анализ…'):label('Analyze Rig','Найти предложения')}</button>{(busy||review)&&<button data-testid="fit-cancel" data-tone="danger" className={button} onClick={onCancel}>{busy?label('Cancel Analysis','Отменить анализ'):label('Discard Proposals','Отбросить предложения')}</button>}</div>
  {!edit&&<p className="text-blue-200">{label('Enter Edit Skeleton to start.','Для начала перейдите в «Редактировать».')}</p>}
  {review&&<>
   <p data-testid="fit-summary" className="text-blue-200">{label('Proposals','Предложений')}: {review.proposals.filter(p=>p.status==='suggested').length} · {label('Vertices analyzed','Проверено вершин')}: {review.vertices.toLocaleString()}</p>
   <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1" role="group" aria-label="Fitting proposals">{review.proposals.map(proposal=><div key={proposal.uuid} data-testid={`fit-row-${proposal.uuid}`} className={`rounded border p-1.5 ${proposal.uuid===activeUuid?'border-blue-300':'border-[#343944]'}`}>
    <div className="flex gap-2 items-start"><input type="checkbox" aria-label={`Fit ${proposal.name||proposal.uuid}`} className="accent-green-300 mt-1" disabled={blocked||!edit||proposal.status!=='suggested'} checked={selected.has(proposal.uuid)} onChange={event=>onToggle(proposal.uuid,event.target.checked)}/><button data-tone="info" className="min-w-0 break-all text-left rounded px-1" onClick={()=>onPick(proposal.uuid)}>{proposal.name||label('Unnamed joint','Без имени')}</button></div>
    <p className="text-blue-200">{status[proposal.status]} · {label('Section vertices','Вершин участка')}: {proposal.support}</p>
    {proposal.reason&&<p className="text-red-200">{reasons[proposal.reason]}</p>}
    {proposal.status==='suggested'&&<><p className="font-mono text-blue-200">{label('Offset','Смещение')}: {Number(proposal.offset.toPrecision(3))} · {label('Document XYZ','XYZ модели')} [{proposal.target.map(value=>Number(value.toPrecision(4))).join(', ')}]</p>{proposal.offset>proposal.length*.5&&<p className="text-red-200">{label('Large shift: inspect this proposal carefully.','Большое смещение: внимательно проверьте предложение.')}</p>}</>}
   </div>)}</div>
   <p className="text-blue-200">{label('Unselected joints stay in place. Weights and skinned Rest shape are preserved. Rotating animation may change around the new pivots; rigid attachments follow their parent. After Apply, use the existing gizmo to correct and verify the GLB.','Невыбранные суставы остаются на месте. Веса и Rest-форма skinned-меша сохраняются. Вращательная анимация может измениться из-за новых центров; жёсткие вложения следуют за родителем. После применения уточните результат Gizmo и проверьте GLB.')}</p>
   <button data-testid="fit-apply" data-tone="edit" className={button} disabled={blocked||!edit||!selected.size} onClick={onApply}>{label('Apply Selected','Применить выбранные')} ({selected.size})</button>
  </>}
  {error&&<p role="alert" className="text-red-200">{error}</p>}
 </section>;
}
