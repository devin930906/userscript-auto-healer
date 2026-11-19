/** TASK-007 / REQ-017: read-only Tampermonkey installation metadata.
 *
 * This module inspects only the Chrome-owned chrome://extensions management UI
 * in a live, explicitly approved, application-owned Chrome session. It never
 * evaluates extension-origin pages or userscripts, installs/enables extensions,
 * reads user scripts, or claims Chrome Web Store provenance.
 */
import {types as nodeTypes} from 'node:util';
import {performance} from 'node:perf_hooks';
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {isLiveApprovedChromeSession} from '../browser/owned-chrome';
import {verifyWindowsLoopbackListenerPid} from '../browser/cdp-session';
import {hasDuplicateJsonObjectKeys,TAMPERMONKEY_EXTENSION_ID} from './tampermonkey-adapter';

export const TAMPERMONKEY_WEBSTORE_URL=
 'https://chromewebstore.google.com/detail/tampermonkey/'+TAMPERMONKEY_EXTENSION_ID;

export type ManagerToggleState='ENABLED'|'DISABLED'|'UNKNOWN'|'NOT_APPLICABLE';

export type ManagerInstallationResult =
 | {readonly ok:true;readonly status:'NOT_INSTALLED';
    readonly extensionId:typeof TAMPERMONKEY_EXTENSION_ID;
    readonly installUrl:typeof TAMPERMONKEY_WEBSTORE_URL;
    readonly extensionAuthenticityVerified:false;
    readonly storeProvenanceVerified:false;
    readonly versionVerified:false;
    readonly permissionVerified:false;
    readonly scriptInstallationVerified:false;
    readonly scriptInjectionVerified:false;
    readonly gmApiVerified:false;
    readonly businessVerified:false}
 | {readonly ok:true;readonly status:'INSTALLED_METADATA_HINT_ONLY';
    readonly manager:'Tampermonkey';
    readonly extensionId:typeof TAMPERMONKEY_EXTENSION_ID;
    readonly version:string;
    readonly enabled:ManagerToggleState;
    readonly allowUserScripts:ManagerToggleState;
    readonly extensionAuthenticityVerified:false;
    readonly storeProvenanceVerified:false;
    readonly versionVerified:true;
    readonly permissionVerified:boolean;
    readonly scriptInstallationVerified:false;
    readonly scriptInjectionVerified:false;
    readonly gmApiVerified:false;
    readonly businessVerified:false}
 | {readonly ok:false;readonly code:'CDP_FAILED';readonly stage?:'connect'|'create-target'|'attach-target'|'list-frame'|'manager-card'|'navigate-details'|'details-frame'|'permission'|'cleanup-close'|'cleanup-list'}
 | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'CANCELLED'|'INVALID_OPTIONS'|
    'UNVERIFIED_BROWSER'|'UNOWNED_LISTENER'|'INVALID_CDP_RESPONSE'}
 | {readonly ok:false;readonly code:'INSPECTION_UNAVAILABLE';readonly stage?:'list-frame'|'manager-card'|'details-frame'};

export type LaunchTampermonkeyInstallResult =
 | {readonly ok:true;readonly status:'INSTALLATION_PAGE_OPENED';
    readonly targetId:string;
    readonly installUrl:typeof TAMPERMONKEY_WEBSTORE_URL;
    readonly userApproved:true;
    readonly nativeConfirmationRequired:true}
 | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'CANCELLED'|'INVALID_OPTIONS'|
    'UNVERIFIED_BROWSER'|'UNOWNED_LISTENER'|'CDP_FAILED'};

const EXTENSIONS_LIST_URL='chrome://extensions/';
const EXTENSIONS_DETAILS_URL='chrome://extensions/?id='+TAMPERMONKEY_EXTENSION_ID;
const MAX_CDP_MESSAGE_BYTES=512*1024;
const CDP_COMMAND_TIMEOUT_MS=5000;
// chrome://extensions renders cards only after its asynchronous inventory load.
const MANAGER_INVENTORY_READY_TIMEOUT_MS=4000;
const VERSION_PATTERN=/^\d+\.\d+\.\d+(?:\.\d+)?$/;
const TAMPERMONKEY_NAME_PATTERN=/^(?:tampermonkey(?:\s*[\(（]?(?:篡改猴|®|beta)[\)）]?)?|篡改猴)$/i;

/** Fixed, read-only expression for Chrome's own extensions management page.
 * It returns only the one allowlisted extension's ID/name/version/enabled
 * state. It does not read scripts, execute extension code, or modify settings.
 */
export const TAMPERMONKEY_MANAGER_CARD_EXPRESSION =
 '(() => {'+
 'try {'+
 ' const expectedId="'+TAMPERMONKEY_EXTENSION_ID+'";'+
 ' const manager=document.querySelector("extensions-manager");'+
 ' if(!manager||location.protocol!=="chrome:"||location.hostname!=="extensions"||location.pathname!=="/")'+
 '  return {managerPage:false,inventoryReady:false,matchingCount:0};'+
 ' const inventoryReady=manager.didInitPage_===true;'+
 ' if(!inventoryReady)return {managerPage:true,inventoryReady:false,matchingCount:0};'+
 ' const matches=[];const visited=new Set();'+
 ' const scan=root=>{'+
 '  if(!root||visited.has(root))return;visited.add(root);'+
 '  for(const el of root.querySelectorAll("*")){'+
 '   if(el.tagName&&el.tagName.toLowerCase()==="extensions-item"){'+
 '    const data=el.data;'+
 '    const id=(typeof el.id==="string"&&el.id)||(data&&typeof data.id==="string"&&data.id)||"";'+
 '    if(id===expectedId){'+
 '     const name=(el.shadowRoot&&el.shadowRoot.querySelector("#name")&&'+
 '       el.shadowRoot.querySelector("#name").textContent||'+
 '       (data&&typeof data.name==="string"?data.name:"")).trim();'+
 '     const versionText=(el.shadowRoot&&el.shadowRoot.querySelector("#version")&&'+
 '       el.shadowRoot.querySelector("#version").textContent||"").trim();'+
 '     const rawVersion=data&&typeof data.version==="string"?data.version:'+ 
 '       data&&data.manifest&&typeof data.manifest.version==="string"?data.manifest.version:'+ 
 '       ((versionText.match(/\\d+(?:\\.\\d+){2,3}/)||[])[0]||"");'+
 '     const toggle=el.shadowRoot&&(el.shadowRoot.querySelector("#enableToggle")||'+
 '       el.shadowRoot.querySelector("cr-toggle"));'+
 '     matches.push({id,name,version:rawVersion,enabled:toggle?Boolean(toggle.checked):null});'+
 '    }'+
 '   }'+
 '   if(el.shadowRoot)scan(el.shadowRoot);'+
 '  }'+
 ' };'+
 ' scan(document);'+
 ' if(matches.length!==1)return {managerPage:true,inventoryReady:true,matchingCount:matches.length};'+
 ' return {managerPage:true,inventoryReady:true,matchingCount:1,id:matches[0].id,name:matches[0].name,'+
 '  version:matches[0].version,enabled:matches[0].enabled};'+
 '}catch{return {managerPage:false,inventoryReady:false,matchingCount:0};}'+
 '})()';

/** Fixed, read-only expression for the Chrome 138+ Allow User Scripts toggle.
 * The caller has already navigated to the exact Tampermonkey details URL.
 * This expression only reads the matching toggle and never clicks it.
 */
export const TAMPERMONKEY_USER_SCRIPTS_EXPRESSION =
 '(() => {'+
 'try {'+
 ' const manager=document.querySelector("extensions-manager");'+
 ' if(!manager||location.protocol!=="chrome:"||location.hostname!=="extensions"||location.pathname!=="/")'+
 '  return {managerPage:false,matchingRows:0,allowUserScriptsAvailable:false,allowUserScripts:null};'+
 ' const rows=[];const visited=new Set();'+
 ' const scan=root=>{'+
 '  if(!root||visited.has(root))return;visited.add(root);'+
 '  for(const el of root.querySelectorAll("*")){'+
 '   if(el.tagName&&el.tagName.toLowerCase()==="extensions-toggle-row"){'+
 '    const label=(el.textContent||"")+" "+(el.shadowRoot&&el.shadowRoot.textContent||"");'+
 '    const toggle=(el.shadowRoot&&el.shadowRoot.querySelector("cr-toggle"))||'+
 '      el.querySelector("cr-toggle");'+
 '    if(/allow user scripts|允许用户脚本/i.test(label)&&toggle)rows.push(Boolean(toggle.checked));'+
 '   }'+
 '   if(el.shadowRoot)scan(el.shadowRoot);'+
 '  }'+
 ' };'+
 ' scan(document);'+
 ' return {managerPage:true,matchingRows:rows.length,'+
 '  allowUserScriptsAvailable:rows.length===1,'+
 '  allowUserScripts:rows.length===1?rows[0]:null};'+
 '}catch{return {managerPage:false,matchingRows:0,allowUserScriptsAvailable:false,allowUserScripts:null};}'+
 '})()';

function isPlainRecord(value:unknown):value is Record<string,unknown>{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||nodeTypes.isProxy(value))
   return false;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(key=>
   typeof key==='string'&&
   Object.prototype.hasOwnProperty.call(descriptors[key as string],'value')&&
   descriptors[key as string].enumerable===true);
 }catch{return false;}
}
function ownValue(record:Record<string,unknown>,key:string):unknown{
 try{
  const descriptor=Object.getOwnPropertyDescriptor(record,key);
  return descriptor&&Object.prototype.hasOwnProperty.call(descriptor,'value')
   ?descriptor.value:undefined;
 }catch{return undefined;}
}
function hasOnlyKeys(record:Record<string,unknown>,allowed:readonly string[]):boolean{
 const set=new Set(allowed);
 return Object.keys(record).every(key=>set.has(key));
}
function runtimeValue(payload:unknown):Record<string,unknown>|null{
 if(!isPlainRecord(payload)||Object.prototype.hasOwnProperty.call(payload,'exceptionDetails'))
  return null;
 const remote=ownValue(payload,'result');
 if(!isPlainRecord(remote)||ownValue(remote,'type')!=='object')return null;
 const value=ownValue(remote,'value');
 return isPlainRecord(value)?value:null;
}
function isManagerInventoryPending(payload:unknown):boolean{
 const value=runtimeValue(payload);
 return value!==null&&
  ownValue(value,'managerPage')===true&&
  ownValue(value,'inventoryReady')===false&&
  ownValue(value,'matchingCount')===0&&
  hasOnlyKeys(value,['managerPage','inventoryReady','matchingCount']);
}
/** @internal Bounded retry seam for deterministic inventory-readiness tests. */
export async function readTampermonkeyManagerCardAfterInventoryReady(
 evaluate:(timeoutMs:number)=>Promise<unknown>,
 options:{readonly timeoutMs?:number;readonly now?:()=>number;
  readonly wait?:(ms:number)=>Promise<void>}={}
):Promise<ManagerInstallationResult>{
 const timeoutMs=options.timeoutMs??MANAGER_INVENTORY_READY_TIMEOUT_MS;
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)
  return {ok:false,code:'INSPECTION_UNAVAILABLE',stage:'manager-card'};
 const now=options.now??(()=>performance.now());
 const wait=options.wait??waitBriefly;
 const deadline=now()+timeoutMs;
 for(;;){
  const remaining=deadline-now();
  if(remaining<=0)
   return {ok:false,code:'INSPECTION_UNAVAILABLE',stage:'manager-card'};
  let receipt:unknown;
  try{receipt=await evaluate(Math.min(CDP_COMMAND_TIMEOUT_MS,remaining));}
  catch{return {ok:false,code:'INSPECTION_UNAVAILABLE',stage:'manager-card'};}
  const inventoryPending=isManagerInventoryPending(receipt);
  const card=parseTampermonkeyExtensionCardReceipt(receipt);
  if(card.ok||!inventoryPending)return card;
  const remainingAfterRead=deadline-now();
  if(remainingAfterRead<=0)
   return {ok:false,code:'INSPECTION_UNAVAILABLE',stage:'manager-card'};
  await wait(Math.min(250,remainingAfterRead));
 }
}
function invalidReceipt():ManagerInstallationResult{
 return {ok:false,code:'INVALID_CDP_RESPONSE'};
}

/** Parse only the fixed returnByValue result from the Chrome manager card probe. */
export function parseTampermonkeyExtensionCardReceipt(
 payload:unknown
):ManagerInstallationResult{
 const value=runtimeValue(payload);
 if(!value||ownValue(value,'managerPage')!==true||
    ownValue(value,'inventoryReady')!==true)return invalidReceipt();
 const count=ownValue(value,'matchingCount');
 if(!Number.isInteger(count)||typeof count!=='number'||count<0||count>1)
  return invalidReceipt();
 if(count===0){
  if(!hasOnlyKeys(value,['managerPage','inventoryReady','matchingCount']))return invalidReceipt();
  return {ok:true,status:'NOT_INSTALLED',extensionId:TAMPERMONKEY_EXTENSION_ID,
   installUrl:TAMPERMONKEY_WEBSTORE_URL,
   extensionAuthenticityVerified:false,storeProvenanceVerified:false,
   versionVerified:false,permissionVerified:false,
   scriptInstallationVerified:false,scriptInjectionVerified:false,
   gmApiVerified:false,businessVerified:false};
 }
 if(!hasOnlyKeys(value,['managerPage','inventoryReady','matchingCount',
   'id','name','version','enabled']))
  return invalidReceipt();
 const id=ownValue(value,'id');
 const name=ownValue(value,'name');
 const version=ownValue(value,'version');
 const enabled=ownValue(value,'enabled');
 if(id!==TAMPERMONKEY_EXTENSION_ID||typeof name!=='string'||
    !TAMPERMONKEY_NAME_PATTERN.test(name)||typeof version!=='string'||
    !VERSION_PATTERN.test(version)||
    (enabled!==null&&enabled!==undefined&&typeof enabled!=='boolean'))
  return invalidReceipt();
 return {ok:true,status:'INSTALLED_METADATA_HINT_ONLY',manager:'Tampermonkey',
  extensionId:TAMPERMONKEY_EXTENSION_ID,version,
  enabled:typeof enabled==='boolean'?(enabled?'ENABLED':'DISABLED'):'UNKNOWN',
  allowUserScripts:'UNKNOWN',
  extensionAuthenticityVerified:false,storeProvenanceVerified:false,
  versionVerified:true,permissionVerified:false,
  scriptInstallationVerified:false,scriptInjectionVerified:false,
  gmApiVerified:false,businessVerified:false};
}

/** Parse only the fixed Allow User Scripts toggle receipt. */
export function parseTampermonkeyUserScriptsReceipt(
 payload:unknown,chromeMajor:number
):ManagerToggleState{
 if(!Number.isInteger(chromeMajor)||chromeMajor<0)return 'UNKNOWN';
 if(chromeMajor<138)return 'NOT_APPLICABLE';
 const value=runtimeValue(payload);
 if(!value||!hasOnlyKeys(value,[
   'managerPage','matchingRows','allowUserScriptsAvailable','allowUserScripts'
  ])||ownValue(value,'managerPage')!==true)return 'UNKNOWN';
 const rows=ownValue(value,'matchingRows');
 if(rows!==1||ownValue(value,'allowUserScriptsAvailable')!==true)return 'UNKNOWN';
 const enabled=ownValue(value,'allowUserScripts');
 return typeof enabled==='boolean'?(enabled?'ENABLED':'DISABLED'):'UNKNOWN';
}

function isNativeAbortSignal(signal:unknown):signal is AbortSignal{
 try{
  if(!signal||typeof signal!=='object'||nodeTypes.isProxy(signal)||
     Object.getPrototypeOf(signal)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(key=>
      Object.prototype.hasOwnProperty.call(signal,key)))return false;
  const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
  return typeof getter==='function'&&typeof getter.call(signal)==='boolean';
 }catch{return false;}
}
async function awaitListenerProofOrRevocation(port:number,pid:number,signal?:AbortSignal):
 Promise<{readonly cancelled:true}|{readonly cancelled:false;readonly ok:boolean}>{
 if(signal?.aborted)return {cancelled:true};
 let onAbort=()=>{};
 const revoked=new Promise<{readonly cancelled:true}>(resolve=>{
  onAbort=()=>resolve({cancelled:true});
  signal?.addEventListener('abort',onAbort,{once:true});
 });
 try{
  const pending=verifyWindowsLoopbackListenerPid(port,pid).then(
   result=>({cancelled:false as const,ok:result.ok}),
   ()=>({cancelled:false as const,ok:false}));
  if(signal?.aborted)return {cancelled:true};
  return signal?await Promise.race([pending,revoked]):await pending;
 }finally{signal?.removeEventListener('abort',onAbort);}
}
function validBrowserWebSocket(raw:string):{readonly url:string;readonly port:number}|null{
 try{
  const url=new URL(raw),port=Number(url.port);
  if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||
     !Number.isInteger(port)||port<1024||port>65535||
     url.username||url.password||url.search||url.hash||
     !/^\/devtools\/browser\/[a-zA-Z0-9-]{8,128}$/.test(url.pathname))
   return null;
  return {url:raw,port};
 }catch{return null;}
}
function readCdpMessage(raw:unknown):Record<string,unknown>|null{
 if(typeof raw!=='string'||raw.length>MAX_CDP_MESSAGE_BYTES||
    Buffer.byteLength(raw,'utf8')>MAX_CDP_MESSAGE_BYTES)return null;
 try{
  const parsed:unknown=JSON.parse(raw);
  if(hasDuplicateJsonObjectKeys(raw)||!isPlainRecord(parsed))return null;
  return parsed;
 }catch{return null;}
}
function connectBrowserWebSocket(url:string):Promise<WebSocket|null>{
 return new Promise(resolve=>{
  let socket:WebSocket|undefined;
  let settled=false;
  const timer=setTimeout(()=>finish(null),CDP_COMMAND_TIMEOUT_MS);
  const finish=(value:WebSocket|null)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);
   if(value===null){try{socket?.close();}catch{/* already closed */}}
   resolve(value);
  };
  try{
   socket=new WebSocket(url);
   socket.addEventListener('open',()=>{if(socket)finish(socket);else finish(null);},{once:true});
   socket.addEventListener('error',()=>finish(null),{once:true});
   socket.addEventListener('close',()=>finish(null),{once:true});
  }catch{finish(null);}
 });
}
function sendCdpCommand(
 socket:WebSocket,id:number,method:string,params:Record<string,unknown>,
 sessionId?:string,timeoutMs=CDP_COMMAND_TIMEOUT_MS
):Promise<Record<string,unknown>|null>{
 return new Promise(resolve=>{
  let settled=false;
  const finish=(value:Record<string,unknown>|null)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);
   socket.removeEventListener('message',onMessage);
   socket.removeEventListener('error',onFailure);
   socket.removeEventListener('close',onFailure);
   resolve(value);
  };
  const onFailure=()=>finish(null);
  const onMessage=(event:{data:unknown})=>{
   const message=readCdpMessage(event.data);
   if(!message){finish(null);return;}
   if(ownValue(message,'id')!==id)return;
   if(Object.prototype.hasOwnProperty.call(message,'error')){finish(null);return;}
   const keys=Object.keys(message);
   const expected=sessionId===undefined?['id','result']:['id','sessionId','result'];
   if(keys.length!==expected.length||keys.some(key=>!expected.includes(key))||
      (sessionId!==undefined&&ownValue(message,'sessionId')!==sessionId)){
    finish(null);return;
   }
   const result=ownValue(message,'result');
   finish(isPlainRecord(result)?result:null);
  };
  const timer=setTimeout(()=>finish(null),timeoutMs);
  if(socket.readyState!==WebSocket.OPEN){finish(null);return;}
  socket.addEventListener('message',onMessage);
  socket.addEventListener('error',onFailure,{once:true});
  socket.addEventListener('close',onFailure,{once:true});
  try{
   socket.send(JSON.stringify({id,method,params,...(sessionId===undefined?{}:{sessionId})}));
  }catch{finish(null);}
 });
}
function waitForCdpEvent(
 socket:WebSocket,method:string,sessionId:string,timeoutMs=6000
):Promise<boolean>{
 return new Promise(resolve=>{
  let settled=false;
  const finish=(value:boolean)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);
   socket.removeEventListener('message',onMessage);
   socket.removeEventListener('error',onFailure);
   socket.removeEventListener('close',onFailure);
   resolve(value);
  };
  const onFailure=()=>finish(false);
  const onMessage=(event:{data:unknown})=>{
   const message=readCdpMessage(event.data);
   if(!message){finish(false);return;}
   if(ownValue(message,'method')===method&&
      ownValue(message,'sessionId')===sessionId)finish(true);
  };
  const timer=setTimeout(()=>finish(false),timeoutMs);
  if(socket.readyState!==WebSocket.OPEN){finish(false);return;}
  socket.addEventListener('message',onMessage);
  socket.addEventListener('error',onFailure,{once:true});
  socket.addEventListener('close',onFailure,{once:true});
 });
}
function frameUrl(result:Record<string,unknown>|null):string|null{
 if(!result)return null;
 const tree=ownValue(result,'frameTree');
 if(!isPlainRecord(tree))return null;
 const frame=ownValue(tree,'frame');
 if(!isPlainRecord(frame))return null;
 const url=ownValue(frame,'url');
 return typeof url==='string'?url:null;
}
function isExtensionsPageUrl(raw:string,details:boolean):boolean{
 try{
  const url=new URL(raw);
  if(url.protocol!=='chrome:'||url.hostname!=='extensions'||
     url.pathname!=='/'||url.username||url.password||url.hash)return false;
  if(!details)return url.search==='';
  return url.searchParams.get('id')===TAMPERMONKEY_EXTENSION_ID&&
   [...url.searchParams.keys()].length===1;
 }catch{return false;}
}
function chromeMajor(version:string):number|null{
 const match=/^(\d+)\./.exec(version);
 if(!match)return null;
 const major=Number(match[1]);
 return Number.isSafeInteger(major)?major:null;
}
async function waitBriefly(ms:number):Promise<void>{
 await new Promise<void>(resolve=>setTimeout(resolve,ms));
}

/** Inspect only the Chrome management UI in an explicitly approved owned
 * session. Runtime.evaluate is confined to chrome://extensions, never an
 * extension-origin page or userscript; the fixed expressions return only
 * Tampermonkey ID/name/version/enabled and Allow User Scripts toggle state.
 */
export async function inspectApprovedTampermonkeyInstallation(
 session:ManagedLaunchResult,userApproved:boolean,signal?:AbortSignal
):Promise<ManagerInstallationResult>{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(signal!==undefined&&!isNativeAbortSignal(signal))
  return {ok:false,code:'INVALID_OPTIONS'};
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(!isLiveApprovedChromeSession(session))return {ok:false,code:'UNVERIFIED_BROWSER'};
 const endpoint=validBrowserWebSocket(session.browserWebsocket);
 if(!endpoint)return {ok:false,code:'UNVERIFIED_BROWSER'};
 const ownership=await awaitListenerProofOrRevocation(endpoint.port,session.pid,signal);
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(ownership.cancelled)return {ok:false,code:'CANCELLED'};
 if(!ownership.ok||!isLiveApprovedChromeSession(session))
  return {ok:false,code:'UNOWNED_LISTENER'};
 const socket=await connectBrowserWebSocket(endpoint.url);
 if(!socket)return {ok:false,code:'CDP_FAILED',stage:'connect'};
 let targetId:string|undefined;
 let sessionId:string|undefined;
 let createAttempted=false;
 let cleanupOk=true;
 let failureStage:'create-target'|'attach-target'|'list-frame'|'manager-card'|'navigate-details'|'details-frame'|'permission'|'cleanup-close'|'cleanup-list'='create-target';
 let result:ManagerInstallationResult={ok:false,code:'CDP_FAILED'};
 let commandId=1;
 try{
  if(signal?.aborted){result={ok:false,code:'CANCELLED'};}
  else{
   createAttempted=true;
   failureStage='create-target';
   const created=await sendCdpCommand(socket,commandId++,'Target.createTarget',
    {url:'about:blank',background:true});
   const createdId=created?ownValue(created,'targetId'):undefined;
   if(typeof createdId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(createdId)){
    result={ok:false,code:'CDP_FAILED',stage:'create-target'};
    cleanupOk=false;
   }else{
    targetId=createdId;
    if(signal?.aborted)result={ok:false,code:'CANCELLED'};
    else{
     failureStage='attach-target';
     const attached=await sendCdpCommand(socket,commandId++,'Target.attachToTarget',
      {targetId,flatten:true});
     const attachedId=attached?ownValue(attached,'sessionId'):undefined;
     if(typeof attachedId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(attachedId))
      result={ok:false,code:'CDP_FAILED',stage:'attach-target'};
     else{
      sessionId=attachedId;
      failureStage='list-frame';
      const pageEnabled=await sendCdpCommand(socket,commandId++,'Page.enable',{},sessionId);
      if(!pageEnabled)result={ok:false,code:'CDP_FAILED',stage:'list-frame'};
      else{
       const listLoaded=waitForCdpEvent(socket,'Page.loadEventFired',sessionId);
       const listNavigation=await sendCdpCommand(socket,commandId++,'Page.navigate',
        {url:EXTENSIONS_LIST_URL},sessionId);
       const listLoadSucceeded=await listLoaded;
       const listFrame=await sendCdpCommand(socket,commandId++,'Page.getFrameTree',{},sessionId);
       if(!listNavigation||Object.prototype.hasOwnProperty.call(listNavigation,'errorText')||
          !listLoadSucceeded||!isExtensionsPageUrl(frameUrl(listFrame)||'',false))
        result={ok:false,code:'INSPECTION_UNAVAILABLE',stage:'list-frame'};
       else{
       failureStage='manager-card';
       const card=await readTampermonkeyManagerCardAfterInventoryReady(timeoutMs=>
        sendCdpCommand(socket,commandId++,'Runtime.evaluate',{
         expression:TAMPERMONKEY_MANAGER_CARD_EXPRESSION,
         returnByValue:true,awaitPromise:false,userGesture:false,silent:true
        },sessionId,timeoutMs)
       );
       if(!card.ok)result={ok:false,code:'INSPECTION_UNAVAILABLE',stage:'manager-card'};
       else if(card.status==='NOT_INSTALLED')result=card;
       else if(signal?.aborted)result={ok:false,code:'CANCELLED'};
       else{
        failureStage='navigate-details';
        const detailsLoaded=waitForCdpEvent(socket,'Page.loadEventFired',sessionId);
        const navigated=await sendCdpCommand(socket,commandId++,'Page.navigate',
         {url:EXTENSIONS_DETAILS_URL},sessionId);
        const detailsLoadSucceeded=await detailsLoaded;
        if(!navigated||Object.prototype.hasOwnProperty.call(navigated,'errorText')||!detailsLoadSucceeded)
         result=card;
        else{
         failureStage='details-frame';
         const detailsFrame=await sendCdpCommand(socket,commandId++,'Page.getFrameTree',{},sessionId);
         if(!isExtensionsPageUrl(frameUrl(detailsFrame)||'',true))result={...card,allowUserScripts:'UNKNOWN',permissionVerified:false};
         else{
          failureStage='permission';
          const permissionReceipt=await sendCdpCommand(socket,commandId++,'Runtime.evaluate',{
           expression:TAMPERMONKEY_USER_SCRIPTS_EXPRESSION,
           returnByValue:true,awaitPromise:false,userGesture:false,silent:true
          },sessionId);
          const major=chromeMajor(session.chromeVersion);
          const permission=major===null?'UNKNOWN':
           parseTampermonkeyUserScriptsReceipt(permissionReceipt,major);
          result={...card,
           allowUserScripts:permission,
           permissionVerified:major!==null&&
            (major<138||permission==='ENABLED'||permission==='DISABLED')};
         }
        }
       }
      }
     }
    }
   }
  }
 }}catch{result={ok:false,code:'CDP_FAILED',stage:failureStage};}
 finally{
  if(targetId&&socket.readyState===WebSocket.OPEN){
   failureStage='cleanup-close';
   await sendCdpCommand(socket,commandId++,'Target.closeTarget',
    {targetId},undefined,2000);
   cleanupOk=false;
   for(let attempt=0;attempt<10;attempt++){
    failureStage='cleanup-list';
    const targets=await sendCdpCommand(socket,commandId++,'Target.getTargets',{},undefined,2000);
    const infos=targets?ownValue(targets,'targetInfos'):undefined;
    if(Array.isArray(infos)&&infos.length<=1000&&
       infos.every(info=>isPlainRecord(info))){
     if(infos.every(info=>ownValue(info,'targetId')!==targetId)){
      cleanupOk=true;break;
     }
    }else break;
    await waitBriefly(100);
   }
  }else if(createAttempted&&isLiveApprovedChromeSession(session)){
   cleanupOk=false;
  }
  try{socket.close();}catch{/* already closed */}
 }
 if(!cleanupOk&&isLiveApprovedChromeSession(session))
  return {ok:false,code:'CDP_FAILED',stage:failureStage};
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(!isLiveApprovedChromeSession(session))return {ok:false,code:'UNVERIFIED_BROWSER'};
 const finalOwnership=await awaitListenerProofOrRevocation(endpoint.port,session.pid,signal);
 if(signal?.aborted||finalOwnership.cancelled)return {ok:false,code:'CANCELLED'};
 if(!finalOwnership.ok)return {ok:false,code:'UNOWNED_LISTENER'};
 return result;
}

/** Launch the official Chrome Web Store installation page for Tampermonkey
 * in the user-approved owned Chrome session. Chrome's native extension
 * installation dialog and user confirmation are strictly required.
 */
export async function launchApprovedTampermonkeyInstallation(
 session:ManagedLaunchResult,userApproved:boolean,signal?:AbortSignal
):Promise<LaunchTampermonkeyInstallResult>{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(signal!==undefined&&!isNativeAbortSignal(signal))
  return {ok:false,code:'INVALID_OPTIONS'};
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(!isLiveApprovedChromeSession(session))return {ok:false,code:'UNVERIFIED_BROWSER'};
 const endpoint=validBrowserWebSocket(session.browserWebsocket);
 if(!endpoint)return {ok:false,code:'UNVERIFIED_BROWSER'};
 const ownership=await awaitListenerProofOrRevocation(endpoint.port,session.pid,signal);
 if(signal?.aborted||ownership.cancelled)return {ok:false,code:'CANCELLED'};
 if(!ownership.ok||!isLiveApprovedChromeSession(session))
  return {ok:false,code:'UNOWNED_LISTENER'};
 const socket=await connectBrowserWebSocket(endpoint.url);
 if(!socket)return {ok:false,code:'CDP_FAILED'};
 try{
  if(signal?.aborted)return {ok:false,code:'CANCELLED'};
  const created=await sendCdpCommand(socket,1,'Target.createTarget',
   {url:TAMPERMONKEY_WEBSTORE_URL,background:false});
  const targetId=created?ownValue(created,'targetId'):undefined;
  if(typeof targetId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(targetId))
   return {ok:false,code:'CDP_FAILED'};
  return {
   ok:true,
   status:'INSTALLATION_PAGE_OPENED',
   targetId,
   installUrl:TAMPERMONKEY_WEBSTORE_URL,
   userApproved:true,
   nativeConfirmationRequired:true
  };
 }catch{return {ok:false,code:'CDP_FAILED'};}
 finally{
  try{socket.close();}catch{/* already closed */}
 }
}

