/** TASK-007 / REQ-017/018: consent-only loopback Tampermonkey GM smoke fixture.
 * The returned userscript source must be installed explicitly by the tester
 * into an independently verified Tampermonkey. This module NEVER installs an
 * extension/script, visits an external site, or modifies a Chrome profile.
 *
 * Self-reported HTTP receipts are only fixture observations. An unrelated
 * local process or a page could forge a POST; they are NOT real manager
 * attestation and must NEVER mark TEST-017/018 or any Stable GATE VERIFIED.
 */
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {TAMPERMONKEY_EXTENSION_ID} from './tampermonkey-adapter';

export type GmProbeMode='broken'|'fixed';
/** Explicit, fixed test modes; never derived from an arbitrary userscript. */
export type GmProbeRunAt=
 'document-start'|'document-body'|'document-end'|'document-idle';
/** Exact enum: callers must not inject free-form metadata into a userscript. */
export const SUPPORTED_GM_RUN_AT:readonly GmProbeRunAt[]=
 Object.freeze(['document-start','document-body','document-end','document-idle']);
export function isSupportedGmProbeRunAt(value:unknown):value is GmProbeRunAt{
 return typeof value==='string'&&SUPPORTED_GM_RUN_AT.some(mode=>mode===value);
}
export interface GmProbeReceipt {
 readonly status:'SELF_REPORTED_FIXTURE_ONLY';
 readonly mode:GmProbeMode;
 readonly reportedGmDefaultMatched:boolean;
 readonly reportedGmStorageRoundtripMatched:boolean;
 readonly reportedBusinessAction:boolean;
 readonly extensionAuthenticityVerified:false;
 readonly scriptInstallationVerified:false;
 readonly gmApiVerified:false;
 readonly businessVerified:false;
}
export interface GmProbeSession {
 readonly status:'ISOLATED_GM_TEST_READY';
 readonly runAt:GmProbeRunAt;
 readonly origin:string;
 readonly source:string;
 /** Short-lived URL for explicit "Import from URL" in an isolated manager.
  * URL possession is not proof of manager identity or actual script execution. */
 readonly installUrl:string;
 readonly expiresAt:number;
 readonly receiptSnapshot:()=>Readonly<Partial<Record<GmProbeMode,GmProbeReceipt>>>;
 readonly stop:()=>Promise<void>;
}
export type GmProbeStartResult=
 |{readonly ok:false;readonly code:'NOT_AUTHORIZED'|'INVALID_OPTIONS'|'BIND_FAILED'|'SESSION_EXPIRED'}
 |{readonly ok:true;readonly session:GmProbeSession};

export const MAX_GM_PROBE_TTL_MS=300000 as const;
const MAX_BODY_BYTES=1024;
const PROBE_DEFAULT='UAH_GM_PROBE_DEFAULT';
function isObject(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function produceFixtureSource(origin:string,token:string,scriptId:string,expiresAt:number,runAt:GmProbeRunAt):string {
 // Userscript @match does not encode a port. The explicit origin check below
 // ensures the test script does nothing on another loopback port.
 const script=[
 '// ==UserScript==',
 // Separate random script identity is NEVER the receipt or install token.
 // Each independently consented test remains a distinct manager entry; the
 // tester must explicitly remove it after completing the diagnostic.
 '// @name UAH Isolated GM Diagnostic '+scriptId.slice(0,8),
 '// @namespace uah-isolated-gm-probe.'+scriptId,
 '// @version 0.0.1',
 '// @match http://127.0.0.1/*',
 '// @grant GM_getValue',
 '// @grant GM_setValue',
 '// @grant GM_deleteValue',
 '// @run-at '+runAt,
 '// @noframes',
 '// ==/UserScript==',
 '(function(){',
 " 'use strict';",
 // @noframes is manager policy only; enforce the same frame boundary inside
 // the disposable script before any GM, DOM or HTTP effect.
 " try{if(typeof window!=='undefined'&&window.top!==window)return;}",
 " catch{return;}",
 // Cross-check the fixed server-issued expiry against the browser's
 // monotonic time origin. A backward Windows clock change may make Date.now()
 // appear live after the real consent interval has already ended. The local
 // server has its own independent monotonic TTL, and the userscript must not
 // revive GM/storage/DOM/fetch effects after server expiry.
 ' const expired=()=>{',
 '  if(Date.now()>='+expiresAt+')return true;',
 // The existing date check is retained for old hosts lacking Performance.
 // A malformed/throwing Performance object cannot authorize actions.
 "  if(typeof performance==='undefined')return false;",
 "  try{const epoch=performance.timeOrigin;const elapsed=performance.now();",
 '   return !Number.isFinite(epoch)||!Number.isFinite(elapsed)||',
 '    epoch+elapsed>='+expiresAt+';}',
 '  catch{return true;}',
 ' };',
 // A manually installed fixture may outlive its short-lived HTTP server.
 // Even if the loopback port is later reused, it must not perform GM, DOM
 // or network actions after the consent interval expires.
 ' if(expired())return;',
 ' if(location.origin!=='+JSON.stringify(origin)+')return;',
 " const mode=new URL(location.href).searchParams.get('mode');",
 " if(mode!=='broken'&&mode!=='fixed')return;",
  // A self-reported fixture action belongs only to the exact owned test page.
  ' const expectedUrl='+JSON.stringify(origin+'/?mode=')+'+mode;',
  ' if(location.href!==expectedUrl)return;',
 ' let gmMatched=false;',
 ' try{gmMatched=GM_getValue('+JSON.stringify('uah-gm-probe-'+token)+','+
    JSON.stringify(PROBE_DEFAULT)+')==='+JSON.stringify(PROBE_DEFAULT)+';}',
 ' catch{gmMatched=false;}',
 // Use only a per-session disposable key. A successful roundtrip also
 // requires immediate deletion, with a read-after-delete check. Never
 // leave a new persistent test value after an apparently successful test.
 ' let gmStorageRoundtrip=false;',
 ' if(expired())return;',
 ' if(location.href!==expectedUrl)return;',
 " if(typeof GM_setValue==='function'&&typeof GM_getValue==='function'&&",
 "    typeof GM_deleteValue==='function'){",
 '  const storageKey='+JSON.stringify('uah-gm-storage-'+token+'-')+'+mode;',
 '  let writeAttempted=false;let writeSucceeded=false;let readBack=false;let removed=false;',
 '  try{',
 '   writeAttempted=true;',
 "   GM_setValue(storageKey,'gm-roundtrip-ok');writeSucceeded=true;",
 "   if(!expired())readBack=GM_getValue(storageKey,'unset')==='gm-roundtrip-ok';",
 '  }catch{}finally{',
 // A setter can mutate before throwing; always try to remove our unique
 // disposable storage key, never use write success as the cleanup guard.
 '   if(writeAttempted){try{',
 "    GM_deleteValue(storageKey);",
 "    removed=!expired()&&GM_getValue(storageKey,'gm-deleted')==='gm-deleted';",
 '   }catch{removed=false;}}',
 '  }',
 '  gmStorageRoundtrip=writeSucceeded&&readBack&&removed;',
 ' }',
 // A synchronous GM getter, DOM query or setter can cross the consent
 // deadline. Abort before every subsequent side effect, not only at entry.
 ' if(expired())return;',
  ' if(location.href!==expectedUrl)return;',
 // A declared document-idle mode does not independently prove that DOM
 // parsing has completed. Always defer the business assertion while loading;
 // GM reads remain at the requested injection point.
 ' const checkDomAndReport=()=>{',
 ' if(expired())return;',
  ' if(location.href!==expectedUrl)return;',
 " const selector=mode==='broken'?'#obsolete-target':'#current-target';",
 ' const target=document.querySelector(selector);',
 ' if(expired())return;',
  ' if(location.href!==expectedUrl)return;',
 ' let actionConfirmed=false;',
 ' if(target){',
 "  target.setAttribute('data-uah-probe-action','done');",
 '  if(Date.now()>='+expiresAt+')return;',
  '  if(location.href!==expectedUrl)return;',
 "  actionConfirmed=target.getAttribute('data-uah-probe-action')==='done';",
 ' }',
 ' if(expired())return;',
  ' if(location.href!==expectedUrl)return;',
 ' void fetch('+JSON.stringify(origin+'/receipt')+',',
 " {method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},",
 ' body:JSON.stringify({token:'+JSON.stringify(token)+',mode,',
 " gmDefaultMatched:gmMatched,gmStorageRoundtripMatched:gmStorageRoundtrip,",
 " businessAction:actionConfirmed})}).catch(()=>{});",
 ' };',
 " if(document.readyState==='loading'){",
 "  document.addEventListener('DOMContentLoaded',checkDomAndReport,{once:true});",
 '  return;',
 ' }',
 ' checkDomAndReport();',
 '})();'
 ];
 return script.join('\n')+'\n';
}
/** A short-lived, in-memory local fixture. Cannot prove extension identity.
 * Only use with explicit tester consent and a newly created isolated Profile.
 */
export async function startIsolatedTampermonkeyGmProbe(
 userApproved:boolean,ttlMs=60000,runAt:GmProbeRunAt='document-idle'
):Promise<GmProbeStartResult>{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>MAX_GM_PROBE_TTL_MS||
    !isSupportedGmProbeRunAt(runAt))
   return {ok:false,code:'INVALID_OPTIONS'};
 const token=randomBytes(32).toString('hex');
 const installKey=randomBytes(32).toString('hex');
 const scriptId=randomBytes(16).toString('hex');
 const managerOrigin='chrome-extension://'+TAMPERMONKEY_EXTENSION_ID;
 // The absolute expiry remains embedded in the disposable userscript, but
 // Windows wall-clock rollback must not extend the server's consent TTL.
 const begunAt=performance.now();
 const expiresAt=Date.now()+ttlMs;
 const expired=()=>Date.now()>=expiresAt||performance.now()-begunAt>=ttlMs;
 const receipts:Partial<Record<GmProbeMode,GmProbeReceipt>>={};
 let server:Server;
 server=createServer((req,res)=>{
   res.setHeader('Cache-Control','no-store');
   res.setHeader('X-Content-Type-Options','nosniff');
   const address=server.address() as AddressInfo|null;
   const host=address?'127.0.0.1:'+address.port:'';
   if(!address||req.headers.host!==host||expired()){
     res.writeHead(403).end();return;
   }
   // HTTP absolute-form URLs can override URL's base origin. Accept only
   // origin-form paths so a forged Host header cannot route this fixture as
   // if it were a different site. Never let malformed URLs crash the server.
   if(!req.url||!req.url.startsWith('/')||req.url.startsWith('//')){
     res.writeHead(400).end();return;
   }
   let url:URL;
   try{url=new URL(req.url,'http://'+host);}catch{
     res.writeHead(400).end();return;
   }
   // Reject dot-segment aliases normalized by URL(): consented fixture routes
   // must match the actual HTTP request target, not only its parsed pathname.
   if(url.origin!=='http://'+host||req.url!==url.pathname+url.search){
     res.writeHead(400).end();return;
   }
   // Only an exact unguessable capability URL serves the disposable source.
   // The real manager may fetch it from its extension origin; Origin is NOT
   // authentication and is never interpreted as evidence of installation.
   // A normal website cannot fetch it across origins by guessing a filename.
   const isInstall=url.pathname==='/install.user.js'&&
     url.search==='?key='+installKey&&req.method==='GET';
   if(req.headers.origin!==undefined&&req.headers.origin!=='http://'+host&&
      !(isInstall&&req.headers.origin===managerOrigin)){
     res.writeHead(403).end();return;
   }
   if(url.pathname==='/install.user.js'){
     if(!isInstall){res.writeHead(403).end();return;}
     const headers:Record<string,string>={
       'Content-Type':'text/javascript; charset=utf-8',
       'Content-Disposition':'inline; filename="UAH-Isolated-GM-Diagnostic.user.js"',
       'Vary':'Origin'
     };
     if(req.headers.origin===managerOrigin)
       headers['Access-Control-Allow-Origin']=managerOrigin;
     res.writeHead(200,headers);
     res.end(produceFixtureSource('http://'+host,token,scriptId,expiresAt,runAt));
     return;
   }
   // The fixture page's same-origin POST may supply Origin. Never treat a
   // browser-supplied Origin as manager or GM attestation.
   if(req.method==='GET'&&url.pathname==='/'&&
       (url.search===''||url.search==='?mode=broken'||url.search==='?mode=fixed')){
     res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
     res.end('<!doctype html><html><head><title>Isolated GM probe</title></head>'+
       '<body><main><div id="current-target">Authorized test fixture</div>'+
       '</main></body></html>');
     return;
   }
   if(req.method!=='POST'||url.pathname!=='/receipt'||url.search!==''){
     res.writeHead(404).end();return;
   }
   if(req.headers['content-type']!=='application/json'){
     res.writeHead(415).end();return;
   }
   let body='';
   let oversized=false;
   let disconnected=false;
   // A peer may disconnect after headers but before Content-Length bytes.
   // IncomingMessage then emits 'aborted' and may emit 'error' (ECONNRESET).
   // Without an error listener, an incomplete loopback POST can terminate the
   // privileged Electron main process. Never accept a partially read receipt.
   const abandon=()=>{disconnected=true;body='';};
   req.on('aborted',abandon);
   req.on('error',abandon);
   res.on('close',()=>{
     if(!res.writableEnded)abandon();
   });
   req.on('data',(chunk:Buffer)=>{
     if(oversized||disconnected)return;
     if(Buffer.byteLength(body)+chunk.length>MAX_BODY_BYTES){
       oversized=true;res.writeHead(413).end();return;
     }
     body+=chunk.toString('utf8');
   });
   req.on('end',()=>{
     if(disconnected||oversized||res.destroyed||res.writableEnded)return;
     // Recheck after the entire body arrives: a slow POST must not outlive
     // the consented probe interval merely because headers arrived in time.
     if(expired()){res.writeHead(403).end();return;}
     let input:unknown;
     try{input=JSON.parse(body);}catch{res.writeHead(400).end();return;}
     if(!isObject(input)||input.token!==token||
       (input.mode!=='broken'&&input.mode!=='fixed')||
       typeof input.gmDefaultMatched!=='boolean'||
       typeof input.gmStorageRoundtripMatched!=='boolean'||
       typeof input.businessAction!=='boolean'||
       Object.keys(input).sort().join(',')!==
          'businessAction,gmDefaultMatched,gmStorageRoundtripMatched,mode,token'){
       res.writeHead(403).end();return;
     }
     const mode=input.mode as GmProbeMode;
     // First receipt wins per mode: replay or a late contradictory POST must
     // never silently rewrite an earlier captured diagnostic observation.
     if(receipts[mode]!==undefined){res.writeHead(409).end();return;}
     // The consented broken fixture contains no #obsolete-target. Its business
     // action can never succeed, even if a sender knows this session's token.
     // Reject impossible FIRST reports without changing 409 replay semantics.
     if(mode==='broken'&&input.businessAction!==false){
       res.writeHead(403).end();return;
     }
     // Preserve the raw reported failures; never rewrite them into success.
     receipts[mode]=Object.freeze({
       status:'SELF_REPORTED_FIXTURE_ONLY',mode,
       reportedGmDefaultMatched:input.gmDefaultMatched,
       reportedGmStorageRoundtripMatched:input.gmStorageRoundtripMatched,
       reportedBusinessAction:input.businessAction,
       extensionAuthenticityVerified:false,
       scriptInstallationVerified:false,
       gmApiVerified:false,
       businessVerified:false
     });
     res.writeHead(204).end();
   });
 });
 try{
   await new Promise<void>((resolve,reject)=>{
     server.once('error',reject);
     server.listen(0,'127.0.0.1',()=>{
       server.removeListener('error',reject);resolve();
     });
   });
 }catch{try{server.close();}catch{}return {ok:false,code:'BIND_FAILED'};}
 const address=server.address() as AddressInfo;
 // The expiration starts when consented setup begins, not when async
 // listen() finally returns. A stalled event loop or delayed bind must not
 // hand back an already-expired but apparently usable diagnostic session.
 // Close the owned loopback listener before refusing the stale start.
 if(expired()){
   await new Promise<void>(resolve=>{
     server.close(()=>resolve());
     server.closeAllConnections();
   });
   return {ok:false,code:'SESSION_EXPIRED'};
 }
 const origin='http://127.0.0.1:'+address.port;
 // Expiration revokes the entire temporary listener, including active
 // keep-alive and incomplete POST connections. server.close() alone only
 // stops new accepts and can leave an already-connected peer hanging.
 let expiryTimer:NodeJS.Timeout;
 let stopping:Promise<void>|undefined;
 const stop=():Promise<void>=>{
   if(stopping)return stopping;
   clearTimeout(expiryTimer);
   stopping=new Promise<void>(resolve=>{
     server.close(()=>resolve());
     server.closeAllConnections();
   });
   return stopping;
 };
 // Only the remaining authorized interval belongs to this listener: using
 // the entire original TTL would extend the bound server beyond its deadline
 // when asynchronous startup itself consumed time.
 // Independently bound by real elapsed time AND the wall-clock expiry.
 // A backward system clock correction during async bind cannot extend it.
 const remaining=Math.min(expiresAt-Date.now(),ttlMs-(performance.now()-begunAt));
 expiryTimer=setTimeout(()=>{void stop();},Math.max(1,remaining));
 expiryTimer.unref();
 return {ok:true,session:{
   status:'ISOLATED_GM_TEST_READY',runAt,
   origin,source:produceFixtureSource(origin,token,scriptId,expiresAt,runAt),
   installUrl:origin+'/install.user.js?key='+installKey,expiresAt,
   receiptSnapshot:()=>Object.freeze({...receipts}),
   stop
 }};
}
