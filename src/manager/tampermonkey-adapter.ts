/** TASK-007 / REQ-017: privacy-minimized, fail-closed Tampermonkey discovery.
 * Chrome CDP target metadata is only a runtime presence hint, never proof of
 * extension authenticity/version, installation, GM APIs or userscript behavior.
 * Do NOT use Runtime.evaluate against extension contexts or userscripts.
 */
import {types as nodeTypes} from 'node:util';
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
    'UNOWNED_LISTENER'|'INVALID_CDP_RESPONSE'|'RUNTIME_NOT_OBSERVED'|'CDP_FAILED'|'INVALID_OPTIONS'};

const acceptedTypes=new Set(['service_worker','background_page']);
const invalidTargets=():ManagerPresenceResult=>({ok:false,code:'INVALID_CDP_RESPONSE'});
/** AbortSignal is also a JS input boundary for this exported direct runtime API.
 * Check its native internal slots and refuse Proxies and own method shadows
 * before invoking aborted or attaching listeners. No caller hooks may run.
 */
function isNativeRuntimeSignal(value:unknown):value is AbortSignal{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(key=>
       Object.prototype.hasOwnProperty.call(value,key)))return false;
  const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
  return typeof getter==='function'&&typeof getter.call(value)==='boolean';
 }catch{return false;}
}
/** Capture only own data descriptors, never invoke getters, proxies' get traps,
 * or a caller-supplied array iterator. Refuse Proxy values before any
 * reflective calls: even getPrototypeOf/ownKeys can invoke attacker traps.
 * CDP JSON normally has plain objects.
 */
export function inspectTampermonkeyTargetHints(payload:unknown):ManagerPresenceResult {
 try{
  if(!Array.isArray(payload)||nodeTypes.isProxy(payload)||
     Object.getPrototypeOf(payload)!==Array.prototype)
    return invalidTargets();
  const length=Object.getOwnPropertyDescriptor(payload,'length')?.value;
  if(!Number.isSafeInteger(length)||length<0||length>512)return invalidTargets();
  const entries=Object.getOwnPropertyDescriptors(payload);
  if(Reflect.ownKeys(entries).length!==length+1)return invalidTargets();
  let count=0;
  const ids=new Set<string>();
  for(let i=0;i<length;i++){
    const slot=entries[String(i)];
    if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))
      return invalidTargets();
    const value:unknown=slot.value;
    if(!value||typeof value!=='object'||Array.isArray(value)||nodeTypes.isProxy(value))
      return invalidTargets();
    const prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)return invalidTargets();
    const fields=Object.getOwnPropertyDescriptors(value);
    const typeField=fields.type,urlField=fields.url,idField=fields.targetId;
    if(!typeField||!urlField||!idField||
       !Object.prototype.hasOwnProperty.call(typeField,'value')||
       !Object.prototype.hasOwnProperty.call(urlField,'value')||
       !Object.prototype.hasOwnProperty.call(idField,'value'))
      return invalidTargets();
    const type:unknown=typeField.value;
    const urlText:unknown=urlField.value;
    const targetId:unknown=idField.value;
    if(typeof type!=='string'||typeof urlText!=='string'||
       typeof targetId!=='string'||urlText.length>8192||
       !/^[a-zA-Z0-9_-]{8,128}$/.test(targetId)||ids.has(targetId))
      return invalidTargets();
    ids.add(targetId);
    if(!acceptedTypes.has(type))continue;
    let url:URL;
    try{url=new URL(urlText);}catch{continue;}
    if(url.protocol!=='chrome-extension:'||url.hostname!==TAMPERMONKEY_EXTENSION_ID||
       url.username||url.password||url.port)continue;
    count++;
  }
  if(count===0)return {ok:false,code:'RUNTIME_NOT_OBSERVED'};
  return {ok:true,status:'RUNTIME_TARGET_HINT_ONLY',manager:'Tampermonkey',
    extensionId:TAMPERMONKEY_EXTENSION_ID,matchedRuntimeTargets:count,
    extensionAuthenticityVerified:false,versionVerified:false,permissionVerified:false,
    scriptInstallationVerified:false,scriptInjectionVerified:false,
    gmApiVerified:false,businessVerified:false};
 }catch{return invalidTargets();}
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
    // Abort/timeout can settle before the WebSocket reaches OPEN.
    // Never issue a command from a late event after cancellation.
    if(settled||signal?.aborted)return;
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
 if(signal!==undefined&&!isNativeRuntimeSignal(signal))
   return {ok:false,code:'INVALID_OPTIONS'};
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 // The native WeakMap ownership check must precede all session property reads.
 if(!isLiveApprovedChromeSession(session))
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
 // An asynchronous listener ownership query may complete after consent
 // has been cancelled; it must never revive a stale runtime observation.
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(!stillOwned.ok)return {ok:false,code:'UNOWNED_LISTENER'};
 // The session may be stopped while the final asynchronous owner check runs.
 // Its old PID result cannot re-authorize an ended app-owned Chrome process.
 if(!isLiveApprovedChromeSession(session))return {ok:false,code:'UNVERIFIED_BROWSER'};
 return inspectTampermonkeyTargetHints(payload);
}
