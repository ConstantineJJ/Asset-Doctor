import React,{useEffect,useState} from 'react';
import * as THREE from 'three';
import type { RigEditSession, RigMode } from '../rig/RigEditSession';
import type { RigGizmoSettings } from '../rig/RigGizmo';
import { useI18n } from '../i18n';
import type { RigExportResult } from '../rig/RigExportService';

interface Props {
  variant?:'tools'|'clips';
  onAddJoint:()=>void;onDeleteJoint:()=>void;deleteReason:string|null;
  session:RigEditSession|null; selectedUuid:string|null; settings:RigGizmoSettings; busy:boolean; enabled:boolean; error:string|null; activeClipIndex:number;
  onMode:(mode:RigMode)=>void; onSettings:(settings:RigGizmoSettings)=>void; onAction:(action:(session:RigEditSession)=>void)=>void;
  exportResult:RigExportResult|null;onVerifyExport:()=>void;onSaveExport:()=>void;
  onPreview:(uuid:string,quaternion:number[])=>void;
  onUndo:()=>void;
}
export function RigEditorPanel({variant='clips',onAddJoint,onDeleteJoint,deleteReason,session,selectedUuid,settings,busy,enabled,error,activeClipIndex,onMode,onSettings,onAction,exportResult,onVerifyExport,onSaveExport,onPreview,onUndo}:Props) {
  const {language}=useI18n(); const label=(en:string,ru:string)=>language==='ru'?ru:en;
  const bone=session?.root.getObjectByProperty('uuid',selectedUuid??'');
  const selected=bone instanceof THREE.Bone?bone:null;
  const children=selected?.children.filter((node):node is THREE.Bone=>node instanceof THREE.Bone)??[];
  const [position,setPosition]=useState(['0','0','0']),[rotation,setRotation]=useState(['0','0','0']),[length,setLength]=useState('1'),[duration,setDuration]=useState('1'),[clipName,setClipName]=useState('');
  useEffect(()=>{
    if(!selected) return;
    setPosition(selected.position.toArray().map(value=>String(Number(value.toFixed(6)))));
    const euler=new THREE.Euler().setFromQuaternion(selected.quaternion);
    setRotation([euler.x,euler.y,euler.z].map(value=>String(Number(THREE.MathUtils.radToDeg(value).toFixed(4)))));
    const child=children.find(node=>node.uuid===settings.endChildUuid)??children[0];
    setLength(String(Number((child?.position.length()??new THREE.Vector3().fromArray(session?.getTerminalTip(selected.uuid)??[0,.2,0]).length()).toFixed(6))));
  },[selectedUuid,session?.revision,session?.previewRevision,session?.mode,settings.endChildUuid]);
  useEffect(()=>{setDuration(String(Number((session?.clips[activeClipIndex]?.duration??1).toFixed(6))));setClipName(session?.clips[activeClipIndex]?.name??'');},[session?.revision,activeClipIndex,session]);
  if(!session || (!session.hasSkeleton&&!session.clips.length)) return null;
  const button='px-2 py-1.5 rounded border cursor-pointer text-xs';
  const input='w-full bg-[#111318] border border-[#343944] rounded px-1 py-1 text-gray-200';
  const update=(patch:Partial<RigGizmoSettings>)=>onSettings({...settings,...patch,...(patch.tool==='twist'?{target:'joint' as const}:{})});
  const edit=session.mode==='edit',pose=session.mode==='pose';
  if(variant==='tools'&&!session.hasSkeleton)return null;
  return <section data-testid={variant==='tools'?'rig-toolbar':'rig-editor'} className="bg-[#1c1e24]/95 border border-blue-700 rounded p-2 space-y-2 text-xs">
    {variant==='clips'&&<h4 className="font-semibold text-blue-200">{label('Animations & GLB','Анимации и GLB')}</h4>}
    <fieldset disabled={busy || !enabled} className="space-y-2 disabled:opacity-60">
      {variant==='tools'&&<>
      {session.hasSkeleton&&<div className="flex gap-1 overflow-x-auto custom-scrollbar whitespace-nowrap">{(['inspect','edit','pose'] as RigMode[]).map(mode=><button key={mode} data-tone={mode==='edit'?'edit':'info'} data-testid={`rig-mode-${mode}`} aria-pressed={session.mode===mode} className={button} onClick={()=>onMode(mode)}>{mode==='inspect'?label('Inspect','Просмотр'):mode==='edit'?label('Edit Skeleton','Редактировать'):label('Pose Preview','Проверить позу')}</button>)}</div>}
      {(edit||pose) && <>
        <div role="group" aria-label="Rig tools" className="flex gap-1 overflow-x-auto custom-scrollbar whitespace-nowrap">{(['select','translate','rotate','twist'] as const).map((tool,index)=><button key={tool} data-testid={`rig-tool-${tool}`} data-tone={tool==='select'?'info':pose?'other':'edit'} aria-pressed={(pose&&settings.tool==='translate'?'rotate':settings.tool)===tool} disabled={tool==='translate'&&pose||tool==='rotate'&&edit&&settings.target==='end'} className={button} onClick={()=>update({tool})}>{[label('Select','Выбор'),label('Move','Перемещение'),label('Rotate XYZ','Поворот XYZ'),label('Bone Axis','Ось кости')][index]}</button>)}</div>
        <div className="flex flex-wrap gap-2 items-end">
          <label>{label('Coordinates','Координаты')}<select aria-label="Rig coordinates" className={input} value={settings.tool==='twist'?'local':settings.space} disabled={settings.tool==='twist'||settings.tool==='select'} onChange={event=>update({space:event.target.value as 'local'|'world'})}><option value="local">{label('Local','Локальные')}</option><option value="world">{label('World','Мировые')}</option></select></label>
        {edit && <>
          <label>{label('Handle','Точка')}<select aria-label="Rig handle" className={input} value={settings.target} disabled={settings.tool==='twist'} onChange={event=>update({target:event.target.value as any,...(event.target.value==='end'&&settings.tool==='rotate'?{tool:'translate' as const}:{})})}><option value="joint">{label('Joint / start','Сустав / начало')}</option><option value="end">{label('End','Конец')}</option></select></label>
          <label>{label('Children','Дочерние кости')}<select aria-label="Rig children policy" className={input} value={settings.childPolicy} onChange={event=>update({childPolicy:event.target.value as any})}><option value="follow">{label('Follow chain','Перемещать цепочку')}</option><option value="hold">{label('Hold world position','Удержать положение')}</option></select></label>
        </>}
        </div>
        {edit&&<div className="flex flex-wrap items-center gap-1"><button data-tone="edit" className={button} disabled={!selected} onClick={onAddJoint}>{label('Add Joint','Добавить сустав')}</button><button data-tone="danger" className={button} disabled={!selected||Boolean(deleteReason)} title={deleteReason??label('Delete unweighted, unanimated leaf','Удалить конечный сустав без весов и анимации')} onClick={onDeleteJoint}>{label('Delete Joint','Удалить сустав')}</button>{selected&&deleteReason&&<span data-testid="joint-delete-reason" className="text-red-200 text-[10px] max-w-sm">{deleteReason}</span>}</div>}
        {selected && <details className="max-h-56 overflow-y-auto custom-scrollbar"><summary className="cursor-pointer text-blue-200">{selected.name||label('Unnamed joint','Без имени')} · {label('Coordinates & length','Координаты и длина')}</summary><div className="space-y-2 pt-2">
          {edit && <><label>{label('Local joint position','Локальная позиция сустава')}</label><div className="grid grid-cols-3 gap-1">{position.map((value,axis)=><input key={axis} aria-label={`Joint position ${'XYZ'[axis]}`} type="number" step="0.01" className={input} value={value} onChange={event=>setPosition(values=>values.map((v,i)=>i===axis?event.target.value:v))}/>)}</div><button data-tone="edit" className={button} onClick={()=>onAction(s=>s.commitJoint(selected.uuid,{position:position.map(Number)},settings.childPolicy))}>{label('Apply Position','Применить позицию')}</button></>}
          <label>{label('Local rotation, degrees','Локальный поворот, градусы')}</label><div className="grid grid-cols-3 gap-1">{rotation.map((value,axis)=><input key={axis} aria-label={`Joint rotation ${'XYZ'[axis]}`} type="number" step="1" className={input} value={value} onChange={event=>setRotation(values=>values.map((v,i)=>i===axis?event.target.value:v))}/>)}</div>
          <button data-tone={pose?'other':'edit'} className={button} onClick={()=>{const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(value=>THREE.MathUtils.degToRad(Number(value))) as [number,number,number]));if(pose)onPreview(selected.uuid,q.toArray());else onAction(s=>s.commitJoint(selected.uuid,{quaternion:q.toArray()},settings.childPolicy));}}>{pose?label('Preview Rotation','Проверить поворот'):label('Apply Rotation','Применить поворот')}</button>
            {children.length>0&&(edit||settings.tool==='twist') && <label>{label('Child branch / bone axis','Дочерняя ветвь / ось кости')}<select aria-label="End child joint" className={input} value={settings.endChildUuid??children[0].uuid} onChange={event=>update({endChildUuid:event.target.value})}>{children.map(child=><option key={child.uuid} value={child.uuid}>{child.name||label('Unnamed child','Без имени')}</option>)}</select></label>}
          {edit && <>

            <label>{children.length?label('Joint distance, local units','Расстояние суставов, локальные единицы'):label('Terminal guide length','Длина конечного ориентира')}<input aria-label="Bone length" type="number" step="0.01" min="0.000001" className={input} value={length} onChange={event=>setLength(event.target.value)}/></label>
            <button data-tone="edit" className={button} onClick={()=>onAction(s=>s.setBoneLength(selected.uuid,children.length?(settings.endChildUuid??children[0].uuid):null,Number(length),settings.childPolicy))}>{label('Apply Length','Применить длину')}</button>
            {!children.length && <p className="text-blue-200">{label('Leaf endpoint is a saved guide. It adds no joint and changes no skin weights.','Конечная точка сохраняется как ориентир. Она не добавляет сустав и не меняет веса.')}</p>}
          </>}
        </div></details>}
      </>}
      {session.mode==='inspect'&&<p className="text-blue-200">{label('Select a joint; Edit enables the four tools.','Выберите сустав; в режиме «Редактировать» доступны четыре инструмента.')}</p>}
      </>}
      {variant==='clips'&&session.clips.length>0 && <div className="space-y-2"><label>{label('Selected clip name','Имя выбранной анимации')}<input aria-label="Animation clip name" maxLength={256} className={input} value={clipName} onChange={event=>setClipName(event.target.value)}/></label><button data-tone="edit" className={button} disabled={!clipName.trim()||clipName.trim()===session.clips[activeClipIndex]?.name} onClick={()=>onAction(s=>s.renameClip(activeClipIndex,clipName))}>{label('Rename Clip','Переименовать клип')}</button><label className="block">{label('Export duration (seconds)','Длительность для экспорта (секунды)')}<input aria-label="Export clip duration" type="number" min="0.000001" step="0.1" className={input} value={duration} onChange={event=>setDuration(event.target.value)}/></label><button data-tone="edit" className={button} onClick={()=>onAction(s=>s.setClipDuration(activeClipIndex,Number(duration)))}>{label('Retime Selected Clip','Изменить длительность клипа')}</button><p className="text-blue-200">{label('Select a clip in the list below. Playback Speed changes preview only; duration and name are saved in GLB.','Выберите клип в списке ниже. Скорость внизу меняет просмотр; длительность и имя сохраняются в GLB.')}</p></div>}
      {variant==='clips'&&<>
      <div className="flex flex-wrap gap-1"><button data-tone="danger" className={button} title="Ctrl+Z" aria-keyshortcuts="Control+Z" disabled={!session.canUndo} onClick={onUndo}>Undo</button><button data-tone="edit" className={button} disabled={!session.canRedo} onClick={()=>onAction(s=>s.redo())}>Redo</button><button data-tone="danger" className={button} disabled={!session.hasEdits} onClick={()=>onAction(s=>s.reset())}>{label('Restore Original','Вернуть исходное')}</button></div>
      <div className="border-t border-[#343944] pt-2 space-y-1"><button className={button} disabled={!session.hasEdits} onClick={onVerifyExport}>{label('Verify Edited GLB','Проверить изменённый GLB')}</button>{exportResult?.verification.status==='VERIFIED'&&<button data-tone="edit" className={button} onClick={onSaveExport}>{label('Save Edited GLB','Сохранить изменённый GLB')}</button>}
      {exportResult&&<p data-testid="rig-export-status" className={exportResult.verification.status==='VERIFIED'?'text-green-300':'text-amber-300'}>{exportResult.verification.status} · {exportResult.verification.clipCount} {label('clips','клипов')} · {exportResult.verification.sampledVertices.toLocaleString()} {label('vertex samples','проверок вершин')}</p>}</div>
      </>}
    </fieldset>
    {!enabled && <p className="text-amber-300">{label('Persistent rig editing requires an imported self-contained GLB.','Для сохраняемого редактирования откройте самодостаточный GLB.')}</p>}
    {error&&(variant==='tools'||!session.hasSkeleton)&&<p role="alert" className="text-red-200">{error}</p>}
  </section>;
}
