import React,{useEffect,useState} from 'react';
import * as THREE from 'three';
import type { RigEditSession, RigMode } from '../rig/RigEditSession';
import type { RigGizmoSettings } from '../rig/RigGizmo';
import { useI18n } from '../i18n';
import type { RigExportResult } from '../rig/RigExportService';

interface Props {
  session:RigEditSession|null; selectedUuid:string|null; settings:RigGizmoSettings; busy:boolean; enabled:boolean; error:string|null; activeClipIndex:number;
  onMode:(mode:RigMode)=>void; onSettings:(settings:RigGizmoSettings)=>void; onAction:(action:(session:RigEditSession)=>void)=>void;
  exportResult:RigExportResult|null;onVerifyExport:()=>void;onSaveExport:()=>void;
  onPreview:(uuid:string,quaternion:number[])=>void;
}
export function RigEditorPanel({session,selectedUuid,settings,busy,enabled,error,activeClipIndex,onMode,onSettings,onAction,exportResult,onVerifyExport,onSaveExport,onPreview}:Props) {
  const {language}=useI18n(); const label=(en:string,ru:string)=>language==='ru'?ru:en;
  const bone=session?.root.getObjectByProperty('uuid',selectedUuid??'');
  const selected=bone instanceof THREE.Bone?bone:null;
  const children=selected?.children.filter((node):node is THREE.Bone=>node instanceof THREE.Bone)??[];
  const [position,setPosition]=useState(['0','0','0']),[rotation,setRotation]=useState(['0','0','0']),[length,setLength]=useState('1'),[duration,setDuration]=useState('1');
  useEffect(()=>{
    if(!selected) return;
    setPosition(selected.position.toArray().map(value=>String(Number(value.toFixed(6)))));
    const euler=new THREE.Euler().setFromQuaternion(selected.quaternion);
    setRotation([euler.x,euler.y,euler.z].map(value=>String(Number(THREE.MathUtils.radToDeg(value).toFixed(4)))));
    const child=children.find(node=>node.uuid===settings.endChildUuid)??children[0];
    setLength(String(Number((child?.position.length()??new THREE.Vector3().fromArray(session?.getTerminalTip(selected.uuid)??[0,.2,0]).length()).toFixed(6))));
  },[selectedUuid,session?.revision,session?.previewRevision,session?.mode,settings.endChildUuid]);
  useEffect(()=>setDuration(String(session?.clips[activeClipIndex]?.duration??1)),[session?.revision,activeClipIndex,session]);
  if(!session?.hasSkeleton) return null;
  const button='px-2 py-1 rounded border border-[#343944] bg-[#202329] text-gray-200 disabled:opacity-35 cursor-pointer text-[10px]';
  const input='w-full bg-[#111318] border border-[#343944] rounded px-1 py-1 text-gray-200';
  const update=(patch:Partial<RigGizmoSettings>)=>onSettings({...settings,...patch});
  const edit=session.mode==='edit',pose=session.mode==='pose';
  return <section data-testid="rig-editor" className="bg-[#1c1e24] border border-cyan-900 rounded p-2.5 space-y-2 text-[10px]">
    <h4 className="font-semibold text-cyan-300">{label('Skeleton Editor','Редактор скелета')}</h4>
    <fieldset disabled={busy || !enabled} className="space-y-2 disabled:opacity-60">
      <div className="flex gap-1">{(['inspect','edit','pose'] as RigMode[]).map(mode=><button key={mode} data-testid={`rig-mode-${mode}`} className={`${button} ${session.mode===mode?'!border-cyan-500 !text-cyan-300':''}`} onClick={()=>onMode(mode)}>{mode==='inspect'?label('Inspect','Просмотр'):mode==='edit'?label('Edit Skeleton','Редактировать'):label('Pose Preview','Проверить позу')}</button>)}</div>
      <p className="text-gray-400">{edit?label('Rest Pose • skinned base shape preserved. Rigid attachments follow their parent.','Rest Pose • базовая форма меша сохраняется. Жёсткие вложения следуют за родителем.'):pose?label('Temporary deformation preview. Returning to Edit restores authored rest.','Временная проверка деформации. Возврат в редактор восстановит Rest Pose.'):label('Select a joint in the viewport or hierarchy.','Выберите сустав мышью или в иерархии.')}</p>
      {(edit||pose) && <>
        <div className="grid grid-cols-2 gap-1">
          <label>{label('Tool','Инструмент')}<select aria-label="Rig tool" className={input} value={pose?'rotate':settings.tool} disabled={pose || settings.target==='end'} onChange={event=>update({tool:event.target.value as any})}><option value="translate">{label('Move','Переместить')}</option><option value="rotate">{label('Rotate','Повернуть')}</option></select></label>
          <label>{label('Coordinates','Координаты')}<select aria-label="Rig coordinates" className={input} value={settings.space} onChange={event=>update({space:event.target.value as any})}><option value="local">Local</option><option value="world">World</option></select></label>
        </div>
        {edit && <div className="grid grid-cols-2 gap-1">
          <label>{label('Handle','Точка')}<select aria-label="Rig handle" className={input} value={settings.target} onChange={event=>update({target:event.target.value as any})}><option value="joint">{label('Joint / start','Сустав / начало')}</option><option value="end">{label('End','Конец')}</option></select></label>
          <label>{label('Children','Дочерние кости')}<select aria-label="Rig children policy" className={input} value={settings.childPolicy} onChange={event=>update({childPolicy:event.target.value as any})}><option value="follow">{label('Follow chain','Перемещать цепочку')}</option><option value="hold">{label('Hold world position','Удержать положение')}</option></select></label>
        </div>}
        {selected && <>
          <div className="text-cyan-200 break-words">{selected.name||label('Unnamed joint','Без имени')}</div>
          {edit && <><label>{label('Local joint position','Локальная позиция сустава')}</label><div className="grid grid-cols-3 gap-1">{position.map((value,axis)=><input key={axis} aria-label={`Joint position ${'XYZ'[axis]}`} type="number" step="0.01" className={input} value={value} onChange={event=>setPosition(values=>values.map((v,i)=>i===axis?event.target.value:v))}/>)}</div><button className={button} onClick={()=>onAction(s=>s.commitJoint(selected.uuid,{position:position.map(Number)},settings.childPolicy))}>{label('Apply Position','Применить позицию')}</button></>}
          <label>{label('Local rotation, degrees','Локальный поворот, градусы')}</label><div className="grid grid-cols-3 gap-1">{rotation.map((value,axis)=><input key={axis} aria-label={`Joint rotation ${'XYZ'[axis]}`} type="number" step="1" className={input} value={value} onChange={event=>setRotation(values=>values.map((v,i)=>i===axis?event.target.value:v))}/>)}</div>
          <button className={button} onClick={()=>{const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(value=>THREE.MathUtils.degToRad(Number(value))) as [number,number,number]));if(pose)onPreview(selected.uuid,q.toArray());else onAction(s=>s.commitJoint(selected.uuid,{quaternion:q.toArray()},settings.childPolicy));}}>{pose?label('Preview Rotation','Проверить поворот'):label('Apply Rotation','Применить поворот')}</button>
          {edit && <>
            {children.length>0 && <select aria-label="End child joint" className={input} value={settings.endChildUuid??children[0].uuid} onChange={event=>update({endChildUuid:event.target.value})}>{children.map(child=><option key={child.uuid} value={child.uuid}>{child.name||label('Unnamed child','Без имени')}</option>)}</select>}
            <label>{children.length?label('Joint distance, local units','Расстояние суставов, локальные единицы'):label('Terminal guide length','Длина конечного ориентира')}<input aria-label="Bone length" type="number" step="0.01" min="0.000001" className={input} value={length} onChange={event=>setLength(event.target.value)}/></label>
            <button className={button} onClick={()=>onAction(s=>s.setBoneLength(selected.uuid,children.length?(settings.endChildUuid??children[0].uuid):null,Number(length),settings.childPolicy))}>{label('Apply Length','Применить длину')}</button>
            {!children.length && <p className="text-amber-300">{label('Leaf endpoint is a saved guide. It adds no joint and changes no skin weights.','Конечная точка сохраняется как ориентир. Она не добавляет сустав и не меняет веса.')}</p>}
          </>}
        </>}
      </>}
      {session.clips.length>0 && <div className="border-t border-[#343944] pt-2 space-y-1"><label>{label('Export duration (seconds)','Длительность для экспорта (секунды)')} — {session.clips[activeClipIndex]?.name}<input aria-label="Export clip duration" type="number" min="0.000001" step="0.1" className={input} value={duration} onChange={event=>setDuration(event.target.value)}/></label><button className={button} onClick={()=>onAction(s=>s.setClipDuration(activeClipIndex,Number(duration)))}>{label('Retime Selected Clip','Изменить длительность клипа')}</button><p className="text-gray-400">{label('Playback Speed below changes preview only.','Playback Speed внизу меняет только предпросмотр.')}</p></div>}
      <div className="flex gap-1"><button className={button} disabled={!session.canUndo} onClick={()=>onAction(s=>s.undo())}>Undo</button><button className={button} disabled={!session.canRedo} onClick={()=>onAction(s=>s.redo())}>Redo</button><button className={button} disabled={!session.hasEdits} onClick={()=>onAction(s=>s.reset())}>{label('Restore Original','Вернуть исходное')}</button></div>
      <div className="border-t border-[#343944] pt-2 space-y-1"><button className={button} disabled={!session.hasEdits} onClick={onVerifyExport}>{label('Verify Edited GLB','Проверить изменённый GLB')}</button>{exportResult?.verification.status==='VERIFIED'&&<button className={button} onClick={onSaveExport}>{label('Save Edited GLB','Сохранить изменённый GLB')}</button>}
      {exportResult&&<p data-testid="rig-export-status" className={exportResult.verification.status==='VERIFIED'?'text-green-300':'text-amber-300'}>{exportResult.verification.status} · {exportResult.verification.clipCount} {label('clips','клипов')} · {exportResult.verification.sampledVertices.toLocaleString()} {label('vertex samples','проверок вершин')}</p>}</div>
    </fieldset>
    {!enabled && <p className="text-amber-300">{label('Persistent rig editing requires an imported self-contained GLB.','Для сохраняемого редактирования откройте самодостаточный GLB.')}</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </section>;
}
