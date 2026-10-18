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
export async function verifyWindowsLoopbackListenerPid(
  port:number, expectedPid:number
):Promise<ListenerOwnerResult> {
  if(process.platform!=='win32')return {ok:false,code:'UNSUPPORTED_PLATFORM'};
  if(!Number.isInteger(port)||port<1024||port>65535 ||
     !Number.isSafeInteger(expectedPid)||expectedPid<1)
    return {ok:false,code:'INVALID_ARGUMENTS'};
  // Both dynamic values are validated integers, never interpolated paths/input.
  const command='$ErrorActionPreference="Stop";'+
    ' @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort '+port+
    ' -State Listen -ErrorAction Stop) | ForEach-Object { $_.OwningProcess }';
  let output:string;
  try {
    const result=await execFileAsync('powershell.exe',
      ['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
      {windowsHide:true,timeout:8000,maxBuffer:4096});
    output=result.stdout;
  } catch {
    return {ok:false,code:'LISTENER_UNAVAILABLE'};
  }
  const lines=output.trim().split(/\r?\n/).filter(Boolean);
  if(lines.length===0)return {ok:false,code:'LISTENER_UNAVAILABLE'};
  if(lines.length!==1 || !/^[0-9]+$/.test(lines[0].trim()))
    return {ok:false,code:'LISTENER_AMBIGUOUS'};
  const pid=Number(lines[0].trim());
  if(!Number.isSafeInteger(pid)||pid<1)return {ok:false,code:'LISTENER_AMBIGUOUS'};
  if(pid!==expectedPid)return {ok:false,code:'LISTENER_PID_MISMATCH'};
  return {ok:true,status:'LISTENER_PID_MATCH_ONLY',pid,executableVerified:false};
}
