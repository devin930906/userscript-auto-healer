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
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';

export type GmProbeMode='broken'|'fixed';
export interface GmProbeReceipt {
 readonly status:'SELF_REPORTED_FIXTURE_ONLY';
 readonly mode:GmProbeMode;
 readonly reportedGmDefaultMatched:boolean;
 readonly reportedBusinessAction:boolean;
 readonly extensionAuthenticityVerified:false;
 readonly scriptInstallationVerified:false;
 readonly gmApiVerified:false;
 readonly businessVerified:false;
}
export interface GmProbeSession {
 readonly status:'ISOLATED_GM_TEST_READY';
 readonly origin:string;
 readonly source:string;
 readonly expiresAt:number;
 readonly receiptSnapshot:()=>Readonly<Partial<Record<GmProbeMode,GmProbeReceipt>>>;
 readonly stop:()=>Promise<void>;
}
export type GmProbeStartResult=
 |{readonly ok:false;readonly code:'NOT_AUTHORIZED'|'INVALID_OPTIONS'|'BIND_FAILED'}
 |{readonly ok:true;readonly session:GmProbeSession};

const MAX_BODY_BYTES=1024;
const PROBE_DEFAULT='UAH_GM_PROBE_DEFAULT';
function isObject(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function produceFixtureSource(origin:string,token:string):string {
 // Userscript @match does not encode a port. The explicit origin check below
 // ensures the test script does nothing on another loopback port.
 const script=[
 '// ==UserScript==',
 '// @name UAH Isolated GM Diagnostic (temporary)',
 '// @namespace uah-isolated-gm-probe',
 '// @version 0.0.1',
 '// @match http://127.0.0.1/*',
 '// @grant GM_getValue',
 '// @run-at document-idle',
 '// @noframes',
 '// ==/UserScript==',
 '(function(){',
 " 'use strict';",
 ' if(location.origin!=='+JSON.stringify(origin)+')return;',
 " const mode=new URL(location.href).searchParams.get('mode');",
 " if(mode!=='broken'&&mode!=='fixed')return;",
 ' let gmMatched=false;',
 ' try{gmMatched=GM_getValue('+JSON.stringify('uah-gm-probe-'+token)+','+
    JSON.stringify(PROBE_DEFAULT)+')==='+JSON.stringify(PROBE_DEFAULT)+';}',
 ' catch{gmMatched=false;}',
 " const selector=mode==='broken'?'#obsolete-target':'#current-target';",
 ' const target=document.querySelector(selector);',
 " if(target)target.setAttribute('data-uah-probe-action','done');",
 ' void fetch('+JSON.stringify(origin+'/receipt')+',',
 " {method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},",
 ' body:JSON.stringify({token:'+JSON.stringify(token)+',mode,',
 " gmDefaultMatched:gmMatched,businessAction:Boolean(target)})}).catch(()=>{});",
 '})();'
 ];
 return script.join('\n')+'\n';
}
/** A short-lived, in-memory local fixture. Cannot prove extension identity.
 * Only use with explicit tester consent and a newly created isolated Profile.
 */
export async function startIsolatedTampermonkeyGmProbe(
 userApproved:boolean,ttlMs=60000
):Promise<GmProbeStartResult>{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>300000)
   return {ok:false,code:'INVALID_OPTIONS'};
 const token=randomBytes(32).toString('hex');
 const expiresAt=Date.now()+ttlMs;
 const receipts:Partial<Record<GmProbeMode,GmProbeReceipt>>={};
 let server:Server;
 server=createServer((req,res)=>{
   res.setHeader('Cache-Control','no-store');
   res.setHeader('X-Content-Type-Options','nosniff');
   const address=server.address() as AddressInfo|null;
   const host=address?'127.0.0.1:'+address.port:'';
   if(!address||req.headers.host!==host||Date.now()>=expiresAt){
     res.writeHead(403).end();return;
   }
   const url=new URL(req.url||'/', 'http://127.0.0.1:'+address.port);
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
   req.on('data',(chunk:Buffer)=>{
     if(oversized)return;
     if(Buffer.byteLength(body)+chunk.length>MAX_BODY_BYTES){
       oversized=true;res.writeHead(413).end();return;
     }
     body+=chunk.toString('utf8');
   });
   req.on('end',()=>{
     if(oversized||res.writableEnded)return;
     let input:unknown;
     try{input=JSON.parse(body);}catch{res.writeHead(400).end();return;}
     if(!isObject(input)||input.token!==token||
       (input.mode!=='broken'&&input.mode!=='fixed')||
       typeof input.gmDefaultMatched!=='boolean'||
       typeof input.businessAction!=='boolean'||
       Object.keys(input).sort().join(',')!==
          'businessAction,gmDefaultMatched,mode,token'){
       res.writeHead(403).end();return;
     }
     const mode=input.mode as GmProbeMode;
     // Preserve the raw reported failures; never rewrite them into success.
     receipts[mode]=Object.freeze({
       status:'SELF_REPORTED_FIXTURE_ONLY',mode,
       reportedGmDefaultMatched:input.gmDefaultMatched,
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
 const origin='http://127.0.0.1:'+address.port;
 const expiryTimer=setTimeout(()=>server.close(),ttlMs);
 expiryTimer.unref();
 let closed=false;
 const stop=async()=>{
   if(closed)return;
   closed=true;clearTimeout(expiryTimer);
   await new Promise<void>(resolve=>{
     server.close(()=>resolve());
     server.closeAllConnections();
   });
 };
 return {ok:true,session:{
   status:'ISOLATED_GM_TEST_READY',
   origin,source:produceFixtureSource(origin,token),expiresAt,
   receiptSnapshot:()=>Object.freeze({...receipts}),
   stop
 }};
}
