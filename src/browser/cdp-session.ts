/** TASK-005: conservative validation of CDP /json/version shape.
 * This is not an authentication check. Do not attach until listener PID,
 * executable, profile and self-launched process identity are also verified.
 */
import {types as nodeTypes} from 'node:util';

/** Native CDP structure inspection must not execute untrusted object
 * accessors or Proxy traps when called through the exported unknown-input API.
 * Genuine JSON.parse records have only own data properties, normal prototypes
 * and no symbol keys. This is structural evidence, never endpoint ownership.
 */
function cdpPlainRecord(value:unknown):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.length>64||keys.some(k=>typeof k!=='string'))return null;
  const copy:Record<string,unknown>=Object.create(null);
  for(const key of keys){
   const d=descriptors[key as string];
   if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))return null;
   copy[key as string]=d.value;
  }
  return copy;
 }catch{return null;}
}

/** Accept only a dense native array of bounded CDP JSON records. In
 * particular Array.isArray() on a revoked Proxy may throw, so Proxy detection
 * comes first. Descriptors prevent array-index accessor execution.
 */
function cdpPlainTargetRows(payload:unknown):Record<string,unknown>[]|null{
 try{
  if(!payload||typeof payload!=='object'||nodeTypes.isProxy(payload)||
     !Array.isArray(payload)||Object.getPrototypeOf(payload)!==Array.prototype)
    return null;
  const d=Object.getOwnPropertyDescriptors(payload);
  const size=Object.getOwnPropertyDescriptor(payload,'length')?.value;
  if(!Number.isSafeInteger(size)||size<0||size>1000||
     Reflect.ownKeys(d).length!==size+1)return null;
  const rows:Record<string,unknown>[]=[];
  for(let i=0;i<size;i++){
   const slot=d[String(i)];
   if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return null;
   const parsed=cdpPlainRecord(slot.value);
   if(!parsed)return null;
   rows.push(parsed);
  }
  return rows;
 }catch{return null;}
}

export type CdpEnvelope =
  | {readonly ok:true; readonly status:'STRUCTURE_ONLY'; readonly browser:string;
     readonly websocketUrl:string;readonly path:string;readonly owned:false}
  | {readonly ok:false;readonly code:'INVALID_SHAPE'|'UNEXPECTED_BROWSER'|
      'UNSAFE_WEBSOCKET'|'INVALID_DEBUGGER_PATH'};
export function inspectCdpVersion(payload:unknown,expectedPort:number):CdpEnvelope {
  if(!Number.isInteger(expectedPort)||expectedPort<1024||expectedPort>65535)
    return {ok:false,code:'INVALID_SHAPE'};
  const data=cdpPlainRecord(payload);
  if(!data)return {ok:false,code:'INVALID_SHAPE'};
  if(typeof data.Browser!=='string' || !/^(?:HeadlessChrome|Chrome)\/\d+(?:\.\d+){1,4}$/.test(data.Browser))
    return {ok:false,code:'UNEXPECTED_BROWSER'};
  if(typeof data.webSocketDebuggerUrl!=='string')return {ok:false,code:'INVALID_SHAPE'};
  let ws:URL;
  try {ws=new URL(data.webSocketDebuggerUrl);}catch{return {ok:false,code:'UNSAFE_WEBSOCKET'};}
  if(ws.protocol!=='ws:' || ws.hostname!=='127.0.0.1' ||
     Number(ws.port)!==expectedPort || ws.username || ws.password ||
     ws.search || ws.hash)
    return {ok:false,code:'UNSAFE_WEBSOCKET'};
  if(!/^\/devtools\/browser\/[a-zA-Z0-9-]{8,128}$/.test(ws.pathname))
    return {ok:false,code:'INVALID_DEBUGGER_PATH'};
  return {ok:true,status:'STRUCTURE_ONLY',browser:data.Browser,
    websocketUrl:data.webSocketDebuggerUrl,path:ws.pathname,owned:false};
}


/** Structure-only tab evidence; never equate a supplied CDP target with ownership.
 * The caller must separately verify the self-launched PID, listener owner and profile
 * before any browser connection, script activity or business verification.
 */
export type CdpTargetEnvelope =
  | {readonly ok:true; readonly status:'TARGET_STRUCTURE_ONLY';
     readonly targetId:string; readonly websocketUrl:string; readonly owned:false}
  | {readonly ok:false; readonly code:'INVALID_TARGET_INPUT'|'INVALID_TARGET_LIST'|
      'TARGET_NOT_FOUND'|'TARGET_AMBIGUOUS'|'UNSAFE_TARGET_WEBSOCKET'};
export function inspectCdpTargetList(
  payload:unknown, expectedPort:number, expectedUrl:string,
  createdTargetId?:string
):CdpTargetEnvelope {
  // Refuse raw addresses that the WHATWG URL constructor would silently
  // trim, strip or reinterpret before comparing against a CDP tab receipt.
  if(!Number.isInteger(expectedPort)||expectedPort<1024||expectedPort>65535 ||
     typeof expectedUrl!=='string' || expectedUrl.length>4096 ||
     expectedUrl.trim()!==expectedUrl||/[\x00-\x1f\x7f\\]/.test(expectedUrl) ||
     (createdTargetId!==undefined &&
      (typeof createdTargetId!=='string' ||
       !/^[a-zA-Z0-9_-]{8,128}$/.test(createdTargetId))))
    return {ok:false,code:'INVALID_TARGET_INPUT'};
  let wanted:URL;
  try {wanted=new URL(expectedUrl);}
  catch {return {ok:false,code:'INVALID_TARGET_INPUT'};}
  if(!['http:','https:'].includes(wanted.protocol) || !wanted.hostname ||
     wanted.username || wanted.password)
    return {ok:false,code:'INVALID_TARGET_INPUT'};
  const targets=cdpPlainTargetRows(payload);
  if(!targets)return {ok:false,code:'INVALID_TARGET_LIST'};
  const matches: Array<{id:string;websocketUrl:string}> = [];
  for(const target of targets) {
    // A CDP list is only a read-only structural hint. WHATWG URL() strips
    // C0 controls/whitespace and normalizes backslashes before comparison;
    // never let an altered raw list URL appear to match an approved target.
    if(target.type!=='page'||typeof target.url!=='string'||
       target.url.length>4096||target.url.trim()!==target.url||
       /[\x00-\x1f\x7f\\]/.test(target.url))continue;
    let actual:URL;
    try {actual=new URL(target.url);}
    catch {continue;}
    if(actual.href!==wanted.href)continue;
    if(typeof target.id!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(target.id) ||
       typeof target.webSocketDebuggerUrl!=='string')
      return {ok:false,code:'UNSAFE_TARGET_WEBSOCKET'};
    let ws:URL;
    try {ws=new URL(target.webSocketDebuggerUrl);}
    catch {return {ok:false,code:'UNSAFE_TARGET_WEBSOCKET'};}
    if(ws.protocol!=='ws:'||ws.hostname!=='127.0.0.1' ||
       Number(ws.port)!==expectedPort || ws.username||ws.password ||
       ws.search||ws.hash || ws.pathname!=="/devtools/page/"+target.id)
      return {ok:false,code:'UNSAFE_TARGET_WEBSOCKET'};
    // A self-created page can share its URL with older pages. Only the
    // exact returned ID may become this navigation's structural receipt.
    // Unrelated matching-URL endpoints still receive safety validation.
    if(createdTargetId!==undefined&&target.id!==createdTargetId)continue;
    matches.push({id:target.id,websocketUrl:target.webSocketDebuggerUrl});
    if(matches.length>1)return {ok:false,code:'TARGET_AMBIGUOUS'};
  }
  if(matches.length===0)return {ok:false,code:'TARGET_NOT_FOUND'};
  return {ok:true,status:'TARGET_STRUCTURE_ONLY',targetId:matches[0].id,
    websocketUrl:matches[0].websocketUrl,owned:false};
}


/** Windows-only loopback listener PID query. This does not contact the CDP endpoint,
 * start a browser, nor by itself authenticate the executable or its Profile.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {lstat} from 'node:fs/promises';
import {win32} from 'node:path';
import {hasUnsafePathLink} from '../version/path-boundary';
const execFileAsync=promisify(execFileCallback);
export type ListenerOwnerResult =
  | {readonly ok:true; readonly status:'LISTENER_PID_MATCH_ONLY'; readonly pid:number;
     readonly executableVerified:false}
  | {readonly ok:false; readonly code:'UNSUPPORTED_PLATFORM'|'INVALID_ARGUMENTS'|
      'LISTENER_UNAVAILABLE'|'LISTENER_AMBIGUOUS'|'LISTENER_PID_MISMATCH'};
/** Parse numeric Windows TCP LISTENING sockets on the exact IPv4 loopback port.
 * Only 127.0.0.1:port -> 0.0.0.0:0 qualifies, never wildcard or remote peers.
 * An invalid PID remains ambiguous, never trusted.
 */
export function parseWindowsLoopbackListeners(output:string,port:number):number[]{
  if(!Number.isInteger(port)||port<1024||port>65535)return [];
  const selected:number[]=[];
  for(const line of output.split(/\r?\n/)){
    const cols=line.trim().split(/\s+/);
    if(cols.length!==5||cols[0].toUpperCase()!=='TCP' ||
       cols[1]!=='127.0.0.1:'+port||cols[2]!=='0.0.0.0:0'||
       cols[3].toUpperCase()!=='LISTENING')continue;
    selected.push(/^\d+$/.test(cols[4])?Number(cols[4]):NaN);
  }
  return selected;
}
/** Resolve the Windows OS netstat by an absolute path, never via CWD/PATH.
 * SystemRoot is process-owned environment configuration, not a cryptographic
 * attestation; a compromised parent process could still forge it. Refuse
 * relative/UNC/namespace/alias paths instead of guessing another executable.
 */
export function resolveWindowsNetstatExecutable(systemRoot:unknown):string|null{
  if(typeof systemRoot!=='string'||systemRoot.length<4||
     systemRoot.length>220||!/^[A-Za-z]:\\/.test(systemRoot)||
     systemRoot!==win32.normalize(systemRoot))return null;
  const components=systemRoot.slice(3).split('\\');
  if(components.some(component=>!component||component==='.'||
      component==='..'||/[<>:"|?*\u0000-\u001f]/.test(component)||
      /[. ]$/.test(component)))return null;
  return win32.join(systemRoot,'System32','netstat.exe');
}
export async function verifyWindowsLoopbackListenerPid(
  port:number, expectedPid:number
):Promise<ListenerOwnerResult> {
  if(process.platform!=='win32')return {ok:false,code:'UNSUPPORTED_PLATFORM'};
  if(!Number.isInteger(port)||port<1024||port>65535 ||
     !Number.isSafeInteger(expectedPid)||expectedPid<1)
    return {ok:false,code:'INVALID_ARGUMENTS'};
  // No PATH or current-directory executable search: an imported or adjacent
  // untrusted "netstat.exe" must never run during Chrome ownership checks.
  // A reparse-point ancestor or missing native binary fails closed.
  let output:string;
  try {
    const binary=resolveWindowsNetstatExecutable(process.env.SystemRoot);
    if(!binary||await hasUnsafePathLink(binary)||
       !(await lstat(binary)).isFile())
      return {ok:false,code:'LISTENER_UNAVAILABLE'};
    const result=await execFileAsync(binary,['-ano','-p','TCP'],
      {windowsHide:true,timeout:12000,maxBuffer:8*1024*1024});
    output=result.stdout;
  }catch{
    return {ok:false,code:'LISTENER_UNAVAILABLE'};
  }
  const pids=parseWindowsLoopbackListeners(output,port);
  if(pids.length===0)return {ok:false,code:'LISTENER_UNAVAILABLE'};
  if(pids.length!==1||!Number.isSafeInteger(pids[0])||pids[0]<1)
    return {ok:false,code:'LISTENER_AMBIGUOUS'};
  if(pids[0]!==expectedPid)return {ok:false,code:'LISTENER_PID_MISMATCH'};
  return {ok:true,status:'LISTENER_PID_MATCH_ONLY',pid:pids[0],executableVerified:false};
}


/** Perform a real, read-only Browser.getVersion CDP WebSocket roundtrip.
 * No Runtime.evaluate, website navigation, scripts, or GM APIs are invoked.
 */
export async function verifyCdpBrowserWebSocket(
  websocketUrl:string,expectedPort:number,expectedVersion:string,
  signal?:AbortSignal
):Promise<boolean>{
  if(typeof websocketUrl!=='string'||typeof expectedVersion!=='string'||
     !/^\d+\.\d+\.\d+\.\d+$/.test(expectedVersion)||
     !Number.isInteger(expectedPort)||expectedPort<1024||expectedPort>65535)
    return false;
  let parsed:URL;
  try{parsed=new URL(websocketUrl);}catch{return false;}
  if(parsed.protocol!=='ws:'||parsed.hostname!=='127.0.0.1'||
     Number(parsed.port)!==expectedPort||parsed.username||parsed.password||
     parsed.search||parsed.hash||
     !/^\/devtools\/browser\/[a-zA-Z0-9-]{8,128}$/.test(parsed.pathname))
    return false;
  // Native consent revocation and owned-child exit must interrupt a
  // pending browser proof. The caller must never wait out the separate
  // four-second network deadline after its authority has been revoked.
  if(signal?.aborted)return false;
  return new Promise(resolve=>{
    let client:WebSocket|undefined,settled=false;
    // An unsolicited matching-id message is not evidence that this client
    // actually issued Browser.getVersion. Refuse it before trusting identity.
    let requestSent=false;
    const finish=(passed:boolean)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      try{client?.close();}catch{ /* connecting/closed socket */ }
      resolve(passed);
    };
    const onAbort=()=>finish(false);
    const timer=setTimeout(()=>finish(false),4000);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){finish(false);return;}
    try{
      const socket=new WebSocket(websocketUrl);
      client=socket;
      socket.addEventListener('open',()=>{
        // close() may throw while the WebSocket is CONNECTING. Its late open
        // event must not send CDP commands after cancellation or timeout.
        if(settled||signal?.aborted)return;
        try{
          socket.send(JSON.stringify({id:1,method:'Browser.getVersion'}));
          requestSent=true;
        }catch{finish(false);}
      });
      socket.addEventListener('message',event=>{
        // No CDP command was sent: a matching id/product can only be an
        // unsolicited server message, never an authenticated roundtrip.
        if(!requestSent){finish(false);return;}
        try{
          // Browser.getVersion uses a tiny JSON text response. Never coerce
          // arbitrary WebSocket event payload objects or parse an unbounded
          // loopback peer frame, even after a real client-issued request.
          const frame:unknown=event.data;
          if(typeof frame!=='string'||frame.length>16384||
             Buffer.byteLength(frame,'utf8')>16384){
            finish(false);return;
          }
          const payload=JSON.parse(frame) as {
            id?:unknown;result?:{product?:unknown};error?:unknown
          };
          if(payload.id!==1)return;
          finish(!payload.error && (
            payload.result?.product==='Chrome/'+expectedVersion||
            payload.result?.product==='HeadlessChrome/'+expectedVersion
          ));
        }catch{finish(false);}
      });
      socket.addEventListener('error',()=>finish(false));
      socket.addEventListener('close',()=>finish(false));
    }catch{finish(false);}
  });
}
