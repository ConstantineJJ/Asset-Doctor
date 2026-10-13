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
  onUndo:()=>void;
}
export function RigEditorPanel({session,selectedUuid,settings,busy,enabled,error,activeClipIndex,onMode,onSettings,onAction,exportResult,onVerifyExport,onSaveExport,onPreview,onUndo}:Props) {
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
  return <section data-testid="rig-editor" className="bg-[#1c1e24] border border-green-700 rounded p-3 space-y-2 text-xs">
    <h4 className="font-semibold text-green-200">{session.hasSkeleton?label('Skeleton Editor','Редактор скелета'):label('Animation Editor','Анимации')}</h4>
    <fieldset disabled={busy || !enabled} className="space-y-2 disabled:opacity-60">
      {session.hasSkeleton&&<div className="flex flex-wrap gap-1">{(['inspect','edit','pose'] as RigMode[]).map(mode=><button key={mode} data-testid={`rig-mode-${mode}`} aria-pressed={session.mode===mode} className={button} onClick={()=>onMode(mode)}>{mode==='inspect'?label('Inspect','Просмотр'):mode==='edit'?label('Edit Skeleton','Редактировать'):label('Pose Preview','Проверить позу')}</button>)}</div>}
      <p className="text-gray-400">{edit?label('Rest Pose • skinned base shape preserved. Rigid attachments follow their parent.','Rest Pose • базовая форма меша сохраняется. Жёсткие вложения следуют за родителем.'):pose?label('Temporary deformation preview. Returning to Edit restores authored rest.','Временная проверка деформации. Возврат в редактор восстановит Rest Pose.'):label('Select a joint in the viewport or hierarchy.','Выберите сустав мышью или в иерархии.')}</p>
      {(edit||pose) && <>
        <div className="grid grid-cols-2 gap-1">
          <label>{label('Tool','Инструмент')}<select aria-label="Rig tool" className={input} value={pose&&settings.tool==='translate'?'rotate':settings.tool} onChange={event=>update({tool:event.target.value as RigGizmoSettings['tool']})}><option value="select">{label('Select joints','Выбрать сустав')}</option><option value="translate" disabled={pose}>{label('Move','Переместить')}</option><option value="rotate" disabled={edit&&settings.target==='end'}>{label('Rotate XYZ','Повернуть XYZ')}</option><option value="twist">{label('Twist bone axis','Вокруг оси кости')}</option></select></label>
          <label>{label('Coordinates','Координаты')}<select aria-label="Rig coordinates" className={input} value={settings.tool==='twist'?'local':settings.space} disabled={settings.tool==='twist'||settings.tool==='select'} onChange={event=>update({space:event.target.value as 'local'|'world'})}><option value="local">{label('Local','Локальные')}</option><option value="world">{label('World','Мировые')}</option></select></label>
        </div>
        <p className="text-gray-300">{settings.tool==='select'?label('Handles are hidden so they cannot intercept joint clicks.','Манипулятор скрыт и не мешает выбирать суставы.'):settings.tool==='twist'?label('Drag the green ring around the bone axis. Choose the child branch below; leaves use their terminal guide.','Тяните зелёное кольцо вокруг оси кости. Выберите дочернюю ветвь ниже; конечные кости используют ориентир.'):label('Click another visible joint to select it; drag a colored handle to edit.','Нажмите на другой сустав для выбора; тяните цветную рукоятку для изменения.')}</p>
        {edit && <div className="grid grid-cols-2 gap-1">
          <label>{label('Handle','Точка')}<select aria-label="Rig handle" className={input} value={settings.target} disabled={settings.tool==='twist'} onChange={event=>update({target:event.target.value as any,...(event.target.value==='end'&&settings.tool==='rotate'?{tool:'translate' as const}:{})})}><option value="joint">{label('Joint / start','Сустав / начало')}</option><option value="end">{label('End','Конец')}</option></select></label>
          <label>{label('Children','Дочерние кости')}<select aria-label="Rig children policy" className={input} value={settings.childPolicy} onChange={event=>update({childPolicy:event.target.value as any})}><option value="follow">{label('Follow chain','Перемещать цепочку')}</option><option value="hold">{label('Hold world position','Удержать положение')}</option></select></label>
        </div>}
        {selected && <>
          <div className="text-cyan-200 break-words">{selected.name||label('Unnamed joint','Без имени')}</div>
          {edit && <><label>{label('Local joint position','Локальная позиция сустава')}</label><div className="grid grid-cols-3 gap-1">{position.map((value,axis)=><input key={axis} aria-label={`Joint position ${'XYZ'[axis]}`} type="number" step="0.01" className={input} value={value} onChange={event=>setPosition(values=>values.map((v,i)=>i===axis?event.target.value:v))}/>)}</div><button className={button} onClick={()=>onAction(s=>s.commitJoint(selected.uuid,{position:position.map(Number)},settings.childPolicy))}>{label('Apply Position','Применить позицию')}</button></>}
          <label>{label('Local rotation, degrees','Локальный поворот, градусы')}</label><div className="grid grid-cols-3 gap-1">{rotation.map((value,axis)=><input key={axis} aria-label={`Joint rotation ${'XYZ'[axis]}`} type="number" step="1" className={input} value={value} onChange={event=>setRotation(values=>values.map((v,i)=>i===axis?event.target.value:v))}/>)}</div>
          <button className={button} onClick={()=>{const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(value=>THREE.MathUtils.degToRad(Number(value))) as [number,number,number]));if(pose)onPreview(selected.uuid,q.toArray());else onAction(s=>s.commitJoint(selected.uuid,{quaternion:q.toArray()},settings.childPolicy));}}>{pose?label('Preview Rotation','Проверить поворот'):label('Apply Rotation','Применить поворот')}</button>
            {children.length>0&&(edit||settings.tool==='twist') && <label>{label('Child branch / bone axis','Дочерняя ветвь / ось кости')}<select aria-label="End child joint" className={input} value={settings.endChildUuid??children[0].uuid} onChange={event=>update({endChildUuid:event.target.value})}>{children.map(child=><option key={child.uuid} value={child.uuid}>{child.name||label('Unnamed child','Без имени')}</option>)}</select></label>}
          {edit && <>

            <label>{children.length?label('Joint distance, local units','Расстояние суставов, локальные единицы'):label('Terminal guide length','Длина конечного ориентира')}<input aria-label="Bone length" type="number" step="0.01" min="0.000001" className={input} value={length} onChange={event=>setLength(event.target.value)}/></label>
            <button className={button} onClick={()=>onAction(s=>s.setBoneLength(selected.uuid,children.length?(settings.endChildUuid??children[0].uuid):null,Number(length),settings.childPolicy))}>{label('Apply Length','Применить длину')}</button>
            {!children.length && <p className="text-amber-300">{label('Leaf endpoint is a saved guide. It adds no joint and changes no skin weights.','Конечная точка сохраняется как ориентир. Она не добавляет сустав и не меняет веса.')}</p>}
          </>}
        </>}
      </>}
      {session.clips.length>0 && <div className="border-t border-[#343944] pt-2 space-y-2"><label>{label('Selected clip name','Имя выбранной анимации')}<input aria-label="Animation clip name" maxLength={256} className={input} value={clipName} onChange={event=>setClipName(event.target.value)}/></label><button className={button} disabled={!clipName.trim()||clipName.trim()===session.clips[activeClipIndex]?.name} onClick={()=>onAction(s=>s.renameClip(activeClipIndex,clipName))}>{label('Rename Clip','Переименовать клип')}</button><label className="block">{label('Export duration (seconds)','Длительность для экспорта (секунды)')}<input aria-label="Export clip duration" type="number" min="0.000001" step="0.1" className={input} value={duration} onChange={event=>setDuration(event.target.value)}/></label><button className={button} onClick={()=>onAction(s=>s.setClipDuration(activeClipIndex,Number(duration)))}>{label('Retime Selected Clip','Изменить длительность клипа')}</button><p className="text-gray-300">{label('Select a clip in the list below. Playback Speed changes preview only; duration and name are saved in GLB.','Выберите клип в списке ниже. Скорость внизу меняет просмотр; длительность и имя сохраняются в GLB.')}</p></div>}
      <div className="flex flex-wrap gap-1"><button className={button} title="Ctrl+Z" aria-keyshortcuts="Control+Z" disabled={!session.canUndo} onClick={onUndo}>Undo</button><button className={button} disabled={!session.canRedo} onClick={()=>onAction(s=>s.redo())}>Redo</button><button data-tone="danger" className={button} disabled={!session.hasEdits} onClick={()=>onAction(s=>s.reset())}>{label('Restore Original','Вернуть исходное')}</button></div>
      <div className="border-t border-[#343944] pt-2 space-y-1"><button className={button} disabled={!session.hasEdits} onClick={onVerifyExport}>{label('Verify Edited GLB','Проверить изменённый GLB')}</button>{exportResult?.verification.status==='VERIFIED'&&<button className={button} onClick={onSaveExport}>{label('Save Edited GLB','Сохранить изменённый GLB')}</button>}
      {exportResult&&<p data-testid="rig-export-status" className={exportResult.verification.status==='VERIFIED'?'text-green-300':'text-amber-300'}>{exportResult.verification.status} · {exportResult.verification.clipCount} {label('clips','клипов')} · {exportResult.verification.sampledVertices.toLocaleString()} {label('vertex samples','проверок вершин')}</p>}</div>
    </fieldset>
    {!enabled && <p className="text-amber-300">{label('Persistent rig editing requires an imported self-contained GLB.','Для сохраняемого редактирования откройте самодостаточный GLB.')}</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </section>;
}
