/** TASK-006 / REQ-010: read-only CDP observation of an explicitly approved owned tab.
 * Never evaluate page JS, claim cross-origin completeness, or infer userscript health.
 */
import {setTimeout as delay} from 'node:timers/promises';
import {types as nodeTypes} from 'node:util';
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
/** Return the observed CDP top-frame URL only for the approved origin.
 * Used to detect a same-origin route change DURING one DOM read. Verifying
 * origin alone would wrongly associate old DOM nodes with a new SPA route.
 */
export function approvedTopFrameUrl(frameTree:unknown,approvedOrigin:string):string|null {
  if(!record(frameTree)||!record(frameTree.frame)||
     typeof frameTree.frame.url!=='string'||
     frameTree.frame.url.length>4096)return null;
  try {
    const current=new URL(frameTree.frame.url);
    return (current.protocol==='https:'||current.protocol==='http:') &&
      !current.username&&!current.password && current.origin===approvedOrigin
      ? current.href : null;
  }catch{return null;}
}
export function isApprovedTopFrame(frameTree:unknown,approvedOrigin:string):boolean {
  return approvedTopFrameUrl(frameTree,approvedOrigin)!==null;
}
/** Only native AbortSignals may control privileged CDP transports.
 * A Proxy, prototype spoof or shadowed event method must not run caller code.
 */
export function isNativeCdpCancellationSignal(value:unknown):value is AbortSignal {
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(key=>
       Object.prototype.hasOwnProperty.call(value,key)))return false;
  const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
  return typeof getter==='function'&&typeof getter.call(value)==='boolean';
 }catch{return false;}
}
/** Copy a bounded selector list before asynchronous owner/CDP checks.
 * Accessor-backed arrays and Proxies cannot supply executable field reads.
 */
function safeSelectors(value:unknown):string[]|null {
 try{
  if(!Array.isArray(value)||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==Array.prototype)return null;
  const desc=Object.getOwnPropertyDescriptors(value);
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(length)||length<0||length>8||
     Reflect.ownKeys(desc).length!==length+1)return null;
  const result:string[]=[];
  for(let i=0;i<length;i++){
   const slot=desc[String(i)];
   if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value')||
      typeof slot.value!=='string'||slot.value.length<1||
      slot.value.length>256||slot.value.trim()!==slot.value||
      /[\\u0000-\\u001f]/.test(slot.value))return null;
   result.push(slot.value);
  }
  return new Set(result).size===result.length?result:null;
 }catch{return null;}
}
/** Browser provenance is checked independently; a target hint is only inert
 * data until the owned browser's live /json/list re-confirms its identity.
 */
function safeTargetId(value:unknown):string|null{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const desc=Object.getOwnPropertyDescriptors(value);
  const keys=Reflect.ownKeys(desc);
  const expected=['ok','status','targetId','businessVerified'];
  if(keys.length!==expected.length||
     keys.some(k=>typeof k!=='string'||!expected.includes(k))||
     expected.some(k=>!Object.prototype.hasOwnProperty.call(desc,k)||
       !Object.prototype.hasOwnProperty.call(desc[k],'value')))return null;
  const id=desc.targetId.value;
  return desc.ok.value===true&&
    desc.status.value==='TARGET_ID_AND_URL_MATCH_ONLY'&&
    desc.businessVerified.value===false&&typeof id==='string'&&
    /^[a-zA-Z0-9_-]{8,128}$/.test(id)?id:null;
 }catch{return null;}
}
/**
 * TASK-006/007 / TEST-010/017: cancellation-aware CDP socket handshake.
 * A late OPEN after abort/timeout cannot make the caller send Page/DOM
 * commands. This is only a transport gate, NEVER browser ownership evidence.
 */
export function awaitReadOnlyCdpSocketOpen(
  socket:WebSocket,signal?:AbortSignal
):Promise<boolean>{
  if(signal!==undefined&&!isNativeCdpCancellationSignal(signal))
    return Promise.resolve(false);
  return new Promise(resolve=>{
    let settled=false;
    const settle=(opened:boolean)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      socket.removeEventListener('open',onOpen);
      socket.removeEventListener('error',onFailure);
      socket.removeEventListener('close',onFailure);
      resolve(opened&&!signal?.aborted);
    };
    const onOpen=()=>settle(true);
    const onFailure=()=>settle(false);
    const onAbort=()=>settle(false);
    const timer=setTimeout(()=>settle(false),4000);
    socket.addEventListener('open',onOpen);
    socket.addEventListener('error',onFailure);
    socket.addEventListener('close',onFailure);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)settle(false);
  });
}
async function pageCdp(url:string,selectors:string[],approvedOrigin:string,
  signal?:AbortSignal):Promise<{summary:DomSummary;selectorCounts:Record<string,number>;
    observedTopUrl:string}|null>{
  if(signal?.aborted)return null;
  const ws=new WebSocket(url);
  let id=0;
  // Opening a WebSocket can take several seconds. Revoked consent must
  // interrupt this phase too, before ANY read-only CDP command is sent.
  const opened=await awaitReadOnlyCdpSocketOpen(ws,signal);
  if(!opened){try{ws.close();}catch{/* connection may still be opening */}return null;}
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
    const initialUrl=initialFrames?
      approvedTopFrameUrl(initialFrames.frameTree,approvedOrigin):null;
    if(initialUrl===null)return null;
    const dom=await query('DOM.getDocument',{depth:-1,pierce:true});
    const frames=await query('Page.getFrameTree');
    const middleUrl=frames?approvedTopFrameUrl(frames.frameTree,approvedOrigin):null;
    if(!dom||!record(dom.root)||!frames||middleUrl===null||middleUrl!==initialUrl)return null;
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
    const finalUrl=finalFrames?
      approvedTopFrameUrl(finalFrames.frameTree,approvedOrigin):null;
    if(finalUrl===null||finalUrl!==middleUrl)return null;
    return {summary,selectorCounts,observedTopUrl:finalUrl};
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
  if(signal!==undefined&&!isNativeCdpCancellationSignal(signal))
    return {ok:false,code:'INVALID_OPTIONS'};
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  const checkedSelectors=safeSelectors(selectors);
  if(!checkedSelectors||typeof expectedUrl!=='string'||expectedUrl.length>4096)
    return {ok:false,code:'INVALID_OPTIONS'};
  // Reject forged sessions before reading any of their properties.
  if(!isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  const targetId=safeTargetId(target);
  if(!targetId)return {ok:false,code:'UNVERIFIED_TARGET'};
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
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!owner.ok||!isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  let json:unknown;
  try{
    // Revocation must abort the bounded target-list HTTP transport itself,
    // not merely the later page WebSocket / DOM commands. A timeout alone
    // can leave a cancelled, consent-sensitive observation waiting on I/O.
    const requestSignal=signal
      ?AbortSignal.any([signal,AbortSignal.timeout(1600)])
      :AbortSignal.timeout(1600);
    const response=await fetch('http://127.0.0.1:'+port+'/json/list',{
      redirect:'error',signal:requestSignal});
    json=await readBoundedCdpJson(response);
  }catch{
    return {ok:false,code:signal?.aborted?'CANCELLED':'CDP_FAILED'};
  }
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!Array.isArray(json))return {ok:false,code:'UNVERIFIED_TARGET'};
  const item=json.find(x=>record(x)&&x.id===targetId);
  if(!record(item)||typeof item.url!=='string')
    return {ok:false,code:'UNVERIFIED_TARGET'};
  let actual:URL;
  try{actual=new URL(item.url);}catch{return {ok:false,code:'UNVERIFIED_TARGET'};}
  if(!['http:','https:'].includes(actual.protocol)||actual.origin!==approved.origin)
    return {ok:false,code:'UNVERIFIED_TARGET'};
  const checked=inspectCdpTargetList(json,port,actual.href);
  if(!checked.ok||checked.targetId!==targetId)
    return {ok:false,code:'UNVERIFIED_TARGET'};
  const found=await pageCdp(checked.websocketUrl,checkedSelectors,approved.origin,signal);
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  if(!found)return {ok:false,code:'CDP_FAILED'};
  if(!isLiveApprovedChromeSession(session))
    return {ok:false,code:'UNVERIFIED_BROWSER'};
  return {ok:true,status:'LIMITED_DOM_OBSERVATION',
    observedAt:new Date().toISOString(),originMatchesApproved:true,
    // Use the live CDP frame after the DOM read, not an earlier /json/list URL.
    routeChanged:found.observedTopUrl!==approved.href,summary:found.summary,
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
  if(signal!==undefined&&!isNativeCdpCancellationSignal(signal))
    return {ok:false,code:'INVALID_OPTIONS'};
  const checkedSelectors=safeSelectors(selectors);
  if(!checkedSelectors||
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
      true,checkedSelectors,signal);
    if(!result.ok)return result;
    samples.push(result);
  }
  const first=samples[0];
  return {ok:true,status:'LIMITED_DYNAMIC_OBSERVATION',samples,
    routeChangeDetected:samples.some(s=>s.routeChanged),
    selectorCountChanged:samples.some(s=>checkedSelectors.some(
      selector=>s.selectorCounts[selector]!==first.selectorCounts[selector])),
    domCountChanged:samples.some(s=>s.summary.elementCount!==first.summary.elementCount),
    userscriptVerified:false};
}
