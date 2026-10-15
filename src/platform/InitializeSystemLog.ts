import {isTauri,invoke} from '@tauri-apps/api/core';
import {systemLog,sanitizeLogText,mergeSystemLogText} from './SystemLog';

if(typeof window!=='undefined'){
 if(isTauri())systemLog.setWriter(batch=>invoke('debug_log_append',{batch}));
 systemLog.record('info','app','session_started',{userAgent:navigator.userAgent});
 const error=(event:ErrorEvent)=>systemLog.record('error','app','window_error',{error:event.error??event.message});
 const rejected=(event:PromiseRejectionEvent)=>systemLog.record('error','app','unhandled_rejection',{error:event.reason});
 window.addEventListener('error',error);window.addEventListener('unhandledrejection',rejected);
 if(import.meta.hot)import.meta.hot.dispose(()=>{window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',rejected);});
}

export async function readSystemLog(){
 await systemLog.flush();
 if(!isTauri())return systemLog.exportText();
 try{
  return mergeSystemLogText(systemLog.exportText(),await invoke<string>('debug_log_read'));
 }catch(error){return systemLog.exportText()+JSON.stringify({kind:'disk_read_error',error:sanitizeLogText(String(error))})+'\n';}
}
export async function clearSystemLog(){
 await systemLog.flush();if(isTauri())await invoke('debug_log_clear');systemLog.clear();
}
