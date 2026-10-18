/** TASK-009 / REQ-014 / REQ-019 / TEST-014 / TEST-019.
 * Conservative LOCAL proposal only. No files, browsers or userscript managers
 * are accessed; a proposal is NEVER evidence of a repaired script.
 */
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {analyzeSelectors} from '../analyze/selector-analyzer';

const SHA256=/^[a-f0-9]{64}$/;
const EVIDENCE_ID=/^[A-Za-z0-9_-]{1,64}$/;
// Intentionally tiny phase-one subset: no combinators, escapes, pseudo-classes,
// attribute selectors or generated JavaScript. Unsupported cases need review.
const SIMPLE_SELECTOR=/^[#.][A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const MAX_SOURCE_BYTES=8*1024*1024;

export interface LiteralPatchRequest {
  readonly source:string;
  readonly expectedSourceSha256:string;
  /** Acorn/SelectorSite CallExpression start offset (UTF-16 index). */
  readonly callOffset:number;
  readonly method:'querySelector'|'querySelectorAll';
  readonly originalSelector:string;
  readonly replacementSelector:string;
  /** Opaque diagnostic reference only, NOT authorization to apply a change. */
  readonly faultEvidenceId:string;
}
export type PatchBlockReason =
  'INVALID_INPUT'|'STALE_SOURCE'|'INVALID_METADATA'|
  'UNSUPPORTED_SOURCE'|'UNSUPPORTED_TARGET'|'INVALID_CANDIDATE';
export interface BlockedLiteralPatch {
  readonly status:'BLOCKED';
  readonly reason:PatchBlockReason;
  readonly automaticPatchAllowed:false;
  readonly tampermonkeyVerified:false;
  readonly businessRecoveredVerified:false;
}
export interface ProposedLiteralPatch {
  readonly status:'CANDIDATE_ONLY';
  readonly reason:'REQUIRES_REAL_MANAGER_AND_BUSINESS_VALIDATION';
  readonly originalSha256:string;
  readonly candidateSha256:string;
  readonly faultEvidenceId:string;
  /** Entire candidate source is local-only and must never be logged or sent. */
  readonly candidateSource:string;
  readonly change:Readonly<{start:number;end:number;before:string;after:string}>;
  readonly automaticPatchAllowed:false;
  readonly tampermonkeyVerified:false;
  readonly businessRecoveredVerified:false;
}
export type LiteralPatchResult=BlockedLiteralPatch|ProposedLiteralPatch;
type AstNode={type:string;start?:number;end?:number;[key:string]:unknown};
const asNode=(value:unknown):AstNode|null=>
  value!==null&&typeof value==='object'&&typeof (value as AstNode).type==='string'
    ?value as AstNode:null;
const hash=(source:string)=>createHash('sha256').update(source,'utf8').digest('hex');
const blocked=(reason:PatchBlockReason):BlockedLiteralPatch=>Object.freeze({
  status:'BLOCKED',reason,automaticPatchAllowed:false,
  tampermonkeyVerified:false,businessRecoveredVerified:false
});

/** Only locate the *actual AST argument token*, never global string-replace. */
function findLiteralArgument(
  source:string,offset:number,method:string
):{start:number;end:number;value:string}|null{
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}) as unknown as AstNode;
  let found:{start:number;end:number;value:string}|null=null;
  function visit(node:AstNode):void{
    if(node.type==='CallExpression'&&node.start===offset){
      const callee=asNode(node.callee);
      const object=asNode(callee?.object);
      const property=asNode(callee?.property);
      const args=node.arguments;
      if(callee?.type==='MemberExpression'&&callee.computed===false&&
         object?.type==='Identifier'&&object.name==='document'&&
         property?.type==='Identifier'&&property.name===method&&
         Array.isArray(args)&&args.length===1){
        const argument=asNode(args[0]);
        if(argument?.type==='Literal'&&typeof argument.value==='string'&&
           Number.isSafeInteger(argument.start)&&Number.isSafeInteger(argument.end)&&
           argument.start!>=0&&argument.end!<=source.length){
          found={start:argument.start!,end:argument.end!,value:argument.value};
        }
      }
    }
    for(const [key,value] of Object.entries(node)){
      if(key==='start'||key==='end'||key==='loc'||key==='raw')continue;
      if(Array.isArray(value)){
        for(const item of value){const child=asNode(item);if(child)visit(child);}
      }else{
        const child=asNode(value);if(child)visit(child);
      }
    }
  }
  visit(ast);
  return found;
}
function headerEnd(source:string):number|null{
  const start=/^[ \t]*\/\/[ \t]*==UserScript==[ \t]*\r?$/gm.exec(source);
  const close=/^[ \t]*\/\/[ \t]*==\/UserScript==[ \t]*\r?$/gm.exec(source);
  return start&&close&&close.index>start.index?close.index+close[0].length:null;
}

/** Fail closed for dynamic selectors, false identity, fallbacks and unverified
 * source versions. A candidate does not grant file-write or auto-apply rights.
 */
export function proposeLiteralSelectorPatch(input:LiteralPatchRequest):LiteralPatchResult{
  try{
    if(!input||typeof input!=='object'||typeof input.source!=='string'||
       Buffer.byteLength(input.source,'utf8')>MAX_SOURCE_BYTES||
       !SHA256.test(input.expectedSourceSha256)||
       !Number.isSafeInteger(input.callOffset)||input.callOffset<0||
       !EVIDENCE_ID.test(input.faultEvidenceId)||
       (input.method!=='querySelector'&&input.method!=='querySelectorAll')||
       typeof input.originalSelector!=='string'||
       typeof input.replacementSelector!=='string')
      return blocked('INVALID_INPUT');
    if(hash(input.source)!==input.expectedSourceSha256)return blocked('STALE_SOURCE');
    if(!SIMPLE_SELECTOR.test(input.originalSelector)||
       !SIMPLE_SELECTOR.test(input.replacementSelector)||
       input.originalSelector===input.replacementSelector)
      return blocked('INVALID_CANDIDATE');
    const boundary=headerEnd(input.source);
    if(boundary===null||input.callOffset<=boundary)return blocked('INVALID_METADATA');
    const analysis=analyzeSelectors(input.source);
    if(analysis.status!=='OK')return blocked('UNSUPPORTED_SOURCE');
    const site=analysis.sites.find(s=>s.offset===input.callOffset);
    if(!site||site.kind!=='literal'||site.fallbackGroup!==null||
       site.method!==input.method||site.selector!==input.originalSelector)
      return blocked('UNSUPPORTED_TARGET');
    const argument=findLiteralArgument(input.source,input.callOffset,input.method);
    if(!argument||argument.start<=boundary||
       argument.value!==input.originalSelector)
      return blocked('UNSUPPORTED_TARGET');
    const before=input.source.slice(argument.start,argument.end);
    const after=JSON.stringify(input.replacementSelector);
    const candidateSource=input.source.slice(0,argument.start)+after+
      input.source.slice(argument.end);
    // A valid changed AST must still point to the intended single literal call.
    const verifiedAst=analyzeSelectors(candidateSource);
    const changedSite=verifiedAst.sites.find(s=>s.offset===input.callOffset);
    if(verifiedAst.status!=='OK'||verifiedAst.sites.length!==analysis.sites.length||
       changedSite?.method!==input.method||
       changedSite?.kind!=='literal'||
       changedSite.selector!==input.replacementSelector||
       candidateSource.slice(0,boundary)!==input.source.slice(0,boundary))
      return blocked('UNSUPPORTED_SOURCE');
    return Object.freeze({
      status:'CANDIDATE_ONLY' as const,
      reason:'REQUIRES_REAL_MANAGER_AND_BUSINESS_VALIDATION' as const,
      originalSha256:input.expectedSourceSha256,
      candidateSha256:hash(candidateSource),
      faultEvidenceId:input.faultEvidenceId,
      candidateSource,
      change:Object.freeze({start:argument.start,end:argument.end,before,after}),
      automaticPatchAllowed:false as const,
      tampermonkeyVerified:false as const,
      businessRecoveredVerified:false as const
    });
  }catch{
    // Parser errors, hostile accessors and oversized/deep ASTs expose no data.
    return blocked('UNSUPPORTED_SOURCE');
  }
}
