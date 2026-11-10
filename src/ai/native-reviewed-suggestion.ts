/**
 * TASK-014 / REQ-015/016 / TEST-015/016/026.
 * Session-only review of a *real*, main-process-owned read-only DOM receipt.
 * Never accept renderer evidence. HMAC labels hide private selectors and IDs.
 * Each request requires a new OS file picker and a distinct native disclosure
 * approval. Provider output is always untrusted text, never repair authority.
 */
import {createHmac,randomBytes} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {OptionalAiGateway,type AiSuggestion,type GatewayCode} from './model-gateway';

type Evidence=Readonly<{diagnosticCode:'SELECTOR_ASSERTION'|'UNKNOWN';
  scenarioHash:string;selectorHash:string}>;
type Failure=Readonly<{ok:false;code:GatewayCode|'CANCELLED'|
  'NO_REVIEW_EVIDENCE'|'INVALID_CONFIGURATION';automaticPatchAllowed:false}>;
export type NativeReviewedSuggestionResult=AiSuggestion|Failure;
const HASH=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const MAX_AGE_MS=300000;
const MAX_SESSION_RECORDS=100;
const blocked=(code:Failure['code']):Failure=>
  Object.freeze({ok:false,code,automaticPatchAllowed:false as const});

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
       selector.trim()!==selector||/[\x00-\x1f\x7f]/.test(selector)||
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
  authorize:(origin:string,review:Evidence)=>Promise<boolean>,
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
    const allowed=await authorize(origin,evidence);
    if(!allowed||signal?.aborted)return blocked('CANCELLED');
    const consent={userApproved:true as const,approvedOrigin:origin};
    if(!gateway.enable(consent))return blocked('NOT_AUTHORIZED');
    return await gateway.suggest(consent,evidence,signal);
  }catch{return blocked('CANCELLED');
  }finally{gateway.disable();}
}
