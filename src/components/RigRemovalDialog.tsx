import React,{useEffect,useRef} from 'react';
import {useI18n} from '../i18n';
import type {RemovalScope,RemovalSummary} from '../rig/RigRemoval';

/** Confirmation starts on Cancel. Opening, Escape and outside clicks never mutate the rig. */
export function RigRemovalDialog({name,scope,summary,onCancel,onConfirm}:{name:string;scope:RemovalScope;summary:RemovalSummary;onCancel:()=>void;onConfirm:()=>void}) {
  const {language}=useI18n(),label=(en:string,ru:string)=>language==='ru'?ru:en,ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const prior=document.activeElement as HTMLElement|null;
    ref.current?.querySelector<HTMLButtonElement>('[data-testid="rig-removal-cancel"]')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}
      if(event.key==='Tab'){
        const buttons=[...ref.current!.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();buttons[(index+(event.shiftKey?buttons.length-1:1))%buttons.length]?.focus();
      }
    };
    window.addEventListener('keydown',key,true);
    return()=>{window.removeEventListener('keydown',key,true);prior?.isConnected&&prior.focus();};
  },[onCancel]);
  return <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={event=>{if(event.target===event.currentTarget)onCancel();}}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="rig-removal-title" data-testid="rig-removal-dialog" className="w-full max-w-xl max-h-[85vh] overflow-auto rounded border border-red-400 bg-[#171d26] p-5 shadow-xl space-y-3 text-sm">
      <h2 id="rig-removal-title" className="text-red-200 font-semibold">{scope==='chain'?label('Delete joint and descendants?','Удалить сустав и всю цепочку?'):label('Delete this joint?','Удалить этот сустав?')}</h2>
      <p className="text-blue-200 break-words">{name}</p>
      <div className="grid grid-cols-2 gap-2 text-blue-200">
        <p>{label('Joints','Суставов')}: <strong data-testid="rig-removal-joints">{summary.removedJointCount}</strong></p>
        <p>{label('Affected vertices','Затронуто вершин')}: <strong data-testid="rig-removal-vertices">{summary.affectedVertices}</strong></p>
        <p>{label('Removed tracks','Удаляется дорожек')}: <strong data-testid="rig-removal-tracks">{summary.removedTrackCount}</strong></p>
        <p>{label('Static meshes','Статических мешей')}: <strong data-testid="rig-removal-static">{summary.staticMeshCount}</strong></p>
      </div>
      <div className="text-red-200 space-y-2">
        <p>{scope==='chain'?label('Descendant joints are also removed. Mesh geometry, including an extra finger, remains.','Дочерние суставы тоже удаляются. Геометрия модели, включая лишний палец, остаётся.'):label('Child joints and attachments remain.','Дочерние суставы и вложенные объекты остаются.')}</p>
        {summary.affectedVertices>0&&<p>{label('Where joints remain, weights transfer to the nearest surviving ancestor, or the first surviving joint in the skin. Shape and motion can change.','Если суставы остаются, веса переходят ближайшему оставшемуся родителю или первому суставу скелета. Форма и движение могут измениться.')}</p>}
        {summary.removedTrackCount>0&&<p>{label('Tracks on removed joints are deleted; empty clips disappear.','Дорожки удалённых суставов удаляются; пустые клипы исчезают.')}</p>}
        {summary.retainedTransformCount>0&&<p>{label('Static coordinate frames preserve children and attachments. These frames are not selectable joints.','Неподвижные узлы координат сохраняют детей и вложенные объекты. Они не являются суставами и не выбираются как кости.')}</p>}
        {summary.staticMeshCount>0&&<p>{label('Meshes without surviving joints become static in Rest Pose. Skeletal deformation and their movement tracks are removed; morph animation remains.','Меши без оставшихся суставов становятся статическими в Rest Pose. Деформация скелетом и их дорожки движения удаляются; morph-анимация сохраняется.')}</p>}
      </div>
      <p className="text-blue-200">{label('Undo / Ctrl+Z restores this operation. Verify the edited GLB before saving.','Undo / Ctrl+Z отменяет эту операцию. Перед сохранением проверьте изменённый GLB.')}</p>
      <div className="flex justify-end gap-2"><button data-testid="rig-removal-cancel" data-tone="danger" className="rounded px-3 py-2" onClick={onCancel}>{label('Cancel','Отмена')}</button><button data-testid="rig-removal-confirm" data-tone="danger" className="rounded px-3 py-2" onClick={onConfirm}>{label('Delete','Удалить')}</button></div>
    </div>
  </div>;
}
