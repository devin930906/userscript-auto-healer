/** TASK-009 / REQ-014 / REQ-019 / TEST-014 / TEST-019.
 * Conservative LOCAL proposal only. No files, browsers or userscript managers
 * are accessed; a proposal is NEVER evidence of a repaired script.
 */
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {types as utilTypes} from 'node:util';
import {analyzeSelectors} from '../analyze/selector-analyzer';
import {parseUserscriptMetadata} from '../analyze/metadata-parser';

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

/** A textual `document.querySelector` is not evidence of a browser DOM call
 * when source code can rebind `document`. Phase-one candidates intentionally
 * reject the entire source if ANY such binding is present: scope analysis and
 * execution order are not verified by this offline repair planner. */
function bindsDocument(pattern:unknown):boolean{
  const node=asNode(pattern);
  if(!node)return false;
  switch(node.type){
    case 'Identifier':return node.name==='document';
    case 'RestElement':return bindsDocument(node.argument);
    case 'AssignmentPattern':return bindsDocument(node.left);
    case 'Property':return bindsDocument(node.value);
    case 'ArrayPattern':
      return Array.isArray(node.elements)&&node.elements.some(bindsDocument);
    case 'ObjectPattern':
      return Array.isArray(node.properties)&&node.properties.some(bindsDocument);
    default:return false;
  }
}

/** Reject source whose `document` reference cannot be conservatively trusted.
 * Direct eval and with-statements also make name resolution ambiguous.
 * This does NOT prove all remaining calls use the native browser DOM API;
 * resulting proposals remain review-only, never automatically applicable. */
function ambiguousDocumentBinding(source:string):boolean{
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}) as unknown as AstNode;
  let ambiguous=false;
  function walk(node:AstNode):void{
    if(ambiguous)return;
    if(node.type==='WithStatement'||
       (node.type==='VariableDeclarator'&&bindsDocument(node.id))||
       (node.type==='CatchClause'&&bindsDocument(node.param))||
       ((node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||
         node.type==='ArrowFunctionExpression')&&
        (bindsDocument(node.id)||
         (Array.isArray(node.params)&&node.params.some(bindsDocument))))||
       ((node.type==='ClassDeclaration'||node.type==='ClassExpression')&&
        bindsDocument(node.id))||
       // for-in/of assignment targets can rebind the global document without
       // appearing as AssignmentExpression nodes in the parsed AST.
       ((node.type==='ForInStatement'||node.type==='ForOfStatement')&&
        bindsDocument(node.left))||
       (node.type==='AssignmentExpression'&&bindsDocument(node.left))||
       (node.type==='UpdateExpression'&&bindsDocument(node.argument))||
       (node.type==='CallExpression'&&asNode(node.callee)?.type==='Identifier'&&
        asNode(node.callee)?.name==='eval')){
      ambiguous=true;return;
    }
    for(const [key,value] of Object.entries(node)){
      if(key==='start'||key==='end'||key==='loc'||key==='raw')continue;
      if(Array.isArray(value)){
        for(const item of value){const child=asNode(item);if(child)walk(child);}
      }else{
        const child=asNode(value);if(child)walk(child);
      }
    }
  }
  walk(ast);
  return ambiguous;
}

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
    if(!input||typeof input!=='object'||utilTypes.isProxy(input)||
       typeof input.source!=='string'||
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
    // A loose search for header markers anywhere in the file can accept
    // ordinary JavaScript with an embedded, non-installable userscript header.
    // Use TASK-003's canonical metadata parser to require a genuine leading
    // userscript metadata block before proposing even a review-only diff.
    const metadata=parseUserscriptMetadata({
      bytes:Buffer.from(input.source,'utf8'),textEncoding:'utf-8'
    });
    if(metadata.status!=='OK')return blocked('INVALID_METADATA');
    // A text match on a shadowed document could patch an unrelated object.
    if(ambiguousDocumentBinding(input.source))return blocked('UNSUPPORTED_TARGET');
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


/** TASK-009 / REQ-019 / TEST-019: independently recheck a candidate at the
 * local review boundary, treating even a planner-shaped object as untrusted.
 *
 * This checks one deterministic, AST-anchored edit against the original
 * request. It does NOT authenticate any manager, diagnose a real website,
 * authorize a file write, or declare recovery. Always require TASK-010/011
 * acceptance + transactional backup before a future application path.
 */
export type CandidateAuditResult=
 |Readonly<{
    status:'BLOCKED';
    reason:'PLANNER_REJECTED'|'UNTRUSTED_CANDIDATE'|'CANDIDATE_MISMATCH';
    automaticPatchAllowed:false;tampermonkeyVerified:false;
    businessRecoveredVerified:false;
  }>
 |Readonly<{
    status:'REVIEWABLE_ONLY';
    originalSha256:string;candidateSha256:string;faultEvidenceId:string;
    /** Source and selector text are deliberately absent from audit receipts. */
    change:Readonly<{start:number;end:number}>;
    automaticPatchAllowed:false;tampermonkeyVerified:false;
    businessRecoveredVerified:false;
  }>;

function blockedAudit(reason:Extract<CandidateAuditResult,{status:'BLOCKED'}>['reason']):
 CandidateAuditResult {
 return Object.freeze({status:'BLOCKED' as const,reason,
   automaticPatchAllowed:false as const,tampermonkeyVerified:false as const,
   businessRecoveredVerified:false as const});
}
const candidateFields=[
 'status','reason','originalSha256','candidateSha256','faultEvidenceId',
 'candidateSource','change','automaticPatchAllowed','tampermonkeyVerified',
 'businessRecoveredVerified'
].sort();
const changeFields=['start','end','before','after'].sort();

/** Re-generates the permitted edit; never trusts claimed hashes or diffs.
 * A successful result is a limited integrity receipt, not write permission.
 */
export function auditProposedLiteralSelectorPatch(
 request:LiteralPatchRequest,untrustedCandidate:unknown
):CandidateAuditResult {
 try{
   const expected=proposeLiteralSelectorPatch(request);
   if(expected.status!=='CANDIDATE_ONLY')return blockedAudit('PLANNER_REJECTED');
   if(!untrustedCandidate||typeof untrustedCandidate!=='object'||
      utilTypes.isProxy(untrustedCandidate)||Array.isArray(untrustedCandidate))
     return blockedAudit('UNTRUSTED_CANDIDATE');
   // Read own data descriptors, not getters. Symbols, extra approval fields,
   // prototype tricks and unknown fields are never admitted as audit input.
   const obj=untrustedCandidate as object;
   const proto=Object.getPrototypeOf(obj);
   if(proto!==Object.prototype&&proto!==null)
     return blockedAudit('UNTRUSTED_CANDIDATE');
   const fields=Object.getOwnPropertyDescriptors(obj);
   const keys=Reflect.ownKeys(fields);
   if(keys.some(k=>typeof k!=='string')||
      keys.length!==candidateFields.length||
      (keys as string[]).sort().some((k,i)=>k!==candidateFields[i]))
     return blockedAudit('UNTRUSTED_CANDIDATE');
   const field=(key:string):unknown=>{
     const d=fields[key];
     if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))
       throw Error('untrusted candidate field');
     return d.value;
   };
   const change=field('change');
   if(!change||typeof change!=='object'||utilTypes.isProxy(change)||
      Array.isArray(change))
     return blockedAudit('UNTRUSTED_CANDIDATE');
   const changeProto=Object.getPrototypeOf(change);
   if(changeProto!==Object.prototype&&changeProto!==null)
     return blockedAudit('UNTRUSTED_CANDIDATE');
   const parts=Object.getOwnPropertyDescriptors(change);
   const partKeys=Reflect.ownKeys(parts);
   if(partKeys.some(k=>typeof k!=='string')||
      partKeys.length!==changeFields.length||
      (partKeys as string[]).sort().some((k,i)=>k!==changeFields[i])||
      changeFields.some(k=>!Object.prototype.hasOwnProperty.call(parts[k],'value')))
     return blockedAudit('UNTRUSTED_CANDIDATE');

   if(field('status')!==expected.status||field('reason')!==expected.reason||
      field('originalSha256')!==expected.originalSha256||
      field('candidateSha256')!==expected.candidateSha256||
      field('faultEvidenceId')!==expected.faultEvidenceId||
      field('candidateSource')!==expected.candidateSource||
      field('automaticPatchAllowed')!==false||
      field('tampermonkeyVerified')!==false||
      field('businessRecoveredVerified')!==false||
      changeFields.some(k=>
        parts[k].value!==expected.change[k as keyof typeof expected.change]))
     return blockedAudit('CANDIDATE_MISMATCH');
   return Object.freeze({
     status:'REVIEWABLE_ONLY' as const,
     originalSha256:expected.originalSha256,
     candidateSha256:expected.candidateSha256,
     faultEvidenceId:expected.faultEvidenceId,
     change:Object.freeze({start:expected.change.start,end:expected.change.end}),
     automaticPatchAllowed:false as const,tampermonkeyVerified:false as const,
     businessRecoveredVerified:false as const
   });
 }catch{
   return blockedAudit('UNTRUSTED_CANDIDATE');
 }
}
