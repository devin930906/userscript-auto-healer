/**
 * TASK-014 / TEST-015/016: native desktop orchestration around the existing
 * provider services. The trusted main process supplies the native picker,
 * config reader and OS confirmation callbacks; none are renderer inputs.
 *
 * This module does not retain credentials or create provider traffic itself.
 * The discovery and review services remain responsible for requiring literal
 * native approval, applying request limits and preserving untrusted outputs.
 */
import {
  discoverModelsFromNativeConfig,
  type NativeModelDiscoveryResult
} from './native-model-discovery';
import {
  requestNativeReviewedAiSuggestion,
  type NativeAiReviewEvidence,
  type NativeReviewedSuggestionResult
} from './native-reviewed-suggestion';
import type {SuggestionRequestTarget} from './model-gateway';

export type NativeAiDesktopSelection=Readonly<{
  /** Resolve only a path returned by the native OS file picker; null is cancel. */
  selectConfigFile:()=>Promise<string|null>;
  /** Read the picked regular file through readNativeSelectedAiConfig. */
  readConfigFile:(path:string)=>Promise<string|null>;
  /** Persist only the remembered picker directory, never provider credentials. */
  rememberSelectedPath?:(path:string)=>void;
  /** Bound to the main window and the current browser/scenario lifecycle. */
  isRevoked:()=>boolean;
}>;

export type NativeAiDesktopReviewEvidence=NativeAiReviewEvidence;
export type NativeAiDesktopReviewAuthorizer=(
  origin:string,
  evidence:NativeAiDesktopReviewEvidence,
  target:SuggestionRequestTarget
)=>Promise<boolean>;

type SelectionResult=Readonly<{ok:true;configText:string}>|
  Readonly<{ok:false;code:'CANCELLED'|'INVALID_CONFIGURATION';automaticPatchAllowed:false}>;

const blocked=(code:'CANCELLED'|'INVALID_CONFIGURATION')=>
  Object.freeze({ok:false as const,code,automaticPatchAllowed:false as const});

function isRevoked(selection:NativeAiDesktopSelection):boolean{
  try{return selection.isRevoked()!==false;}
  catch{return true;}
}

/** Resolve one native-selected configuration while rechecking window/session
 * authority before and after every asynchronous boundary. File paths and
 * configuration text are never returned to the renderer.
 */
async function readSelectedConfig(
  selection:NativeAiDesktopSelection
):Promise<SelectionResult>{
  if(isRevoked(selection))return blocked('CANCELLED');
  const path=await selection.selectConfigFile();
  if(isRevoked(selection)||path===null)return blocked('CANCELLED');
  if(typeof path!=='string'||path.length===0||path.length>4096)
    return blocked('INVALID_CONFIGURATION');
  selection.rememberSelectedPath?.(path);
  if(isRevoked(selection))return blocked('CANCELLED');
  const configText=await selection.readConfigFile(path);
  if(isRevoked(selection))return blocked('CANCELLED');
  if(typeof configText!=='string'||configText.length===0)
    return blocked('INVALID_CONFIGURATION');
  return Object.freeze({ok:true as const,configText});
}

/** Exercise the same native picker/read/approval flow used by the IPC handler
 * without requiring an actual provider. Tests inject a local mock transport.
 */
export async function discoverNativeAiModelsFromDesktop(
  selection:NativeAiDesktopSelection,
  authorizeOrigin:(origin:string)=>Promise<boolean>,
  signal?:AbortSignal,
  transport:typeof fetch=fetch
):Promise<NativeModelDiscoveryResult>{
  const selected=await readSelectedConfig(selection);
  if(!selected.ok)return blocked(selected.code);
  if(isRevoked(selection))return blocked('CANCELLED');
  return await discoverModelsFromNativeConfig(
    selected.configText,authorizeOrigin,signal,transport);
}

/** Run one suggestion from an already-resolved, main-process-only receipt.
 * The provider service makes a separate origin+exact-target approval before
 * it sends the three fixed evidence fields; no source bytes enter this flow.
 */
export async function requestNativeAiSuggestionFromDesktop(
  selection:NativeAiDesktopSelection,
  evidence:NativeAiDesktopReviewEvidence,
  authorize:NativeAiDesktopReviewAuthorizer,
  signal?:AbortSignal,
  transport:typeof fetch=fetch
):Promise<NativeReviewedSuggestionResult>{
  const selected=await readSelectedConfig(selection);
  if(!selected.ok)return blocked(selected.code);
  if(isRevoked(selection))return blocked('CANCELLED');
  return await requestNativeReviewedAiSuggestion(
    selected.configText,evidence,authorize,signal,transport);
}
