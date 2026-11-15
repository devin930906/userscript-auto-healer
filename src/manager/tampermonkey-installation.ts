/** TASK-007 / REQ-017: read-only Tampermonkey installation metadata.
 *
 * This module inspects only the Chrome-owned chrome://extensions management UI
 * in a live, explicitly approved, application-owned Chrome session. It never
 * evaluates extension-origin pages or userscripts, installs/enables extensions,
 * reads user scripts, or claims Chrome Web Store provenance.
 */
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {TAMPERMONKEY_EXTENSION_ID} from './tampermonkey-adapter';

export type ManagerToggleState='ENABLED'|'DISABLED'|'UNKNOWN'|'NOT_APPLICABLE';

export type ManagerInstallationResult =
 | {readonly ok:true;readonly status:'NOT_INSTALLED';
    readonly extensionId:typeof TAMPERMONKEY_EXTENSION_ID;
    readonly extensionAuthenticityVerified:false;
    readonly storeProvenanceVerified:false;
    readonly versionVerified:false;
    readonly permissionVerified:false;
    readonly scriptInstallationVerified:false;
    readonly scriptInjectionVerified:false;
    readonly gmApiVerified:false;
    readonly businessVerified:false}
 | {readonly ok:true;readonly status:'INSTALLED_METADATA_HINT_ONLY';
    readonly manager:'Tampermonkey';
    readonly extensionId:typeof TAMPERMONKEY_EXTENSION_ID;
    readonly version:string;
    readonly enabled:ManagerToggleState;
    readonly allowUserScripts:ManagerToggleState;
    readonly extensionAuthenticityVerified:false;
    readonly storeProvenanceVerified:false;
    readonly versionVerified:true;
    readonly permissionVerified:boolean;
    readonly scriptInstallationVerified:false;
    readonly scriptInjectionVerified:false;
    readonly gmApiVerified:false;
    readonly businessVerified:false}
 | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'CANCELLED'|
    'UNVERIFIED_BROWSER'|'UNOWNED_LISTENER'|'CDP_FAILED'|
    'INSPECTION_UNAVAILABLE'|'INVALID_CDP_RESPONSE'};

export function parseTampermonkeyExtensionCardReceipt(
 _payload:unknown
):ManagerInstallationResult{
 return {ok:false,code:'INSPECTION_UNAVAILABLE'};
}

export function parseTampermonkeyUserScriptsReceipt(
 _payload:unknown,_chromeMajor:number
):ManagerToggleState{
 return 'UNKNOWN';
}

export async function inspectApprovedTampermonkeyInstallation(
 _session:ManagedLaunchResult,_userApproved:boolean,_signal?:AbortSignal
):Promise<ManagerInstallationResult>{
 return {ok:false,code:'INSPECTION_UNAVAILABLE'};
}
