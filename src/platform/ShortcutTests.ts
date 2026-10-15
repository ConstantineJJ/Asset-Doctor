import {ShortcutStore,chordFromEvent,validChord} from './Shortcuts';
export function runShortcutTests():{name:string;passed:boolean;actual?:unknown;expected?:unknown}[]{
 const data=new Map<string,string>(),local={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}},store=new ShortcutStore(local);
 const russian=chordFromEvent({code:'KeyZ',key:'я',ctrlKey:true,altKey:false,shiftKey:false,metaKey:false});
 const conflict=store.assign('wireframe','KeyF'),original=store.getSnapshot().wireframe;
 const assigned=store.assign('wireframe','Alt+KeyH'),restored=new ShortcutStore(local);
 const badStorage=new ShortcutStore({getItem:()=>null,setItem:()=>{throw new Error('Quota');}}),failed=badStorage.assign('wireframe','KeyH');
 return [
  {name:'Hotkeys use physical key codes across Russian keyboard layout',passed:russian==='Ctrl+KeyZ'},
  {name:'Hotkey conflicts reject without changing an existing assignment',passed:!conflict.ok&&original==='KeyZ'},
  {name:'Custom hotkeys persist and accept canonical Alt combinations',passed:assigned.ok&&restored.getSnapshot().wireframe==='Alt+KeyH'},
  {name:'Hotkey preferences report storage failures and keep the previous binding',passed:!failed.ok&&badStorage.getSnapshot().wireframe==='KeyZ'},
  {name:'Hotkeys preserve focus navigation and reserved Windows/browser commands',passed:!validChord('Tab')&&!validChord('Alt+F4')&&!validChord('Ctrl+KeyR')&&!validChord('Shift+Ctrl+KeyZ')},
 ];
}
