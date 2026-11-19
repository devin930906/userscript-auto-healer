/**
 * TASK-014 / REQ-015/016 / TEST-015/016/026.
 * Session-only review of a *real*, main-process-owned read-only DOM receipt.
 * Never accept renderer evidence. HMAC labels hide private selectors and IDs.
 * Each request requires a new OS file picker and a distinct native disclosure
 * approval. Provider output is always untrusted text, never repair authority.
 */
import {createHmac,randomBytes} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {OptionalAiGateway,type AiSuggestion,type GatewayCode,
  type SuggestionRequestTarget} from './model-gateway';
import type {DiagnosticFaultEvidence} from '../repair/patch-planner';

type Evidence=Readonly<{diagnosticCode:'SELECTOR_ASSERTION'|'UNKNOWN';
  scenarioHash:string;selectorHash:string}>;
export type NativeAiReviewEvidence=Evidence;
type Failure=Readonly<{ok:false;code:GatewayCode|'CANCELLED'|
  'NO_REVIEW_EVIDENCE'|'INVALID_CONFIGURATION';automaticPatchAllowed:false}>;
export type NativeReviewedSuggestionResult=AiSuggestion|Failure;
const HASH=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const MAX_AGE_MS=300000;
const MAX_SESSION_RECORDS=100;
const blocked=(code:Failure['code']):Failure=>
  Object.freeze({ok:false,code,automaticPatchAllowed:false as const});

/** Format the exact native disclosure without ever receiving the API key. */
export function formatNativeAiReviewDisclosure(origin:string,review:NativeAiReviewEvidence,
  target:SuggestionRequestTarget):string{
  return [
    '服务来源：'+origin,
    '实际请求目标：'+target.method+' '+target.url,
    '只发送以下固定字段（不发送脚本源码、DOM、URL、文件路径或选择器原文）：',
    'diagnosticCode='+review.diagnosticCode,
    'scenarioHash='+review.scenarioHash,
    'selectorHash='+review.selectorHash,
    '会发送本地配置的 Bearer API Key；仅发起上述一次请求，有用量成本。',
    '返回的文字仅供人工参考，绝不安装、更新或修复脚本。'
  ].join('\n');
}

/** A native AI disclosure must never inspect a caller-controlled cancellation
 * getter or attach a hostile listener. Reject forged signals before touching
 * the evidence, authorizer or network. The gateway has the same boundary,
 * but validation here must precede the privileged approval callback.
 */
function isNativeReviewSignal(value:unknown):value is AbortSignal{
  try{
    if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
       Object.getPrototypeOf(value)!==AbortSignal.prototype||
       ['aborted','addEventListener','removeEventListener'].some(name=>
         Object.prototype.hasOwnProperty.call(value,name)))return false;
    const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
    return typeof getter==='function'&&typeof getter.call(value)==='boolean';
  }catch{return false;}
}

export class NativeAiEvidenceStore{
  private readonly salt=randomBytes(32);
  private readonly receipts=new Map<string,{evidence:Evidence;created:number}>();
  constructor(private readonly now:()=>number=Date.now){}
  /** A native clock failure must never expose its error text or authorize a
   * fresh review receipt. A failed lookup revokes that receipt below. */
  private readClock():number|null{
    try{
      const timestamp=this.now();
      return Number.isSafeInteger(timestamp)&&timestamp>=0?timestamp:null;
    }catch{return null;}
  }
  /** Call only after an owned-Chrome, consented scenario inspection succeeds. */
  record(id:unknown,scriptSha256:unknown,selector:unknown,code:unknown):boolean{
    if(typeof id!=='string'||!ID.test(id)||
       typeof scriptSha256!=='string'||!HASH.test(scriptSha256)||
       typeof selector!=='string'||!selector||selector.length>256||
       selector.trim()!==selector||/[\x00-\x1f\x7f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(selector)||
       // UTF-8 HMAC encoding replaces lone surrogate code units with U+FFFD;
       // distinct malformed selectors must not alias one review evidence hash.
       // Unicode mode treats a valid surrogate pair as one code point.
       /[\uD800-\uDFFF]/u.test(selector)||
       (code!=='SELECTOR_ASSERTION'&&code!=='UNKNOWN'))return false;
    const created=this.readClock();
    if(created===null)return false;
    if(!this.receipts.has(id)&&this.receipts.size>=MAX_SESSION_RECORDS){
      // An expired receipt must not permanently consume a session slot.
      // Never evict a still-valid receipt just to admit a new one.
      for(const [key,receipt] of this.receipts){
        if(created<receipt.created||created-receipt.created>MAX_AGE_MS)
          this.receipts.delete(key);
      }
      if(this.receipts.size>=MAX_SESSION_RECORDS)return false;
    }
    const digest=(label:string,value:string)=>createHmac('sha256',this.salt)
      .update(label+'\n'+value).digest('hex');
    const evidence=Object.freeze({
      diagnosticCode:code as Evidence['diagnosticCode'],
      scenarioHash:digest('uah-native-ai-scenario-v1',scriptSha256+'\n'+id),
      selectorHash:digest('uah-native-ai-selector-v1',scriptSha256+'\n'+id+'\n'+selector)
    });
    this.receipts.set(id,{evidence,created});
    return true;
  }
  resolve(id:unknown):Evidence|null{
    if(typeof id!=='string'||!ID.test(id))return null;
    const receipt=this.receipts.get(id);
    if(!receipt)return null;
    const now=this.readClock();
    if(now===null||now<receipt.created||
       now-receipt.created>MAX_AGE_MS){
      this.receipts.delete(id);return null;
    }
    return receipt.evidence;
  }
  revoke(id:unknown):void{
    if(typeof id==='string'&&ID.test(id))this.receipts.delete(id);
  }
  clear():void{this.receipts.clear();}
}

/** Inputs here are created by NativeAiEvidenceStore in the privileged process.
 * No string, object or path from an untrusted renderer enters this function.
 */
export async function requestNativeReviewedAiSuggestion(
  configText:unknown,
  evidenceInput:unknown,
  authorize:(origin:string,review:Evidence,target:SuggestionRequestTarget)=>Promise<boolean>,
  signal?:AbortSignal,
  transport:typeof fetch=fetch
):Promise<NativeReviewedSuggestionResult>{
  if(signal!==undefined&&!isNativeReviewSignal(signal))
    return blocked('INVALID_CANCEL_SIGNAL');
  if(signal?.aborted)return blocked('CANCELLED');
  if(evidenceInput===null||evidenceInput===undefined)
    return blocked('NO_REVIEW_EVIDENCE');
  let evidence:Evidence;
  try{
    if(!evidenceInput||typeof evidenceInput!=='object'||
       Array.isArray(evidenceInput)||nodeTypes.isProxy(evidenceInput)||
       Object.getPrototypeOf(evidenceInput)!==Object.prototype)
      return blocked('INVALID_EVIDENCE');
    const fields=Object.getOwnPropertyDescriptors(evidenceInput);
    const own=Reflect.ownKeys(fields);
    const keys=['diagnosticCode','scenarioHash','selectorHash'];
    if(own.length!==3||keys.some(key=>
       !Object.prototype.hasOwnProperty.call(fields,key)||
       !Object.prototype.hasOwnProperty.call(fields[key],'value')))
      return blocked('INVALID_EVIDENCE');
    const d=fields.diagnosticCode.value;
    const sh=fields.scenarioHash.value;
    const sel=fields.selectorHash.value;
    if((d!=='SELECTOR_ASSERTION'&&d!=='UNKNOWN')||
       typeof sh!=='string'||!HASH.test(sh)||
       typeof sel!=='string'||!HASH.test(sel))
       return blocked('INVALID_EVIDENCE');
    evidence=Object.freeze({diagnosticCode:d,scenarioHash:sh,selectorHash:sel});
  }catch{return blocked('INVALID_EVIDENCE');}
  if(typeof configText!=='string'||configText.length===0||
     Buffer.byteLength(configText,'utf8')>4096)return blocked('INVALID_CONFIGURATION');
  let gateway:OptionalAiGateway;
  let origin:string;
  try{
    const input:unknown=JSON.parse(configText);
    gateway=new OptionalAiGateway(input,transport);
    origin=new URL((input as {baseUrl:string}).baseUrl).origin;
  }catch{return blocked('INVALID_CONFIGURATION');}
  try{
    if(!gateway.status().manualModelAvailable)return blocked('MODEL_NOT_SELECTED');
    if(signal?.aborted)return blocked('CANCELLED');
    const target=gateway.suggestionRequestTarget();
    let onAbort:(()=>void)|undefined;
    const revoked=signal?new Promise<false>(resolve=>{
      onAbort=()=>resolve(false);
      signal.addEventListener('abort',onAbort,{once:true});
    }):undefined;
    let allowed:boolean;
    try{
      if(signal?.aborted)return blocked('CANCELLED');
      const approval=Promise.resolve().then(()=>
        signal?.aborted?false:authorize(origin,evidence,target));
      allowed=revoked?await Promise.race([approval,revoked]):await approval;
    }finally{
      if(signal&&onAbort)signal.removeEventListener('abort',onAbort);
    }
    if(!allowed||signal?.aborted)return blocked('CANCELLED');
    const consent={userApproved:true as const,approvedOrigin:origin};
    if(!gateway.enable(consent))return blocked('NOT_AUTHORIZED');
    return await gateway.suggest(consent,evidence,signal);
  }catch{return blocked('CANCELLED');
  }finally{gateway.disable();}
}

const SIMPLE_SELECTOR_RE = /^[#.][A-Za-z_][A-Za-z0-9_-]{0,127}$/;

/**
 * TASK-014 / PR #858 calibration:
 * Extract and validate an untrusted AI suggestion text into a candidate replacement selector.
 *
 * Safety invariants:
 * 1. AI output is strictly untrusted text.
 * 2. Only valid simple CSS selectors matching /^[#.][A-Za-z_][A-Za-z0-9_-]{0,127}$/ are accepted.
 * 3. Never authorizes a write or auto-patch; candidate must be verified by real Tampermonkey & business gates.
 */
export function extractAiAssistedReplacementSelector(suggestion: unknown): string | null {
  if (!suggestion || typeof suggestion !== 'object' || nodeTypes.isProxy(suggestion)) {
    return null;
  }
  const s = suggestion as Record<string, unknown>;
  if (s.ok !== true || s.status !== 'UNTRUSTED_AI_TEXT_ONLY' || typeof s.candidateText !== 'string') {
    return null;
  }

  let text = s.candidateText.trim();
  // Strip markdown code fences if present: ```css\n#selector\n``` or `#selector`
  if (text.startsWith('```')) {
    const lines = text.split('\n');
    if (lines.length >= 2) {
      lines.shift();
      if (lines[lines.length - 1].trim().startsWith('```')) {
        lines.pop();
      }
      text = lines.join('\n').trim();
    }
  }

  // If text is wrapped in single or double quotes or backticks, unwrap
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('`') && text.endsWith('`'))
  ) {
    text = text.slice(1, -1).trim();
  }

  // Attempt JSON parse if structured response format was used
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.replacementSelector === 'string') {
          text = parsed.replacementSelector.trim();
        } else if (typeof parsed.selector === 'string') {
          text = parsed.selector.trim();
        }
      }
    } catch {
      // not JSON, fallback to raw trimmed text
    }
  }

  if (!SIMPLE_SELECTOR_RE.test(text)) {
    return null;
  }

  return text;
}

/**
 * TASK-014 / PR #858 calibration:
 * Create a DiagnosticFaultEvidence assisted by an untrusted AI suggestion.
 * The resulting evidence must still pass proposeConservativeRepairCandidateFromEvidence
 * and undergo real manager assertion before any repair or acceptance.
 */
export function buildAiAssistedDiagnosticEvidence(
  suggestion: unknown,
  faultContext: {
    faultEvidenceId: string;
    targetUrl: string;
    originalSelector: string;
    scriptSha256: string;
  }
): DiagnosticFaultEvidence | null {
  const replacementSelector = extractAiAssistedReplacementSelector(suggestion);
  if (!replacementSelector) return null;

  if (
    typeof faultContext !== 'object' ||
    !faultContext ||
    nodeTypes.isProxy(faultContext) ||
    typeof faultContext.faultEvidenceId !== 'string' ||
    typeof faultContext.targetUrl !== 'string' ||
    typeof faultContext.originalSelector !== 'string' ||
    typeof faultContext.scriptSha256 !== 'string' ||
    replacementSelector === faultContext.originalSelector
  ) {
    return null;
  }

  return Object.freeze({
    faultEvidenceId: faultContext.faultEvidenceId,
    targetUrl: faultContext.targetUrl,
    originalSelector: faultContext.originalSelector,
    replacementSelector,
    scriptSha256: faultContext.scriptSha256
  });
}
