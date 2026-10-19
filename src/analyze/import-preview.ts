/**
 * TASK-003 / REQ-004 / REQ-011: bounded local AST preview for user-imported
 * scripts. This never executes code, contacts a website, authenticates a
 * manager, or authorizes a patch. Only method names and source positions leave
 * the privileged importer: no selector strings, URLs, source or path content.
 */
import type {ImportedScript} from '../import/import-service';
import {parseUserscriptMetadata,readUserscriptSource,type MetadataStatus} from './metadata-parser';
import {analyzeSelectors,type SelectorKind} from './selector-analyzer';

export const MAX_ANALYSIS_BYTES=256*1024;
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
const flags={tampermonkeyVerified:false as const,
 businessVerified:false as const,automaticPatchAllowed:false as const};
export function unavailableImportPreview(status:ImportPreviewStatus,metadataStatus:ImportAnalysisPreview['metadataStatus']):
 ImportAnalysisPreview{
 return Object.freeze({status,metadataStatus,totalSites:0,literalSites:0,
   runtimeConfirmationSites:0,sites:Object.freeze([]),...flags});
}
/** A user script can be many MiB: do not parse large or deeply nested source
 * on Electron's main thread for a convenience preview. Larger scripts remain
 * importable, but need a later cancellable isolated AST analysis worker.
 */
export function previewImportedScriptAnalysis(
 script:Pick<ImportedScript,'bytes'|'textEncoding'>
):ImportAnalysisPreview{
 try{
  if(!(script?.bytes instanceof Uint8Array)||script.bytes.byteLength>MAX_ANALYSIS_BYTES)
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
  return Object.freeze({
   status:'STATIC_ANALYSIS_ONLY' as const,metadataStatus:metadata.status,
   totalSites:analysis.sites.length,
   literalSites:analysis.sites.filter(site=>site.kind==='literal').length,
   runtimeConfirmationSites:analysis.sites.filter(site=>site.kind!=='literal').length,
   sites:Object.freeze(visible),...flags
  });
 }catch{
  // Pathological syntax/depth and hostile objects do not reach the renderer.
  return unavailableImportPreview('PARSE_ERROR','NOT_CHECKED');
 }
}

/** Bound the synchronous AST budget for one native-picker/folder response.
 * A batch may contain 1000 approved files; full batch analysis belongs in a
 * future cancellable worker, not the privileged Electron main event loop.
 */
export function previewImportedBatch(
 scripts:readonly Pick<ImportedScript,'bytes'|'textEncoding'>[]
):ImportAnalysisPreview[]{
 let analyzedFiles=0;
 let bytesBudgetUsed=0;
 return scripts.map(script=>{
  if(!(script.bytes instanceof Uint8Array)||
     script.bytes.byteLength>MAX_ANALYSIS_BYTES)
   return previewImportedScriptAnalysis(script);
  if(analyzedFiles>=MAX_BATCH_PREVIEW_FILES||
     bytesBudgetUsed+script.bytes.byteLength>MAX_BATCH_PREVIEW_BYTES)
   return unavailableImportPreview('SKIPPED_BATCH_BUDGET','NOT_CHECKED');
  analyzedFiles++;
  bytesBudgetUsed+=script.bytes.byteLength;
  return previewImportedScriptAnalysis(script);
 });
}
