/** TASK-007 / TEST-017: conservative preflight for a consented Tampermonkey GM test.
 * This function checks caller-supplied metadata ONLY. The caller is untrusted:
 * neither a valid shape nor a reported installed/enabled script can attest a
 * Chrome extension, GM_getValue invocation, or website business behavior.
 * Actual TEST-017/018 must use independently observed browser execution.
 */
import {types as nodeTypes} from 'node:util';
import type {MetadataResult} from '../analyze/metadata-parser';
import type {ManagerPresenceResult} from './tampermonkey-adapter';
import {TAMPERMONKEY_EXTENSION_ID} from './tampermonkey-adapter';

export type TampermonkeyPreflightCode =
 'NOT_AUTHORIZED'|'INVALID_INPUT'|'RUNTIME_NOT_OBSERVED'|'WRONG_MANAGER'|
 'VERSION_NOT_REPORTED'|'MANAGER_NOT_ENABLED'|'USERSCRIPTS_PERMISSION_UNKNOWN'|
 'USERSCRIPTS_NOT_ALLOWED'|'SCRIPT_NOT_REPORTED_ENABLED'|'INVALID_SCRIPT_METADATA'|
 'GM_GRANT_NOT_DECLARED'|'MATCH_NOT_CONFIRMED'|'RUN_AT_NOT_CONFIRMED'|
 'INJECTION_CONTEXT_NOT_CONFIRMED'|'EXTERNAL_RESOURCES_UNVERIFIED';
export type TampermonkeyPreflightResult =
 | {readonly ok:false;readonly status:'BLOCKED';readonly code:TampermonkeyPreflightCode;
    readonly gmApiVerified:false;readonly businessVerified:false}
 | {readonly ok:true;readonly status:'METADATA_ELIGIBLE_ONLY';
    readonly extensionId:typeof TAMPERMONKEY_EXTENSION_ID;
    readonly reportedVersion:string;readonly scriptMatchPattern:string;
    readonly extensionAuthenticityVerified:false;readonly scriptInstallationVerified:false;
    readonly gmApiVerified:false;readonly businessVerified:false};

/** Values from an independent browser adapter. They are *reports*, not proof.
 * Do not accept this payload as a successful business or GM execution receipt.
 */
export interface ReportedTampermonkeyState {
 readonly extensionId:unknown;
 readonly version:unknown;
 readonly enabled:unknown;
 readonly userScriptsPermission:unknown;
 readonly userScriptsAllowed:unknown;
 readonly scriptInstalled:unknown;
 readonly scriptEnabled:unknown;
}

/** Only confirm an exact-origin, prefix-matching @match pattern.
 * Wildcard hosts, regex @include and broader match semantics are UNKNOWN until
 * checked in the actual manager; never guess coverage for a website.
 */
export function matchingExactOriginPattern(pattern:unknown,target:URL):boolean {
 if(typeof pattern!=='string'||pattern.length>1024)return false;
 const match=/^(https?):\/\/([a-z0-9.-]+)(\/[^\s]*)$/i.exec(pattern);
 if(!match||match[2].startsWith('.')||match[2].endsWith('.')||match[2].includes('..')||
    match[2].includes('*')||match[2].includes(':'))return false;
 if(target.protocol!==match[1].toLowerCase()+':'||
    target.hostname!==match[2].toLowerCase())return false;
 // Chrome-style @match patterns contain no port component. Our disposable
 // GM fixture binds to a random loopback port and performs an independent
 // exact-origin runtime check; its metadata must not be rejected merely for
 // that port. Keep remote/non-loopback nonstandard ports fail-closed: this
 // preflight is not authority to install or execute a userscript.
 if(target.port&&!(target.protocol==='http:'&&target.hostname==='127.0.0.1'&&
    match[2].toLowerCase()==='127.0.0.1'))return false;
 // A wildcard at the end of the path is a conservative, literal prefix;
 // other wildcards require true manager-based matching.
 const path=match[3];
 // Chrome content-script match paths include the URL query. Ignoring it
 // would incorrectly accept exact @match paths on queried pages.
 const pathAndQuery=target.pathname+target.search;
 if(path==='/*')return true;
 if(path.includes('*')&&(!path.endsWith('*')||path.slice(0,-1).includes('*')))return false;
 if(!path.endsWith('*'))return pathAndQuery===path;
 return pathAndQuery.startsWith(path.slice(0,-1));
}
function blocked(code:TampermonkeyPreflightCode):TampermonkeyPreflightResult {
 return {ok:false,status:'BLOCKED',code,gmApiVerified:false,businessVerified:false};
}
/** Positive result authorizes NO installation, injection, file edit or network call. */
function inspectReportedTampermonkeyPreflightUnchecked(
 runtime:ManagerPresenceResult,
 report:ReportedTampermonkeyState,
 metadata:MetadataResult,
 targetUrl:string,
 userApproved:boolean
):TampermonkeyPreflightResult {
 if(userApproved!==true)return blocked('NOT_AUTHORIZED');
 if(!runtime||runtime.ok!==true||runtime.status!=='RUNTIME_TARGET_HINT_ONLY'||
    runtime.extensionId!==TAMPERMONKEY_EXTENSION_ID)return blocked('RUNTIME_NOT_OBSERVED');
 if(!report||typeof report!=='object'||Array.isArray(report)||
    typeof targetUrl!=='string'||targetUrl.length>4096)return blocked('INVALID_INPUT');
 if(report.extensionId!==TAMPERMONKEY_EXTENSION_ID)return blocked('WRONG_MANAGER');
 if(typeof report.version!=='string'||!/^[0-9]{1,4}(?:\.[0-9]{1,4}){1,3}$/.test(report.version))
    return blocked('VERSION_NOT_REPORTED');
 if(report.enabled!==true)return blocked('MANAGER_NOT_ENABLED');
 if(report.userScriptsPermission!==true)return blocked('USERSCRIPTS_PERMISSION_UNKNOWN');
 if(report.userScriptsAllowed!==true)return blocked('USERSCRIPTS_NOT_ALLOWED');
 if(report.scriptInstalled!==true||report.scriptEnabled!==true)
    return blocked('SCRIPT_NOT_REPORTED_ENABLED');
 if(!metadata||metadata.status!=='OK'||!metadata.tags||
    !Array.isArray(metadata.unknownNames)||metadata.unknownNames.length!==0||
    !Array.isArray(metadata.tags.grant)||!Array.isArray(metadata.tags.match))
    return blocked('INVALID_SCRIPT_METADATA');
 // The consented GM_getValue fixture has only one authorized GM capability.
 // Other grants, including duplicated declarations, need a separate review.
 if(metadata.tags.grant.length!==1||metadata.tags.grant[0]!=='GM_getValue')
    return blocked('GM_GRANT_NOT_DECLARED');
 // A missing @run-at uses the manager default, but an explicit unsupported,
 // empty or contradictory instruction cannot be inferred from static metadata.
 // This is only metadata eligibility: actual injection timing remains unverified.
 const runAt=metadata.tags['run-at'];
 if(runAt!==undefined&&(!Array.isArray(runAt)||runAt.length!==1||
    !['document-start','document-body','document-end','document-idle'].includes(runAt[0])))
    return blocked('RUN_AT_NOT_CONFIRMED');
 // This narrowly consented GM diagnostic does not interpret alternate
 // execution wrappers. @unwrap is a KNOWN tag, so unknownNames cannot
 // block it. A malformed or duplicated @noframes also leaves iframe
 // injection semantics uncertain. Neither case can pass even metadata-only
 // eligibility before actual Tampermonkey sandbox and injection testing.
 if(metadata.tags.unwrap!==undefined||
    (metadata.tags.noframes!==undefined&&
     (metadata.tags.noframes.length!==1||metadata.tags.noframes[0]!=='')))
    return blocked('INJECTION_CONTEXT_NOT_CONFIRMED');
 // @require and @resource may fetch and execute/use dependencies beyond the
 // isolated test fixture. Do not implicitly approve any remote code/resources
 // on a caller-supplied installation report.
 const requires=metadata.tags.require;
 const resources=metadata.tags.resource;
 const connects=metadata.tags.connect;
 const updateUrl=metadata.tags.updateurl;
 const downloadUrl=metadata.tags.downloadurl;
 // Manager UI icons may trigger additional resource loading on install or
 // display. Treat both recognized icon forms as unverified dependencies;
 // do not silently extend the consented, network-isolated GM preflight.
 const icon=metadata.tags.icon;
 const icon64=metadata.tags.icon64;
 // A reported successful @match does not authorize additional outbound
 // contacts, remote code/resource loading or self-update supply chains.
 if(requires!==undefined||resources!==undefined||connects!==undefined||
    updateUrl!==undefined||downloadUrl!==undefined||icon!==undefined||icon64!==undefined)
    return blocked('EXTERNAL_RESOURCES_UNVERIFIED');
 let target:URL;
 try{target=new URL(targetUrl);}catch{return blocked('INVALID_INPUT');}
 if(!['http:','https:'].includes(target.protocol)||!target.hostname||
    target.username||target.password||target.hash)return blocked('INVALID_INPUT');
 // @exclude can overrule @match. Conservatively refuse it until a real
 // extension test evaluates manager-specific exclusion/precedence rules.
 if(metadata.tags.include!==undefined||
    (metadata.tags.exclude?.length??0)>0||
    (metadata.tags['exclude-match']?.length??0)>0)
    return blocked('MATCH_NOT_CONFIRMED');
 // This explicitly consented GM fixture must not silently inject on extra
 // sites. Even one matching entry cannot bless a second @match (or duplicate).
 if(metadata.tags.match.length!==1)return blocked('MATCH_NOT_CONFIRMED');
 const pattern=metadata.tags.match[0];
 if(!matchingExactOriginPattern(pattern,target))return blocked('MATCH_NOT_CONFIRMED');
 return {ok:true,status:'METADATA_ELIGIBLE_ONLY',
   extensionId:TAMPERMONKEY_EXTENSION_ID,reportedVersion:report.version,
   scriptMatchPattern:pattern,extensionAuthenticityVerified:false,
   scriptInstallationVerified:false,gmApiVerified:false,businessVerified:false};
}


/** Copy only plain own data descriptors at the untrusted IPC/report boundary.
 * In particular, a nonthrowing getter cannot become a valid manager report.
 * Reject proxies before reflecting their keys (proxy traps can have effects).
 */
function plainDataSnapshot(input:unknown):Record<string,unknown>|null {
 if(!input||typeof input!=='object'||Array.isArray(input)||nodeTypes.isProxy(input))
  return null;
 const prototype=Object.getPrototypeOf(input);
 if(prototype!==Object.prototype&&prototype!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const names=Reflect.ownKeys(descriptors);
 if(names.length>128||names.some(name=>typeof name!=='string'))return null;
 const result:Record<string,unknown>=Object.create(null);
 for(const name of names){
  const descriptor=descriptors[name as string];
  if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))
   return null;
  result[name as string]=descriptor.value;
 }
 return result;
}
/** @grant, @match and the unknown-tag list are arrays supplied by metadata.
 * Snapshot each string slot without iterating or invoking index getters.
 */
function stringListSnapshot(input:unknown):string[]|null {
 if(!Array.isArray(input)||nodeTypes.isProxy(input)||
    Object.getPrototypeOf(input)!==Array.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const count=Object.getOwnPropertyDescriptor(input,'length')?.value;
 if(!Number.isSafeInteger(count)||count<0||count>8192||
    Reflect.ownKeys(descriptors).length!==count+1)return null;
 const values:string[]=[];
 for(let i=0;i<count;i++){
  const descriptor=descriptors[String(i)];
  if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value')||
     typeof descriptor.value!=='string')return null;
  values.push(descriptor.value);
 }
 return values;
}

/** Fail closed on hostile accessors or revoked proxies passed through a
 * serialized report boundary. A malformed report grants no browser action.
 */
export function inspectReportedTampermonkeyPreflight(
 runtime:ManagerPresenceResult,
 report:ReportedTampermonkeyState,
 metadata:MetadataResult,
 targetUrl:string,
 userApproved:boolean
):TampermonkeyPreflightResult {
 if(userApproved!==true)return blocked('NOT_AUTHORIZED');
 try{
  const safeRuntime=plainDataSnapshot(runtime);
  const safeReport=plainDataSnapshot(report);
  const safeMetadata=plainDataSnapshot(metadata);
  if(!safeRuntime||!safeReport||!safeMetadata)
   return blocked('INVALID_INPUT');
  const rawTags=plainDataSnapshot(safeMetadata.tags);
  const unknownNames=stringListSnapshot(safeMetadata.unknownNames);
  if(!rawTags||!unknownNames)return blocked('INVALID_INPUT');
  const tags:Record<string,string[]>=Object.create(null);
  for(const [name,rawValues] of Object.entries(rawTags)){
   const values=stringListSnapshot(rawValues);
   if(!values)return blocked('INVALID_INPUT');
   tags[name]=values;
  }
  return inspectReportedTampermonkeyPreflightUnchecked(
   safeRuntime as unknown as ManagerPresenceResult,
   safeReport as unknown as ReportedTampermonkeyState,
   {...safeMetadata,tags,unknownNames} as unknown as MetadataResult,
   targetUrl,true);
 }catch{return blocked('INVALID_INPUT');}
}
