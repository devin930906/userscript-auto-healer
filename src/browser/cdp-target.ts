/** TASK-005: explicitly authorized target navigation in a verified owned Chrome.
 * This cannot prove login, userscript injection, GM APIs or business behavior.
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagedLaunchResult } from './owned-chrome';
import { readBoundedCdpJson } from './owned-chrome';
import { inspectCdpTargetList, verifyWindowsLoopbackListenerPid } from './cdp-session';

export type OpenTargetResult =
  | {readonly ok:true;readonly status:'TARGET_ID_AND_URL_MATCH_ONLY';
     readonly targetId:string;readonly businessVerified:false}
  | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'UNVERIFIED_BROWSER'|
      'INVALID_TARGET_URL'|'UNOWNED_LISTENER'|'CDP_COMMAND_FAILED'|'TARGET_NOT_CONFIRMED'};
function validTarget(raw:string):boolean {
  if(raw.length>4096||raw.trim()!==raw)return false;
  try{
    const url=new URL(raw);
    return ['http:','https:'].includes(url.protocol)&&!!url.hostname&&
      !url.username&&!url.password&&!url.hash;
  }catch{return false;}
}
async function requestNewTab(wsUrl:string,targetUrl:string):Promise<string|null>{
  return new Promise(resolve=>{
    let ws:WebSocket,finished=false;
    const finish=(value:string|null)=>{
      if(finished)return;
      finished=true;clearTimeout(timer);
      try{ws.close();}catch{ /* socket already closed */ }
      resolve(value);
    };
    const timer=setTimeout(()=>finish(null),5000);
    try{
      ws=new WebSocket(wsUrl);
      ws.addEventListener('open',()=>{
        try{ws.send(JSON.stringify({id:2,method:'Target.createTarget',
          params:{url:targetUrl}}));}
        catch{finish(null);}
      });
      ws.addEventListener('message',event=>{
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
/** Never accept a raw third-party CDP socket or an unapproved website. */
export async function openApprovedTarget(
  session:ManagedLaunchResult,targetUrl:string,userApproved:boolean
):Promise<OpenTargetResult>{
  if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
  if(!session.ok||session.status!=='OWNED_CDP_BROWSER_VERIFIED'||
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
  if(!owns.ok)return {ok:false,code:'UNOWNED_LISTENER'};
  const created=await requestNewTab(session.browserWebsocket,targetUrl);
  if(!created)return {ok:false,code:'CDP_COMMAND_FAILED'};
  const began=Date.now();
  while(Date.now()-began<9000){
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list',{
        redirect:'error',signal:AbortSignal.timeout(1500)});
      const json=await readBoundedCdpJson(response);
      const inspected=inspectCdpTargetList(json,port,targetUrl);
      if(inspected.ok&&inspected.targetId===created)
        return {ok:true,status:'TARGET_ID_AND_URL_MATCH_ONLY',
          targetId:created,businessVerified:false};
    }catch{ /* navigation is still pending */ }
    await delay(250);
  }
  return {ok:false,code:'TARGET_NOT_CONFIRMED'};
}
