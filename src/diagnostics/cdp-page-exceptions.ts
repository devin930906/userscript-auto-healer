/**
 * TASK-008 / REQ-013 / TEST-013: passive CDP page JavaScript exception signals.
 * A page exception is NOT attributed to Tampermonkey or a userscript. Only an
 * approved application-owned Chrome instance and exact approved target qualify.
 * No Runtime.evaluate, script installation, source/message/stack storage,
 * browsing history, or file writes are performed here.
 */
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {isLiveApprovedChromeSession,readBoundedCdpJson} from '../browser/owned-chrome';
import type {OpenTargetResult} from '../browser/cdp-target';
import {inspectCdpTargetList,verifyWindowsLoopbackListenerPid} from '../browser/cdp-session';
import {classifyFaultSignals,BoundedFaultLog,type FaultTriage} from './fault-classifier';

type Failure='NOT_AUTHORIZED'|'UNVERIFIED_BROWSER'|'UNVERIFIED_TARGET'|
  'INVALID_OPTIONS'|'CDP_FAILED'|'ROUTE_CHANGED'|'TOO_MANY_EXCEPTIONS'|'CANCELLED';
export type PageExceptionSignalResult=Readonly<{
  status:'BLOCKED'|'PAGE_EXCEPTION_SIGNAL_ONLY'|'NO_EXCEPTION_IN_WINDOW_ONLY';
  code:Failure|'NONE';
  observedCount:number;
  triage:FaultTriage;
  tampermonkeyVerified:false;
  businessVerified:false;
  automaticPatchAllowed:false;
}>;
const MAX_EXCEPTIONS=32;
/** Bound all event deliveries, including repeated exception IDs. Unique IDs
 * are not an event budget: CDP transport replays must not evade the cap.
 * This only counts anonymous page signals, never manager/GM evidence. */
export function countBoundedPageExceptionEvent(
  previousCount:number,exceptionId:unknown
):{ok:true;count:number}|{ok:false;code:'INVALID_EXCEPTION_ID'|'TOO_MANY_EXCEPTIONS'}{
  if(!Number.isSafeInteger(previousCount)||previousCount<0||
     previousCount>MAX_EXCEPTIONS||typeof exceptionId!=='number'||
     !Number.isSafeInteger(exceptionId)||exceptionId<0)
    return {ok:false,code:'INVALID_EXCEPTION_ID'};
  if(previousCount===MAX_EXCEPTIONS)
    return {ok:false,code:'TOO_MANY_EXCEPTIONS'};
  return {ok:true,count:previousCount+1};
}
const MAX_MESSAGE_BYTES=128*1024;
const uncertain=()=>classifyFaultSignals([{id:'page_runtime_unverified',code:'UNVERIFIED_OBSERVATION'}]);
function result(
  status:PageExceptionSignalResult['status'],
  code:PageExceptionSignalResult['code'],
  count:number
):PageExceptionSignalResult{
  const triage=status==='PAGE_EXCEPTION_SIGNAL_ONLY'
    ?classifyFaultSignals(Array.from({length:count},(_,i)=>({
      id:'page_exception_'+(i+1),code:'SCRIPT_EXCEPTION' as const
    })))
    :uncertain();
  return Object.freeze({status,code,observedCount:count,triage,
    tampermonkeyVerified:false as const,businessVerified:false as const,
    automaticPatchAllowed:false as const});
}
const blocked=(code:Failure)=>result('BLOCKED',code,0);
function validUrl(raw:unknown):raw is string{
  if(typeof raw!=='string'||raw.length>4096||raw.trim()!==raw)return false;
  try{
    const url=new URL(raw);
    return (url.protocol==='http:'||url.protocol==='https:')&&
      !!url.hostname&&!url.username&&!url.password&&!url.hash;
  }catch{return false;}
}
type FrameIdentity = {readonly id:string;readonly loaderId:string;readonly url:string};
/** Frame events replayed after Page.enable are not a new navigation if
 * their main-frame ID, document loader and URL match the armed checkpoint.
 * A different loader (including same-URL reload) must still invalidate it.
 */
function getArmedFrameIdentity(reply:unknown,expectedUrl:string):FrameIdentity|null{
  if(!exactMainFrame(reply,expectedUrl))return null;
  const tree=(reply as {frameTree?:{frame?:unknown}}).frameTree;
  const frame=tree?.frame as Record<string,unknown>|undefined;
  if(typeof frame?.id!=='string'||!frame.id||
     typeof frame.loaderId!=='string'||!frame.loaderId)return null;
  return {id:frame.id,loaderId:frame.loaderId,url:expectedUrl};
}
export function isArmedFrameNavigationReplay(
  params:unknown,armed:FrameIdentity|null
):boolean{
  if(!armed||!params||typeof params!=='object'||Array.isArray(params))
    return false;
  const frame=(params as {frame?:unknown}).frame;
  if(!frame||typeof frame!=='object'||Array.isArray(frame))return false;
  const data=frame as Record<string,unknown>;
  return data.id===armed.id&&data.loaderId===armed.loaderId&&
    data.url===armed.url;
}

function exactMainFrame(reply:unknown,expectedUrl:string):boolean{
  if(!reply||typeof reply!=='object'||Array.isArray(reply))return false;
  const tree=(reply as {frameTree?:unknown}).frameTree;
  if(!tree||typeof tree!=='object'||Array.isArray(tree))return false;
  const frame=(tree as {frame?:unknown}).frame;
  if(!frame||typeof frame!=='object'||Array.isArray(frame))return false;
  return (frame as {url?:unknown}).url===expectedUrl;
}

/** Only methods needed for passive event subscription are permitted.
 * Exceptions' message, source URL, line, stack and object values are dropped
 * in the WebSocket handler before constructing any result.
 */
async function capture(
  wsUrl:string,expectedUrl:string,durationMs:number,signal?:AbortSignal
):Promise<{ok:true;count:number}|{ok:false;code:Failure}>{
  let ws:WebSocket;
  try{ws=new WebSocket(wsUrl);}
  catch{return {ok:false,code:'CDP_FAILED'};}
  let broken=false;
  let navigated=false;
  let tooMany=false;
  let listening=false;
  let monitoringNavigation=false;
  let armedIdentity:FrameIdentity|null=null;
  let nextId=0;
  let open=false;
  let count=0;
  const waiting=new Map<number,(reply:unknown)=>void>();
  const fail=()=>{
    broken=true;
    for(const callback of waiting.values())callback(null);
    waiting.clear();
  };
  const onMessage=(event:MessageEvent)=>{
    try{
      const raw=String(event.data);
      if(Buffer.byteLength(raw,'utf8')>MAX_MESSAGE_BYTES){fail();return;}
      const body:unknown=JSON.parse(raw);
      if(!body||typeof body!=='object'||Array.isArray(body)){fail();return;}
      const msg=body as Record<string,unknown>;
      if(typeof msg.id==='number'&&waiting.has(msg.id)){
        const reply=waiting.get(msg.id)!;
        waiting.delete(msg.id);
        reply(msg.error===undefined?msg.result:null);
      }
      // Page.enable may replay the just-opened target's initial navigation.
      // Only a navigation after the explicit sampling boundary is evidence
      // of a route change during an observation.
      if(monitoringNavigation&&msg.method==='Page.frameNavigated'&&
         !isArmedFrameNavigationReplay(msg.params,armedIdentity))navigated=true;
      if(monitoringNavigation&&msg.method==='Page.navigatedWithinDocument')
        navigated=true;
      if(listening&&msg.method==='Runtime.exceptionThrown'){
        const detail=(msg.params as {exceptionDetails?:{exceptionId?:unknown}}|undefined)
          ?.exceptionDetails;
        const exceptionId=detail?.exceptionId;
        const next=countBoundedPageExceptionEvent(count,exceptionId);
        if(!next.ok){
          if(next.code==='TOO_MANY_EXCEPTIONS')tooMany=true;
          fail();return;
        }
        count=next.count;
      }
    }catch{fail();}
  };
  ws.addEventListener('message',onMessage);
  ws.addEventListener('error',fail);
  ws.addEventListener('close',fail);
  const command=(method:'Page.enable'|'Page.getFrameTree'|'Runtime.enable'|
    'Runtime.disable'|'Page.disable'):Promise<unknown>=>{
    if(broken||signal?.aborted||!open)return Promise.resolve(null);
    return new Promise(resolve=>{
      const id=++nextId;
      const timer=setTimeout(()=>{
        waiting.delete(id);resolve(null);
      },4000);
      waiting.set(id,response=>{clearTimeout(timer);resolve(response);});
      try{ws.send(JSON.stringify({id,method}));}
      catch{waiting.delete(id);clearTimeout(timer);resolve(null);}
    });
  };
  try{
    open=await new Promise<boolean>(resolve=>{
      let settled=false;
      const done=(value:boolean)=>{
        if(settled)return;settled=true;clearTimeout(timer);resolve(value);
      };
      const timer=setTimeout(()=>done(false),4000);
      ws.addEventListener('open',()=>done(true),{once:true});
      ws.addEventListener('error',()=>done(false),{once:true});
      ws.addEventListener('close',()=>done(false),{once:true});
      signal?.addEventListener('abort',()=>done(false),{once:true});
    });
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    if(!open||broken)return {ok:false,code:'CDP_FAILED'};
    if(await command('Page.enable')===null)return {ok:false,code:'CDP_FAILED'};
    // Target discovery can succeed before the newly created page has
    // finished replacing about:blank. Settle only frame identity BEFORE
    // enabling Runtime. Once sampling starts, any navigation still blocks.
    const settleUntil=Date.now()+2400;
    let first=await command('Page.getFrameTree');
    while(!exactMainFrame(first,expectedUrl)&&!broken&&!signal?.aborted&&
          Date.now()<settleUntil){
      await new Promise<void>(resolve=>setTimeout(resolve,100));
      first=await command('Page.getFrameTree');
    }
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    if(broken||first===null)return {ok:false,code:'CDP_FAILED'};
    if(!exactMainFrame(first,expectedUrl))return {ok:false,code:'ROUTE_CHANGED'};
    // Enabling Runtime can deliver cached exceptions and delayed navigation
    // events from initial page creation. Neither is part of this sample.
    if(await command('Runtime.enable')===null)return {ok:false,code:'CDP_FAILED'};
    const armedFrame=await command('Page.getFrameTree');
    if(!exactMainFrame(armedFrame,expectedUrl))
      return {ok:false,code:'ROUTE_CHANGED'};
    armedIdentity=getArmedFrameIdentity(armedFrame,expectedUrl);
    if(broken)return {ok:false,code:'CDP_FAILED'};
    navigated=false;
    count=0;
    monitoringNavigation=true;
    listening=true;
    await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},durationMs);
      const onAbort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);resolve();};
      signal?.addEventListener('abort',onAbort,{once:true});
    });
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    if(tooMany)return {ok:false,code:'TOO_MANY_EXCEPTIONS'};
    if(broken)return {ok:false,code:'CDP_FAILED'};
    listening=false;
    if(await command('Runtime.disable')===null)return {ok:false,code:'CDP_FAILED'};
    const last=await command('Page.getFrameTree');
    if(navigated||!exactMainFrame(last,expectedUrl))
      return {ok:false,code:'ROUTE_CHANGED'};
    if(broken)return {ok:false,code:'CDP_FAILED'};
    return {ok:true,count};
  }finally{
    listening=false;
    monitoringNavigation=false;
    try{ws.close();}catch{ /* already closed */ }
    for(const callback of waiting.values())callback(null);
    waiting.clear();
  }
}

/** Observe an already opened, approved tab WITHOUT triggering page execution.
 * The observation interval can miss exceptions; no exceptions seen != health.
 */
export async function inspectApprovedPageExceptions(
  browser:ManagedLaunchResult,target:OpenTargetResult,expectedUrl:unknown,
  userApproved:boolean,durationMs=1200,signal?:AbortSignal
):Promise<PageExceptionSignalResult>{
  if(userApproved!==true)return blocked('NOT_AUTHORIZED');
  if(signal?.aborted)return blocked('CANCELLED');
  if(!Number.isInteger(durationMs)||durationMs<250||durationMs>5000||
     !validUrl(expectedUrl))return blocked('INVALID_OPTIONS');
  if(!browser?.ok||!isLiveApprovedChromeSession(browser))
    return blocked('UNVERIFIED_BROWSER');
  if(!target?.ok||target.status!=='TARGET_ID_AND_URL_MATCH_ONLY')
    return blocked('UNVERIFIED_TARGET');
  let address:URL;
  try{address=new URL(browser.browserWebsocket);}
  catch{return blocked('UNVERIFIED_BROWSER');}
  const port=Number(address.port);
  if(address.protocol!=='ws:'||address.hostname!=='127.0.0.1'||
     address.username||address.password||address.search||address.hash||
     !Number.isInteger(port)||port<1024||port>65535)
    return blocked('UNVERIFIED_BROWSER');
  const owns=await verifyWindowsLoopbackListenerPid(port,browser.pid);
  if(signal?.aborted)return blocked('CANCELLED');
  if(!owns.ok||!isLiveApprovedChromeSession(browser))
    return blocked('UNVERIFIED_BROWSER');
  let list:unknown;
  try{
    // Consent revocation must abort target discovery HTTP itself, not just
    // subsequent CDP event monitoring. Keep the existing transport deadline.
    const requestSignal=signal
      ?AbortSignal.any([signal,AbortSignal.timeout(1600)])
      :AbortSignal.timeout(1600);
    const response=await fetch('http://127.0.0.1:'+port+'/json/list',{
      redirect:'error',signal:requestSignal});
    list=await readBoundedCdpJson(response);
  }catch{return blocked(signal?.aborted?'CANCELLED':'CDP_FAILED');}
  if(signal?.aborted)return blocked('CANCELLED');
  const tab=inspectCdpTargetList(list,port,expectedUrl);
  if(!tab.ok||tab.targetId!==target.targetId)return blocked('UNVERIFIED_TARGET');
  if(signal?.aborted)return blocked('CANCELLED');
  const observation=await capture(tab.websocketUrl,expectedUrl,durationMs,signal);
  if(signal?.aborted)return blocked('CANCELLED');
  if(!isLiveApprovedChromeSession(browser))return blocked('UNVERIFIED_BROWSER');
  if(!observation.ok)return blocked(observation.code);
  return result(observation.count>0?'PAGE_EXCEPTION_SIGNAL_ONLY':
    'NO_EXCEPTION_IN_WINDOW_ONLY','NONE',observation.count);
}
/** Local bounded journal records only predefined evidence IDs, not page data. */
export async function inspectAndLogApprovedPageExceptions(
  browser:ManagedLaunchResult,target:OpenTargetResult,expectedUrl:unknown,
  userApproved:boolean,journal:BoundedFaultLog,durationMs=1200,
  signal?:AbortSignal
):Promise<PageExceptionSignalResult>{
  const seen=await inspectApprovedPageExceptions(browser,target,expectedUrl,
    userApproved,durationMs,signal);
  journal.record(seen.status==='PAGE_EXCEPTION_SIGNAL_ONLY'
    ?Array.from({length:seen.observedCount},(_,i)=>({
      id:'page_exception_'+(i+1),code:'SCRIPT_EXCEPTION' as const
    }))
    :[{id:'page_exception_not_verified',code:'UNVERIFIED_OBSERVATION'}]);
  return seen;
}
