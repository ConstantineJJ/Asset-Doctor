import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Bug,Download,Trash2,X} from 'lucide-react';
import {systemLog,type LogLevel} from '../platform/SystemLog';
import {readSystemLog,clearSystemLog} from '../platform/InitializeSystemLog';
import {saveTextFile} from '../platform/FileIO';
import {shortcuts,shortcutEventAllowed} from '../platform/Shortcuts';
import {useI18n} from '../i18n';

export function openSystemLog(){window.dispatchEvent(new Event('asset-doctor:open-system-log'));}
export function SystemLogControl(){
 const {language}=useI18n(),ru=language==='ru',state=useSyncExternalStore(systemLog.subscribe,systemLog.getSnapshot,systemLog.getSnapshot);
 const [open,setOpen]=useState(false),[filter,setFilter]=useState<LogLevel|'all'>('all'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),prior=useRef<HTMLElement|null>(null);
 const show=()=>{prior.current=document.activeElement as HTMLElement;setOpen(true);setMessage('');};
 useEffect(()=>{const requested=()=>show(),key=(event:KeyboardEvent)=>{if(shortcutEventAllowed(event)&&shortcuts.match(event)==='systemLog'){event.preventDefault();show();}};
  window.addEventListener('asset-doctor:open-system-log',requested);window.addEventListener('keydown',key);
  return()=>{window.removeEventListener('asset-doctor:open-system-log',requested);window.removeEventListener('keydown',key);};},[]);
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 const save=async()=>{setBusy(true);setMessage('');try{const text=await readSystemLog(),result=await saveTextFile(`AssetDoctor_system_${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`,text);setMessage(result==='saved'?(ru?'Журнал сохранён.':'Log saved.'):result==='downloaded'?(ru?'Журнал передан на скачивание.':'Log download requested.'):(ru?'Сохранение отменено.':'Save cancelled.'));}catch(error){setMessage(`${ru?'Не удалось сохранить журнал':'Could not save log'}: ${String(error)}`);}finally{setBusy(false);}};
 const clear=async()=>{setBusy(true);try{await clearSystemLog();setMessage(ru?'Текущие записи очищены.':'Current log entries cleared.');}catch(error){setMessage(String(error));}finally{setBusy(false);}};
 return <>
  <button data-open-system-log type="button" aria-label={ru?'Системный журнал':'System log'} title={ru?'Системный журнал':'System log'} aria-pressed={open} onClick={show}
   className={`shrink-0 p-1.5 rounded border border-[#687787] bg-[#252830] ${state.writeError?'text-rose-300':state.enabled?'text-cyan-300':'text-gray-400'}`}><Bug className="w-4 h-4"/></button>
  {open&&createPortal(<dialog ref={dialog} aria-label={ru?'Системный журнал':'System log'} onClose={()=>{setOpen(false);prior.current?.isConnected&&prior.current.focus();}}
   className="asset-doctor-ui m-auto w-[min(64rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto rounded-lg border border-[#687787] bg-[#252830] text-gray-100 p-4 backdrop:bg-black/60">
   <div className="flex justify-between items-center"><h2 className="font-semibold">{ru?'Системный журнал':'System log'}</h2><button aria-label={ru?'Закрыть системный журнал':'Close system log'} onClick={()=>dialog.current?.close()}><X className="w-5 h-5"/></button></div>
   <p className="my-3 text-xs text-gray-300">{ru?'Локальный журнал операций и ошибок. Геометрия и текстуры моделей в него не включаются.':'Local operation and error log. Model geometry and textures are not included.'}</p>
   <div className="flex flex-wrap items-center gap-3 text-sm mb-3">
    <label className="flex gap-2"><input type="checkbox" checked={state.enabled} onChange={event=>systemLog.setEnabled(event.target.checked)}/>{ru?'Записывать системный журнал':'Record system log'}</label>
    <label className="flex gap-2"><input type="checkbox" checked={state.verbose} onChange={event=>systemLog.setVerbose(event.target.checked)}/>{ru?'Подробные записи':'Verbose records'}</label>
    <select aria-label={ru?'Уровень записей':'Log level'} className="bg-[#252830] border border-[#687787] rounded p-1" value={filter} onChange={event=>setFilter(event.target.value as LogLevel|'all')}><option value="all">{ru?'Все уровни':'All levels'}</option>{(['error','warn','info','debug'] as const).map(level=><option key={level} value={level}>{level}</option>)}</select>
    <button disabled={busy} aria-label={ru?'Сохранить системный журнал':'Save system log'} className="flex items-center gap-1 border border-[#687787] rounded p-1.5 disabled:opacity-40" onClick={()=>void save()}><Download className="w-4 h-4"/>{ru?'Сохранить':'Save'}</button>
    <button disabled={busy} className="flex items-center gap-1 border border-[#687787] rounded p-1.5 disabled:opacity-40" onClick={()=>void clear()}><Trash2 className="w-4 h-4"/>{ru?'Очистить':'Clear'}</button>
   </div>
   {(state.writeError||message)&&<p role="status" className="my-2 text-sm text-amber-200">{state.writeError||message}</p>}
   <div className="text-xs text-gray-300 mb-2">{ru?'Записей в окне':'Entries in view'}: {state.entries.length} · {ru?'Сессия':'Session'}: {systemLog.sessionId.slice(0,8)}{state.unconfirmedDiskEntries>0&&` · ${ru?'Неподтверждённых записей на диске':'Unconfirmed disk records'}: ${state.unconfirmedDiskEntries}`}</div>
   <div className="h-[min(45vh,26rem)] overflow-auto bg-[#15171c] border border-[#58626e] rounded p-2 space-y-1" aria-label={ru?'Записи журнала':'Log entries'}>
    {state.entries.filter(entry=>filter==='all'||entry.level===filter).map(entry=><pre key={entry.sequence} className={`whitespace-pre-wrap break-all text-[11px] ${entry.level==='error'?'text-rose-200':entry.level==='warn'?'text-amber-200':'text-gray-200'}`}>{JSON.stringify(entry)}</pre>)}
    {!state.entries.length&&<p className="text-sm text-gray-400">{ru?'Записей пока нет.':'No records yet.'}</p>}
   </div>
  </dialog>,document.body)}
 </>;
}
