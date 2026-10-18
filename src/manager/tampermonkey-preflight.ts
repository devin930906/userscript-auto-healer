/** TASK-007 / TEST-017: conservative preflight for a consented Tampermonkey GM test.
 * This function checks caller-supplied metadata ONLY. The caller is untrusted:
 * neither a valid shape nor a reported installed/enabled script can attest a
 * Chrome extension, GM_getValue invocation, or website business behavior.
 * Actual TEST-017/018 must use independently observed browser execution.
 */
import type {MetadataResult} from '../analyze/metadata-parser';
import type {ManagerPresenceResult} from './tampermonkey-adapter';
import {TAMPERMONKEY_EXTENSION_ID} from './tampermonkey-adapter';

export type TampermonkeyPreflightCode =
 'NOT_AUTHORIZED'|'INVALID_INPUT'|'RUNTIME_NOT_OBSERVED'|'WRONG_MANAGER'|
 'VERSION_NOT_REPORTED'|'MANAGER_NOT_ENABLED'|'USERSCRIPTS_PERMISSION_UNKNOWN'|
 'USERSCRIPTS_NOT_ALLOWED'|'SCRIPT_NOT_REPORTED_ENABLED'|'INVALID_SCRIPT_METADATA'|
 'GM_GRANT_NOT_DECLARED'|'MATCH_NOT_CONFIRMED';
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
function matchingExactOriginPattern(pattern:unknown,target:URL):boolean {
 if(typeof pattern!=='string'||pattern.length>1024)return false;
 const match=/^(https?):\/\/([a-z0-9.-]+)(\/[^\s]*)$/i.exec(pattern);
 if(!match||match[2].startsWith('.')||match[2].endsWith('.')||match[2].includes('..')||
    match[2].includes('*')||match[2].includes(':'))return false;
 if(target.protocol!==match[1].toLowerCase()+':'||target.hostname!==match[2].toLowerCase()||
    target.port)return false;
 // A wildcard at the end of the path is a conservative, literal prefix;
 // other wildcards require true manager-based matching.
 const path=match[3];
 if(path==='/*')return true;
 if(path.indexOf('*')!==path.length-1||path.slice(0,-1).includes('*'))return false;
 const prefix=path.endsWith('*')?path.slice(0,-1):path;
 return target.pathname.startsWith(prefix);
}
function blocked(code:TampermonkeyPreflightCode):TampermonkeyPreflightResult {
 return {ok:false,status:'BLOCKED',code,gmApiVerified:false,businessVerified:false};
}
/** Positive result authorizes NO installation, injection, file edit or network call. */
export function inspectReportedTampermonkeyPreflight(
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
    !Array.isArray(metadata.tags.grant)||!Array.isArray(metadata.tags.match))
    return blocked('INVALID_SCRIPT_METADATA');
 if(!metadata.tags.grant.includes('GM_getValue'))return blocked('GM_GRANT_NOT_DECLARED');
 let target:URL;
 try{target=new URL(targetUrl);}catch{return blocked('INVALID_INPUT');}
 if(!['http:','https:'].includes(target.protocol)||!target.hostname||
    target.username||target.password||target.hash)return blocked('INVALID_INPUT');
 // @exclude can overrule @match. Conservatively refuse it until a real
 // extension test evaluates manager-specific exclusion/precedence rules.
 if((metadata.tags.exclude?.length??0)>0||(metadata.tags['exclude-match']?.length??0)>0)
    return blocked('MATCH_NOT_CONFIRMED');
 const pattern=metadata.tags.match.find(value=>matchingExactOriginPattern(value,target));
 if(!pattern)return blocked('MATCH_NOT_CONFIRMED');
 return {ok:true,status:'METADATA_ELIGIBLE_ONLY',
   extensionId:TAMPERMONKEY_EXTENSION_ID,reportedVersion:report.version,
   scriptMatchPattern:pattern,extensionAuthenticityVerified:false,
   scriptInstallationVerified:false,gmApiVerified:false,businessVerified:false};
}
