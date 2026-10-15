import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {LogOut, Menu, Settings, X} from 'lucide-react';
import {useI18n} from '../i18n';
import {isDesktop, requestDesktopClose} from '../platform/FileIO';

type Helper='grid'|'axes'|'bbox'|'skeleton'|'origin';
interface Props {
  toggles:Record<Helper,boolean>;
  onToggleHelper:(helper:Helper)=>void;
}

export function ApplicationMenu({toggles,onToggleHelper}:Props){
  const {language,setLanguage}=useI18n();
  const ru=language==='ru';
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useRef<HTMLDivElement>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false);
  const [settings,setSettings]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [position,setPosition]=useState({left:8,top:48});
  const restoreFocus=()=>trigger.current?.focus();

  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const rect=trigger.current?.getBoundingClientRect();if(rect)setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-248)),top:rect.bottom+6});};
    place();popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  useEffect(()=>{if(settings)dialog.current?.showModal();},[settings]);

  const menuKeys=(event:React.KeyboardEvent)=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();setOpen(false);restoreFocus();return;}
    const items=Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);
    const index=items.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index-1+items.length)%items.length:undefined;
    if(next!==undefined){event.preventDefault();items[next]?.focus();}
    if(event.key==='Tab')setOpen(false);
  };
  const exit=async()=>{
    setBusy(true);setError('');
    try{await requestDesktopClose();setOpen(false);restoreFocus();}
    catch(cause){setError(String(cause));}
    finally{setBusy(false);}
  };
  const helperLabels:Record<Helper,string>={
    skeleton:ru?'Скелет в Doctor и Compare':'Skeleton in Doctor and Compare',
    grid:ru?'Сетка в Doctor':'Grid in Doctor',axes:ru?'Оси в Doctor':'Axes in Doctor',
    bbox:ru?'Границы модели в Doctor':'Bounding box in Doctor',origin:ru?'Начало координат в Doctor':'Origin in Doctor',
  };
  return <>
    <button ref={trigger} type="button" aria-label={ru?'Меню приложения':'Application menu'} title={ru?'Меню приложения':'Application menu'} aria-haspopup="menu" aria-expanded={open}
      onClick={()=>{setError('');setOpen(value=>!value);}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}
      className="p-1.5 rounded border border-[#687787] bg-[#252830] text-cyan-300 cursor-pointer"><Menu className="w-4 h-4"/></button>
    {open&&createPortal(<div ref={popup} role="menu" aria-label={ru?'Меню приложения':'Application menu'} onKeyDown={menuKeys} style={position}
      className="asset-doctor-ui fixed z-[130] w-60 rounded border border-[#687787] bg-[#252830] text-gray-100 shadow-xl p-1">
      <button role="menuitem" className="flex items-center gap-2 w-full p-2 rounded hover:bg-[#384552] focus:bg-[#384552]" onClick={()=>{setOpen(false);setSettings(true);}}><Settings className="w-4 h-4"/>{ru?'Настройки':'Settings'}</button>
      <button role="menuitem" disabled={!isDesktop()||busy} title={!isDesktop()?(ru?'Выход доступен в приложении для Windows':'Exit is available in the Windows application'):undefined}
        className="flex items-center gap-2 w-full p-2 rounded text-red-300 hover:bg-[#50323a] focus:bg-[#50323a] disabled:opacity-50" onClick={()=>void exit()}><LogOut className="w-4 h-4"/>{ru?'Выйти':'Exit'}</button>
      {error&&<p role="alert" className="p-2 text-red-300 break-words">{ru?'Не удалось закрыть приложение: ':'Could not close application: '}{error}</p>}
    </div>,document.body)}
    {settings&&createPortal(<dialog ref={dialog} aria-label={ru?'Настройки':'Settings'} onClose={()=>{setSettings(false);restoreFocus();}} onKeyDown={event=>event.stopPropagation()}
      className="asset-doctor-ui m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-[#687787] bg-[#252830] text-gray-100 p-5 shadow-xl backdrop:bg-black/60">
      <div className="flex items-center justify-between mb-4"><h2 className="font-semibold">{ru?'Настройки':'Settings'}</h2><button aria-label={ru?'Закрыть настройки':'Close settings'} onClick={()=>dialog.current?.close()} className="p-1 rounded hover:bg-[#384552]"><X className="w-5 h-5"/></button></div>
      <label className="flex items-center justify-between gap-4 mb-4">{ru?'Язык интерфейса':'Interface language'}<select value={language} onChange={event=>setLanguage(event.target.value as 'en'|'ru')} className="rounded border border-[#687787] bg-[#252830] px-2 py-1"><option value="en">English</option><option value="ru">Русский</option></select></label>
      <div className="space-y-3">{(['skeleton','grid','axes','bbox','origin'] as Helper[]).map(helper=><label key={helper} className="flex items-center gap-3"><input type="checkbox" checked={toggles[helper]} onChange={()=>onToggleHelper(helper)} className="accent-cyan-400 w-4 h-4"/>{helperLabels[helper]}</label>)}</div>
    </dialog>,document.body)}
  </>;
}
