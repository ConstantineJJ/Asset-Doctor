import React,{useEffect,useRef} from 'react';
import {useI18n} from '../i18n';

export function RigJointMenu({joint,reason,busy,onAdd,onDelete,onClose}:{joint:{uuid:string;x:number;y:number;name:string};reason:string|null;busy:boolean;onAdd:()=>void;onDelete:()=>void;onClose:()=>void}) {
  const ref=useRef<HTMLDivElement>(null),{language}=useI18n(),label=(en:string,ru:string)=>language==='ru'?ru:en;
  useEffect(()=>{
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))onClose();};
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault();const buttons=[...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();
      }
    };
    window.addEventListener('pointerdown',close,true);window.addEventListener('keydown',key);window.addEventListener('resize',onClose);window.addEventListener('blur',onClose);
    return()=>{window.removeEventListener('pointerdown',close,true);window.removeEventListener('keydown',key);window.removeEventListener('resize',onClose);window.removeEventListener('blur',onClose);};
  },[onClose]);
  return <div ref={ref} role="menu" aria-label="Joint actions" className="fixed z-[100] w-72 max-h-[80vh] overflow-auto rounded border border-blue-400 bg-[#171d26] p-2 shadow-xl text-xs space-y-2" style={{left:Math.max(8,Math.min(joint.x,window.innerWidth-296)),top:Math.max(8,Math.min(joint.y,window.innerHeight-220))}}>
    <p className="text-blue-200 break-words">{joint.name||label('Joint','Сустав')}</p>
    <button role="menuitem" data-tone="edit" disabled={busy} className="w-full rounded p-2 text-left" onClick={onAdd}>{label('Add child joint','Добавить дочерний сустав')}</button>
    <button role="menuitem" data-tone="danger" disabled={busy||Boolean(reason)} className="w-full rounded p-2 text-left" onClick={onDelete}>{label('Delete joint','Удалить сустав')}</button>
    {reason&&<p data-testid="joint-menu-reason" className="text-red-200">{reason}</p>}
    <p className="text-blue-200">{label('New joints have no skin weights. Drag with RMB still pans the camera.','Новый сустав создаётся без весов. Перетаскивание ПКМ по-прежнему перемещает камеру.')}</p>
  </div>;
}
