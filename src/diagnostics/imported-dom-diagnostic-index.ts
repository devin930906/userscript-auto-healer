/** Main-owned index of bounded AST hints for later consented DOM-only checks.
 * This index contains neither source bytes nor file paths and grants no browser
 * or userscript authority by itself. */
import {types as nodeTypes} from 'node:util';
import {matchingExactOriginPattern} from '../manager/tampermonkey-preflight';
import {normalizeScenarioTargetUrl} from '../scenarios/scenario-registry';
import type {ImportedDomDiagnosticHints} from '../analyze/import-preview';

const HASH=/^[a-f0-9]{64}$/;
const MAX_IMPORTED_SCRIPTS=1000;
const MAX_MATCH_PATTERNS=16;
const MAX_SELECTOR_SITES=8;
const MAX_SELECTOR_LENGTH=256;
export type ImportedDomPlanCode=
 'INVALID_TARGET_URL'|'NO_LITERAL_SELECTORS'|'UNSUPPORTED_MATCH_RULES'|
 'NO_MATCH_METADATA'|'TARGET_NOT_MATCHED'|'SELECTOR_LIMIT_EXCEEDED';
export type ImportedDomPlanItem=
 |Readonly<{ordinal:number;scriptSha256:string;status:'READY_FOR_INSPECTION';
   filename:string|null;targetUrl:string;
   selectorSites:readonly ImportedDomDiagnosticHints['selectorSites'][number][]}>
 |Readonly<{ordinal:number;scriptSha256:string;filename:string|null;
   status:'BLOCKED';code:ImportedDomPlanCode}>;
export interface ImportedDomPlan{
 readonly targetUrl:string|null;
 readonly items:readonly ImportedDomPlanItem[];
 readonly truncatedScripts:boolean;
}
interface Profile{readonly hash:string;readonly filename:string|null;
 readonly hints:ImportedDomDiagnosticHints|null}

function ownData(value:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const own=Reflect.ownKeys(descriptors);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string')||
     keys.some(key=>!Object.prototype.hasOwnProperty.call(descriptors,key)||
       !Object.prototype.hasOwnProperty.call(descriptors[key],'value')))return null;
  const copy:Record<string,unknown>=Object.create(null);
  for(const key of keys)copy[key]=descriptors[key].value;
  return copy;
 }catch{return null;}
}
function ownArray(value:unknown,maximum:number):unknown[]|null{
 try{
  if(nodeTypes.isProxy(value)||!Array.isArray(value)||
     Object.getPrototypeOf(value)!==Array.prototype)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const length:unknown=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(typeof length!=='number'||!Number.isSafeInteger(length)||
     length<0||length>maximum||Reflect.ownKeys(descriptors).length!==length+1)return null;
  const result:unknown[]=[];
  for(let index=0;index<length;index++){
   const slot=descriptors[String(index)];
   if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return null;
   result.push(slot.value);
  }
  return result;
 }catch{return null;}
}
function snapshotHints(value:unknown):ImportedDomDiagnosticHints|null{
 const hints=ownData(value,['matchPatterns','unsupportedScope','selectorSites',
  'selectorSitesTruncated']);
 if(!hints||typeof hints.unsupportedScope!=='boolean'||
    typeof hints.selectorSitesTruncated!=='boolean')return null;
 const patterns=ownArray(hints.matchPatterns,MAX_MATCH_PATTERNS);
 const rawSites=ownArray(hints.selectorSites,MAX_SELECTOR_SITES);
 if(!patterns||!rawSites)return null;
 const matchPatterns:string[]=[];
 const seenPatterns=new Set<string>();
 for(const item of patterns){
  if(typeof item!=='string'||item.length<1||item.length>1024||
     /[\u0000-\u001f\u007f]/.test(item)||seenPatterns.has(item))return null;
  seenPatterns.add(item);matchPatterns.push(item);
 }
 const selectorSites:ImportedDomDiagnosticHints['selectorSites'][number][]=[];
 const seenSelectors=new Set<string>();
 for(const item of rawSites){
  const site=ownData(item,['offset','method','selector']);
  if(!site||typeof site.offset!=='number'||!Number.isSafeInteger(site.offset)||
     site.offset<0||site.offset>512*1024||
     (site.method!=='querySelector'&&site.method!=='querySelectorAll')||
     typeof site.selector!=='string'||site.selector.length<1||
     site.selector.length>MAX_SELECTOR_LENGTH||
     /[\u0000-\u001f\u007f]/.test(site.selector)||
     seenSelectors.has(site.selector))return null;
  seenSelectors.add(site.selector);
  selectorSites.push(Object.freeze({offset:site.offset,method:site.method,
   selector:site.selector}));
 }
 return Object.freeze({matchPatterns:Object.freeze(matchPatterns),
  unsupportedScope:hints.unsupportedScope,
  selectorSites:Object.freeze(selectorSites),
  selectorSitesTruncated:hints.selectorSitesTruncated});
}

/** The native importer calls this after it has validated the source bytes.
 * Renderer IPC has no route to this method or to this main-owned index. */
export class ImportedDomDiagnosticIndex{
 private readonly profiles=new Map<string,Profile>();
 private truncatedScripts=false;
 recordImported(hash:unknown,hints:unknown,filename:unknown=null):void{
  if(typeof hash!=='string'||!HASH.test(hash))return;
  const label=typeof filename==='string'&&filename.length>0&&filename.length<=255&&
   !/[\u0000-\u001f\u007f/\\:]/.test(filename)?filename:null;
  const safeHints=hints===null||hints===undefined?null:snapshotHints(hints);
  const previous=this.profiles.get(hash);
  if(previous){
   if(!previous.hints&&safeHints)
    this.profiles.set(hash,Object.freeze({hash,filename:previous.filename??label,hints:safeHints}));
   return;
  }
  if(this.profiles.size>=MAX_IMPORTED_SCRIPTS){this.truncatedScripts=true;return;}
  this.profiles.set(hash,Object.freeze({hash,filename:label,hints:safeHints}));
 }
 plan(targetInput:unknown):ImportedDomPlan{
  const normalizedUrl=normalizeScenarioTargetUrl(targetInput);
  let target:URL|null=null;
  try{
   if(normalizedUrl){
    const parsed=new URL(normalizedUrl);
    if(!parsed.hash)target=parsed;
   }
  }catch{target=null;}
  const targetUrl=target?normalizedUrl:null;
  const items:ImportedDomPlanItem[]=[];
  let ordinal=0;
  for(const profile of this.profiles.values()){
   const base={ordinal:ordinal++,scriptSha256:profile.hash,
    filename:profile.filename} as const;
   const blocked=(code:ImportedDomPlanCode):ImportedDomPlanItem=>
    Object.freeze({...base,status:'BLOCKED' as const,code});
   if(!targetUrl||!target){items.push(blocked('INVALID_TARGET_URL'));continue;}
   const hints=profile.hints;
   if(!hints||hints.selectorSites.length===0){
    items.push(blocked('NO_LITERAL_SELECTORS'));continue;
   }
   if(hints.unsupportedScope){items.push(blocked('UNSUPPORTED_MATCH_RULES'));continue;}
   if(hints.selectorSitesTruncated){items.push(blocked('SELECTOR_LIMIT_EXCEEDED'));continue;}
   if(hints.matchPatterns.length===0){items.push(blocked('NO_MATCH_METADATA'));continue;}
   if(!hints.matchPatterns.some(pattern=>matchingExactOriginPattern(pattern,target))){
    items.push(blocked('TARGET_NOT_MATCHED'));continue;
   }
   items.push(Object.freeze({...base,status:'READY_FOR_INSPECTION' as const,
    targetUrl,selectorSites:hints.selectorSites}));
  }
  return Object.freeze({targetUrl,items:Object.freeze(items),
   truncatedScripts:this.truncatedScripts});
 }
}

