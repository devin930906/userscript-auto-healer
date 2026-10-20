/** TASK-005: explicit-consent isolated Chrome launch with fail-closed CDP HTTP/PID checks.
 * This does not establish an actual WebSocket session, tab identity, Tampermonkey
 * injection, GM API support or script repair; those are separate product gates.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { preflightChrome, inspectWindowsChromeBinary } from './chrome-launcher';
import { inspectCdpVersion, verifyWindowsLoopbackListenerPid, verifyCdpBrowserWebSocket } from './cdp-session';


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
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>limit){
        // Cancellation is best-effort cleanup. A hostile or broken response
        // may never settle its cancel promise; never block fail-closed size
        // rejection or the owning Chrome startup on that asynchronous work.
        void reader.cancel().catch(()=>undefined);
        return null;
      }
      body+=decoder.decode(value,{stream:true});
    }
    body+=decoder.decode();
    return bytes>0?JSON.parse(body) as unknown:null;
  }catch{
    return null;
  }finally{
    reader.releaseLock();
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
  'CDP_VERSION_REJECTED'|'CDP_VERSION_PARSED'|'PROBE_ERROR';

/** Only fixed, redacted transport labels. Never serialize an underlying
 * fetch/undici error, socket address, Chrome profile, process or user script.
 * Ignore arbitrary getters, prototype chains and hostile Proxy failures.
 */
export function classifyCdpStartupTransportFailure(error:unknown):
 'FETCH_FAILED'|'FETCH_REFUSED'|'FETCH_TIMEOUT'|'FETCH_RESET' {
 let current:unknown=error;
 for(let depth=0;depth<3;depth++){
  if(!current||typeof current!=='object')break;
  let desc:PropertyDescriptorMap;
  try{desc=Object.getOwnPropertyDescriptors(current);}
  catch{return 'FETCH_FAILED';}
  const code=desc.code?.value;
  if(code==='ECONNREFUSED')return 'FETCH_REFUSED';
  if(code==='ECONNRESET'||code==='EPIPE')return 'FETCH_RESET';
  if(code==='ETIMEDOUT'||code==='UND_ERR_CONNECT_TIMEOUT'||
     code==='UND_ERR_HEADERS_TIMEOUT')return 'FETCH_TIMEOUT';
  if(desc.name?.value==='TimeoutError')return 'FETCH_TIMEOUT';
  current=desc.cause?.value;
 }
 // AbortSignal.timeout() rejects with a native DOMException whose name
 // may be inherited, rather than an own property descriptor.
 if(typeof DOMException!=='undefined'&&error instanceof DOMException&&
    error.name==='TimeoutError')return 'FETCH_TIMEOUT';
 return 'FETCH_FAILED';
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
export function isLiveApprovedChromeSession(session:ManagedLaunchResult):boolean {
  if(!session || session.ok!==true || session.status!=='OWNED_CDP_BROWSER_VERIFIED')return false;
  const child=liveSessions.get(session);
  return Boolean(child && child.pid===session.pid && child.exitCode===null &&
    !child.killed && child.signalCode===null);
}
function stopOwnChild(child:ChildProcess):void {
  if(child.pid && child.exitCode===null && !child.killed)child.kill();
}
/** Never attach to an unowned endpoint, create an unknown Profile or stop another PID. */
export async function launchApprovedIsolatedChrome(
  input:unknown,options:ChromeLaunchOptions
):Promise<ManagedLaunchResult> {
  if(options?.userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
  if(options.signal?.aborted)return {ok:false,code:'ABORTED'};
  const preflight=await preflightChrome(input);
  if(!preflight.ok)return {ok:false,code:'PREFLIGHT_FAILED'};
  const binary=await inspectWindowsChromeBinary(preflight.config);
  if(!binary.ok)return {ok:false,code:'BINARY_NOT_VERIFIED'};
  if(options.signal?.aborted)return {ok:false,code:'ABORTED'};
  if(options.testHeadless===true && process.env.GITHUB_ACTIONS!=='true')
    return {ok:false,code:'NOT_AUTHORIZED'};
  const cfg=preflight.config;
  const argv=[
    '--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port='+cfg.remoteDebuggingPort,
    '--user-data-dir='+cfg.userDataDir,'about:blank'
  ];
  if(options.testHeadless===true)argv.unshift('--headless=new');
  let child:ChildProcess;
  try{
    child=spawn(cfg.executablePath,argv,{shell:false,windowsHide:true,stdio:'ignore'});
  }catch{return {ok:false,code:'LAUNCH_FAILED'};}
  let errored=false,exited=false,retained=false;
  child.once('error',()=>{errored=true;});
  child.once('exit',()=>{exited=true;});
  if(!child.pid){stopOwnChild(child);return {ok:false,code:'LAUNCH_FAILED'};}
  const emitStage=(stage:ChromeStartupStage):void=>{
    try{options.onStartupStage?.(stage);}
    catch{/* Diagnostic subscribers cannot affect Chrome authorization. */}
  };
  const pid=child.pid;
  const url='http://127.0.0.1:'+cfg.remoteDebuggingPort+'/json/version';
  const began=Date.now();
  try{
    while(Date.now()-began<20000){
      if(options.signal?.aborted)return {ok:false,code:'ABORTED'};
      if(errored||exited)return {ok:false,code:'LAUNCH_FAILED'};
      let phase:'FETCH'|'PROCESS'='FETCH';
      try{
        const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(1500)});
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
              if(options.signal?.aborted)return {ok:false,code:'ABORTED'};
              const handshake=await verifyCdpBrowserWebSocket(inspected.websocketUrl,
                cfg.remoteDebuggingPort,binary.version);
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
                try{options.onUnexpectedExit?.();}
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
    if(!exited&&!errored&&child.exitCode===null&&!child.killed)
      emitStage('CHILD_RUNNING_NO_CDP');
    return {ok:false,code:'CDP_TIMEOUT'};
  }finally{
    if(!retained)stopOwnChild(child);
  }
}
