/** TASK-004 / REQ-005: local-only scenario contracts; this module never opens a browser. */
import type { MetadataResult } from '../analyze/metadata-parser';

export type ScenarioState = 'INVALID' | 'UNKNOWN' | 'READY_TO_TEST';
export type ScenarioIssue =
  'INVALID_ID' | 'INVALID_SCRIPT_HASH' | 'DUPLICATE_ID' | 'INVALID_URL' |
  'MISSING_TARGET_URL' | 'NOT_AUTHORIZED' | 'LOGIN_NOT_READY' |
  'MISSING_ASSERTIONS' | 'INVALID_STEP' | 'INVALID_ASSERTION';
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
export function preflightScenario(input:ScenarioInput,metadata?:MetadataResult):RegisteredScenario {
  const invalid:ScenarioIssue[]=[];
  if(typeof input.id!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.id))
    invalid.push('INVALID_ID');
  if(typeof input.scriptSha256!=='string' || !/^[a-f0-9]{64}$/i.test(input.scriptSha256))
    invalid.push('INVALID_SCRIPT_HASH');
  const hasTarget=typeof input.targetUrl==='string' && input.targetUrl.trim().length>0;
  const url=hasTarget?normalizeUrl(input.targetUrl):null;
  if(hasTarget && !url)invalid.push('INVALID_URL');
  if(!Array.isArray(input.steps) || input.steps.length>100 ||
     !input.steps.every(step=>step && ['click','wait-for'].includes(step.kind) && validSelector(step.selector)))
    invalid.push('INVALID_STEP');
  if(!Array.isArray(input.assertions) || input.assertions.length>100 ||
     !input.assertions.every(rule=>rule && ['selector-present','text-contains'].includes(rule.kind) &&
        validSelector(rule.selector) &&
        (rule.kind!=='text-contains' || (typeof rule.expectedText==='string' && rule.expectedText.length<=4096))))
    invalid.push('INVALID_ASSERTION');
  const issues:ScenarioIssue[]=[...invalid];
  if(!invalid.length) {
    if(!url)issues.push('MISSING_TARGET_URL');
    if(input.userApproved!==true)issues.push('NOT_AUTHORIZED');
    if(input.requiresLogin && input.loginReady!==true)issues.push('LOGIN_NOT_READY');
    if(input.assertions.length===0)issues.push('MISSING_ASSERTIONS');
  }
  const clean:ScenarioInput={
    id:input.id,scriptSha256:input.scriptSha256,
    ...(url?{targetUrl:url}:{}),
    userApproved:input.userApproved===true,
    requiresLogin:input.requiresLogin===true,
    loginReady:input.loginReady===true,
    steps:Array.isArray(input.steps)?input.steps.map(step=>({...step})):[],
    assertions:Array.isArray(input.assertions)?input.assertions.map(rule=>({...rule})):[]
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
    if(this.scenarios.has(input.id))
      return {...result,state:'INVALID',issues:[...result.issues,'DUPLICATE_ID']};
    if(result.state!=='INVALID')this.scenarios.set(input.id,structuredClone(result));
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
