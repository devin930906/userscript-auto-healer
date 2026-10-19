/**
 * TASK-014 / REQ-015/016: explicitly enabled, bounded OpenAI-compatible
 * gateway. Native caller only; do NOT expose config/credentials or these
 * methods through renderer IPC. There is no automatic network connection.
 *
 * Only three pre-reviewed non-reversible evidence fields may leave the app.
 * Any text from the provider is UNTRUSTED and NEVER a patch/GM attestation.
 * Persistent credential storage, arbitrary source/DOM transfer, and product
 * repair integration require separate native authorization and verification.
 */
export type GatewayCode =
  'DISABLED' | 'NOT_AUTHORIZED' | 'INVALID_EVIDENCE' |
  'MODEL_NOT_SELECTED' | 'REQUEST_LIMIT' | 'NETWORK_FAILED' |
  'HTTP_REJECTED' | 'INVALID_RESPONSE' | 'CANCELLED';
export type GatewayFailure = Readonly<{ok:false;code:GatewayCode;automaticPatchAllowed:false}>;
export type ModelDiscovery = Readonly<{ok:true;status:'MODELS_DISCOVERED'|'MANUAL_MODEL_FALLBACK';
  models:readonly string[];manualModelAvailable:boolean;automaticPatchAllowed:false}>;
export type AiSuggestion = Readonly<{ok:true;status:'UNTRUSTED_AI_TEXT_ONLY';
  candidateText:string;model:string;tampermonkeyVerified:false;
  businessVerified:false;automaticPatchAllowed:false;automaticRollbackAllowed:false}>;
export type GatewayStatus = Readonly<{enabled:boolean;remainingRequests:number;manualModelAvailable:boolean}>;
type Options = Readonly<{baseUrl:string;apiKey:string;manualModel:string|null;
  maxRequests:number;timeoutMs:number;maxOutputTokens:number}>;
type Consent = Readonly<{userApproved:true;approvedOrigin:string}>;
type SafeEvidence = Readonly<{diagnosticCode:'SELECTOR_ASSERTION'|'UNKNOWN';
  scenarioHash:string;selectorHash:string}>;
const HASH=/^[a-f0-9]{64}$/;
const MODEL=/^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,127}$/;
const MAX_REPLY=32*1024;
const failure=(code:GatewayCode):GatewayFailure=>
  Object.freeze({ok:false,code,automaticPatchAllowed:false as const});

/** Access only own data descriptors; no user-created getters or hidden fields. */
function record(input:unknown,keys:readonly string[]):Record<string,unknown>|null{
  try{
    if(!input||typeof input!=='object'||Array.isArray(input))return null;
    const proto=Object.getPrototypeOf(input);
    if(proto!==Object.prototype&&proto!==null)return null;
    const fields=Object.getOwnPropertyDescriptors(input);
    const names=Reflect.ownKeys(fields);
    if(names.length!==keys.length||names.some(k=>typeof k!=='string')||
       keys.some(k=>!Object.prototype.hasOwnProperty.call(fields,k)||
         !Object.prototype.hasOwnProperty.call(fields[k],'value')))return null;
    const result:Record<string,unknown>=Object.create(null);
    for(const key of keys)result[key]=fields[key].value;
    return result;
  }catch{return null;}
}
function validateConfig(input:unknown):{options:Options;url:URL}{
  const c=record(input,['baseUrl','apiKey','manualModel','maxRequests','timeoutMs','maxOutputTokens']);
  if(!c||typeof c.baseUrl!=='string'||c.baseUrl.length>512||
     c.baseUrl.trim()!==c.baseUrl||c.baseUrl.includes('%')||
     /(?:^|\/)\.{1,2}(?:\/|$)/.test(c.baseUrl))
    throw Error('INVALID_AI_CONFIGURATION');
  let url:URL;
  try{url=new URL(c.baseUrl);}catch{throw Error('INVALID_AI_CONFIGURATION');}
  const hostname=url.hostname.toLowerCase();
  const local=hostname==='127.0.0.1';
  const publicHostname=/^(?=.{1,253}$)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(hostname)&&
    !hostname.endsWith('.local')&&!hostname.endsWith('.internal')&&
    !hostname.endsWith('.localhost');
  if(!(local&&url.protocol==='http:'||publicHostname&&url.protocol==='https:')||
     url.username||url.password||url.search||url.hash||
     !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(url.pathname)||
     (url.pathname!=='/'&&url.pathname.endsWith('/'))||
     typeof c.apiKey!=='string'||c.apiKey.length<1||c.apiKey.length>512||
     /[\r\n\0]/.test(c.apiKey)||c.apiKey.trim()!==c.apiKey||
     !(c.manualModel===null||
       typeof c.manualModel==='string'&&MODEL.test(c.manualModel))||
     !Number.isSafeInteger(c.maxRequests)||Number(c.maxRequests)<1||Number(c.maxRequests)>8||
     !Number.isSafeInteger(c.timeoutMs)||Number(c.timeoutMs)<500||Number(c.timeoutMs)>10000||
     !Number.isSafeInteger(c.maxOutputTokens)||
     Number(c.maxOutputTokens)<32||Number(c.maxOutputTokens)>256)
    throw Error('INVALID_AI_CONFIGURATION');
  const options:Options={
    baseUrl:url.href,apiKey:c.apiKey,manualModel:c.manualModel as string|null,
    maxRequests:c.maxRequests as number,timeoutMs:c.timeoutMs as number,
    maxOutputTokens:c.maxOutputTokens as number
  };
  return {options,url};
}
function validateEvidence(input:unknown):SafeEvidence|null{
  const r=record(input,['diagnosticCode','scenarioHash','selectorHash']);
  if(!r||(r.diagnosticCode!=='SELECTOR_ASSERTION'&&r.diagnosticCode!=='UNKNOWN')||
    typeof r.scenarioHash!=='string'||!HASH.test(r.scenarioHash)||
    typeof r.selectorHash!=='string'||!HASH.test(r.selectorHash))
    return null;
  return {diagnosticCode:r.diagnosticCode,scenarioHash:r.scenarioHash,selectorHash:r.selectorHash};
}
async function limitedJson(response:Response):Promise<unknown|null>{
  if(!response.ok||!response.body)return null;
  const claimed=response.headers.get('content-length');
  if(claimed!==null&&(!/^\d+$/.test(claimed)||Number(claimed)>MAX_REPLY))return null;
  const reader=response.body.getReader();const bytes:Uint8Array[]=[];let count=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      count+=value.byteLength;
      if(count>MAX_REPLY)return null;
      bytes.push(value);
    }
    if(count===0)return null;
    const data=new Uint8Array(count);let off=0;
    for(const part of bytes){data.set(part,off);off+=part.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)) as unknown;
  }catch{return null;}finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
export class OptionalAiGateway {
  private enabled=false;
  private requests=0;
  private readonly pending=new Set<AbortController>();
  private readonly options:Options;
  private readonly origin:string;
  private readonly root:string;
  constructor(input:unknown,private readonly transport:typeof fetch=fetch){
    const {options,url}=validateConfig(input);
    if(typeof transport!=='function')throw Error('INVALID_AI_TRANSPORT');
    this.options=options;
    this.origin=url.origin;
    this.root=url.href.replace(/\/$/,'');
  }
  status():GatewayStatus{
    return Object.freeze({enabled:this.enabled,
      remainingRequests:this.options.maxRequests-this.requests,
      manualModelAvailable:this.options.manualModel!==null});
  }
  /** A native consent dialog must supply this scope; untrusted JS cannot. */
  enable(input:unknown):boolean{
    const c=record(input,['userApproved','approvedOrigin']);
    if(!c||c.userApproved!==true||c.approvedOrigin!==this.origin)return false;
    this.enabled=true;
    return true;
  }
  disable():void{
    this.enabled=false;
    for(const controller of this.pending)controller.abort();
  }
  private consent(input:unknown):GatewayFailure|null{
    if(!this.enabled)return failure('DISABLED');
    const c=record(input,['userApproved','approvedOrigin']);
    return c&&c.userApproved===true&&c.approvedOrigin===this.origin
      ?null:failure('NOT_AUTHORIZED');
  }
  private async request(path:'/models'|'/chat/completions',init:RequestInit,
    signal?:AbortSignal):Promise<{response:Response;value:unknown}|GatewayFailure>{
    if(signal?.aborted)return failure('CANCELLED');
    if(this.requests>=this.options.maxRequests)return failure('REQUEST_LIMIT');
    this.requests++; // failures consume quota; no silent retry
    const abort=new AbortController();
    this.pending.add(abort);
    const timer=AbortSignal.timeout(this.options.timeoutMs);
    const all=signal?AbortSignal.any([abort.signal,timer,signal]):
      AbortSignal.any([abort.signal,timer]);
    try{
      const response=await this.transport(this.root+path,{
        ...init,redirect:'error',credentials:'omit',cache:'no-store',signal:all,
        headers:{'Authorization':'Bearer '+this.options.apiKey,
          'Accept':'application/json',...(init.body?{'Content-Type':'application/json'}:{})}
      });
      if(!this.enabled||signal?.aborted||abort.signal.aborted)return failure('CANCELLED');
      if(!response.ok)return failure('HTTP_REJECTED');
      const value=await limitedJson(response);
      if(!this.enabled||signal?.aborted||abort.signal.aborted)return failure('CANCELLED');
      if(value===null)return failure('INVALID_RESPONSE');
      return {response,value};
    }catch{
      return failure(signal?.aborted||abort.signal.aborted||!this.enabled?
        'CANCELLED':'NETWORK_FAILED');
    }finally{this.pending.delete(abort);}
  }
  async discoverModels(consent:unknown,signal?:AbortSignal):
      Promise<ModelDiscovery|GatewayFailure>{
    const refused=this.consent(consent);
    if(refused)return refused;
    const fetched=await this.request('/models',{method:'GET'},signal);
    if('ok' in fetched&&fetched.ok===false){
      if(fetched.code==='HTTP_REJECTED'||fetched.code==='INVALID_RESPONSE'||
         fetched.code==='NETWORK_FAILED')
        return Object.freeze({ok:true,status:'MANUAL_MODEL_FALLBACK' as const,
          models:Object.freeze([] as string[]),
          manualModelAvailable:this.options.manualModel!==null,automaticPatchAllowed:false as const});
      return fetched;
    }
    if(!('value' in fetched))return failure('INVALID_RESPONSE');
    const v=fetched.value as {data?:unknown};
    const items=v&&typeof v==='object'&&!Array.isArray(v)&&Array.isArray(v.data)
      ?v.data:null;
    if(!items||items.length>100)return failure('INVALID_RESPONSE');
    const models:string[]=[];
    for(const entry of items){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))return failure('INVALID_RESPONSE');
      const id=(entry as {id?:unknown}).id;
      if(typeof id!=='string'||!MODEL.test(id))return failure('INVALID_RESPONSE');
      if(!models.includes(id))models.push(id);
    }
    return Object.freeze({ok:true,status:'MODELS_DISCOVERED' as const,
      models:Object.freeze(models),manualModelAvailable:this.options.manualModel!==null,
      automaticPatchAllowed:false as const});
  }
  async suggest(consent:unknown,evidence:unknown,signal?:AbortSignal):
      Promise<AiSuggestion|GatewayFailure>{
    const refused=this.consent(consent);
    if(refused)return refused;
    const data=validateEvidence(evidence);
    if(!data)return failure('INVALID_EVIDENCE');
    if(this.options.manualModel===null)return failure('MODEL_NOT_SELECTED');
    // This intentionally contains no script, selector text, DOM, URL or file path.
    const body=JSON.stringify({model:this.options.manualModel,stream:false,
      max_tokens:this.options.maxOutputTokens,
      messages:[{role:'system',content:'This is unverified, privacy-minimized diagnostic metadata. Respond with high-level, review-only guidance. Never claim to have repaired or tested a script.'},
        {role:'user',content:JSON.stringify(data)}]});
    const fetched=await this.request('/chat/completions',{method:'POST',body},signal);
    if('ok' in fetched&&fetched.ok===false)return fetched;
    if(!('value' in fetched))return failure('INVALID_RESPONSE');
    const response=fetched.value as {choices?:unknown};
    if(!response||typeof response!=='object'||!Array.isArray(response.choices)||
       response.choices.length!==1)return failure('INVALID_RESPONSE');
    const item=response.choices[0] as {message?:unknown};
    if(!item||typeof item!=='object'||!item.message||
       typeof item.message!=='object'||Array.isArray(item.message))
      return failure('INVALID_RESPONSE');
    const message=item.message as Record<string,unknown>;
    const content=message.content;
    if(message.role!=='assistant'||typeof content!=='string'||!content.trim()||
       content.length>4096||message.tool_calls!==undefined||
       message.function_call!==undefined)return failure('INVALID_RESPONSE');
    return Object.freeze({ok:true,status:'UNTRUSTED_AI_TEXT_ONLY' as const,
      candidateText:content,model:this.options.manualModel,tampermonkeyVerified:false as const,
      businessVerified:false as const,automaticPatchAllowed:false as const,
      automaticRollbackAllowed:false as const});
  }
}
