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
