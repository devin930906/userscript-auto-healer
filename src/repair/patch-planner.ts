/** TASK-009 / REQ-014 / REQ-019 / TEST-014 / TEST-019.
 * Conservative LOCAL proposal only. No files, browsers or userscript managers
 * are accessed; a proposal is NEVER evidence of a repaired script.
 */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {parse} from 'acorn';
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
  readonly method:'querySelector'|'querySelectorAll'|'getElementById';
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

/** An otherwise literal call may target a script-overridden selector method,
 * not the browser's native DOM API. Dynamic computed writes on document are
 * also ambiguous: their property key might be a selector method at runtime.
 * These checks intentionally apply across the entire source, as phase-one
 * proposals cannot prove execution order or alias/side-effect boundaries. */
/** A direct write through window/globalThis/self/top/parent.document may rebind the actual
 * browser document or override its native selector methods. Treat literal
 * global document aliases as the same untrusted target, including ['document'].
 * Dynamic aliases remain unsupported by the offline planner's scope model. */
function isGlobalDocumentMember(target:unknown):boolean{
  const member=asNode(target);
  if(member?.type!=='MemberExpression')return false;
  const host=asNode(member.object);
  if(host?.type!=='Identifier'||
     (host.name!=='window'&&host.name!=='globalThis'&&
      host.name!=='self'&&host.name!=='top'&&host.name!=='parent'))return false;
  const property=asNode(member.property);
  return member.computed===true?
    property?.type==='Literal'&&property.value==='document':
    property?.type==='Identifier'&&property.name==='document';
}

/** A selector inherited from Document.prototype may be replaced without
 * assigning a method directly on document. Phase-one offline review cannot
 * trust that target, including explicit global constructor spellings. */
/** Statically known property access only; dynamic aliases cannot prove which
 * native selector was touched and are blocked by the caller. */
function hasMemberName(node:AstNode,name:string):boolean{
  const key=asNode(node.property);
  return node.computed===true?
    key?.type==='Literal'&&key.value===name:
    key?.type==='Identifier'&&key.name===name;
}
function isDocumentReference(target:unknown):boolean{
  const node=asNode(target);
  return (node?.type==='Identifier'&&node.name==='document')||
    isGlobalDocumentMember(node);
}
/** Both direct Document.prototype and inherited-instance prototype paths
 * can mutate the native selector used by a later document.querySelector().
 * Object/Reflect.getPrototypeOf and __proto__ are treated as aliases only
 * when their receiver is the known global document; unrelated prototypes
 * remain eligible for review-only candidate generation. */
function isDocumentPrototype(target:unknown):boolean{
  const node=asNode(target);
  if(node?.type==='CallExpression'&&Array.isArray(node.arguments)&&
     node.arguments.length===1&&isDocumentReference(node.arguments[0])){
    const callee=asNode(node.callee);
    const host=asNode(callee?.object);
    return callee?.type==='MemberExpression'&&
      host?.type==='Identifier'&&
      (host.name==='Object'||host.name==='Reflect')&&
      hasMemberName(callee,'getPrototypeOf');
  }
  if(node?.type!=='MemberExpression')return false;
  if(hasMemberName(node,'__proto__')&&isDocumentReference(node.object))
    return true;
  if(!hasMemberName(node,'prototype'))return false;
  const ctor=asNode(node.object);
  if(ctor?.type==='Identifier')return ctor.name==='Document';
  if(ctor?.type!=='MemberExpression')return false;
  if(hasMemberName(ctor,'constructor')&&isDocumentReference(ctor.object))
    return true;
  const host=asNode(ctor.object);
  return host?.type==='Identifier'&&
    (host.name==='window'||host.name==='globalThis'||host.name==='self'||host.name==='top'||host.name==='parent')&&
    hasMemberName(ctor,'Document');
}

/** A computed global property whose name is not a static string may be
 * 'document' at runtime. Offline AST analysis must not silently promote
 * a selector call after such a mutation to a native-DOM repair candidate.
 * Ordinary read-only aliases and known unrelated literal keys remain allowed.
 */
function isDynamicGlobalDocumentAlias(target:unknown):boolean{
 const node=asNode(target);
 if(node?.type!=='MemberExpression'||node.computed!==true)return false;
 const host=asNode(node.object);
 if(host?.type!=='Identifier'||
    (host.name!=='window'&&host.name!=='globalThis'&&
      host.name!=='self'&&host.name!=='top'&&host.name!=='parent'))return false;
 const property=asNode(node.property);
 return property?.type!=='Literal'||typeof property.value!=='string';
}

function mayReplaceDomSelectorMethod(target:unknown):boolean{
  const member=asNode(target);
  if(member?.type!=='MemberExpression')return false;
  const object=asNode(member.object);
  if(!((object?.type==='Identifier'&&object.name==='document')||
       isGlobalDocumentMember(object)||isDynamicGlobalDocumentAlias(object)||
       isDocumentPrototype(object)))return false;
  const property=asNode(member.property);
  if(member.computed===true){
    if(property?.type!=='Literal'||typeof property.value!=='string')return true;
    return property.value==='querySelector'||property.value==='querySelectorAll'||
       property.value==='getElementById';
  }
  return property?.type==='Identifier'&&
    (property.name==='querySelector'||property.name==='querySelectorAll'||
      property.name==='getElementById');
}

/** In a literal Object.assign/defineProperties bag, only a known
 * non-document property can be ruled out. Spreads, dynamic names or an
 * unknown bag may replace the global document, so block conservatively. */
function mayContainDocumentProperty(value:unknown):boolean{
 const bag=asNode(value);
 if(bag?.type!=='ObjectExpression'||!Array.isArray(bag.properties))return true;
 for(const value of bag.properties){
  const entry=asNode(value);
  if(entry?.type!=='Property')return true;
  const key=asNode(entry.key);
  const name=entry.computed===true?
   (key?.type==='Literal'&&typeof key.value==='string'?key.value:null):
   (key?.type==='Identifier'?key.name:
    key?.type==='Literal'?String(key.value):null);
  if(name===null||name==='document')return true;
 }
 return false;
}

/** Reflective writes can replace either a native selector method or the
 * global document reference itself. Preserve unrelated known global keys,
 * but refuse ambiguous/dynamic property names and prototype replacements.
 * This is an offline conservative heuristic, never runtime attestation. */
function mayReflectivelyMutateDocument(node:AstNode):boolean{
 if(node.type!=='CallExpression'||!Array.isArray(node.arguments)||
    node.arguments.length===0)return false;
 const argument=asNode(node.arguments[0]);
 const firstIsDocument=argument?.type==='Identifier'&&argument.name==='document';
 const aliasedDocument=isGlobalDocumentMember(argument)||
   isDynamicGlobalDocumentAlias(argument);
 const documentPrototype=isDocumentPrototype(argument);
 const globalHost=argument?.type==='Identifier'&&
   (argument.name==='window'||argument.name==='globalThis'||
    argument.name==='self'||argument.name==='top'||argument.name==='parent');
 if(!firstIsDocument&&!aliasedDocument&&!documentPrototype&&!globalHost)return false;
 const callee=asNode(node.callee);
 if(callee?.type!=='MemberExpression')return false;
 const receiver=asNode(callee.object);
 if(receiver?.type!=='Identifier'||
    (receiver.name!=='Object'&&receiver.name!=='Reflect'))return false;
 const property=asNode(callee.property);
 const method=callee.computed===true?
   (property?.type==='Literal'&&typeof property.value==='string'?
      property.value:null):
   (property?.type==='Identifier'?property.name:null);
 if(typeof method!=='string')return true;
 const mutatesDocument=receiver.name==='Object'?
   ['defineProperty','defineProperties','assign','setPrototypeOf'].includes(method):
   ['defineProperty','set','deleteProperty','setPrototypeOf'].includes(method);
 if(!globalHost)return mutatesDocument;
 if(method==='setPrototypeOf')return true;
 if((receiver.name==='Object'&&method==='defineProperty')||
    (receiver.name==='Reflect'&&
     ['defineProperty','set','deleteProperty'].includes(method))){
  const key=asNode(node.arguments[1]);
  return key?.type!=='Literal'||typeof key.value!=='string'||
     key.value==='document';
 }
 if(receiver.name==='Object'&&
    (method==='assign'||method==='defineProperties'))
  return node.arguments.slice(1).some(mayContainDocumentProperty);
 return false;
}

/** Capturing the real document or its prototype into another variable can
 * let the script override querySelector through that alias, bypassing
 * direct document.method mutation checks. Phase-one review deliberately
 * rejects these aliases rather than assuming it can solve complete JS alias
 * and execution-order analysis. Read-only aliases may also be refused.
 */
function capturesMutableDocumentAlias(node:AstNode):boolean{
 const value=node.type==='VariableDeclarator'?node.init:
   node.type==='AssignmentExpression'||node.type==='AssignmentPattern'?
     node.right:undefined;
 return isDocumentReference(value)||isDocumentPrototype(value);
}

/** Capture destructuring aliases of global document / Document.prototype.
 * Object and array patterns hide aliases from ordinary identifier-assignment
 * checks. Until a verified JS binding/side-effect analysis exists, refuse
 * review-only candidates when such a reference could escape through a pattern.
 */
function isDocumentConstructorReference(target:unknown):boolean{
 const node=asNode(target);
 if(node?.type==='Identifier')return node.name==='Document';
 if(node?.type!=='MemberExpression')return false;
 if(hasMemberName(node,'constructor')&&isDocumentReference(node.object))
  return true;
 const host=asNode(node.object);
 return host?.type==='Identifier'&&
   (host.name==='window'||host.name==='globalThis'||host.name==='self'||host.name==='top'||host.name==='parent')&&
   hasMemberName(node,'Document');
}
function capturesDestructuredDocumentAlias(node:AstNode):boolean{
 if(node.type!=='VariableDeclarator'&&node.type!=='AssignmentExpression'&&
    node.type!=='AssignmentPattern')return false;
 const pattern=asNode(node.type==='VariableDeclarator'?node.id:node.left);
 const value=asNode(node.type==='VariableDeclarator'?node.init:node.right);
 if(!pattern||!value)return false;
 if(pattern.type==='ArrayPattern'&&value.type==='ArrayExpression')
  return Array.isArray(value.elements)&&value.elements.some(item=>
    isDocumentReference(item)||isDocumentPrototype(item));
 if(pattern.type!=='ObjectPattern')return false;
 const fromGlobal=value.type==='Identifier'&&
   (value.name==='window'||value.name==='globalThis'||value.name==='self'||value.name==='top'||value.name==='parent');
 const fromConstructor=isDocumentConstructorReference(value);
 if(!fromGlobal&&!fromConstructor)return false;
 if(!Array.isArray(pattern.properties))return true;
 return pattern.properties.some(item=>{
   const entry=asNode(item);
   // Object rest can carry a document/prototype reference. Dynamic property
   // keys may resolve to the sensitive key at runtime.
   if(entry?.type!=='Property')return true;
   const key=asNode(entry.key);
   if(entry.computed===true&&
      (key?.type!=='Literal'||typeof key.value!=='string'))return true;
   const name=key?.type==='Identifier'&&entry.computed!==true?key.name:
     key?.type==='Literal'?key.value:null;
   return name===(fromGlobal?'document':'prototype');
 });
}

/** Reject source whose `document` reference or selector methods cannot be
 * conservatively trusted. Direct eval and with-statements also make name
 * resolution ambiguous.
 * This does NOT prove all remaining calls use the native browser DOM API;
 * resulting proposals remain review-only, never automatically applicable. */
function ambiguousDocumentBinding(source:string):boolean{
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}) as unknown as AstNode;
  let ambiguous=false;
  // A computed global read can resolve to the native document. A merely
  // unused read is not a method mutation; preserve that existing safe case.
  // Once the value escapes into another expression, native-DOM provenance
  // cannot be established by the phase-one AST reviewer.
  const uncertainDocumentAliases=new Set<string>();
  function walk(node:AstNode):void{
    if(ambiguous)return;
    const capturedValue=node.type==='VariableDeclarator'?node.init:
      node.type==='AssignmentExpression'||node.type==='AssignmentPattern'?
        node.right:undefined;
    const capturedName=asNode(node.type==='VariableDeclarator'?node.id:
      node.type==='AssignmentExpression'||node.type==='AssignmentPattern'?
        node.left:undefined);
    const newAlias=isDynamicGlobalDocumentAlias(capturedValue);
    if(newAlias){
      if(capturedName?.type!=='Identifier'||typeof capturedName.name!=='string'){
        ambiguous=true;return;
      }
      uncertainDocumentAliases.add(capturedName.name);
    }
    if(node.type==='Identifier'&&uncertainDocumentAliases.has(node.name as string)){
      ambiguous=true;return;
    }
    if(node.type==='WithStatement'||capturesMutableDocumentAlias(node)||
       capturesDestructuredDocumentAlias(node)||
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
       (node.type==='AssignmentExpression'&&
        (bindsDocument(node.left)||isGlobalDocumentMember(node.left)||
         isDynamicGlobalDocumentAlias(node.left)||
         mayReplaceDomSelectorMethod(node.left)))||
       (node.type==='UpdateExpression'&&
        (bindsDocument(node.argument)||isGlobalDocumentMember(node.argument)||
         isDynamicGlobalDocumentAlias(node.argument)||
         mayReplaceDomSelectorMethod(node.argument)))||
       (node.type==='UnaryExpression'&&node.operator==='delete'&&
        (isGlobalDocumentMember(node.argument)||
         isDynamicGlobalDocumentAlias(node.argument)||
         mayReplaceDomSelectorMethod(node.argument)))||
       (node.type==='CallExpression'&&asNode(node.callee)?.type==='Identifier'&&
        asNode(node.callee)?.name==='eval')||
       mayReflectivelyMutateDocument(node)){
      ambiguous=true;return;
    }
    for(const [key,value] of Object.entries(node)){
      if(key==='start'||key==='end'||key==='loc'||key==='raw')continue;
      // Capturing the unknown value itself is not its later use. Do not
      // reclassify the declaration/assignment binding as a mutation.
      if(newAlias&&(key==='id'||key==='left'))continue;
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

const PATCH_REQUEST_FIELDS=[
 'source','expectedSourceSha256','callOffset','method',
 'originalSelector','replacementSelector','faultEvidenceId'
] as const;

/** Snapshot the seven exact own data properties before looking at a script.
 * A getter can modify or leak local data even when its return value is valid;
 * catching its exception AFTER evaluation cannot undo that side effect.
 * Reject accessors, extra approval claims, inherited fields, symbols,
 * class instances and Proxy inputs without executing their traps.
 */
function captureLiteralPatchRequest(input:unknown):LiteralPatchRequest|null{
 try{
  if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||
     Array.isArray(input))return null;
  const prototype=Object.getPrototypeOf(input);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.length!==PATCH_REQUEST_FIELDS.length||
     keys.some(key=>typeof key!=='string'||
       !PATCH_REQUEST_FIELDS.includes(key as typeof PATCH_REQUEST_FIELDS[number]))||
     PATCH_REQUEST_FIELDS.some(key=>
       !Object.prototype.hasOwnProperty.call(descriptors,key)||
       !Object.prototype.hasOwnProperty.call(descriptors[key],'value')))
    return null;
  // These are inert values, not property gets on the caller's object.
  return {
   source:descriptors.source.value,
   expectedSourceSha256:descriptors.expectedSourceSha256.value,
   callOffset:descriptors.callOffset.value,
   method:descriptors.method.value,
   originalSelector:descriptors.originalSelector.value,
   replacementSelector:descriptors.replacementSelector.value,
   faultEvidenceId:descriptors.faultEvidenceId.value
  } as LiteralPatchRequest;
 }catch{return null;}
}

/** Fail closed for dynamic selectors, false identity, fallbacks and unverified
 * source versions. A candidate does not grant file-write or auto-apply rights.
 */
export function proposeLiteralSelectorPatch(input:LiteralPatchRequest):LiteralPatchResult{
  try{
    const request=captureLiteralPatchRequest(input);
    if(!request||typeof request.source!=='string'||
       Buffer.byteLength(request.source,'utf8')>MAX_SOURCE_BYTES||
       !SHA256.test(request.expectedSourceSha256)||
       !Number.isSafeInteger(request.callOffset)||request.callOffset<0||
       !EVIDENCE_ID.test(request.faultEvidenceId)||
       (request.method!=='querySelector'&&request.method!=='querySelectorAll'&&
        request.method!=='getElementById')||
       typeof request.originalSelector!=='string'||
       typeof request.replacementSelector!=='string')
      return blocked('INVALID_INPUT');
    if(hash(request.source)!==request.expectedSourceSha256)return blocked('STALE_SOURCE');
    if(!SIMPLE_SELECTOR.test(request.originalSelector)||
       !SIMPLE_SELECTOR.test(request.replacementSelector)||
       request.originalSelector===request.replacementSelector||
       // getElementById takes a bare element ID rather than CSS syntax.
       (request.method==='getElementById'&&
        (!request.originalSelector.startsWith('#')||
         !request.replacementSelector.startsWith('#'))))
      return blocked('INVALID_CANDIDATE');
    // A loose search for header markers anywhere in the file can accept
    // ordinary JavaScript with an embedded, non-installable userscript header.
    // Use TASK-003's canonical metadata parser to require a genuine leading
    // userscript metadata block before proposing even a review-only diff.
    const metadata=parseUserscriptMetadata({
      bytes:Buffer.from(request.source,'utf8'),textEncoding:'utf-8'
    });
    if(metadata.status!=='OK')return blocked('INVALID_METADATA');
    // A text match on a shadowed document could patch an unrelated object.
    if(ambiguousDocumentBinding(request.source))return blocked('UNSUPPORTED_TARGET');
    const boundary=headerEnd(request.source);
    if(boundary===null||request.callOffset<=boundary)return blocked('INVALID_METADATA');
    const analysis=analyzeSelectors(request.source);
    if(analysis.status!=='OK')return blocked('UNSUPPORTED_SOURCE');
    const site=analysis.sites.find(s=>s.offset===request.callOffset);
    if(!site||site.kind!=='literal'||site.fallbackGroup!==null||
       site.method!==request.method||site.selector!==
       (request.method==='getElementById'?
        request.originalSelector.slice(1):request.originalSelector))
      return blocked('UNSUPPORTED_TARGET');
    const argument=findLiteralArgument(request.source,request.callOffset,request.method);
    const oldArg=request.method==='getElementById'?
      request.originalSelector.slice(1):request.originalSelector;
    const newArg=request.method==='getElementById'?
      request.replacementSelector.slice(1):request.replacementSelector;
    if(!argument||argument.start<=boundary||
       argument.value!==oldArg)
      return blocked('UNSUPPORTED_TARGET');
    const before=request.source.slice(argument.start,argument.end);
    const after=JSON.stringify(newArg);
    const candidateSource=request.source.slice(0,argument.start)+after+
      request.source.slice(argument.end);
    // A valid changed AST must still point to the intended single literal call.
    const verifiedAst=analyzeSelectors(candidateSource);
    const changedSite=verifiedAst.sites.find(s=>s.offset===request.callOffset);
    if(verifiedAst.status!=='OK'||verifiedAst.sites.length!==analysis.sites.length||
       changedSite?.method!==request.method||
       changedSite?.kind!=='literal'||
       changedSite.selector!==newArg||
       candidateSource.slice(0,boundary)!==request.source.slice(0,boundary))
      return blocked('UNSUPPORTED_SOURCE');
    return Object.freeze({
      status:'CANDIDATE_ONLY' as const,
      reason:'REQUIRES_REAL_MANAGER_AND_BUSINESS_VALIDATION' as const,
      originalSha256:request.expectedSourceSha256,
      candidateSha256:hash(candidateSource),
      faultEvidenceId:request.faultEvidenceId,
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
   if(nodeTypes.isProxy(untrustedCandidate))return blockedAudit('UNTRUSTED_CANDIDATE');
   if(!untrustedCandidate||typeof untrustedCandidate!=='object'||
      Array.isArray(untrustedCandidate))
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
   if(nodeTypes.isProxy(change))return blockedAudit('UNTRUSTED_CANDIDATE');
   if(!change||typeof change!=='object'||Array.isArray(change))
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
