/** Explicit attachment to a user-authorized, already-running custom Chrome.
 * This is a separate capability from launching/owning Chrome. It never starts
 * or stops a browser process and never claims that a script or GM API works.
 */
import {lstat,open} from 'node:fs/promises';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify,types as nodeTypes} from 'node:util';
import {win32} from 'node:path';
import {preflightExistingChrome,inspectWindowsChromeBinary} from './chrome-launcher';
import {findWindowsLoopbackListenerPid,verifyWindowsLoopbackListenerPid} from './cdp-session';
import {hasUnsafePathLink} from '../version/path-boundary';
import {getChromePlusPlusConfiguredDataDir} from './chrome-plus-plus';

const execFileAsync=promisify(execFileCallback);
export type ExistingChromeFailure='NOT_AUTHORIZED'|'ABORTED'|'UNSUPPORTED_PLATFORM'|
  'INVALID_CONFIG'|'INVALID_ENDPOINT'|'UNSAFE_PROFILE'|'PROFILE_NOT_FOUND'|'BINARY_NOT_VERIFIED'|
  'DEBUGGER_ENDPOINT_UNAVAILABLE'|'LISTENER_NOT_VERIFIED'|
  'PROCESS_IDENTITY_MISMATCH'|'WEBSOCKET_AUTHORIZATION_FAILED'|'CDP_VERSION_NOT_VERIFIED';
export type ExistingChromeResult=
  | {readonly ok:false;readonly code:ExistingChromeFailure}
  | {readonly ok:true;readonly status:'AUTHORIZED_EXISTING_CDP_BROWSER_VERIFIED';
     readonly pid:number;readonly chromeVersion:string;readonly browserWebsocket:string;
     readonly websocketHandshakeVerified:true;readonly targetVerified:false;
     /** Sends CDP commands over the single Chrome-authorized, persistent socket. */
     readonly sendCommand:(method:string,params?:Readonly<Record<string,unknown>>,
       signal?:AbortSignal)=>Promise<unknown>;
     /** True only while this exact attached transport remains active. */
     readonly isLive:()=>boolean;
     readonly stop:()=>void};

/** Parse Chrome's bounded DevToolsActivePort file. It contains a TCP port and
 * a browser WebSocket path. The returned URL is always loopback and carries no
 * credentials/query; malformed or ambiguous files are rejected.
 */
export function parseDevToolsActivePort(raw:unknown):{port:number;path:string}|null{
  if(typeof raw!=='string'||raw.length>512)return null;
  const text=raw.endsWith('\r\n')?raw.slice(0,-2):raw.endsWith('\n')?raw.slice(0,-1):raw;
  const rows=text.split(/\r?\n/);
  if(rows.length!==2||!/^\d{1,5}$/.test(rows[0]))return null;
  const port=Number(rows[0]);
  if(!Number.isInteger(port)||port<1024||port>65535||
     !/^\/devtools\/browser\/[a-zA-Z0-9-]{8,128}$/.test(rows[1]))return null;
  return {port,path:rows[1]};
}

/** Windows CRT command-line tokenization for process identity evidence. */
export function parseWindowsCommandLine(raw:unknown):string[]|null{
  if(typeof raw!=='string'||raw.length>32768)return null;
  const args:string[]=[];let i=0;
  while(i<raw.length){
    while(i<raw.length&&/[\t ]/.test(raw[i]))i++;
    if(i>=raw.length)break;
    let arg='',quoted=false;
    while(i<raw.length){
      if(!quoted&&/[\t ]/.test(raw[i]))break;
      let slashes=0;
      while(raw[i]==='\\'){slashes++;i++;}
      if(raw[i]==='"'){
        arg+='\\'.repeat(Math.floor(slashes/2));
        if(slashes%2){arg+='"';i++;}
        else {quoted=!quoted;i++;}
        continue;
      }
      arg+='\\'.repeat(slashes);
      if(i>=raw.length||(!quoted&&/[\t ]/.test(raw[i])))break;
      arg+=raw[i++];
    }
    if(quoted)return null;
    args.push(arg);
    if(args.length>256)return null;
  }
  return args;
}
function normalizeWindowsPath(value:string):string|null{
  if(!/^[A-Za-z]:\\/.test(value)||/[\u0000-\u001f<>|"*?%]/.test(value)||value.includes('/'))return null;
  const normalized=win32.normalize(value).replace(/\\+$/,'').toLowerCase();
  return normalized.length>=3?normalized:null;
}
/** Pure exact executable/profile matching used after the OS process snapshot. */
export function chromeProcessMatches(
  processInfo:unknown,expectedExecutable:string,expectedProfile:string
):boolean{
  if(!processInfo||typeof processInfo!=='object'||nodeTypes.isProxy(processInfo)||Array.isArray(processInfo))return false;
  try{
    const d=Object.getOwnPropertyDescriptors(processInfo);
    const executable=d.ExecutablePath?.value,commandLine=d.CommandLine?.value;
    if(typeof executable!=='string'||typeof commandLine!=='string')return false;
    const actualExe=normalizeWindowsPath(executable),wantedExe=normalizeWindowsPath(expectedExecutable);
    const wantedProfile=normalizeWindowsPath(expectedProfile),args=parseWindowsCommandLine(commandLine);
    if(!actualExe||actualExe!==wantedExe||!wantedProfile||!args||args.length<2)return false;
    const values:string[]=[];
    for(let i=1;i<args.length;i++){
      const arg=args[i];
      if(arg.toLowerCase()==='--user-data-dir'){
        if(i+1>=args.length)return false;
        values.push(args[++i]);
      }else if(arg.toLowerCase().startsWith('--user-data-dir='))
        values.push(arg.slice(arg.indexOf('=')+1));
    }
    if (values.length === 1 && normalizeWindowsPath(values[0]) === wantedProfile) {
      return true;
    }
    if (values.length === 0) {
      const configured = getChromePlusPlusConfiguredDataDir(executable);
      if (configured && normalizeWindowsPath(configured) === wantedProfile) {
        return true;
      }
    }
    return false;
  }catch{return false;}
}

async function readActivePort(profile:string):Promise<{port:number;path:string}|null>{
  const path=win32.join(profile,'DevToolsActivePort');
  try{
    if(await hasUnsafePathLink(path))return null;
    const before=await lstat(path);
    if(!before.isFile()||before.size<1||before.size>512)return null;
    const handle=await open(path,'r');
    try{
      const data=Buffer.alloc(513);
      const {bytesRead}=await handle.read(data,0,data.length,0);
      if(bytesRead>512)return null;
      const after=await lstat(path);
      if(after.isSymbolicLink()||before.ino!==after.ino||before.size!==after.size)return null;
      return parseDevToolsActivePort(data.subarray(0,bytesRead).toString('utf8'));
    }finally{await handle.close();}
  }catch{return null;}
}
export async function readChromeProcessInfo(pid:number):Promise<Record<string, unknown>|null>{
  if(!Number.isSafeInteger(pid)||pid<1)return null;
  // PID is numeric and generated locally; no path, script, or user value is
  // interpolated into PowerShell. Base64 avoids command-shell parsing.
  const script='$ErrorActionPreference="Stop";$p=Get-CimInstance Win32_Process -Filter "ProcessId = '+pid+'";'+
    'if(!$p){exit 2};[pscustomobject]@{ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine;ParentProcessId=$p.ParentProcessId}|ConvertTo-Json -Compress';
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  for(const shell of ['pwsh.exe','powershell.exe']){
    try{
      const result=await execFileAsync(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],
        {windowsHide:true,timeout:5000,maxBuffer:65536});
      return JSON.parse(result.stdout) as Record<string, unknown>;
    }catch(error){
      if(shell==='pwsh.exe'&&(error as NodeJS.ErrnoException).code==='ENOENT')continue;
      return null;
    }
  }
  return null;
}
function validSignal(signal:unknown):signal is AbortSignal|undefined{
  if(signal===undefined)return true;
  try{
    if(!signal||typeof signal!=='object'||nodeTypes.isProxy(signal)||
       Object.getPrototypeOf(signal)!==AbortSignal.prototype||
       ['aborted','addEventListener','removeEventListener'].some(k=>Object.prototype.hasOwnProperty.call(signal,k)))return false;
    const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
    return typeof getter==='function'&&typeof getter.call(signal)==='boolean';
  }catch{return false;}
}
const attachedSessions=new WeakSet<object>();
const sessionLiveness=new WeakMap<object,()=>boolean>();
export function isAuthorizedExistingChromeAttachment(session:unknown):
  session is Extract<ExistingChromeResult,{ok:true}>{
  if(!session||typeof session!=='object'||!attachedSessions.has(session as object))return false;
  const live=sessionLiveness.get(session as object);
  return !!live&&live();
}
/** Main-process guard for the external-browser capability. It is intentionally
 * separate from the owned-child guard and never authorizes stopping Chrome.
 */
export const isLiveApprovedExistingChromeSession=isAuthorizedExistingChromeAttachment;

type PersistentCdpSocketResult=
 | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'ABORTED'|'INVALID_ENDPOINT'|
     'WEBSOCKET_AUTHORIZATION_FAILED'|'CDP_VERSION_NOT_VERIFIED'}
 | {readonly ok:true;readonly version:string;readonly sendCommand:
     (method:string,params?:Readonly<Record<string,unknown>>,signal?:AbortSignal)=>Promise<unknown>;
     readonly isLive:()=>boolean;readonly stop:()=>void};

const persistentTransports=new WeakSet<object>();
const persistentTransportLiveness=new WeakMap<object,()=>boolean>();
/** Open and retain one Chrome-authorized browser WebSocket. This primitive is
 * called only after the caller proves the selected executable, Data directory
 * and process owner. Later commands use this same socket so the user's native
 * Chrome consent remains attached to the session.
 */
export async function connectExistingBrowserWebSocket(
  websocketUrl:string,expectedVersion:string,options:Readonly<{
    userApproved:boolean;signal?:AbortSignal;WebSocketImpl?:typeof WebSocket;
    validateIdentity:()=>Promise<boolean>;approvalTimeoutMs?:number
  }>
):Promise<PersistentCdpSocketResult>{
  let approved=false,signal:AbortSignal|undefined,WebSocketImpl:typeof WebSocket=WebSocket;
  let validateIdentity:(()=>Promise<boolean>)|undefined,approvalTimeoutMs=120000;
  try{
    if(!options||typeof options!=='object'||nodeTypes.isProxy(options)||
       Object.getPrototypeOf(options)!==Object.prototype)return {ok:false,code:'NOT_AUTHORIZED'};
    const d=Object.getOwnPropertyDescriptors(options),keys=Reflect.ownKeys(d);
    if(keys.some(k=>!['userApproved','signal','WebSocketImpl','validateIdentity','approvalTimeoutMs'].includes(String(k)))||
       !d.userApproved||!Object.hasOwn(d.userApproved,'value')||d.userApproved.value!==true||
       !d.validateIdentity||!Object.hasOwn(d.validateIdentity,'value')||typeof d.validateIdentity.value!=='function'||
       (d.signal!==undefined&&(!Object.hasOwn(d.signal,'value')||!validSignal(d.signal.value)))||
       (d.WebSocketImpl!==undefined&&(!Object.hasOwn(d.WebSocketImpl,'value')||typeof d.WebSocketImpl.value!=='function'))||
       (d.approvalTimeoutMs!==undefined&&(!Object.hasOwn(d.approvalTimeoutMs,'value')||
         typeof d.approvalTimeoutMs.value!=='number'||!Number.isSafeInteger(d.approvalTimeoutMs.value)||
         d.approvalTimeoutMs.value<1000||d.approvalTimeoutMs.value>120000)))
      return {ok:false,code:'NOT_AUTHORIZED'};
    approved=true;signal=d.signal?.value as AbortSignal|undefined;
    if(d.WebSocketImpl)WebSocketImpl=d.WebSocketImpl.value as typeof WebSocket;
    validateIdentity=d.validateIdentity.value as ()=>Promise<boolean>;
    if(d.approvalTimeoutMs)approvalTimeoutMs=d.approvalTimeoutMs.value as number;
  }catch{return {ok:false,code:'NOT_AUTHORIZED'};}
  if(!approved)return {ok:false,code:'NOT_AUTHORIZED'};
  if(signal?.aborted)return {ok:false,code:'ABORTED'};
  let url:URL;
  try{url=new URL(websocketUrl);}catch{return {ok:false,code:'INVALID_ENDPOINT'};}
  if(typeof expectedVersion!=='string'||!/^\d+\.\d+\.\d+\.\d+$/.test(expectedVersion)||
     url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.username||url.password||
     url.search||url.hash||!Number.isInteger(Number(url.port))||Number(url.port)<1024||Number(url.port)>65535||
     !/^\/devtools\/browser\/[a-zA-Z0-9-]{8,128}$/.test(url.pathname))
    return {ok:false,code:'INVALID_ENDPOINT'};
  let initialIdentity=false;
  try{initialIdentity=await validateIdentity();}catch{return {ok:false,code:'WEBSOCKET_AUTHORIZATION_FAILED'};}
  if(!initialIdentity)return {ok:false,code:'WEBSOCKET_AUTHORIZATION_FAILED'};
  if(signal?.aborted)return {ok:false,code:'ABORTED'};
  let socket:WebSocket;
  try{socket=new WebSocketImpl(websocketUrl);}catch{return {ok:false,code:'WEBSOCKET_AUTHORIZATION_FAILED'};}
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;signal?:AbortSignal;onAbort?:()=>void}>();
  let nextId=1,dead=false,handshakeComplete=false;
  const onTransportAbort=()=>revoke();
  const revoke=()=>{
    if(dead)return;
    dead=true;
    signal?.removeEventListener('abort',onTransportAbort);
    for(const entry of pending.values()){
      clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.onAbort!);
      entry.reject(new Error('SESSION_REVOKED'));
    }
    pending.clear();
    try{if(socket.readyState===WebSocketImpl.OPEN||socket.readyState===WebSocketImpl.CONNECTING)socket.close();}catch{}
  };
  const live=()=>!dead&&socket.readyState===WebSocketImpl.OPEN;
  socket.addEventListener('close',revoke,{once:true});
  socket.addEventListener('error',revoke,{once:true});
  socket.addEventListener('message',event=>{
    try{
      const raw=(event as MessageEvent<unknown>).data;
      if(typeof raw!=='string'||raw.length>2_000_000||Buffer.byteLength(raw,'utf8')>2_000_000){revoke();return;}
      const message=JSON.parse(raw) as {id?:unknown;result?:unknown;error?:unknown};
      if(!Number.isSafeInteger(message.id))return; // unsolicited CDP events have no request id
      const entry=pending.get(message.id as number);if(!entry)return;
      pending.delete(message.id as number);clearTimeout(entry.timer);
      if(entry.signal&&entry.onAbort)entry.signal.removeEventListener('abort',entry.onAbort);
      if(Object.prototype.hasOwnProperty.call(message,'error'))entry.reject(new Error('CDP_COMMAND_REJECTED'));
      else if(!Object.prototype.hasOwnProperty.call(message,'result'))entry.reject(new Error('CDP_RESPONSE_INVALID'));
      else entry.resolve(message.result);
    }catch{revoke();}
  });
  const waitForOpen=():Promise<boolean>=>new Promise(resolve=>{
    let settled=false;
    const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(ok);};
    const abort=()=>{revoke();finish(false);};
    const timer=setTimeout(()=>{revoke();finish(false);},approvalTimeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    socket.addEventListener('open',()=>finish(true),{once:true});
    socket.addEventListener('close',()=>finish(false),{once:true});
    socket.addEventListener('error',()=>finish(false),{once:true});
    if(signal?.aborted){abort();return;}
    if(socket.readyState===WebSocketImpl.OPEN)finish(true);
    else if(socket.readyState===WebSocketImpl.CLOSED||socket.readyState===WebSocketImpl.CLOSING)finish(false);
  });
  const request=(method:string,params?:Readonly<Record<string,unknown>>,requestSignal?:AbortSignal,timeoutMs=15000):Promise<unknown>=>{
    if(!live())return Promise.reject(new Error('SESSION_REVOKED'));
    // Only the read-only target inventory is exposed after the handshake.
    // Browser.getVersion is reserved for the one-time connection proof.
    if(method!=='Target.getTargets'||!handshakeComplete)
      return Promise.reject(new Error('INVALID_CDP_METHOD'));
    if(params!==undefined&&(!params||typeof params!=='object'||nodeTypes.isProxy(params)||
      Array.isArray(params)||Object.getPrototypeOf(params)!==Object.prototype||Reflect.ownKeys(params).length!==0))
      return Promise.reject(new Error('INVALID_CDP_PARAMS'));
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)return Promise.reject(new Error('INVALID_TIMEOUT'));
    if(requestSignal&&!validSignal(requestSignal))return Promise.reject(new Error('INVALID_SIGNAL'));
    if(requestSignal?.aborted){revoke();return Promise.reject(new Error('ABORTED'));}
    const id=nextId++;
    if(!Number.isSafeInteger(id)){revoke();return Promise.reject(new Error('SESSION_REVOKED'));}
    return new Promise((resolve,reject)=>{
      const finishReject=(message:string)=>{const entry=pending.get(id);if(entry){pending.delete(id);clearTimeout(entry.timer);if(entry.signal&&entry.onAbort)entry.signal.removeEventListener('abort',entry.onAbort);entry.reject(new Error(message));}revoke();reject(new Error(message));};
      const onAbort=()=>finishReject('ABORTED');
      const timer=setTimeout(()=>finishReject('CDP_TIMEOUT'),timeoutMs);
      if(requestSignal)requestSignal.addEventListener('abort',onAbort,{once:true});
      pending.set(id,{resolve,reject,timer,signal:requestSignal,onAbort});
      try{socket.send(JSON.stringify({id,method,...(params===undefined?{}:{params})}));}
      catch{finishReject('CDP_SEND_FAILED');}
    });
  };
  const opened=await waitForOpen();
  if(!opened||signal?.aborted){revoke();return {ok:false,code:signal?.aborted?'ABORTED':'WEBSOCKET_AUTHORIZATION_FAILED'};}
  let versionReply:unknown;
  try{
    // The one allowed non-target command proves this is the expected Chrome.
    const id=nextId++;
    versionReply=await new Promise<unknown>((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);revoke();reject(new Error('CDP_TIMEOUT'));},approvalTimeoutMs);
      const onAbort=()=>{pending.delete(id);clearTimeout(timer);revoke();reject(new Error('ABORTED'));};
      if(signal)signal.addEventListener('abort',onAbort,{once:true});
      pending.set(id,{resolve,reject,timer,signal,onAbort});
      try{socket.send(JSON.stringify({id,method:'Browser.getVersion'}));}
      catch{pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',onAbort);revoke();reject(new Error('CDP_SEND_FAILED'));}
    });
    handshakeComplete=true;
  }
  catch{revoke();return {ok:false,code:signal?.aborted?'ABORTED':'CDP_VERSION_NOT_VERIFIED'};}
  let product:string|undefined;
  try{if(versionReply&&typeof versionReply==='object'&&!nodeTypes.isProxy(versionReply)){
    const d=Object.getOwnPropertyDescriptors(versionReply);
    if(typeof d.product?.value==='string')product=d.product.value;
  }}catch{}
  if(product!=='Chrome/'+expectedVersion&&product!=='HeadlessChrome/'+expectedVersion){revoke();return {ok:false,code:'CDP_VERSION_NOT_VERIFIED'};}
  let finalIdentity=false;
  try{finalIdentity=await validateIdentity();}catch{}
  if(!finalIdentity||!live()||signal?.aborted){revoke();return {ok:false,code:signal?.aborted?'ABORTED':'WEBSOCKET_AUTHORIZATION_FAILED'};}
  signal?.addEventListener('abort',onTransportAbort,{once:true});
  if(signal?.aborted){revoke();return {ok:false,code:'ABORTED'};}
  const exposed={
    ok:true as const,status:'AUTHORIZED_PERSISTENT_BROWSER_WEBSOCKET' as const,version:expectedVersion,
    isLive:()=>persistentTransports.has(exposed)&&live(),
    stop:()=>{revoke();persistentTransports.delete(exposed);},
    sendCommand:async(method:string,params?:Readonly<Record<string,unknown>>,requestSignal?:AbortSignal)=>{
      if(!persistentTransports.has(exposed)||!live())throw new Error('SESSION_REVOKED');
      if(requestSignal?.aborted){revoke();throw new Error('ABORTED');}
      let valid=false;
      try{valid=await validateIdentity();}catch{}
      if(!valid){revoke();throw new Error('SESSION_REVOKED');}
      if(!live())throw new Error('SESSION_REVOKED');
      let result:unknown;
      try{result=await request(method,params,requestSignal);}catch(error){
        if(error instanceof Error&&error.message==='INVALID_CDP_METHOD')throw error;
        revoke();throw error;
      }
      let stillValid=false;
      try{stillValid=await validateIdentity();}catch{}
      if(!stillValid||!live()){revoke();throw new Error('SESSION_REVOKED');}
      return result;
    }
  };
  persistentTransports.add(exposed);
  persistentTransportLiveness.set(exposed,live);
  return Object.freeze(exposed);
}

export function isLiveExistingBrowserTransport(session:unknown):boolean{
  if(!session||typeof session!=='object'||!persistentTransports.has(session))return false;
  const live=persistentTransportLiveness.get(session);return !!live&&live();
}

/** Connect only after explicit app consent and Chrome's own remote-debugging
 * authorization. Supports a running custom/portable Data directory; refuses
 * standard Chrome profiles. It reads DevToolsActivePort but never mutates it,
 * launches Chrome, or terminates any process.
 */
export async function connectApprovedExistingChrome(
  input:unknown,options:Readonly<{userApproved:boolean;signal?:AbortSignal}>
):Promise<ExistingChromeResult>{
  let approved=false,signal:AbortSignal|undefined;
  try{
    if(!options||typeof options!=='object'||nodeTypes.isProxy(options)||
       Object.getPrototypeOf(options)!==Object.prototype)return {ok:false,code:'NOT_AUTHORIZED'};
    const d=Object.getOwnPropertyDescriptors(options);
    const keys=Reflect.ownKeys(d);
    if((keys.length!==1&&keys.length!==2)||keys.some(k=>k!=='userApproved'&&k!=='signal')||
       !d.userApproved||!Object.hasOwn(d.userApproved,'value')||d.userApproved.value!==true||
       (d.signal!==undefined&&(!Object.hasOwn(d.signal,'value')||!validSignal(d.signal.value))))
      return {ok:false,code:'NOT_AUTHORIZED'};
    approved=true;signal=d.signal?.value as AbortSignal|undefined;
  }catch{return {ok:false,code:'NOT_AUTHORIZED'};}
  if(!approved)return {ok:false,code:'NOT_AUTHORIZED'};
  if(signal?.aborted)return {ok:false,code:'ABORTED'};
  if(process.platform!=='win32')return {ok:false,code:'UNSUPPORTED_PLATFORM'};
  const pathCheck=await preflightExistingChrome(input);
  if(!pathCheck.ok)return {ok:false,code:
    pathCheck.code==='UNSAFE_PROFILE'?'UNSAFE_PROFILE':
    pathCheck.code==='PROFILE_NOT_FOUND'?'PROFILE_NOT_FOUND':'INVALID_CONFIG'};
  const cfg=pathCheck.config;
  const identity=await inspectWindowsChromeBinary(cfg);
  if(!identity.ok)return {ok:false,code:'BINARY_NOT_VERIFIED'};
  if(signal?.aborted)return {ok:false,code:'ABORTED'};
  const endpoint=await readActivePort(cfg.userDataDir);
  if(!endpoint)
    return {ok:false,code:'DEBUGGER_ENDPOINT_UNAVAILABLE'};
  const listener=await findWindowsLoopbackListenerPid(endpoint.port);
  if(!listener.ok)return {ok:false,code:'LISTENER_NOT_VERIFIED'};
  const validateIdentity=async():Promise<boolean>=>{
    if(signal?.aborted)return false;
    const processInfo=await readChromeProcessInfo(listener.pid);
    if(!chromeProcessMatches(processInfo,cfg.executablePath,cfg.userDataDir))return false;
    const listenerRecheck=await verifyWindowsLoopbackListenerPid(endpoint.port,listener.pid);
    return listenerRecheck.ok&&listenerRecheck.pid===listener.pid;
  };
  if(!await validateIdentity())return signal?.aborted?{ok:false,code:'ABORTED'}:{ok:false,code:'PROCESS_IDENTITY_MISMATCH'};
  const websocket='ws://127.0.0.1:'+endpoint.port+endpoint.path;
  const transport=await connectExistingBrowserWebSocket(websocket,identity.version,{
    userApproved:true,signal,validateIdentity
  });
  if(!transport.ok)return {ok:false,code:transport.code};
  if(signal?.aborted||!transport.isLive()){transport.stop();return {ok:false,code:'ABORTED'};}
  const session:Extract<ExistingChromeResult,{ok:true}>=Object.freeze({
    ok:true,status:'AUTHORIZED_EXISTING_CDP_BROWSER_VERIFIED',pid:listener.pid,
    chromeVersion:identity.version,browserWebsocket:websocket,
    websocketHandshakeVerified:true,targetVerified:false,
    sendCommand:transport.sendCommand,
    isLive:()=>isAuthorizedExistingChromeAttachment(session),
    stop:()=>{transport.stop();attachedSessions.delete(session);sessionLiveness.delete(session);}
  });
  attachedSessions.add(session);
  sessionLiveness.set(session,()=>transport.isLive());
  return session;
}
