import React,{useSyncExternalStore} from 'react';
import {Bug,ScrollText} from 'lucide-react';
import {systemLog} from '../platform/SystemLog';
import {openSystemLog} from './SystemLogControl';
import {useI18n} from '../i18n';

export function SystemStatusBar({assetName,partial,count,enabled,busy,message,onLogAll}:{assetName:string;partial:boolean;count:number;enabled:boolean;busy:boolean;message:string;onLogAll:()=>void}){
 const {language}=useI18n(),ru=language==='ru',log=useSyncExternalStore(systemLog.subscribe,systemLog.getSnapshot,systemLog.getSnapshot);
 return <footer aria-label={ru?'Служебная панель':'System options'} className="shrink-0 min-h-8 flex items-center gap-2 px-3 py-1 border-t border-[#454c58] bg-[#202329] text-[11px] text-gray-300">
  <button onClick={openSystemLog} className="shrink-0 flex items-center gap-1 rounded px-1 hover:bg-[#383e49]" title={ru?'Открыть системный журнал':'Open system log'}><Bug className={`w-3 h-3 ${log.writeError?'text-rose-300':log.enabled?'text-cyan-300':'text-gray-500'}`}/><span className="hidden sm:inline">{ru?'Журнал':'System log'}: {log.enabled?(ru?'запись':'recording'):(ru?'пауза':'paused')}</span></button>
  <span className="truncate min-w-0 max-w-[28%]" title={assetName}>{assetName?`${ru?'Модель':'Model'}: ${assetName}`:''}</span>
  {enabled&&partial&&<span className="shrink-0 text-amber-200">{ru?'Неполное сканирование':'Partial scan'}</span>}
  <span role="status" className="truncate min-w-0 flex-1" title={message}>{message}</span>
  <button aria-label={ru?'Логировать все неисправности':'Log all findings'} disabled={!enabled||busy||!count} onClick={onLogAll} className="shrink-0 flex items-center gap-1 rounded border border-[#586571] px-2 py-0.5 text-cyan-200 hover:bg-[#383e49] disabled:opacity-40"><ScrollText className="w-3.5 h-3.5"/>{ru?'Логировать всё':'Log all findings'} ({count})</button>
 </footer>;
}
