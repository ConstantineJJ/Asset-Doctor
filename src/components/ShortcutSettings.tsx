import React,{useState} from 'react';
import {chordFromEvent,displayChord,shortcutActions,shortcuts,useShortcutBindings,type ShortcutAction} from '../platform/Shortcuts';
import {useI18n} from '../i18n';

export function ShortcutSettings(){
 const {language}=useI18n(),ru=language==='ru',bindings=useShortcutBindings();
 const [recording,setRecording]=useState<ShortcutAction|null>(null),[error,setError]=useState('');
 const assign=(id:ShortcutAction,chord:string|null)=>{
  const result=shortcuts.assign(id,chord);
  if(result.ok){setRecording(null);setError('');return;}
  const action=shortcutActions.find(item=>item.id===result.conflict);
  setError(result.reason==='conflict'?`${ru?'Уже назначено: ':'Already assigned: '}${ru?action?.ru:action?.en}`:result.reason==='storage'?(ru?'Не удалось сохранить настройки.':'Could not save settings.'):(ru?'Сочетание занято системой или недоступно.':'This shortcut is reserved or unavailable.'));
 };
 return <section className="mt-5 border-t border-[#58626e] pt-4 space-y-3" aria-label={ru?'Горячие клавиши':'Keyboard shortcuts'}>
  <h3 className="font-semibold">{ru?'Горячие клавиши':'Keyboard shortcuts'}</h3>
  <p className="text-xs text-gray-300">{ru?'Нажмите на сочетание, затем нажмите нужные клавиши. Esc отменяет запись.':'Click a binding, then press your keys. Esc cancels recording.'}</p>
  {shortcutActions.map(action=><div className="flex items-center gap-2 text-sm" key={action.id}>
   <span className="flex-1">{ru?action.ru:action.en}</span>
   <button className="min-w-28 px-2 py-1.5 rounded border border-[#687787] bg-[#252830]" aria-label={`${ru?'Назначить':'Assign'} ${ru?action.ru:action.en}`} aria-pressed={recording===action.id}
    onClick={()=>{setRecording(action.id);setError('');}} onKeyDown={event=>{
     if(recording!==action.id)return;event.preventDefault();event.stopPropagation();
     if(event.key==='Escape'){setRecording(null);setError('');return;}
     if(['Control','Alt','Shift','Meta'].includes(event.key)||event.repeat)return;
     const chord=chordFromEvent(event.nativeEvent);if(chord)assign(action.id,chord);else setError(ru?'Сочетание недоступно.':'Shortcut unavailable.');
    }}>{recording===action.id?(ru?'Нажмите…':'Press keys…'):displayChord(bindings[action.id])}</button>
   <button className="px-2 py-1.5 border border-[#687787] rounded disabled:opacity-40" disabled={!bindings[action.id]} aria-label={`${ru?'Отключить':'Disable'} ${ru?action.ru:action.en}`} onClick={()=>assign(action.id,null)}>×</button>
  </div>)}
  {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
  <button className="px-2 py-1.5 border border-[#687787] rounded text-sm" onClick={()=>{const result=shortcuts.reset();setRecording(null);setError(result.ok?'':ru?'Не удалось сохранить настройки.':'Could not save settings.');}}>{ru?'Восстановить горячие клавиши':'Reset shortcuts'}</button>
 </section>;
}
