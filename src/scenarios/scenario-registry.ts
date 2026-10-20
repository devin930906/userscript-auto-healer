/** TASK-004 / REQ-005: local-only scenario contracts; this module never opens a browser. */
import type { MetadataResult } from '../analyze/metadata-parser';

export type ScenarioState = 'INVALID' | 'UNKNOWN' | 'READY_TO_TEST';
export type ScenarioIssue =
  'INVALID_ID' | 'INVALID_SCRIPT_HASH' | 'DUPLICATE_ID' | 'INVALID_URL' |
  'MISSING_TARGET_URL' | 'NOT_AUTHORIZED' | 'LOGIN_NOT_READY' |
  'MISSING_ASSERTIONS' | 'INVALID_STEP' | 'INVALID_ASSERTION' | 'INVALID_FLAGS';
export interface SiteHint {
  readonly source: 'match' | 'include';
  readonly pattern: string;
  readonly scheme: string | null;
  readonly hostPattern: string | null;
}
export interface ScenarioStep {
  readonly kind: 'click' | 'wait-for';
  readonly selector: string;
}
export interface ScenarioAssertion {
  readonly kind: 'selector-present' | 'text-contains';
  readonly selector: string;
  readonly expectedText?: string;
}
export interface ScenarioInput {
  readonly id: string;
  readonly scriptSha256: string;
  readonly targetUrl?: string;
  /** Explicit user consent to test the target; does not authorize script updates. */
  readonly userApproved: boolean;
  readonly requiresLogin: boolean;
  /** Caller attestation only; real browser confirmation belongs to TASK-007/010. */
  readonly loginReady?: boolean;
  readonly steps: readonly ScenarioStep[];
  readonly assertions: readonly ScenarioAssertion[];
}
export interface RegisteredScenario {
  readonly input: ScenarioInput;
  readonly hints: readonly SiteHint[];
  readonly state: ScenarioState;
  readonly issues: readonly ScenarioIssue[];
}
function validSelector(input:unknown):input is string {
  return typeof input==='string' && input.trim().length>0 && input.length<=512;
}
function normalizeUrl(input:unknown):string|null {
  if(typeof input!=='string' || !input.trim() || input.length>4096) return null;
  try {
    const url=new URL(input);
    if(!['http:','https:'].includes(url.protocol) || !url.hostname ||
       url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}
/** URL patterns are hints only: wildcards must never become invented real URLs. */
export function suggestSites(metadata?:MetadataResult):SiteHint[] {
  if(metadata?.status!=='OK')return [];
  const hints:SiteHint[]=[];
  const seen=new Set<string>();
  for(const source of ['match','include'] as const) {
    for(const pattern of metadata.tags[source] ?? []) {
      const value=pattern.trim();
      if(!value || seen.has(source+':'+value))continue;
      seen.add(source+':'+value);
      const match=/^(\*|https?):\/\/([^/\s]+)(?:\/|$)/i.exec(value);
      const host=match?.[2] ?? null;
      hints.push({
        source,pattern:value,
        scheme:match?.[1]?.toLowerCase() ?? null,
        hostPattern:host && !host.includes('@') ? host : null
      });
    }
  }
  return hints;
}
/** Capture data descriptors without evaluating user-supplied accessors.
 * Proxy traps are caught and treated as malformed input, never surfaced.
 * A scenario contract does not admit unknown fields or sparse arrays.
 */
function ownData(input:unknown, required:readonly string[], optional:readonly string[]=[]):
    Record<string,unknown>|null {
  try {
    if(!input||typeof input!=='object'||Array.isArray(input))return null;
    const proto=Object.getPrototypeOf(input);
    if(proto!==Object.prototype&&proto!==null)return null;
    const descriptors=Object.getOwnPropertyDescriptors(input);
    const keys=Reflect.ownKeys(descriptors);
    if(keys.some(key=>typeof key!=='string'||
       (!required.includes(key)&&!optional.includes(key)))||
       required.some(key=>!Object.prototype.hasOwnProperty.call(descriptors,key))||
       keys.some(key=>!Object.prototype.hasOwnProperty.call(
         descriptors[key as string],'value')))return null;
    const captured:Record<string,unknown>=Object.create(null);
    for(const key of keys)captured[key as string]=descriptors[key as string].value;
    return captured;
  }catch{return null;}
}
function ownRows(input:unknown,max:number,required:readonly string[],
    optional:readonly string[]=[]):Record<string,unknown>[]|null {
  try {
    if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype)
      return null;
    const length=Object.getOwnPropertyDescriptor(input,'length')?.value;
    if(!Number.isSafeInteger(length)||length<0||length>max)return null;
    const slots=Object.getOwnPropertyDescriptors(input);
    if(Reflect.ownKeys(slots).length!==length+1)return null;
    const rows:Record<string,unknown>[]=[];
    for(let index=0;index<length;index++){
      const slot=slots[String(index)];
      if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))
        return null;
      const row=ownData(slot.value,required,optional);
      if(!row)return null;
      rows.push(row);
    }
    return rows;
  }catch{return null;}
}
export function preflightScenario(input:ScenarioInput,metadata?:MetadataResult):RegisteredScenario {
  // This lower-level registry also validates untrusted runtime values; the
  // Electron IPC sanitization is not its only line of defense.
  const data=ownData(input,
    ['id','scriptSha256','userApproved','requiresLogin','steps','assertions'],
    ['targetUrl','loginReady']);
  const steps=data?ownRows(data.steps,100,['kind','selector']):null;
  const assertions=data?ownRows(data.assertions,100,['kind','selector'],['expectedText']):null;
  const invalid:ScenarioIssue[]=[];
  if(typeof data?.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(data.id))
    invalid.push('INVALID_ID');
  if(typeof data?.scriptSha256!=='string'||!/^[a-f0-9]{64}$/i.test(data.scriptSha256))
    invalid.push('INVALID_SCRIPT_HASH');
  // Required authorization and login flags must be exact booleans. Coercing
  // malformed requiresLogin to false would create an unauthorized no-login
  // scenario for native services which consume this registry directly.
  if(typeof data?.userApproved!=='boolean'||
     typeof data?.requiresLogin!=='boolean'||
     (data!==null&&Object.prototype.hasOwnProperty.call(data,'loginReady')&&
      typeof data.loginReady!=='boolean'))
    invalid.push('INVALID_FLAGS');
  const hasTarget=typeof data?.targetUrl==='string'&&data.targetUrl.trim().length>0;
  const url=hasTarget?normalizeUrl(data!.targetUrl):null;
  if(hasTarget&&!url)invalid.push('INVALID_URL');
  if(!steps||!steps.every(step=>
      (step.kind==='click'||step.kind==='wait-for')&&validSelector(step.selector)))
    invalid.push('INVALID_STEP');
  if(!assertions||!assertions.every(rule=>
      (rule.kind==='selector-present'||rule.kind==='text-contains')&&
      validSelector(rule.selector)&&
      (rule.kind!=='text-contains'||
        (typeof rule.expectedText==='string'&&rule.expectedText.length<=4096))))
    invalid.push('INVALID_ASSERTION');
  const issues:ScenarioIssue[]=[...invalid];
  if(!invalid.length){
    if(!url)issues.push('MISSING_TARGET_URL');
    if(data!.userApproved!==true)issues.push('NOT_AUTHORIZED');
    if(data!.requiresLogin===true&&data!.loginReady!==true)
      issues.push('LOGIN_NOT_READY');
    if(assertions!.length===0)issues.push('MISSING_ASSERTIONS');
  }
  const clean:ScenarioInput={
    id:typeof data?.id==='string'?data.id:'',
    scriptSha256:typeof data?.scriptSha256==='string'?data.scriptSha256:'',
    ...(url?{targetUrl:url}:{}),
    userApproved:data?.userApproved===true,
    requiresLogin:data?.requiresLogin===true,
    loginReady:data?.loginReady===true,
    steps:steps?steps.map(step=>({
      kind:step.kind as ScenarioStep['kind'],
      selector:step.selector as string
    })):[],
    assertions:assertions?assertions.map(rule=>({
      kind:rule.kind as ScenarioAssertion['kind'],
      selector:rule.selector as string,
      ...(Object.prototype.hasOwnProperty.call(rule,'expectedText')
        ?{expectedText:rule.expectedText as string}:{})
    })):[]
  };
  return {
    input:clean,hints:suggestSites(metadata),
    state:invalid.length?'INVALID':issues.length?'UNKNOWN':'READY_TO_TEST',
    issues
  };
}
/** In-memory first; storage/real-world acceptance come in later tasks. */
export class ScenarioRegistry {
  private readonly scenarios=new Map<string,RegisteredScenario>();
  register(input:ScenarioInput,metadata?:MetadataResult):RegisteredScenario {
    const result=preflightScenario(input,metadata);
    if(result.state==='INVALID')return structuredClone(result);
    if(this.scenarios.has(result.input.id))
      return {...result,state:'INVALID',issues:[...result.issues,'DUPLICATE_ID']};
    this.scenarios.set(result.input.id,structuredClone(result));
    return structuredClone(result);
  }
  get(id:string):RegisteredScenario|null {
    const stored=this.scenarios.get(id);
    return stored?structuredClone(stored):null;
  }
  list():RegisteredScenario[] {
    return [...this.scenarios.values()].map(value=>structuredClone(value));
  }
}
