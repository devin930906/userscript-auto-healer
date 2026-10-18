/** TASK-006 / REQ-010: read-only CDP observation of an explicitly approved owned tab.
 * Never evaluate page JS, claim cross-origin completeness, or infer userscript health.
 */
import {setTimeout as delay} from 'node:timers/promises';
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {isLiveApprovedChromeSession,readBoundedCdpJson} from '../browser/owned-chrome';
import type {OpenTargetResult} from '../browser/cdp-target';
import {inspectCdpTargetList,verifyWindowsLoopbackListenerPid} from '../browser/cdp-session';

export interface DomSummary {
  readonly elementCount:number;
  readonly iframeCount:number;
  readonly visibleShadowRoots:number;
  readonly blindSpots:readonly ('IFRAME_CONTENT_UNVERIFIED'|'CLOSED_SHADOW_ROOT_UNKNOWN'|'CROSS_ORIGIN_FRAME_UNVERIFIED')[];
}
export type ObservationResult =
  | {readonly ok:true;readonly status:'LIMITED_DOM_OBSERVATION';readonly observedAt:string;
     readonly originMatchesApproved:true;readonly routeChanged:boolean;
     readonly summary:DomSummary;readonly selectorCounts:Readonly<Record<string,number>>;
     readonly fullPageVerified:false;readonly userscriptVerified:false}
  | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'UNVERIFIED_BROWSER'|
     'UNVERIFIED_TARGET'|'INVALID_OPTIONS'|'CDP_FAILED'|'DOM_TOO_COMPLEX'|'CANCELLED'};
type CdpNode={nodeType?:unknown;nodeName?:unknown;nodeId?:unknown;
  children?:unknown;shadowRoots?:unknown;contentDocument?:unknown};
type CdpFrameTree={frame?:{url?:unknown};childFrames?:unknown};
const MAX_NODES=20000;
const MAX_BYTES=2*1024*1024;
function record(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==='object'&&!Array.isArray(value);
}
export function summarizeDomTree(raw:unknown,frames:unknown,approvedOrigin:string):DomSummary|null {
  if(!record(raw)||!isApprovedTopFrame(frames,approvedOrigin))return null;
  let elementCount=0,visited=0,iframes=0,shadow=0,cross=false;
  const stack:Array<{node:unknown;depth:number}>=[{node:raw,depth:0}];
  while(stack.length){
    const item=stack.pop()!;
    if(item.depth>90||++visited>MAX_NODES)return null;
    if(!record(item.node))return null;
    const node=item.node as CdpNode;
    if(!Number.isInteger(node.nodeType)||typeof node.nodeName!=='string')return null;
    if(node.nodeType===1){
      elementCount++;
      if(String(node.nodeName).toUpperCase()==='IFRAME')iframes++;
    }
    for(const key of ['children','shadowRoots','contentDocument'] as const){
      const next=node[key];
      if(next===undefined)continue;
      if(key==='contentDocument'){
        stack.push({node:next,depth:item.depth+1});
      }else{
        if(!Array.isArray(next))return null;
        if(key==='shadowRoots')shadow+=next.length;
        for(const child of next)stack.push({node:child,depth:item.depth+1});
      }
    }
  }
  const walkFrames=[frames];let traversed=0;
  while(walkFrames.length){
    const current=walkFrames.pop();
    if(!record(current)||++traversed>1000)return null;
    const frame=current as CdpFrameTree;
    if(!record(frame.frame)||typeof frame.frame.url!=='string')return null;
    try{
      const url=new URL(frame.frame.url);
      if(url.protocol==='http:'||url.protocol==='https:'){
        if(url.origin!==approvedOrigin)cross=true;
      }else if(url.href!=='about:blank')cross=true;
    }catch{cross=true;}
    if(frame.childFrames!==undefined){
      if(!Array.isArray(frame.childFrames))return null;
      walkFrames.push(...frame.childFrames);
    }
  }
  const blindSpots:DomSummary['blindSpots'][number][]=['CLOSED_SHADOW_ROOT_UNKNOWN'];
  if(iframes>0)blindSpots.push('IFRAME_CONTENT_UNVERIFIED');
  if(cross)blindSpots.push('CROSS_ORIGIN_FRAME_UNVERIFIED');
  return {elementCount,iframeCount:iframes,
    visibleShadowRoots:shadow,blindSpots};
}
/** Enforce the approved top-level origin inside CDP, not only via /json/list.
 * The page may navigate between tab discovery and DOM snapshot commands.
 */
export function isApprovedTopFrame(frameTree:unknown,approvedOrigin:string):boolean {
  if(!record(frameTree)||!record(frameTree.frame)||
     typeof frameTree.frame.url!=='string')return false;
  try {
    const current=new URL(frameTree.frame.url);
    return (current.protocol==='https:'||current.protocol==='http:') &&
      !current.username&&!current.password && current.origin===approvedOrigin;
  }catch{return false;}
}
function validateSelectors(value:unknown):value is string[]{
  return Array.isArray(value)&&value.length<=8&&
    value.every(s=>typeof s==='string'&&s.length>=1&&s.length<=256&&
      s.trim()===s&&!/[\u0000-\u001f]/.test(s))&&new Set(value).size===value.length;
}
async function pageCdp(url:string,selectors:string[],approvedOrigin:string,
  signal?:AbortSignal):Promise<{summary:DomSummary;selectorCounts:Record<string,number>}|null>{
  if(signal?.aborted)return null;
  const ws=new WebSocket(url);
  let id=0;
  const opened=await new Promise<boolean>(resolve=>{
    let done=false;
    const settle=(value:boolean)=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>settle(false),4000);
    ws.addEventListener('open',()=>settle(true),{once:true});
    ws.addEventListener('error',()=>settle(false),{once:true});
    ws.addEventListener('close',()=>settle(false),{once:true});
  });
  if(!opened){ws.close();return null;}
  const query=(method:string,params:Record<string,unknown>={}):Promise<Record<string,unknown>|null>=>{
    const commandId=++id;
    return new Promise(resolve=>{
      let done=false;
      const finish=(value:Record<string,unknown>|null)=>{
        if(done)return;done=true;clearTimeout(timer);
        ws.removeEventListener('message',onMessage);
        ws.removeEventListener('close',onClose);
        signal?.removeEventListener('abort',onClose);
        resolve(value);
      };
      const onClose=()=>finish(null);
      const onMessage=(event:MessageEvent)=>{
        try{
          const raw=String(event.data);
          if(raw.length>MAX_BYTES)return finish(null);
          const obj=JSON.parse(raw) as {id?:unknown;result?:unknown;error?:unknown};
          if(obj.id!==commandId)return;
          finish(!obj.error&&record(obj.result)?obj.result:null);
        }catch{finish(null);}
      };
      const timer=setTimeout(()=>finish(null),4000);
      ws.addEventListener('message',onMessage);
      ws.addEventListener('close',onClose,{once:true});
      signal?.addEventListener('abort',onClose,{once:true});
      if(signal?.aborted){finish(null);return;}
      try{ws.send(JSON.stringify({id:commandId,method,params}));}
      catch{finish(null);}
    });
  };
  try{
    // Verify the live frame origin before asking CDP for any DOM content.
    // Revalidate after the DOM read: navigation may race either command.
    const initialFrames=await query('Page.getFrameTree');
    if(!initialFrames||!isApprovedTopFrame(initialFrames.frameTree,approvedOrigin))return null;
    const dom=await query('DOM.getDocument',{depth:-1,pierce:true});
    const frames=await query('Page.getFrameTree');
    if(!dom||!record(dom.root)||!frames ||
       !isApprovedTopFrame(frames.frameTree,approvedOrigin))return null;
    const summary=summarizeDomTree(dom.root,frames.frameTree,approvedOrigin);
    if(!summary||typeof dom.root.nodeId!=='number')return null;
    const selectorCounts:Record<string,number>=Object.create(null);
    for(const selector of selectors){
      if(signal?.aborted)return null;
      const result=await query('DOM.querySelectorAll',{nodeId:dom.root.nodeId,selector});
      if(!result||!Array.isArray(result.nodeIds)||
         result.nodeIds.length>MAX_NODES||!result.nodeIds.every(Number.isInteger))return null;
      selectorCounts[selector]=result.nodeIds.length;
    }
    // A route transition after the first DOM read must not turn observations
    // of a different origin into apparently authorized evidence.
    const finalFrames=await query('Page.getFrameTree');
    if(!finalFrames||!isApprovedTopFrame(finalFrames.frameTree,approvedOrigin))return null;
    return {summary,selectorCounts};
  }finally{try{ws.close();}catch{/* closing untrusted endpoint */}}
}
/** Can inspect a tab only after its identity and origin are rechecked against
 * the current owned Chrome; URL changes inside that origin are still observable.
 */
export async function observeApprovedDom(
  session:ManagedLaunchResult,target:OpenTargetResult,expectedUrl:string,
  userApproved:boolean,selectors:string[]=[],signal?:AbortSignal
):Promise<ObservationResult>{
  if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!session?.ok||!isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  if(!target?.ok||target.status!=='TARGET_ID_AND_URL_MATCH_ONLY')
    return {ok:false,code:'UNVERIFIED_TARGET'};
  if(!validateSelectors(selectors)||typeof expectedUrl!=='string'||expectedUrl.length>4096)
    return {ok:false,code:'INVALID_OPTIONS'};
  let approved:URL,socket:URL;
  try{approved=new URL(expectedUrl);socket=new URL(session.browserWebsocket);}
  catch{return {ok:false,code:'INVALID_OPTIONS'};}
  if(!['http:','https:'].includes(approved.protocol)||!approved.hostname||
     approved.username||approved.password)return {ok:false,code:'INVALID_OPTIONS'};
  const port=Number(socket.port);
  if(socket.protocol!=='ws:'||socket.hostname!=='127.0.0.1'||
     !Number.isInteger(port)||port<1024||port>65535)
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  const owner=await verifyWindowsLoopbackListenerPid(port,session.pid);
  if(!owner.ok||!isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  let json:unknown;
  try{
    const response=await fetch('http://127.0.0.1:'+port+'/json/list',{
      redirect:'error',signal:AbortSignal.timeout(1600)});
    json=await readBoundedCdpJson(response);
  }catch{return {ok:false,code:'CDP_FAILED'};}
  if(!Array.isArray(json))return {ok:false,code:'UNVERIFIED_TARGET'};
  const item=json.find(x=>record(x)&&x.id===target.targetId);
  if(!record(item)||typeof item.url!=='string')
    return {ok:false,code:'UNVERIFIED_TARGET'};
  let actual:URL;
  try{actual=new URL(item.url);}catch{return {ok:false,code:'UNVERIFIED_TARGET'};}
  if(!['http:','https:'].includes(actual.protocol)||actual.origin!==approved.origin)
    return {ok:false,code:'UNVERIFIED_TARGET'};
  const checked=inspectCdpTargetList(json,port,actual.href);
  if(!checked.ok||checked.targetId!==target.targetId)
    return {ok:false,code:'UNVERIFIED_TARGET'};
  const found=await pageCdp(checked.websocketUrl,selectors,approved.origin,signal);
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!found)return {ok:false,code:'CDP_FAILED'};
  if(!isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  return {ok:true,status:'LIMITED_DOM_OBSERVATION',
    observedAt:new Date().toISOString(),originMatchesApproved:true,
    routeChanged:actual.href!==approved.href,summary:found.summary,
    selectorCounts:found.selectorCounts,fullPageVerified:false,userscriptVerified:false};
}

/** Bounded repeated snapshots permit evidence of asynchronous DOM and SPA route
 * transitions, without executing scripts or interpreting the site business result.
 */
export type DynamicObservation =
 | {readonly ok:true;readonly status:'LIMITED_DYNAMIC_OBSERVATION';
    readonly samples:readonly Extract<ObservationResult,{ok:true}>[];
    readonly routeChangeDetected:boolean;readonly selectorCountChanged:boolean;
    readonly domCountChanged:boolean;readonly userscriptVerified:false}
 | Extract<ObservationResult,{ok:false}>;
export async function observeApprovedDomSeries(
  session:ManagedLaunchResult,target:OpenTargetResult,expectedUrl:string,
  userApproved:boolean,selectors:string[],sampleCount:number,intervalMs:number,
  signal?:AbortSignal
):Promise<DynamicObservation>{
  if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
  if(!validateSelectors(selectors)||
     !Number.isInteger(sampleCount)||sampleCount<2||sampleCount>8||
     !Number.isInteger(intervalMs)||intervalMs<100||intervalMs>3000)
    return {ok:false,code:'INVALID_OPTIONS'};
  const samples:Extract<ObservationResult,{ok:true}>[]=[];
  for(let i=0;i<sampleCount;i++){
    if(signal?.aborted)return {ok:false,code:'CANCELLED'};
    if(i!==0){
      try{await delay(intervalMs,undefined,{signal});}
      catch{return {ok:false,code:'CANCELLED'};}
    }
    const result=await observeApprovedDom(session,target,expectedUrl,
      true,selectors,signal);
    if(!result.ok)return result;
    samples.push(result);
  }
  const first=samples[0];
  return {ok:true,status:'LIMITED_DYNAMIC_OBSERVATION',samples,
    routeChangeDetected:samples.some(s=>s.routeChanged),
    selectorCountChanged:samples.some(s=>selectors.some(
      selector=>s.selectorCounts[selector]!==first.selectorCounts[selector])),
    domCountChanged:samples.some(s=>s.summary.elementCount!==first.summary.elementCount),
    userscriptVerified:false};
}
