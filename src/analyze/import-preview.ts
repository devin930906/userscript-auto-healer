/**
 * TASK-003 / REQ-004 / REQ-011: bounded local AST preview for user-imported
 * scripts. This never executes code, contacts a website, authenticates a
 * manager, or authorizes a patch. Public summaries expose only method names
 * and source positions. The isolated Worker may return bounded selector hints
 * to Electron main for a later consented DOM probe; those hints must never be
 * forwarded to the renderer or stored in a journal.
 */
import type {ImportedScript} from '../import/import-service';
import {parseUserscriptMetadata,readUserscriptSource,type MetadataStatus} from './metadata-parser';
import {analyzeSelectors,type SelectorKind} from './selector-analyzer';

export const MAX_ANALYSIS_BYTES=256*1024;
export const MAX_ISOLATED_ANALYSIS_BYTES=512*1024;
const MAX_VISIBLE_SITES=8;
export const MAX_BATCH_PREVIEW_BYTES=1024*1024;
export const MAX_BATCH_PREVIEW_FILES=16;
export type ImportPreviewStatus=
 'STATIC_ANALYSIS_ONLY'|'SKIPPED_TOO_LARGE'|'INVALID_ENCODING'|
 'INVALID_METADATA'|'PARSE_ERROR'|'SKIPPED_BATCH_BUDGET'|
 'SKIPPED_CANCELLED'|'ISOLATED_ANALYSIS_FAILED';
export interface ImportSelectorPreview {
 readonly line:number;
 readonly column:number;
 readonly method:string;
 readonly kind:SelectorKind;
}
/** Privileged main-only hints used to prepare a bounded, consented DOM probe.
 * This data must be removed before any renderer IPC or persisted journal. */
export interface ImportedDomDiagnosticHints {
 readonly matchPatterns:readonly string[];
 readonly unsupportedScope:boolean;
 readonly selectorSites:readonly Readonly<{
  offset:number;method:'querySelector'|'querySelectorAll';selector:string
 }>[];
 readonly selectorSitesTruncated:boolean;
}
export interface ImportAnalysisPreview {
 readonly status:ImportPreviewStatus;
 readonly metadataStatus:MetadataStatus|'NOT_CHECKED';
 readonly totalSites:number;
 readonly literalSites:number;
 readonly runtimeConfirmationSites:number;
 readonly sites:readonly ImportSelectorPreview[];
 readonly tampermonkeyVerified:false;
 readonly businessVerified:false;
 readonly automaticPatchAllowed:false;
}
/** Exact isolated-worker wire shape. The parent validates and moves hints into
 * a WeakMap keyed by the sanitized preview object; they never become preview
 * properties that renderer summaries can accidentally serialize. */
export type IsolatedImportAnalysisPreview=ImportAnalysisPreview&Readonly<{
 diagnosticHints:ImportedDomDiagnosticHints|null
}>;
const flags={tampermonkeyVerified:false as const,
 businessVerified:false as const,automaticPatchAllowed:false as const};
export function unavailableImportPreview(status:ImportPreviewStatus,metadataStatus:ImportAnalysisPreview['metadataStatus']):
 ImportAnalysisPreview{
 return Object.freeze({status,metadataStatus,totalSites:0,literalSites:0,
   runtimeConfirmationSites:0,sites:Object.freeze([]),...flags});
}
/** Keep direct synchronous preview and manual repair within the smaller budget. */
export function previewImportedScriptAnalysis(
 script:Pick<ImportedScript,'bytes'|'textEncoding'>
):ImportAnalysisPreview{
 return previewScript(script,MAX_ANALYSIS_BYTES);
}

function previewScript(
 script:Pick<ImportedScript,'bytes'|'textEncoding'>,maxBytes:number,
 includeDiagnosticHints=false
):ImportAnalysisPreview&{diagnosticHints?:ImportedDomDiagnosticHints}{
 try{
  if(!(script?.bytes instanceof Uint8Array)||script.bytes.byteLength>maxBytes)
    return unavailableImportPreview('SKIPPED_TOO_LARGE','NOT_CHECKED');
  const metadata=parseUserscriptMetadata(script);
  if(metadata.status==='INVALID_ENCODING')
    return unavailableImportPreview('INVALID_ENCODING',metadata.status);
  if(metadata.status!=='OK')
    return unavailableImportPreview('INVALID_METADATA',metadata.status);
  const source=readUserscriptSource(script);
  if(source===null)return unavailableImportPreview('INVALID_ENCODING',metadata.status);
  const analysis=analyzeSelectors(source);
  if(analysis.status!=='OK')return unavailableImportPreview('PARSE_ERROR',metadata.status);
  const visible=analysis.sites.slice(0,MAX_VISIBLE_SITES).map(site=>Object.freeze({
   line:site.line,column:site.column,method:site.method,kind:site.kind
  }));
  const diagnosticHints=includeDiagnosticHints
   ?buildDiagnosticHints(metadata.tags,metadata.unknownNames,analysis.sites)
   :undefined;
  return Object.freeze({
   status:'STATIC_ANALYSIS_ONLY' as const,metadataStatus:metadata.status,
   totalSites:analysis.sites.length,
   literalSites:analysis.sites.filter(site=>site.kind==='literal').length,
   runtimeConfirmationSites:analysis.sites.filter(site=>site.kind!=='literal').length,
   sites:Object.freeze(visible),...flags,
   ...(diagnosticHints?{diagnosticHints}: {})
  });
 }catch{
  // Pathological syntax/depth and hostile objects do not reach the renderer.
  return unavailableImportPreview('PARSE_ERROR','NOT_CHECKED');
 }
}

const MAX_DIAGNOSTIC_MATCH_PATTERNS=16;
const MAX_DIAGNOSTIC_SELECTOR_SITES=8;
const MAX_DIAGNOSTIC_SELECTOR_LENGTH=256;
function buildDiagnosticHints(
 tags:Readonly<Record<string,string[]>>,unknownNames:readonly string[],
 sites:ReturnType<typeof analyzeSelectors>['sites']
):ImportedDomDiagnosticHints{
 const rawPatterns=tags.match??[];
 const patterns:string[]=[];
 const seenPatterns=new Set<string>();
 let invalidPattern=false;
 for(const pattern of rawPatterns){
  if(typeof pattern!=='string'||pattern.length===0||pattern.length>1024||
     /[\u0000-\u001f\u007f]/.test(pattern)){
   invalidPattern=true;
   continue;
  }
  if(seenPatterns.has(pattern))continue;
  seenPatterns.add(pattern);
  if(patterns.length<MAX_DIAGNOSTIC_MATCH_PATTERNS)patterns.push(pattern);
 }
 const unsupportedScope=unknownNames.length>0||invalidPattern||
  tags.include!==undefined||tags.exclude!==undefined||
  tags['exclude-match']!==undefined||
  patterns.length<seenPatterns.size||
  seenPatterns.size>MAX_DIAGNOSTIC_MATCH_PATTERNS;
 const seen=new Set<string>();
 const selectorSites:ImportedDomDiagnosticHints['selectorSites'][number][]=[];
 let selectorSitesTruncated=false;
 for(const site of sites){
  if(site.kind!=='literal'||site.fallbackGroup!==null||
     (site.method!=='querySelector'&&site.method!=='querySelectorAll')||
     typeof site.selector!=='string'||!site.selector||
     site.selector.length>MAX_DIAGNOSTIC_SELECTOR_LENGTH||
     /[\u0000-\u001f\u007f]/.test(site.selector)||seen.has(site.selector))continue;
  if(selectorSites.length>=MAX_DIAGNOSTIC_SELECTOR_SITES){
   selectorSitesTruncated=true;
   continue;
  }
  seen.add(site.selector);
  selectorSites.push(Object.freeze({offset:site.offset,
   method:site.method as 'querySelector'|'querySelectorAll',selector:site.selector}));
 }
 return Object.freeze({
  matchPatterns:Object.freeze(patterns),unsupportedScope,
  selectorSites:Object.freeze(selectorSites),selectorSitesTruncated
 });
}

/** Only the isolated worker uses this larger per-file budget. */
export function previewIsolatedImportedBatch(
 scripts:readonly Pick<ImportedScript,'bytes'|'textEncoding'>[]
):IsolatedImportAnalysisPreview[]{
 let analyzedFiles=0;
 let bytesBudgetUsed=0;
 return scripts.map(script=>{
  if(!(script.bytes instanceof Uint8Array)||
     script.bytes.byteLength>MAX_ISOLATED_ANALYSIS_BYTES)
   return Object.freeze({...unavailableImportPreview('SKIPPED_TOO_LARGE','NOT_CHECKED'),
    diagnosticHints:null});
  if(analyzedFiles>=MAX_BATCH_PREVIEW_FILES||
     bytesBudgetUsed+script.bytes.byteLength>MAX_BATCH_PREVIEW_BYTES)
   return Object.freeze({...unavailableImportPreview('SKIPPED_BATCH_BUDGET','NOT_CHECKED'),
    diagnosticHints:null});
  analyzedFiles++;
  bytesBudgetUsed+=script.bytes.byteLength;
  const preview=previewScript(script,MAX_ISOLATED_ANALYSIS_BYTES,true);
  return Object.freeze({...preview,diagnosticHints:preview.diagnosticHints??null});
 });
}

