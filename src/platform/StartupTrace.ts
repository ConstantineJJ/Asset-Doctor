import {isDesktop} from './FileIO';
type StartupStage='frontend_module'|'react_ready'|'doctor_create'|'doctor_ready'|'doctor_frame'|'compare_create'|'compare_ready';
const sent=new Set<StartupStage>();
export function markStartup(stage:StartupStage){
 if(!isDesktop()||sent.has(stage))return;
 sent.add(stage);
 void import('@tauri-apps/api/core').then(({invoke})=>invoke('startup_mark',{stage})).catch(error=>console.warn('Startup trace unavailable:',error));
}
