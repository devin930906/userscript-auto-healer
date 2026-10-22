/**
 * TASK-017 / TASK-004 / REQ-005 / TEST-005: ephemeral desktop-only
 * scenario staging for already imported, read-only userscript digests.
 * This session never opens a URL, runs a script, saves a scenario to disk,
 * authenticates a manager, or gives patch/rollback authority.
 * The caller claim userApproved is only staging consent, never CDP consent.
 */
import {ScenarioRegistry,type ScenarioInput,type ScenarioIssue,
  type ScenarioState} from './scenario-registry';
import {types as nodeTypes} from 'node:util';

const noAuthority={
 automaticPatchAllowed:false as const,
 tampermonkeyVerified:false as const,
 businessVerified:false as const
};
type BlockCode='INVALID_REQUEST'|'SCRIPT_NOT_IMPORTED'|'NOT_AUTHORIZED'|
 'INVALID_SCENARIO'|'DUPLICATE_ID'|'SCENARIO_LIMIT';
export type DesktopScenarioOutcome=
 |Readonly<{ok:false;code:BlockCode}&typeof noAuthority>
 |Readonly<{ok:true;status:'STAGED_RUNTIME_UNVERIFIED';
  id:string;scriptSha256:string;state:ScenarioState;
  issues:readonly ScenarioIssue[];readOnlyDomEligible:boolean}&typeof noAuthority>;
const invalid=(code:BlockCode):DesktopScenarioOutcome=>
 Object.freeze({ok:false as const,code,...noAuthority});
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const MAX_SESSION_SCENARIOS=100;
const payloadKeys=['id','scriptSha256','targetUrl','selector',
  'userApproved','requiresLogin','loginReady'] as const;
const allowedFields=new Set<string>([...payloadKeys,'replacementSelector']);
function fields(input:unknown):Record<string,unknown>|null{
 try{
  if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||
    Array.isArray(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const props=Object.getOwnPropertyDescriptors(input);
  const own=Reflect.ownKeys(props);
  const hasReplacement=Object.prototype.hasOwnProperty.call(props,'replacementSelector');
  if(own.length!==payloadKeys.length+Number(hasReplacement)||
     own.some(k=>typeof k!=='string'||!allowedFields.has(k))||
     payloadKeys.some(k=>!Object.prototype.hasOwnProperty.call(props,k)||
       !Object.prototype.hasOwnProperty.call(props[k],'value'))||
     (hasReplacement&&!Object.prototype.hasOwnProperty.call(props.replacementSelector,'value')))
    return null;
  const data:Record<string,unknown>=Object.create(null);
  for(const name of payloadKeys)data[name]=props[name].value;
  if(hasReplacement)data.replacementSelector=props.replacementSelector.value;
  return data;
 }catch{return null;}
}
export class DesktopScenarioSession{
 private readonly importedHashes=new Set<string>();
 private readonly registry=new ScenarioRegistry();
 /** Only call after the main process successfully imported/validated bytes. */
 recordImported(digest:string):void{
  if(typeof digest==='string'&&SHA.test(digest))this.importedHashes.add(digest);
 }
 /**
  * Resolve only an already-imported, caller-staged, non-login selector
  * scenario. This internal result is never returned over renderer IPC.
  * It grants no authority: the privileged caller MUST independently
  * confirm ownership of Chrome and obtain fresh native user consent.
  */
 resolveReadOnlyDom(id:unknown):
  |Readonly<{ok:false;code:'INVALID_ID'|'SCENARIO_NOT_FOUND'|'SCENARIO_NOT_READONLY_ELIGIBLE'}>
  |Readonly<{ok:true;targetUrl:string;scenario:ScenarioInput}>{
  try{
   if(typeof id!=='string'||!ID.test(id))return {ok:false,code:'INVALID_ID'};
   const saved=this.registry.get(id);
   if(!saved)return {ok:false,code:'SCENARIO_NOT_FOUND'};
   const scenario=saved.input;
   if(saved.state!=='READY_TO_TEST'||
      !this.importedHashes.has(scenario.scriptSha256)||
      scenario.userApproved!==true||scenario.requiresLogin!==false||
      scenario.steps.length!==0||
      (scenario.assertions.length!==1&&scenario.assertions.length!==2)||
      scenario.assertions.some(a=>
        a.kind!=='selector-present'||a.expectedText!==undefined||
        typeof a.selector!=='string'||!a.selector||
        a.selector.length>256||a.selector.trim()!==a.selector||
        /[\u0000-\u001f]/.test(a.selector))||
      new Set(scenario.assertions.map(a=>a.selector)).size!==scenario.assertions.length||
      typeof scenario.targetUrl!=='string')
     return {ok:false,code:'SCENARIO_NOT_READONLY_ELIGIBLE'};
   const url=new URL(scenario.targetUrl);
   if(!['http:','https:'].includes(url.protocol)||
      !url.hostname||url.username||url.password||url.hash)
     return {ok:false,code:'SCENARIO_NOT_READONLY_ELIGIBLE'};
   return {ok:true,targetUrl:url.href,scenario};
  }catch{return {ok:false,code:'SCENARIO_NOT_READONLY_ELIGIBLE'};}
 }
 register(input:unknown):DesktopScenarioOutcome{
  try{
   const data=fields(input);
   if(!data||typeof data.id!=='string'||!ID.test(data.id)||
      typeof data.scriptSha256!=='string'||!SHA.test(data.scriptSha256)||
      typeof data.targetUrl!=='string'||data.targetUrl.length>4096||
      typeof data.selector!=='string'||!data.selector.trim()||
      data.selector.length>512||
      typeof data.userApproved!=='boolean'||
      typeof data.requiresLogin!=='boolean'||
      typeof data.loginReady!=='boolean')
    return invalid('INVALID_REQUEST');
   const hasReplacement=Object.prototype.hasOwnProperty.call(data,'replacementSelector');
   if(hasReplacement&&(
      typeof data.replacementSelector!=='string'||
      data.replacementSelector.length===0||data.replacementSelector.length>256||
      data.replacementSelector.trim()!==data.replacementSelector||
      /[\u0000-\u001f]/.test(data.replacementSelector)||
      data.replacementSelector===data.selector))
     return invalid('INVALID_REQUEST');
   if(!this.importedHashes.has(data.scriptSha256))return invalid('SCRIPT_NOT_IMPORTED');
   if(data.userApproved!==true)return invalid('NOT_AUTHORIZED');
   if(this.registry.get(data.id))return invalid('DUPLICATE_ID');
   if(this.registry.list().length>=MAX_SESSION_SCENARIOS)return invalid('SCENARIO_LIMIT');
   const scenario:ScenarioInput={
    id:data.id,scriptSha256:data.scriptSha256,targetUrl:data.targetUrl,
    userApproved:true,requiresLogin:data.requiresLogin,
    loginReady:data.loginReady,steps:[],
    assertions:[{kind:'selector-present',selector:data.selector},
      ...(hasReplacement?
        [{kind:'selector-present' as const,selector:data.replacementSelector as string}]:[])]
   };
   // preflightScenario checks URL scheme, host and credentials and returns
   // UNKNOWN for unverified login prerequisites; it does not visit the site.
   const result=this.registry.register(scenario);
   if(result.state==='INVALID')return invalid('INVALID_SCENARIO');
   return Object.freeze({
    ok:true as const,status:'STAGED_RUNTIME_UNVERIFIED' as const,
    id:result.input.id,scriptSha256:result.input.scriptSha256,
    state:result.state,issues:Object.freeze([...result.issues]),
    // Eligibility is a bounded UI hint, never a browser visit authorization.
    // The privileged inspector still re-resolves and asks for native consent.
    readOnlyDomEligible:this.resolveReadOnlyDom(result.input.id).ok,
    ...noAuthority
   });
  }catch{return invalid('INVALID_REQUEST');}
 }
}
