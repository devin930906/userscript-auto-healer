/** TASK-007 / REQ-017: privacy-minimized, fail-closed Tampermonkey discovery.
 * Chrome CDP target metadata is only a runtime presence hint, never proof of
 * extension authenticity/version, installation, GM APIs or userscript behavior.
 * Do NOT use Runtime.evaluate against extension contexts or userscripts.
 */
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {isLiveApprovedChromeSession} from '../browser/owned-chrome';
import {verifyWindowsLoopbackListenerPid} from '../browser/cdp-session';

export const TAMPERMONKEY_EXTENSION_ID='dhdgffkkebhmkfjojejmpbldmpobfkfo' as const;
export type ManagerPresenceResult =
 | {readonly ok:true;readonly status:'RUNTIME_TARGET_HINT_ONLY';
    readonly manager:'Tampermonkey';readonly extensionId:typeof TAMPERMONKEY_EXTENSION_ID;
    readonly matchedRuntimeTargets:number;readonly extensionAuthenticityVerified:false;
    readonly versionVerified:false;readonly permissionVerified:false;
    readonly scriptInstallationVerified:false;readonly scriptInjectionVerified:false;
    readonly gmApiVerified:false;readonly businessVerified:false}
 | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'CANCELLED'|'UNVERIFIED_BROWSER'|
    'UNOWNED_LISTENER'|'INVALID_CDP_RESPONSE'|'RUNTIME_NOT_OBSERVED'|'CDP_FAILED'};

function object(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
const acceptedTypes=new Set(['service_worker','background_page']);
/** No web-page or renderer-supplied claim can become proof of actual extension execution. */
export function inspectTampermonkeyTargetHints(payload:unknown):ManagerPresenceResult {
 if(!Array.isArray(payload)||payload.length>512)return {ok:false,code:'INVALID_CDP_RESPONSE'};
 let count=0;
 const ids=new Set<string>();
 for(const value of payload){
   if(!object(value)||typeof value.type!=='string'||typeof value.url!=='string'||
      typeof value.targetId!=='string'||value.url.length>8192)
     return {ok:false,code:'INVALID_CDP_RESPONSE'};
   if(!acceptedTypes.has(value.type))continue;
   let url:URL;
   try{url=new URL(value.url);}catch{continue;}
   if(url.protocol!=='chrome-extension:'||url.hostname!==TAMPERMONKEY_EXTENSION_ID||
      url.username||url.password||url.port)continue;
   if(!/^[a-zA-Z0-9_-]{8,128}$/.test(value.targetId)||ids.has(value.targetId))
     return {ok:false,code:'INVALID_CDP_RESPONSE'};
   ids.add(value.targetId);
   count++;
 }
 if(count===0)return {ok:false,code:'RUNTIME_NOT_OBSERVED'};
 return {ok:true,status:'RUNTIME_TARGET_HINT_ONLY',manager:'Tampermonkey',
   extensionId:TAMPERMONKEY_EXTENSION_ID,matchedRuntimeTargets:count,
   extensionAuthenticityVerified:false,versionVerified:false,permissionVerified:false,
   scriptInstallationVerified:false,scriptInjectionVerified:false,
   gmApiVerified:false,businessVerified:false};
}
async function readBoundedTargets(websocketUrl:string,signal?:AbortSignal):Promise<unknown|null>{
 return new Promise(resolve=>{
  let socket:WebSocket|undefined,settled=false;
  const finish=(value:unknown|null)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   signal?.removeEventListener('abort',onAbort);
   try{socket?.close();}catch{/* CDP socket can already be closed */}
   resolve(value);
  };
  const onAbort=()=>finish(null);
  const timer=setTimeout(()=>finish(null),5000);
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted){finish(null);return;}
  try{
   socket=new WebSocket(websocketUrl);
   socket.addEventListener('open',()=>{
    try{socket?.send(JSON.stringify({id:1,method:'Target.getTargets'}));}
    catch{finish(null);}
   });
   socket.addEventListener('message',event=>{
    if(typeof event.data!=='string'||event.data.length>256*1024){finish(null);return;}
    try{
     const reply=JSON.parse(event.data) as {id?:unknown;result?:{targetInfos?:unknown};error?:unknown};
     if(reply.id!==1)return;
     finish(!reply.error?reply.result?.targetInfos??null:null);
    }catch{finish(null);}
   });
   socket.addEventListener('error',()=>finish(null));
   socket.addEventListener('close',()=>finish(null));
  }catch{finish(null);}
 });
}
/** Query only the browser websocket from a live application-owned Chrome session.
 * This intentionally never starts/enables/installs an extension or reads script data.
 */
export async function inspectApprovedTampermonkeyRuntime(
 session:ManagedLaunchResult,userApproved:boolean,signal?:AbortSignal
):Promise<ManagerPresenceResult>{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(!session?.ok||!isLiveApprovedChromeSession(session))
   return {ok:false,code:'UNVERIFIED_BROWSER'};
 let ws:URL;
 try{ws=new URL(session.browserWebsocket);}catch{return {ok:false,code:'UNVERIFIED_BROWSER'};}
 const port=Number(ws.port);
 if(ws.protocol!=='ws:'||ws.hostname!=='127.0.0.1'||
    !Number.isInteger(port)||port<1024||port>65535||ws.username||ws.password||
    ws.search||ws.hash||!/^\/devtools\/browser\/[a-zA-Z0-9-]{8,128}$/.test(ws.pathname))
   return {ok:false,code:'UNVERIFIED_BROWSER'};
 const owned=await verifyWindowsLoopbackListenerPid(port,session.pid);
 if(!owned.ok||!isLiveApprovedChromeSession(session))
   return {ok:false,code:'UNOWNED_LISTENER'};
 const payload=await readBoundedTargets(session.browserWebsocket,signal);
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(payload===null)return {ok:false,code:'CDP_FAILED'};
 if(!isLiveApprovedChromeSession(session))return {ok:false,code:'UNVERIFIED_BROWSER'};
 const stillOwned=await verifyWindowsLoopbackListenerPid(port,session.pid);
 if(!stillOwned.ok)return {ok:false,code:'UNOWNED_LISTENER'};
 return inspectTampermonkeyTargetHints(payload);
}
