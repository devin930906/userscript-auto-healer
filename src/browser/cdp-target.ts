/** TASK-005: explicitly authorized target navigation in a verified owned Chrome.
 * This cannot prove login, userscript injection, GM APIs or business behavior.
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagedLaunchResult } from './owned-chrome';
import { readBoundedCdpJson, isLiveApprovedChromeSession } from './owned-chrome';
import { inspectCdpTargetList, verifyWindowsLoopbackListenerPid } from './cdp-session';

export type OpenTargetResult =
  | {readonly ok:true;readonly status:'TARGET_ID_AND_URL_MATCH_ONLY';
     readonly targetId:string;readonly businessVerified:false}
  | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'UNVERIFIED_BROWSER'|
      'INVALID_TARGET_URL'|'UNOWNED_LISTENER'|'CDP_COMMAND_FAILED'|'TARGET_NOT_CONFIRMED'|'CANCELLED'};
/** Fixed, content-blind diagnostics for a verified, explicitly approved tab only. */
export type TargetNavigationStage = 'TAB_CREATED'|'TAB_CREATION_FAILED'|
  'LIST_TRANSPORT_FAILED'|'LIST_INVALID'|'LIST_NOT_MATCHED'|
  'TARGET_ID_MISMATCH'|'MAIN_FRAME_PENDING'|'MAIN_FRAME_CONFIRMED';
function validTarget(raw:string):boolean {
  if(raw.length>4096||raw.trim()!==raw)return false;
  try{
    const url=new URL(raw);
    return ['http:','https:'].includes(url.protocol)&&!!url.hostname&&
      !url.username&&!url.password&&!url.hash;
  }catch{return false;}
}
/** Do not send Target.createTarget after cancellation or a stopped session.
 * Closing the socket cannot undo a command already accepted by Chrome; any
 * cancelled in-flight result remains unverified and is never retained.
 */
async function requestNewTab(
  wsUrl:string,targetUrl:string,signal?:AbortSignal
):Promise<string|null>{
  return new Promise(resolve=>{
    let ws:WebSocket|undefined,finished=false;
    const onAbort=()=>finish(null);
    const finish=(value:string|null)=>{
      if(finished)return;
      finished=true;clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      try{ws?.close();}catch{ /* socket already closed */ }
      resolve(value);
    };
    const timer=setTimeout(()=>finish(null),5000);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){finish(null);return;}
    try{
      ws=new WebSocket(wsUrl);
      ws.addEventListener('open',()=>{
        if(finished||signal?.aborted){finish(null);return;}
        try{ws?.send(JSON.stringify({id:2,method:'Target.createTarget',
          params:{url:targetUrl}}));}
        catch{finish(null);}
      });
      ws.addEventListener('message',event=>{
        if(finished||signal?.aborted){finish(null);return;}
        try{
          const data=JSON.parse(String(event.data)) as {
            id?:number;result?:{targetId?:unknown};error?:unknown
          };
          if(data.id!==2)return;
          const id=data.result?.targetId;
          finish(!data.error&&typeof id==='string'&&
            /^[a-zA-Z0-9_-]{8,128}$/.test(id)?id:null);
        }catch{finish(null);}
      });
      ws.addEventListener('error',()=>finish(null));
      ws.addEventListener('close',()=>finish(null));
    }catch{finish(null);}
  });
}

/** A target-list URL can advance ahead of the page's CDP main frame during
 * navigation. Only consider a newly opened tab ready once its own read-only
 * Page.getFrameTree agrees with the approved URL. This never observes DOM,
 * executes page JS, or elevates userscript/business trust.
 */
async function confirmsMainFrameNavigation(
  wsUrl:string,expectedUrl:string,signal?:AbortSignal
):Promise<boolean>{
  if(signal?.aborted)return false;
  return new Promise(resolve=>{
    let socket:WebSocket|undefined,done=false;
    const finish=(confirmed:boolean)=>{
      if(done)return;
      done=true;clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      try{socket?.close();}catch{/* socket may still be connecting */}
      resolve(confirmed&&!signal?.aborted);
    };
    const onAbort=()=>finish(false);
    const timer=setTimeout(()=>finish(false),1500);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){finish(false);return;}
    try{
      socket=new WebSocket(wsUrl);
      socket.addEventListener('open',()=>{
        if(done||signal?.aborted){finish(false);return;}
        try{socket?.send(JSON.stringify({id:1,method:'Page.getFrameTree'}));}
        catch{finish(false);}
      });
      socket.addEventListener('message',event=>{
        if(done||signal?.aborted){finish(false);return;}
        try{
          const raw=String(event.data);
          if(raw.length>16384){finish(false);return;}
          const response=JSON.parse(raw) as {
            id?:unknown;result?:{frameTree?:{frame?:{url?:unknown}}};error?:unknown
          };
          if(response.id!==1)return;
          const actual=response.result?.frameTree?.frame?.url;
          // Match canonical URL semantics used by inspectCdpTargetList:
          // Chrome may normalize host casing or default ports. Do not accept
          // same-origin but different-path navigation as target readiness.
          finish(!response.error&&typeof actual==='string'&&
            actual.length<=4096&&new URL(actual).href===new URL(expectedUrl).href);
        }catch{finish(false);}
      });
      socket.addEventListener('error',()=>finish(false));
      socket.addEventListener('close',()=>finish(false));
    }catch{finish(false);}
  });
}

/** Never accept a raw third-party CDP socket or an unapproved website. */
export async function openApprovedTarget(
  session:ManagedLaunchResult,targetUrl:string,userApproved:boolean,
  signal?:AbortSignal,
  onTargetStage?: (stage:TargetNavigationStage)=>void
):Promise<OpenTargetResult>{
  // This native-only, optional diagnostic can never grant authority.
  // Report fixed labels only; suppress observer errors and private data.
  const stage=(value:TargetNavigationStage)=>{
    try{onTargetStage?.(value);}catch{/* non-authoritative */}
  };
  if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!session || !session.ok||session.status!=='OWNED_CDP_BROWSER_VERIFIED'||
     session.websocketHandshakeVerified!==true || !isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  if(typeof targetUrl!=='string'||!validTarget(targetUrl))
    return {ok:false,code:'INVALID_TARGET_URL'};
  let socket:URL;
  try{socket=new URL(session.browserWebsocket);}
  catch{return {ok:false,code:'UNVERIFIED_BROWSER'};}
  const port=Number(socket.port);
  if(socket.protocol!=='ws:'||socket.hostname!=='127.0.0.1'||
     socket.username||socket.password||socket.search||socket.hash||
     !Number.isInteger(port)||port<1024||port>65535)
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  const owns=await verifyWindowsLoopbackListenerPid(port,session.pid);
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!owns.ok)return {ok:false,code:'UNOWNED_LISTENER'};
  if(!isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  const created=await requestNewTab(session.browserWebsocket,targetUrl,signal);
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!created){stage('TAB_CREATION_FAILED');return {ok:false,code:'CDP_COMMAND_FAILED'};}
  stage('TAB_CREATED');
  const began=Date.now();
  while(Date.now()-began<9000){
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list',{
        redirect:'error',signal:signal?
          AbortSignal.any([signal,AbortSignal.timeout(1500)]):
          AbortSignal.timeout(1500)});
      const json=await readBoundedCdpJson(response);
      if(signal?.aborted)return {ok:false,code:'CANCELLED'};
      const inspected=inspectCdpTargetList(json,port,targetUrl);
      if(!Array.isArray(json))stage('LIST_INVALID');
      else if(!inspected.ok)stage('LIST_NOT_MATCHED');
      else if(inspected.targetId!==created)stage('TARGET_ID_MISMATCH');
      else if(await confirmsMainFrameNavigation(inspected.websocketUrl,targetUrl,signal)) {
        stage('MAIN_FRAME_CONFIRMED');
        if(!isLiveApprovedChromeSession(session))
          return {ok:false,code:'UNVERIFIED_BROWSER'};
        const stillOwned=await verifyWindowsLoopbackListenerPid(port,session.pid);
        if(signal?.aborted)return {ok:false,code:'CANCELLED'};
        if(!stillOwned.ok)return {ok:false,code:'UNOWNED_LISTENER'};
        return {ok:true,status:'TARGET_ID_AND_URL_MATCH_ONLY',
          targetId:created,businessVerified:false};
      }else stage('MAIN_FRAME_PENDING');
    }catch{
      stage('LIST_TRANSPORT_FAILED');
      /* navigation is still pending; cancellation checked below */
    }
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    try{await delay(250,undefined,{signal});}
    catch{return {ok:false,code:'CANCELLED'};}
  }
  return signal?.aborted?{ok:false,code:'CANCELLED'}:
    {ok:false,code:'TARGET_NOT_CONFIRMED'};
}
