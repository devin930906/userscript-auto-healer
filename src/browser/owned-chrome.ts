/** TASK-005: explicit-consent isolated Chrome launch with fail-closed CDP HTTP/PID checks.
 * This does not establish an actual WebSocket session, tab identity, Tampermonkey
 * injection, GM API support or script repair; those are separate product gates.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import {types as nodeTypes} from 'node:util';
import { preflightChrome, inspectWindowsChromeBinary } from './chrome-launcher';
import { inspectCdpVersion, verifyWindowsLoopbackListenerPid, verifyCdpBrowserWebSocket, type ListenerOwnerResult } from './cdp-session';


/** Reject oversized or invalid CDP JSON based on bytes actually streamed.
 * A missing or dishonest Content-Length must not bypass this limit.
 */
export async function readBoundedCdpJson(response:Response):Promise<unknown|null> {
  const limit=16384;
  // An early status/header rejection must not leave an unread HTTP response
  // pinned to the loopback connection. Cleanup is best-effort and must never
  // hold the security rejection open if an untrusted stream cannot cancel.
  const rejectUnread=():null=>{
    if(response.body)void response.body.cancel().catch(()=>undefined);
    return null;
  };
  if(response.status!==200)return rejectUnread();
  const length=response.headers.get('content-length');
  if(length!==null &&
     (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)) ||
      Number(length)>limit))return rejectUnread();
  if(!response.body)return null;
  const reader=response.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,body='';
  // HTTP headers may arrive within the fetch timeout while the body never
  // finishes. A separate bounded body deadline is necessary: response.json(),
  // reader.read() and even reader.cancel() can otherwise remain pending and
  // stall the owned-Chrome bootstrap indefinitely. No partial JSON is trusted.
  let deadline:NodeJS.Timeout|undefined;
  const readBody=async():Promise<unknown|null>=>{
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>limit){
          // Never await an untrusted cancellation implementation.
          try{void reader.cancel().catch(()=>undefined);}catch{}
          return null;
        }
        body+=decoder.decode(value,{stream:true});
      }
      body+=decoder.decode();
      return bytes>0?JSON.parse(body) as unknown:null;
    }catch{return null;}
  };
  try{
    return await Promise.race([
      readBody(),
      new Promise<null>(resolve=>{
        deadline=setTimeout(()=>{
          // Revoke a stalled stream without waiting for its cancel hook.
          // A late read result cannot authorize a partial CDP response.
          try{void reader.cancel().catch(()=>undefined);}catch{}
          resolve(null);
        },1500);
      })
    ]);
  }finally{
    if(deadline)clearTimeout(deadline);
    // A pending reader.read() can make releaseLock throw. Cleanup must not
    // hide the bounded, fail-closed outcome or extend the startup deadline.
    try{reader.releaseLock();}catch{}
  }
}

export type LaunchFailure = 'NOT_AUTHORIZED'|'ABORTED'|'PREFLIGHT_FAILED'|
  'BINARY_NOT_VERIFIED'|'LAUNCH_FAILED'|'CDP_TIMEOUT'|'OWNER_MISMATCH'|'VERSION_MISMATCH'|'WEBSOCKET_VERIFICATION_FAILED';
export type ManagedLaunchResult =
  | {readonly ok:false;readonly code:LaunchFailure}
  | {readonly ok:true;readonly status:'OWNED_CDP_BROWSER_VERIFIED';
      readonly pid:number;readonly chromeVersion:string;readonly browserWebsocket:string;
      readonly websocketHandshakeVerified:true;readonly targetVerified:false;
      readonly stop:()=>void};
export type ChromeStartupStage='FETCH_FAILED'|'FETCH_REFUSED'|'FETCH_TIMEOUT'|
  'FETCH_RESET'|'CHILD_RUNNING_NO_CDP'|'HTTP_REJECTED'|'BODY_REJECTED'|
  'CDP_VERSION_REJECTED'|'CDP_VERSION_PARSED'|'PROBE_ERROR'|
  'CDP_TIMEOUT_LISTENER_PID_MATCH'|'CDP_TIMEOUT_LISTENER_UNAVAILABLE'|
  'CDP_TIMEOUT_LISTENER_PID_MISMATCH'|'CDP_TIMEOUT_LISTENER_AMBIGUOUS'|
  'CDP_TIMEOUT_PROBE_INCONCLUSIVE';

/** Only fixed, redacted transport labels. Never serialize an underlying
 * fetch/undici error, socket address, Chrome profile, process or user script.
 * Ignore arbitrary getters, prototype chains and hostile Proxy failures.
 */
/** Map only known transport codes to fixed diagnostic labels; never serialize
 * Error.message, endpoint, profile details or a nested rejection payload.
 */
function transportCodeLabel(code:unknown):
 'FETCH_REFUSED'|'FETCH_TIMEOUT'|'FETCH_RESET'|undefined {
 if(code==='ECONNREFUSED')return 'FETCH_REFUSED';
 if(code==='ECONNRESET'||code==='EPIPE')return 'FETCH_RESET';
 if(code==='ETIMEDOUT'||code==='UND_ERR_CONNECT_TIMEOUT'||
    code==='UND_ERR_HEADERS_TIMEOUT')return 'FETCH_TIMEOUT';
 return undefined;
}
export function classifyCdpStartupTransportFailure(error:unknown):
 'FETCH_FAILED'|'FETCH_REFUSED'|'FETCH_TIMEOUT'|'FETCH_RESET' {
 let current:unknown=error;
 for(let depth=0;depth<3;depth++){
  if(!current||typeof current!=='object'||nodeTypes.isProxy(current))
    return 'FETCH_FAILED';
  let desc:PropertyDescriptorMap;
  try{desc=Object.getOwnPropertyDescriptors(current);}
  catch{return 'FETCH_FAILED';}
  // Node/undici can wrap multiple socket failures in a native AggregateError.
  // Only a small, fully inspectable, unanimous set is specific enough for a
  // redacted label. Mixed, sparse, foreign or hostile reports are UNKNOWN.
  if(current instanceof AggregateError){
    try{
      const reasons:unknown=desc.errors?.value;
      if(nodeTypes.isProxy(reasons)||!Array.isArray(reasons)||
         Object.getPrototypeOf(reasons)!==Array.prototype||
         reasons.length<1||reasons.length>8)return 'FETCH_FAILED';
      let unanimous:'FETCH_REFUSED'|'FETCH_TIMEOUT'|'FETCH_RESET'|undefined;
      for(let i=0;i<reasons.length;i++){
        const entry=Object.getOwnPropertyDescriptor(reasons,String(i));
        const reason:unknown=entry?.value;
        if(!entry||!Object.prototype.hasOwnProperty.call(entry,'value')||
           !reason||typeof reason!=='object'||nodeTypes.isProxy(reason))
          return 'FETCH_FAILED';
        const result=transportCodeLabel(
          Object.getOwnPropertyDescriptors(reason).code?.value);
        if(!result||(unanimous!==undefined&&unanimous!==result))
          return 'FETCH_FAILED';
        unanimous=result;
      }
      return unanimous??'FETCH_FAILED';
    }catch{return 'FETCH_FAILED';}
  }
  const label=transportCodeLabel(desc.code?.value);
  if(label)return label;
  if(desc.name?.value==='TimeoutError')return 'FETCH_TIMEOUT';
  current=desc.cause?.value;
 }
 // AbortSignal.timeout() rejects with a native DOMException whose name
 // may be inherited, rather than an own property descriptor.
 if(typeof DOMException!=='undefined'&&error instanceof DOMException&&
    error.name==='TimeoutError')return 'FETCH_TIMEOUT';
 return 'FETCH_FAILED';
}
/** A timeout is not proof of a Chrome/port conflict. Keep the actual Windows
 * listener observation separate from CDP version/owner/WebSocket verification.
 * These fixed labels contain no PID, port, profile, URL or OS-error text.
 * LISTENER_UNAVAILABLE may also mean the OS probe failed; it does not by
 * itself prove that no listening socket exists.
 */
export function classifyCdpTimeoutListener(result:ListenerOwnerResult):ChromeStartupStage {
  if(result.ok)return 'CDP_TIMEOUT_LISTENER_PID_MATCH';
  switch(result.code){
    case 'LISTENER_UNAVAILABLE':return 'CDP_TIMEOUT_LISTENER_UNAVAILABLE';
    case 'LISTENER_PID_MISMATCH':return 'CDP_TIMEOUT_LISTENER_PID_MISMATCH';
    case 'LISTENER_AMBIGUOUS':return 'CDP_TIMEOUT_LISTENER_AMBIGUOUS';
    default:return 'CDP_TIMEOUT_PROBE_INCONCLUSIVE';
  }
}
export interface ChromeLaunchOptions {
  /** Explicit user approval to launch THIS isolated Chrome, not general script consent. */
  readonly userApproved:boolean;
  /** Disposable GitHub Actions test profile only. */
  readonly testHeadless?:boolean;
  readonly signal?:AbortSignal;
  /** Called only if a verified, still-owned Chrome process exits unexpectedly. */
  readonly onUnexpectedExit?:()=>void;
  /** Trusted native diagnostics only; emits fixed stage labels, never URL,
   * profile, PID, response body or transport error text. Non-authoritative. */
  readonly onStartupStage?:(stage:ChromeStartupStage)=>void;
}
/** Only references actually issued by this process can open CDP targets.
 * A serialized/forged success-shaped result is not an authorized session.
 */
const liveSessions=new WeakMap<object,ChildProcess>();
export function isLiveApprovedChromeSession(
  session:ManagedLaunchResult
):session is Extract<ManagedLaunchResult,{ok:true}> {
  // An exported inspector can receive an arbitrary object at runtime. Only
  // objects already held by this private WeakMap may have their properties read.
  // WeakMap.get never invokes Proxy property/accessor traps, even for a
  // revoked proxy. A live registered session is frozen by the native launcher.
  if(!session||typeof session!=='object')return false;
  const child=liveSessions.get(session);
  if(!child)return false;
  return session.ok===true&&session.status==='OWNED_CDP_BROWSER_VERIFIED'&&
    child.pid===session.pid&&child.exitCode===null&&
    !child.killed&&child.signalCode===null;
}
function stopOwnChild(child:ChildProcess):void {
  if(child.pid && child.exitCode===null && !child.killed)child.kill();
}
/** TASK-005 / TEST-006/007/009/026: snapshot native consent without running
 * caller-defined getters, inherited authorization or Proxy reflection traps.
 * No browser preflight, executable inspection or filesystem side effect may
 * occur until these options pass this fail-closed boundary.
 */
function checkedChromeLaunchOptions(raw:unknown):ChromeLaunchOptions|null {
 try{
  if(!raw||typeof raw!=='object'||nodeTypes.isProxy(raw))return null;
  const prototype=Object.getPrototypeOf(raw);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const desc=Object.getOwnPropertyDescriptors(raw);
  const allowed=new Set(['userApproved','signal','testHeadless',
    'onStartupStage','onUnexpectedExit']);
  for(const key of Reflect.ownKeys(desc)){
   if(typeof key!=='string'||!allowed.has(key)||
      !Object.prototype.hasOwnProperty.call(desc[key],'value'))return null;
  }
  if(desc.userApproved?.value!==true)return null;
  const signal:unknown=desc.signal?.value;
  if(signal!==undefined){
   if(!signal||typeof signal!=='object'||nodeTypes.isProxy(signal)||
      Object.getPrototypeOf(signal)!==AbortSignal.prototype||
      ['aborted','addEventListener','removeEventListener'].some(key=>
        Object.prototype.hasOwnProperty.call(signal,key)))return null;
   const getter=Object.getOwnPropertyDescriptor(
     AbortSignal.prototype,'aborted')?.get;
   if(typeof getter!=='function'||typeof getter.call(signal)!=='boolean')
     return null;
  }
  const headless:unknown=desc.testHeadless?.value;
  if(headless!==undefined&&typeof headless!=='boolean')return null;
  const startup:unknown=desc.onStartupStage?.value;
  const unexpected:unknown=desc.onUnexpectedExit?.value;
  if((startup!==undefined&&
      (typeof startup!=='function'||nodeTypes.isProxy(startup)))||
     (unexpected!==undefined&&
      (typeof unexpected!=='function'||nodeTypes.isProxy(unexpected))))
    return null;
  return {userApproved:true,signal:signal as AbortSignal|undefined,
    testHeadless:headless as boolean|undefined,
    onStartupStage:startup as ChromeLaunchOptions['onStartupStage'],
    onUnexpectedExit:unexpected as ChromeLaunchOptions['onUnexpectedExit']};
 }catch{return null;}
}
/** Never attach to an unowned endpoint, create an unknown Profile or stop another PID. */
export async function launchApprovedIsolatedChrome(
  input:unknown,options:ChromeLaunchOptions
):Promise<ManagedLaunchResult> {
  const checked=checkedChromeLaunchOptions(options);
  if(!checked)return {ok:false,code:'NOT_AUTHORIZED'};
  if(checked.signal?.aborted)return {ok:false,code:'ABORTED'};
  const preflight=await preflightChrome(input);
  if(!preflight.ok)return {ok:false,code:'PREFLIGHT_FAILED'};
  const binary=await inspectWindowsChromeBinary(preflight.config);
  if(!binary.ok)return {ok:false,code:'BINARY_NOT_VERIFIED'};
  if(checked.signal?.aborted)return {ok:false,code:'ABORTED'};
  if(checked.testHeadless===true && process.env.GITHUB_ACTIONS!=='true')
    return {ok:false,code:'NOT_AUTHORIZED'};
  const cfg=preflight.config;
  const argv=[
    '--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port='+cfg.remoteDebuggingPort,
    '--user-data-dir='+cfg.userDataDir,'about:blank'
  ];
  if(checked.testHeadless===true)argv.unshift('--headless=new');
  let child:ChildProcess;
  try{
    child=spawn(cfg.executablePath,argv,{shell:false,windowsHide:true,stdio:'ignore'});
  }catch{return {ok:false,code:'LAUNCH_FAILED'};}
  let errored=false,exited=false,retained=false;
  child.once('error',()=>{errored=true;});
  child.once('exit',()=>{exited=true;});
  if(!child.pid){stopOwnChild(child);return {ok:false,code:'LAUNCH_FAILED'};}
  const emitStage=(stage:ChromeStartupStage):void=>{
    try{checked.onStartupStage?.(stage);}
    catch{/* Diagnostic subscribers cannot affect Chrome authorization. */}
  };
  const pid=child.pid;
  const url='http://127.0.0.1:'+cfg.remoteDebuggingPort+'/json/version';
  // Deadline uses monotonic process time: OS clock corrections must not
  // prematurely cut off (or extend) the 20-second consented CDP bootstrap.
  const began=performance.now();
  try{
    while(performance.now()-began<20000){
      if(checked.signal?.aborted)return {ok:false,code:'ABORTED'};
      if(errored||exited)return {ok:false,code:'LAUNCH_FAILED'};
      let phase:'FETCH'|'PROCESS'='FETCH';
      try{
        // The per-probe timeout is independent of native revocation. A
        // revoked consent must cancel a still-pending CDP HTTP request,
        // not wait for this independent 1500ms deadline to expire.
        const fetchSignal=checked.signal?
          AbortSignal.any([checked.signal,AbortSignal.timeout(1500)]):
          AbortSignal.timeout(1500);
        const response=await fetch(url,{redirect:'error',signal:fetchSignal});
        phase='PROCESS';
        const payload=await readBoundedCdpJson(response);
        if(response.status!==200)emitStage('HTTP_REJECTED');
        else if(payload===null)emitStage('BODY_REJECTED');
        if(payload!==null){
            const inspected=inspectCdpVersion(payload,cfg.remoteDebuggingPort);
            if(!inspected.ok)emitStage('CDP_VERSION_REJECTED');
            if(inspected.ok){
              emitStage('CDP_VERSION_PARSED');
              if(inspected.browser!=='Chrome/'+binary.version &&
                 inspected.browser!=='HeadlessChrome/'+binary.version)
                return {ok:false,code:'VERSION_MISMATCH'};
              const owner=await verifyWindowsLoopbackListenerPid(cfg.remoteDebuggingPort,pid);
              if(!owner.ok)return {ok:false,code:'OWNER_MISMATCH'};
              if(checked.signal?.aborted)return {ok:false,code:'ABORTED'};
              const handshake=await verifyCdpBrowserWebSocket(inspected.websocketUrl,
                cfg.remoteDebuggingPort,binary.version);
              // Consent may be revoked during the asynchronous handshake.
              // A successful transport proof must never reactivate a cancelled launch.
              if(checked.signal?.aborted)return {ok:false,code:'ABORTED'};
              // CDP identity proofs completed after the fixed monotonic
              // bootstrap deadline are not a valid launch receipt. In
              // particular, a late successful WebSocket handshake must not
              // turn an already-expired launch into an authorized session.
              if(performance.now()-began>=20000)
                return {ok:false,code:'CDP_TIMEOUT'};
              if(!handshake)return {ok:false,code:'WEBSOCKET_VERIFICATION_FAILED'};
              if(errored||exited||child.killed||child.exitCode!==null)
                return {ok:false,code:'LAUNCH_FAILED'};
              const verified:Extract<ManagedLaunchResult,{ok:true}>=Object.freeze({
                ok:true,status:'OWNED_CDP_BROWSER_VERIFIED',pid,
                chromeVersion:binary.version,browserWebsocket:inspected.websocketUrl,
                websocketHandshakeVerified:true,targetVerified:false,
                stop:()=>{liveSessions.delete(verified);stopOwnChild(child);}
              });
              liveSessions.set(verified,child);
              // An externally closed/crashed Chrome must revoke any native
              // consented GM fixture immediately. Intentional stop() removes
              // ownership before exit, and must not invoke this callback.
              const onUnexpectedExit=()=>{
                if(!liveSessions.delete(verified))return;
                try{checked.onUnexpectedExit?.();}
                catch{/* Lifecycle cleanup must not crash the main process. */}
              };
              child.once('exit',onUnexpectedExit);
              child.once('error',onUnexpectedExit);
              retained=true;
              return verified;
            }
        }
      }catch(error){
        // Fixed labels only. Raw transport errors may disclose loopback
        // addresses, user paths or Chrome runtime details.
        emitStage(phase==='FETCH'
          ?classifyCdpStartupTransportFailure(error):'PROBE_ERROR');
      }
      await delay(250);
    }
    // A child can stay alive without ever exposing the required owned
    // listener. Record only that boundary, not process/profile/port data.
    if(!exited&&!errored&&child.exitCode===null&&!child.killed){
      emitStage('CHILD_RUNNING_NO_CDP');
      // CI disposable Chrome only. A bounded OS-owned PID check diagnoses
      // which boundary timed out; it does NOT relax the 20s deadline, retry
      // a partly initialized profile, or grant a CDP ownership receipt.
      if(checked.testHeadless===true&&process.env.GITHUB_ACTIONS==='true'){
        let stage:ChromeStartupStage='CDP_TIMEOUT_PROBE_INCONCLUSIVE';
        try{
          stage=classifyCdpTimeoutListener(
            await verifyWindowsLoopbackListenerPid(cfg.remoteDebuggingPort,pid));
        }catch{/* Never publish OS error text or change the failure result. */}
        emitStage(stage);
      }
    }
    return {ok:false,code:'CDP_TIMEOUT'};
  }finally{
    if(!retained)stopOwnChild(child);
  }
}
