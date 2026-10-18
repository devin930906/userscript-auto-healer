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
  if(response.status!==200)return null;
  const length=response.headers.get('content-length');
  if(length!==null &&
     (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)) ||
      Number(length)>limit))return null;
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
        await reader.cancel();
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
export interface ChromeLaunchOptions {
  /** Explicit user approval to launch THIS isolated Chrome, not general script consent. */
  readonly userApproved:boolean;
  /** Disposable GitHub Actions test profile only. */
  readonly testHeadless?:boolean;
  readonly signal?:AbortSignal;
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
  const pid=child.pid;
  const url='http://127.0.0.1:'+cfg.remoteDebuggingPort+'/json/version';
  const began=Date.now();
  try{
    while(Date.now()-began<20000){
      if(options.signal?.aborted)return {ok:false,code:'ABORTED'};
      if(errored||exited)return {ok:false,code:'LAUNCH_FAILED'};
      try{
        const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(1500)});
        const payload=await readBoundedCdpJson(response);
        if(payload!==null){
            const inspected=inspectCdpVersion(payload,cfg.remoteDebuggingPort);
            if(inspected.ok){
              if(inspected.browser!=='Chrome/'+binary.version &&
                 inspected.browser!=='HeadlessChrome/'+binary.version)
                return {ok:false,code:'VERSION_MISMATCH'};
              const owner=await verifyWindowsLoopbackListenerPid(cfg.remoteDebuggingPort,pid);
              if(!owner.ok)return {ok:false,code:'OWNER_MISMATCH'};
              if(options.signal?.aborted)return {ok:false,code:'ABORTED'};
              const handshake=await verifyCdpBrowserWebSocket(inspected.websocketUrl,
                cfg.remoteDebuggingPort,binary.version);
              if(!handshake)return {ok:false,code:'WEBSOCKET_VERIFICATION_FAILED'};
              retained=true;
              return {ok:true,status:'OWNED_CDP_BROWSER_VERIFIED',pid,
                chromeVersion:binary.version,browserWebsocket:inspected.websocketUrl,
                websocketHandshakeVerified:true,targetVerified:false,
                stop:()=>stopOwnChild(child)};
            }
        }
      }catch{ /* Chrome has not presented an acceptable endpoint yet. */ }
      await delay(250);
    }
    return {ok:false,code:'CDP_TIMEOUT'};
  }finally{
    if(!retained)stopOwnChild(child);
  }
}
