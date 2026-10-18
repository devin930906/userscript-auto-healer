/** TASK-005: conservative validation of CDP /json/version shape.
 * This is not an authentication check. Do not attach until listener PID,
 * executable, profile and self-launched process identity are also verified.
 */
export type CdpEnvelope =
  | {readonly ok:true; readonly status:'STRUCTURE_ONLY'; readonly browser:string;
     readonly websocketUrl:string;readonly path:string;readonly owned:false}
  | {readonly ok:false;readonly code:'INVALID_SHAPE'|'UNEXPECTED_BROWSER'|
      'UNSAFE_WEBSOCKET'|'INVALID_DEBUGGER_PATH'};
export function inspectCdpVersion(payload:unknown,expectedPort:number):CdpEnvelope {
  if(!Number.isInteger(expectedPort)||expectedPort<1024||expectedPort>65535 ||
     !payload || typeof payload!=='object' || Array.isArray(payload))
    return {ok:false,code:'INVALID_SHAPE'};
  const data=payload as Record<string,unknown>;
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
  payload:unknown, expectedPort:number, expectedUrl:string
):CdpTargetEnvelope {
  if(!Number.isInteger(expectedPort)||expectedPort<1024||expectedPort>65535 ||
     typeof expectedUrl!=='string' || expectedUrl.length>4096)
    return {ok:false,code:'INVALID_TARGET_INPUT'};
  let wanted:URL;
  try {wanted=new URL(expectedUrl);}
  catch {return {ok:false,code:'INVALID_TARGET_INPUT'};}
  if(!['http:','https:'].includes(wanted.protocol) || !wanted.hostname ||
     wanted.username || wanted.password)
    return {ok:false,code:'INVALID_TARGET_INPUT'};
  if(!Array.isArray(payload) || payload.length>1000)
    return {ok:false,code:'INVALID_TARGET_LIST'};
  const matches: Array<{id:string;websocketUrl:string}> = [];
  for(const candidate of payload) {
    if(!candidate || typeof candidate!=='object'||Array.isArray(candidate))
      return {ok:false,code:'INVALID_TARGET_LIST'};
    const target=candidate as Record<string,unknown>;
    if(target.type!=='page'||typeof target.url!=='string')continue;
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
       cols[1]!=='127.0.0.1:'+port||cols[2]!=='0.0.0.0:0')continue;
    selected.push(/^\d+$/.test(cols[4])?Number(cols[4]):NaN);
  }
  return selected;
}
export async function verifyWindowsLoopbackListenerPid(
  port:number, expectedPid:number
):Promise<ListenerOwnerResult> {
  if(process.platform!=='win32')return {ok:false,code:'UNSUPPORTED_PLATFORM'};
  if(!Number.isInteger(port)||port<1024||port>65535 ||
     !Number.isSafeInteger(expectedPid)||expectedPid<1)
    return {ok:false,code:'INVALID_ARGUMENTS'};
  // netstat avoids repeated, expensive PowerShell NetTCP module startup in
  // concurrent Windows tests and in the actual app; no shell interpolation.
  let output:string;
  try {
    const result=await execFileAsync('netstat.exe',['-ano','-p','TCP'],
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
  websocketUrl:string,expectedPort:number,expectedVersion:string
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
  return new Promise(resolve=>{
    let client:WebSocket,settled=false;
    const finish=(passed:boolean)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      try{client.close();}catch{ /* socket already closed */ }
      resolve(passed);
    };
    const timer=setTimeout(()=>finish(false),4000);
    try{
      client=new WebSocket(websocketUrl);
      client.addEventListener('open',()=>{
        try{client.send(JSON.stringify({id:1,method:'Browser.getVersion'}));}
        catch{finish(false);}
      });
      client.addEventListener('message',event=>{
        try{
          const payload=JSON.parse(String(event.data)) as {
            id?:unknown;result?:{product?:unknown};error?:unknown
          };
          if(payload.id!==1)return;
          finish(!payload.error && (
            payload.result?.product==='Chrome/'+expectedVersion||
            payload.result?.product==='HeadlessChrome/'+expectedVersion
          ));
        }catch{finish(false);}
      });
      client.addEventListener('error',()=>finish(false));
      client.addEventListener('close',()=>finish(false));
    }catch{finish(false);}
  });
}
