/**
 * TASK-016 / REQ-025 / TEST-025 — conservative shared compatibility metadata.
 *
 * This is a bounded, memory-only OFFLINE preview of versioned locator/retry/
 * mutation-observer settings. It does not query the DOM, inject a userscript,
 * run Tampermonkey, attest business results, change files, or activate a
 * proposed upgrade. Callers must supply their own isolated test fixtures;
 * reported check outcomes are NOT trusted runtime evidence or write authority.
 */
import { types as nodeTypes } from 'node:util';

export type LocatorBinding = Readonly<{
  key:string;
  selector:string;
  attempts:number;
  delayMs:number;
  observeMutations:boolean;
}>;
export type CompatibilityVersion = Readonly<{
  version:string;
  consumers:readonly string[];
  bindings:readonly LocatorBinding[];
}>;
export type CompatibilitySnapshot = Readonly<{
  schema:'uah-limited-compat-v1';
  phase:'OFFLINE_PREVIEW_NOT_RUNTIME_VALIDATED';
  active:CompatibilityVersion;
  preview:CompatibilityVersion|null;
  tampermonkeyVerified:false;
  businessVerified:false;
  automaticActivationAllowed:false;
}>;
export type PreviewDecision =
  | Readonly<{
    status:'BLOCKED';
    reason:'INVALID_UPGRADE'|'OFFLINE_REGRESSION_NOT_COMPLETE'|'PREVIEW_EXISTS';
    automaticActivationAllowed:false;
    tampermonkeyVerified:false;
    businessVerified:false;
  }>
  | Readonly<{
    status:'OFFLINE_PREVIEW_ONLY';
    fromVersion:string;
    toVersion:string;
    checkedConsumers:number;
    automaticActivationAllowed:false;
    tampermonkeyVerified:false;
    businessVerified:false;
  }>;

const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HASH=/^[a-f0-9]{64}$/;
const SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_CONSUMERS=64, MAX_BINDINGS=32;

function exact(input:unknown, keys:readonly string[]):Record<string,unknown>|null {
  if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||Array.isArray(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const own=Reflect.ownKeys(descriptors);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string')||
    keys.some(k=>!Object.prototype.hasOwnProperty.call(descriptors,k)||
      !Object.prototype.hasOwnProperty.call(descriptors[k],'value')))return null;
  const out:Record<string,unknown>=Object.create(null);
  for(const key of keys)out[key]=descriptors[key].value;
  return out;
}
function safeArray(input:unknown,limit:number):readonly unknown[] {
  if(nodeTypes.isProxy(input)||!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||
    input.length<1||input.length>limit||
    Reflect.ownKeys(input).length!==input.length+1)throw Error('INVALID_COMPAT_ARRAY');
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const out:unknown[]=[];
  for(let i=0;i<input.length;i++) {
    const field=descriptors[String(i)];
    if(!field||!Object.prototype.hasOwnProperty.call(field,'value'))
      throw Error('INVALID_COMPAT_ARRAY');
    out.push(field.value);
  }
  return out;
}
function versionParts(version:unknown):number[] {
  if(typeof version!=='string'||!SEMVER.test(version))
    throw Error('INVALID_COMPAT_VERSION');
  const parts=version.split('.').map(Number);
  if(parts.some(n=>!Number.isSafeInteger(n)))
    throw Error('INVALID_COMPAT_VERSION');
  return parts;
}
function isNewer(current:string,candidate:string):boolean {
  const a=versionParts(current),b=versionParts(candidate);
  for(let i=0;i<3;i++)if(a[i]!==b[i])return b[i]>a[i];
  return false;
}
function parseDefinition(input:unknown):CompatibilityVersion {
  const obj=exact(input,['version','consumers','bindings']);
  if(!obj)throw Error('INVALID_COMPAT_DEFINITION');
  versionParts(obj.version);
  const consumers=safeArray(obj.consumers,MAX_CONSUMERS);
  const names=new Set<string>();
  const validatedConsumers=consumers.map(value=>{
    if(typeof value!=='string'||!HASH.test(value)||names.has(value))
      throw Error('INVALID_COMPAT_CONSUMER');
    names.add(value);
    return value;
  }).sort();
  const keys=new Set<string>();
  const validatedBindings=safeArray(obj.bindings,MAX_BINDINGS).map(entry=>{
    const binding=exact(entry,['key','selector','attempts','delayMs','observeMutations']);
    if(!binding||typeof binding.key!=='string'||!ID.test(binding.key)||
      keys.has(binding.key)||typeof binding.selector!=='string'||
      binding.selector.length===0||binding.selector.length>256||
      binding.selector.trim()!==binding.selector||
      /[\x00-\x1f\x7f]/.test(binding.selector)||
      !Number.isSafeInteger(binding.attempts)||
      (binding.attempts as number)<1||(binding.attempts as number)>5||
      !Number.isSafeInteger(binding.delayMs)||
      (binding.delayMs as number)<0||(binding.delayMs as number)>2000||
      typeof binding.observeMutations!=='boolean')
      throw Error('INVALID_COMPAT_BINDING');
    keys.add(binding.key);
    return Object.freeze({
      key:binding.key,selector:binding.selector,
      attempts:binding.attempts as number,delayMs:binding.delayMs as number,
      observeMutations:binding.observeMutations
    }) as LocatorBinding;
  }).sort((a,b)=>a.key.localeCompare(b.key));
  return Object.freeze({
    version:obj.version as string,
    consumers:Object.freeze(validatedConsumers),
    bindings:Object.freeze(validatedBindings)
  });
}
const blocked=(reason:Extract<PreviewDecision,{status:'BLOCKED'}>['reason']):PreviewDecision=>
  Object.freeze({
    status:'BLOCKED' as const,reason,
    automaticActivationAllowed:false as const,
    tampermonkeyVerified:false as const,businessVerified:false as const
  });

export class LimitedCompatibilityLayer {
  private readonly active:CompatibilityVersion;
  private preview:CompatibilityVersion|null=null;
  constructor(input:unknown) {
    // Validation and copy: caller mutations cannot rewrite pinned mappings.
    this.active=parseDefinition(input);
  }
  /** Existing version only: a proposed selector never reaches consumers. */
  resolve(key:unknown):LocatorBinding|null {
    if(typeof key!=='string'||!ID.test(key))return null;
    return this.active.bindings.find(binding=>binding.key===key)||null;
  }
  snapshot():CompatibilitySnapshot {
    return Object.freeze({
      schema:'uah-limited-compat-v1' as const,
      phase:'OFFLINE_PREVIEW_NOT_RUNTIME_VALIDATED' as const,
      active:this.active,preview:this.preview,
      tampermonkeyVerified:false as const,businessVerified:false as const,
      automaticActivationAllowed:false as const
    });
  }
  /**
   * A caller-reported, per-consumer offline fixture matrix must be complete.
   * Even all-PASS reports can only stage a read-only preview: there is no
   * promotion or disk/runtime side effect without future trusted E2E gates.
   */
  previewUpgrade(candidate:unknown,reports:unknown):PreviewDecision {
    if(this.preview)return blocked('PREVIEW_EXISTS');
    try {
      const parsed=parseDefinition(candidate);
      if(!isNewer(this.active.version,parsed.version)||
        parsed.consumers.length!==this.active.consumers.length||
        parsed.consumers.some((x,i)=>x!==this.active.consumers[i])||
        parsed.bindings.length!==this.active.bindings.length||
        parsed.bindings.some((x,i)=>x.key!==this.active.bindings[i].key)||
        parsed.bindings.every((x,i)=>
          JSON.stringify(x)===JSON.stringify(this.active.bindings[i])))
        return blocked('INVALID_UPGRADE');
      const matrix=safeArray(reports,MAX_CONSUMERS);
      if(matrix.length!==this.active.consumers.length)
        return blocked('OFFLINE_REGRESSION_NOT_COMPLETE');
      const visited=new Set<string>();
      for(const entry of matrix){
        const report=exact(entry,['scriptHash','passed']);
        if(!report||typeof report.scriptHash!=='string'||
          !HASH.test(report.scriptHash)||visited.has(report.scriptHash)||
          !this.active.consumers.includes(report.scriptHash)||
          report.passed!==true)
          return blocked('OFFLINE_REGRESSION_NOT_COMPLETE');
        visited.add(report.scriptHash);
      }
      if(visited.size!==this.active.consumers.length)
        return blocked('OFFLINE_REGRESSION_NOT_COMPLETE');
      this.preview=parsed;
      return Object.freeze({
        status:'OFFLINE_PREVIEW_ONLY' as const,
        fromVersion:this.active.version,toVersion:parsed.version,
        checkedConsumers:visited.size,
        automaticActivationAllowed:false as const,
        tampermonkeyVerified:false as const,businessVerified:false as const
      });
    }catch{
      return blocked('INVALID_UPGRADE');
    }
  }
  /** Reverts only transient preview metadata. Never modifies script files. */
  rollbackPreview():boolean {
    const hadPreview=this.preview!==null;
    this.preview=null;
    return hadPreview;
  }
}
