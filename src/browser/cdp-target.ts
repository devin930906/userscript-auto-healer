/** TASK-005: explicitly authorized target navigation in a verified owned Chrome.
 * This cannot prove login, userscript injection, GM APIs or business behavior.
 */
import { setTimeout as delay } from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {types as nodeTypes} from 'node:util';
import type { ManagedLaunchResult } from './owned-chrome';
import { readBoundedCdpJson, isLiveApprovedChromeSession } from './owned-chrome';
import { inspectCdpTargetList, verifyWindowsLoopbackListenerPid } from './cdp-session';

export type OpenTargetResult =
  | {readonly ok:true;readonly status:'TARGET_ID_AND_URL_MATCH_ONLY';
     readonly targetId:string;readonly businessVerified:false}
  | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'UNVERIFIED_BROWSER'|
      'INVALID_TARGET_URL'|'UNOWNED_LISTENER'|'CDP_COMMAND_FAILED'|'TARGET_NOT_CONFIRMED'|'CANCELLED'|'INVALID_OPTIONS'};
/** Fixed, content-blind diagnostics for a verified, explicitly approved tab only. */
export type TargetNavigationStage = 'TAB_CREATED'|'TAB_CREATION_FAILED'|
  'LIST_TRANSPORT_FAILED'|'LIST_INVALID'|'LIST_NOT_MATCHED'|
  'TARGET_ID_MISMATCH'|'MAIN_FRAME_PENDING'|'MAIN_FRAME_CONFIRMED'|
  'MAIN_FRAME_ABOUT_BLANK'|'MAIN_FRAME_MISSING_URL'|
  'MAIN_FRAME_INVALID_URL'|'MAIN_FRAME_URL_MISMATCH'|
  'MAIN_FRAME_CDP_REJECTED'|'MAIN_FRAME_RESPONSE_INVALID'|
  'MAIN_FRAME_TRANSPORT_FAILED'|
  'UNVERIFIED_TAB_CLOSED'|'UNVERIFIED_TAB_CLEANUP_UNCONFIRMED';
function validTarget(raw:string):boolean {
  if(raw.length>4096||raw.trim()!==raw)return false;
  try{
    const url=new URL(raw);
    return ['http:','https:'].includes(url.protocol)&&!!url.hostname&&
      !url.username&&!url.password&&!url.hash;
  }catch{return false;}
}
/** Content-blind classification of the read-only Page.getFrameTree receipt.
 * Only fixed labels leave this boundary; raw URLs never enter diagnostics.
 * This is evidence for diagnosis, not proof of script or business readiness.
 */
export function classifyMainFrameUrl(actual:unknown,expected:string):TargetNavigationStage{
  if(actual==='about:blank')return 'MAIN_FRAME_ABOUT_BLANK';
  if(typeof actual!=='string'||actual.length===0)return 'MAIN_FRAME_MISSING_URL';
  if(actual.length>4096||typeof expected!=='string'||expected.length>4096)
    return 'MAIN_FRAME_INVALID_URL';
  try{
    const found=new URL(actual),approved=new URL(expected);
    if(!['http:','https:'].includes(found.protocol)||
      found.username||found.password||found.hash||
      !['http:','https:'].includes(approved.protocol)||
      approved.username||approved.password||approved.hash)
      return 'MAIN_FRAME_INVALID_URL';
    return found.href===approved.href?
      'MAIN_FRAME_CONFIRMED':'MAIN_FRAME_URL_MISMATCH';
  }catch{return 'MAIN_FRAME_INVALID_URL';}
}

/** Classify a bounded CDP Page.getFrameTree message without leaking error
 * text, URL, source or arbitrary page data. null means an unrelated message
 * ID and is not a navigation receipt. All errors remain fail-closed.
 */
export function classifyMainFrameResponse(
  raw:unknown, expectedUrl:string
):TargetNavigationStage|null{
  if(typeof raw!=='string'||raw.length>16384)return 'MAIN_FRAME_RESPONSE_INVALID';
  try{
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
      return 'MAIN_FRAME_RESPONSE_INVALID';
    const receipt=parsed as {id?:unknown;error?:unknown;
      result?:{frameTree?:{frame?:{url?:unknown}}}};
    if(receipt.id!==1)return null;
    if(Object.prototype.hasOwnProperty.call(receipt,'error'))
      return 'MAIN_FRAME_CDP_REJECTED';
    const result=receipt.result;
    if(!result||typeof result!=='object'||Array.isArray(result)||
       !result.frameTree||typeof result.frameTree!=='object'||
       Array.isArray(result.frameTree)||
       !result.frameTree.frame||typeof result.frameTree.frame!=='object'||
       Array.isArray(result.frameTree.frame))
      return 'MAIN_FRAME_RESPONSE_INVALID';
    // Page.getFrameTree's top frame must have its own protocol frame ID,
    // no parent frame, and no unreachable navigation marker. Matching an
    // approved URL alone does not certify a live top-level document.
    // These checks cannot attest script execution or business recovery.
    const frame=result.frameTree.frame as {
      id?:unknown;parentId?:unknown;unreachableUrl?:unknown;url?:unknown
    };
    if(typeof frame.id!=='string'||
       !/^[a-zA-Z0-9_-]{8,128}$/.test(frame.id)||
       Object.prototype.hasOwnProperty.call(frame,'parentId')||
       Object.prototype.hasOwnProperty.call(frame,'unreachableUrl'))
      return 'MAIN_FRAME_RESPONSE_INVALID';
    return classifyMainFrameUrl(frame.url,expectedUrl);
  }catch{return 'MAIN_FRAME_RESPONSE_INVALID';}
}

/** Parse only the bounded JSON text for this owned Chrome command.
 * undefined is an unrelated CDP message id; null is an invalid/failed
 * command receipt. No error text or page data may be returned.
 */
export function readCreatedTargetReceipt(raw:unknown):string|null|undefined{
  if(typeof raw!=='string'||raw.length>16384)return null;
  try{
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
    const data=parsed as {id?:unknown;result?:{targetId?:unknown};error?:unknown};
    if(data.id!==2)return undefined;
    if(Object.prototype.hasOwnProperty.call(data,'error'))return null;
    const result=data.result;
    if(!result||typeof result!=='object'||Array.isArray(result))return null;
    const id=result.targetId;
    return typeof id==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(id)?id:null;
  }catch{return null;}
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
        // Reject oversized, binary or malformed replies before JSON.parse.
        // Only a valid Target.createTarget receipt can mint the tab identity.
        const id=readCreatedTargetReceipt(event.data);
        if(id!==undefined)finish(id);
      });
      ws.addEventListener('error',()=>finish(null));
      ws.addEventListener('close',()=>finish(null));
    }catch{finish(null);}
  });
}


/** Read only native text for Target.closeTarget. A present CDP error field
 * is never an acknowledgement, even when its JSON value is falsy and the
 * result also says success. Ignore unrelated event IDs without promoting
 * malformed/binary/oversized data into a verified cleanup receipt.
 */
export function readClosedTargetReceipt(raw:unknown):boolean|undefined{
  if(typeof raw!=='string'||raw.length>16384)return false;
  try{
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return false;
    const receipt=parsed as {id?:unknown;error?:unknown;result?:unknown};
    if(receipt.id!==3)return undefined;
    if(Object.prototype.hasOwnProperty.call(receipt,'error'))return false;
    const result=receipt.result;
    return !!result&&typeof result==='object'&&!Array.isArray(result)&&
      (result as {success?:unknown}).success===true;
  }catch{return false;}
}

/** TASK-008 / TEST-013/026: an acknowledged tab closure is not verified
 * until a bounded, well-formed /json/list shows the specific ID absent.
 * Never invoke an untrusted getter or Proxy when used as a direct API.
 */
export function isClosedTargetAbsentFromValidList(payload:unknown,targetId:unknown):boolean{
  try{
    if(typeof targetId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(targetId)||
       !Array.isArray(payload)||nodeTypes.isProxy(payload)||
       Object.getPrototypeOf(payload)!==Array.prototype)return false;
    const entries=Object.getOwnPropertyDescriptors(payload);
    const size=entries.length?.value;
    if(!Number.isSafeInteger(size)||size<0||size>1000||
       Reflect.ownKeys(entries).length!==size+1)return false;
    const seen=new Set<string>();
    for(let i=0;i<size;i++){
      const slot=entries[String(i)];
      if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return false;
      const row:unknown=slot.value;
      if(!row||typeof row!=='object'||Array.isArray(row)||
         nodeTypes.isProxy(row))return false;
      const proto=Object.getPrototypeOf(row);
      if(proto!==Object.prototype&&proto!==null)return false;
      const desc=Object.getOwnPropertyDescriptors(row);
      const id=desc.id,type=desc.type,url=desc.url;
      if(!id||!type||!url||
         !Object.prototype.hasOwnProperty.call(id,'value')||
         !Object.prototype.hasOwnProperty.call(type,'value')||
         !Object.prototype.hasOwnProperty.call(url,'value')||
         typeof id.value!=='string'||
         !/^[a-zA-Z0-9_-]{8,128}$/.test(id.value)||
         typeof type.value!=='string'||type.value.length>64||
         typeof url.value!=='string'||url.value.length>8192||
         seen.has(id.value))return false;
      seen.add(id.value);
    }
    return !seen.has(targetId);
  }catch{return false;}
}

/** Undo only the page ID minted by THIS Target.createTarget call. This
 * bounded cleanup runs even after the original navigation consent is
 * cancelled; it never replays the URL, executes script, closes other tabs
 * or elevates a failed page into a trusted observation. The live Chrome
 * process and listener PID must be rechecked by the caller first.
 */
async function closeUnverifiedNewTab(
  browserWebsocket:string,targetId:string,port:number
):Promise<boolean>{
  const acknowledged=await new Promise<boolean>(resolve=>{
    let socket:WebSocket|undefined,done=false;
    const finish=(ok:boolean)=>{
      if(done)return;
      done=true;clearTimeout(timer);
      try{socket?.close();}catch{/* already closed */}
      resolve(ok);
    };
    const timer=setTimeout(()=>finish(false),2000);
    try{
      socket=new WebSocket(browserWebsocket);
      socket.addEventListener('open',()=>{
        if(done)return;
        try{socket?.send(JSON.stringify({id:3,method:'Target.closeTarget',
          params:{targetId}}));}
        catch{finish(false);}
      });
      socket.addEventListener('message',event=>{
        if(done)return;
        const acknowledged=readClosedTargetReceipt(event.data);
        if(acknowledged!==undefined)finish(acknowledged);
      });
      socket.addEventListener('error',()=>finish(false));
      socket.addEventListener('close',()=>finish(false));
    }catch{finish(false);}
  });
  if(!acknowledged)return false;
  // CDP's close acknowledgement can precede removal from /json/list.
  // Require a fresh, bounded read-only target-list receipt before asserting
  // cleanup. Unavailable or malformed receipts remain UNCONFIRMED.
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list',{
        redirect:'error',signal:AbortSignal.timeout(1000)});
      const json=await readBoundedCdpJson(response);
      if(isClosedTargetAbsentFromValidList(json,targetId))return true;
    }catch{/* bounded verification retry */}
    await delay(100);
  }
  return false;
}

/** A target-list URL can advance ahead of the page's CDP main frame during
 * navigation. Only consider a newly opened tab ready once its own read-only
 * Page.getFrameTree agrees with the approved URL. This never observes DOM,
 * executes page JS, or elevates userscript/business trust.
 */
async function confirmsMainFrameNavigation(
  wsUrl:string,expectedUrl:string,signal?:AbortSignal
):Promise<TargetNavigationStage>{
  if(signal?.aborted)return 'MAIN_FRAME_PENDING';
  return new Promise(resolve=>{
    let socket:WebSocket|undefined,done=false;
    const finish=(stage:TargetNavigationStage)=>{
      if(done)return;
      done=true;clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      try{socket?.close();}catch{/* socket may still be connecting */}
      resolve(signal?.aborted?'MAIN_FRAME_PENDING':stage);
    };
    const onAbort=()=>finish('MAIN_FRAME_PENDING');
    const timer=setTimeout(()=>finish('MAIN_FRAME_PENDING'),1500);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){finish('MAIN_FRAME_PENDING');return;}
    try{
      socket=new WebSocket(wsUrl);
      socket.addEventListener('open',()=>{
        if(done||signal?.aborted){finish('MAIN_FRAME_PENDING');return;}
        try{socket?.send(JSON.stringify({id:1,method:'Page.getFrameTree'}));}
        catch{finish('MAIN_FRAME_TRANSPORT_FAILED');}
      });
      socket.addEventListener('message',event=>{
        if(done||signal?.aborted){finish('MAIN_FRAME_PENDING');return;}
        // Never emit the CDP payload; only an allowlisted fixed stage.
        const receipt=classifyMainFrameResponse(event.data,expectedUrl);
        if(receipt!==null)finish(receipt);
      });
      socket.addEventListener('error',()=>finish('MAIN_FRAME_TRANSPORT_FAILED'));
      socket.addEventListener('close',()=>finish('MAIN_FRAME_TRANSPORT_FAILED'));
    }catch{finish('MAIN_FRAME_TRANSPORT_FAILED');}
  });
}

/** Direct exported native API boundary: a forged AbortSignal getter can
 * execute caller code before ownership verification or turn a cancellation
 * check into an uncaught exception. Use native internal slots, never call
 * arbitrary accessors, shadow event methods or proxy traps.
 */
function validNativeCancelSignal(value:unknown):value is AbortSignal{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(key=>
       Object.prototype.hasOwnProperty.call(value,key)))return false;
  const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
  return typeof getter==='function'&&typeof getter.call(value)==='boolean';
 }catch{return false;}
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
  if(signal!==undefined&&!validNativeCancelSignal(signal))
    return {ok:false,code:'INVALID_OPTIONS'};
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  // WeakMap-backed ownership MUST precede reads of session.ok/status etc.
  // Forged objects, including revoked Proxies, cannot invoke user accessors.
  if(!isLiveApprovedChromeSession(session)||
     session.websocketHandshakeVerified!==true)
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
  if(!created){
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    stage('TAB_CREATION_FAILED');return {ok:false,code:'CDP_COMMAND_FAILED'};
  }
  stage('TAB_CREATED');
  let verified=false;
  try {
    // Cancellation after the tab's creation still requires best-effort
    // cleanup. The finally block never replays the approved navigation.
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    // The nine-second target confirmation budget must survive wall-clock shifts.
    // Monotonic time preserves the original limit and conservative failure.
    const began=performance.now();
  while(performance.now()-began<9000){
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list',{
        redirect:'error',signal:signal?
          AbortSignal.any([signal,AbortSignal.timeout(1500)]):
          AbortSignal.timeout(1500)});
      const json=await readBoundedCdpJson(response);
      if(signal?.aborted)return {ok:false,code:'CANCELLED'};
      const inspected=inspectCdpTargetList(json,port,targetUrl,created);
      if(!Array.isArray(json))stage('LIST_INVALID');
      else if(!inspected.ok)stage('LIST_NOT_MATCHED');
      else if(inspected.targetId!==created)stage('TARGET_ID_MISMATCH');
      else {
        const frameStage=await confirmsMainFrameNavigation(
          inspected.websocketUrl,targetUrl,signal);
        stage(frameStage);
        if(frameStage==='MAIN_FRAME_CONFIRMED'){
        if(!isLiveApprovedChromeSession(session))
          return {ok:false,code:'UNVERIFIED_BROWSER'};
        const stillOwned=await verifyWindowsLoopbackListenerPid(port,session.pid);
        if(signal?.aborted)return {ok:false,code:'CANCELLED'};
        if(!stillOwned.ok)return {ok:false,code:'UNOWNED_LISTENER'};
        // The owned session may be stopped while the final PID query awaits.
        // An earlier listener match cannot verify an already-ended browser.
        if(!isLiveApprovedChromeSession(session))
          return {ok:false,code:'UNVERIFIED_BROWSER'};
        verified=true;
        return {ok:true,status:'TARGET_ID_AND_URL_MATCH_ONLY',
          targetId:created,businessVerified:false};
        }
      }
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
  } finally {
    if(!verified){
      // Only close the target minted above, only if the ORIGINAL owned
      // Chrome is still live and owns this exact loopback listener.
      // Cleanup failure is not permission to trust or relaunch the page.
      try{
        if(isLiveApprovedChromeSession(session)){
          const owner=await verifyWindowsLoopbackListenerPid(port,session.pid);
          if(owner.ok&&isLiveApprovedChromeSession(session)){
            const cleaned=await closeUnverifiedNewTab(
              session.browserWebsocket,created,port);
            stage(cleaned?'UNVERIFIED_TAB_CLOSED':
              'UNVERIFIED_TAB_CLEANUP_UNCONFIRMED');
          }else stage('UNVERIFIED_TAB_CLEANUP_UNCONFIRMED');
        }
      }catch{stage('UNVERIFIED_TAB_CLEANUP_UNCONFIRMED');}
    }
  }
}
