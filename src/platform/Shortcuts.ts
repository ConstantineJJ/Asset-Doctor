import {useSyncExternalStore} from 'react';

export const shortcutActions=[
 {id:'frameAll',en:'Frame all',ru:'Показать всю модель',key:'KeyF'},
 {id:'focusSelected',en:'Focus selected',ru:'Фокус на выбранном',key:'Shift+KeyF'},
 {id:'playPause',en:'Play / Pause',ru:'Воспроизведение / пауза',key:'Space'},
 {id:'wireframe',en:'Wireframe',ru:'Каркасный режим',key:'KeyZ'},
 {id:'undo',en:'Undo',ru:'Отменить правку',key:'Ctrl+KeyZ'},
 {id:'redo',en:'Redo rig edit',ru:'Повторить правку рига',key:'Ctrl+Shift+KeyZ'},
 {id:'openFile',en:'Open model',ru:'Открыть модель',key:'Ctrl+KeyO'},
 {id:'skeleton',en:'Skeleton',ru:'Показать скелет',key:'KeyX'},
 {id:'grid',en:'Ground grid',ru:'Сетка пола',key:'KeyG'},
 {id:'autoRotate',en:'Auto rotation',ru:'Автовращение',key:'KeyR'},
 {id:'systemLog',en:'System log',ru:'Системный журнал',key:'F8'},
 {id:'diagnosticLog',en:'Log all findings',ru:'Отчёт обо всех неисправностях',key:'F9'},
] as const;
export type ShortcutAction=typeof shortcutActions[number]['id'];
export type ShortcutBindings=Record<ShortcutAction,string|null>;
const defaults=()=>Object.fromEntries(shortcutActions.map(action=>[action.id,action.key])) as ShortcutBindings;
const storageKey='asset-doctor.shortcuts.v1';
const reserved=new Set(['F5','Alt+F4','Ctrl+KeyW','Ctrl+KeyR','Ctrl+Shift+KeyR','Ctrl+KeyT','Ctrl+KeyN','Ctrl+KeyL']);
export function validChord(chord:string){
 const parts=chord.split('+'),code=parts.pop()!;
 return /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(code)
  &&parts.join('+')===['Ctrl','Alt','Shift'].filter(modifier=>parts.includes(modifier)).join('+')&&!reserved.has(chord);
}
export function chordFromEvent(event:Pick<KeyboardEvent,'code'|'key'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'>):string|null{
 if(event.metaKey)return null;
 const code=event.code||(/^\w$/.test(event.key)?`Key${event.key.toUpperCase()}`:event.key===' '?'Space':event.key);
 const chord=[event.ctrlKey?'Ctrl':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null,code].filter(Boolean).join('+');
 return validChord(chord)?chord:null;
}
export const displayChord=(chord:string|null)=>chord?.replace(/Key|Digit/g,'')??'—';
function storage(){try{return typeof window==='undefined'?undefined:window.localStorage;}catch{return undefined;}}

export class ShortcutStore{
 private bindings:ShortcutBindings=defaults();
 private listeners=new Set<()=>void>();
 constructor(private readonly local:Pick<Storage,'getItem'|'setItem'>|undefined=storage()){
  try{const saved=JSON.parse(local?.getItem(storageKey)??'null');if(!saved)return;
   const next={...this.bindings,...Object.fromEntries(shortcutActions.filter(action=>action.id in saved).map(action=>[action.id,saved[action.id]]))};
   const assigned=Object.values(next).filter((value):value is string=>value!==null);
   if(assigned.every(value=>typeof value==='string'&&validChord(value))&&new Set(assigned).size===assigned.length)this.bindings=next;
  }catch{/* Corrupt or unavailable preferences retain defaults. */}
 }
 getSnapshot=()=>this.bindings;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 assign(action:ShortcutAction,chord:string|null):{ok:true}|{ok:false;reason:'reserved'|'storage'|'conflict';conflict?:ShortcutAction}{
  if(chord!==null&&!validChord(chord))return {ok:false,reason:'reserved'};
  const conflict=shortcutActions.find(item=>item.id!==action&&this.bindings[item.id]===chord);
  if(chord&&conflict)return {ok:false,reason:'conflict',conflict:conflict.id};
  return this.save({...this.bindings,[action]:chord});
 }
 private save(next:ShortcutBindings):{ok:true}|{ok:false;reason:'storage'}{
  try{this.local?.setItem(storageKey,JSON.stringify(next));}catch{return {ok:false,reason:'storage'};}
  this.bindings=next;this.listeners.forEach(listener=>listener());return {ok:true};
 }
 reset(){return this.save(defaults());}
 match(event:KeyboardEvent){const chord=chordFromEvent(event);return chord?shortcutActions.find(action=>this.bindings[action.id]===chord)?.id:null;}
}
export const shortcuts=new ShortcutStore();
export const useShortcutBindings=()=>useSyncExternalStore(shortcuts.subscribe,shortcuts.getSnapshot,shortcuts.getSnapshot);
export function shortcutEventAllowed(event:KeyboardEvent){
 if(event.defaultPrevented||event.repeat||event.isComposing||event.getModifierState?.('AltGraph'))return false;
 if(document.querySelector('dialog[open],[aria-modal="true"],[data-shortcuts-blocked="true"]'))return false;
 const target=event.target;
 if(target instanceof HTMLElement){
  if(target.isContentEditable||target.closest('input,textarea,select,[role="textbox"]'))return false;
  if(['Space','Enter'].includes(event.code)&&target.closest('button,a,[role="button"]'))return false;
 }
 return true;
}
