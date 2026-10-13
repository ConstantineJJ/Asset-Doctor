import React,{useState} from 'react';
import type {AnimationClipInfo} from '../types';
import {useI18n} from '../i18n';

export function AnimationClipList({clips,activeIndex,onSelect,busy}:{clips:AnimationClipInfo[];activeIndex:number;onSelect:(index:number)=>void;busy:boolean}) {
  const [query,setQuery]=useState('');const {language}=useI18n();const ru=language==='ru';
  const visible=clips.map((clip,index)=>({clip,index})).filter(({clip})=>clip.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section aria-label="Animation clips" className="space-y-2 text-xs">
    <h4 className="font-semibold text-green-200">{ru?'Анимации':'Animation Clips'} · {visible.length}/{clips.length}</h4>
    <input aria-label="Search animation clips" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={ru?'Найти анимацию…':'Find animation…'} className="w-full rounded px-2 py-2"/>
    <p className="text-gray-300">{ru?'Нажмите на клип для выбора. В режиме редактирования выбор не запускает движение.':'Click a clip to select it. Edit mode selects without starting playback.'}</p>
    <div className="max-h-80 overflow-y-auto custom-scrollbar space-y-2 pr-1">
      {visible.map(({clip,index})=><article key={index} className="space-y-1">
        <button type="button" data-testid={`animation-clip-${index}`} aria-pressed={index===activeIndex} disabled={busy} onClick={()=>onSelect(index)} className="w-full text-left p-2 rounded space-y-1" title={clip.name}>
          <span className="flex justify-between gap-2"><span className="font-semibold break-words min-w-0">{index===activeIndex?'✓ ':''}{clip.name}</span><span className="shrink-0 font-mono">{clip.duration.toFixed(2)}s</span></span>
          <span className="block text-[11px]">{ru?'Дорожек':'Tracks'}: {clip.trackCount} · {clip.rootMotionDetected?(ru?'Движение корня':'Root motion'):(ru?'Без значимого движения корня':'No significant root motion')}</span>
        </button>
        {index===activeIndex&&<div className="px-2 text-gray-300 text-[11px] break-words">
          <div>{ru?'Поворот корня':'Root rotation'}: {clip.rootMotionRotation??0}°</div>
          {clip.rootMotionDelta&&<div>{ru?'Смещение':'Translation'}: [{clip.rootMotionDelta.map(value=>value.toFixed(3)).join(', ')}]</div>}
          {clip.rootMotionTrackName&&<div>{ru?'Дорожка':'Track'}: {clip.rootMotionTrackName}</div>}
        </div>}
      </article>)}
    </div>
    {!visible.length&&<p role="status">{ru?'Анимаций с таким именем нет.':'No animations match this name.'}</p>}
  </section>;
}
