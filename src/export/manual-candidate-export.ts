/**
 * TASK-012 / REQ-023 / TEST-023 (limited native-only manual export).
 *
 * Export a rechecked, independently backed-up AST literal candidate as a
 * separately named .user.js for a human to import. Never alter the original,
 * install into Tampermonkey, claim business recovery, or authorize auto-apply.
 * Only a privileged native caller may select these filesystem paths.
 */
import {createHash,randomUUID} from 'node:crypto';
import {link,lstat,open} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,sep} from 'node:path';
import {types as nodeTypes} from 'node:util';
import type {BigIntStats} from 'node:fs';
import {removeOwnedStagingPending} from '../version/staging-pending-ownership';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../repair/patch-planner';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {verifyStagedCandidateReadOnly} from '../version/staged-candidate-recheck';
import {verifyExactCandidateBytesReadOnly} from '../version/candidate-bytes';
import {hasUnsafePathLink} from '../version/path-boundary';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'REVIEW_REJECTED'|
 'RECHECK_FAILED'|'UNSAFE_DESTINATION'|'EXPORT_FAILED';
const noAuthority={
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,
 managerInstalled:false as const,
 businessVerified:false as const
};
export type ManualCandidateExportResult=
 |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
 |Readonly<{status:'EXPORTED_RUNTIME_UNVERIFIED';exportFileName:string;recoveryExportFileName:string;
   candidateSha256:string;byteLength:number}&typeof noAuthority>;
const block=(reason:Reason):ManualCandidateExportResult=>
 Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});
type Options={sourcePath:string;backupDirectory:string;exportDirectory:string;
 userApproved:boolean};
const optionNames=['sourcePath','backupDirectory','exportDirectory','userApproved'];
const receiptNames=[
 'status','backupFileName','candidateFileName','originalSha256',
 'candidateSha256','candidateByteLength','automaticPatchAllowed',
 'automaticRollbackAllowed','tampermonkeyVerified','businessVerified'
];
const requestNames=[
 'source','expectedSourceSha256','callOffset','method','originalSelector',
 'replacementSelector','faultEvidenceId'
];
function plain(input:unknown,names:readonly string[]):Record<string,unknown>|null{
 // Reject Proxy before invoking its observable reflection traps.
 if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||
    Array.isArray(input))return null;
 const proto=Object.getPrototypeOf(input);
 if(proto!==Object.prototype&&proto!==null)return null;
 const desc=Object.getOwnPropertyDescriptors(input);
 const keys=Reflect.ownKeys(desc);
 if(keys.length!==names.length||keys.some(k=>typeof k!=='string')||
    names.some(k=>!Object.prototype.hasOwnProperty.call(desc,k)||
      !Object.prototype.hasOwnProperty.call(desc[k],'value')))return null;
 const out:Record<string,unknown>=Object.create(null);
 for(const name of names)out[name]=desc[name].value;
 return out;
}
function absolute(value:unknown):value is string{
 return typeof value==='string'&&value.length>0&&value.length<=4096&&
   !value.includes('\0')&&isAbsolute(value);
}
function sameDir(a:BigIntStats,b:BigIntStats):boolean{
 return a.isDirectory()&&b.isDirectory()&&a.dev===b.dev&&a.ino===b.ino;
}
/** A manually installable candidate must not be placed anywhere inside the
 * protected backup store, including a child directory. Compare complete path
 * components, not string prefixes (which would reject unrelated siblings).
 * Symlink/junction ancestry is separately rejected before any file write.
 */
export function insideProtectedBackup(backup:string,destination:string):boolean{
 const suffix=relative(backup,destination);
 return suffix===''||
   (suffix!=='..'&&!suffix.startsWith('..'+sep)&&!isAbsolute(suffix));
}
/** A successful receipt establishes only a separately readable export;
 * the user still must deliberately install/update the userscript and test
 * its behavior inside the real Tampermonkey environment.
 */
export async function exportReviewedCandidateForManualInstall(
 untrustedRequest:unknown,untrustedReceipt:unknown,untrustedOptions:unknown
):Promise<ManualCandidateExportResult>{
 try{
  const raw=plain(untrustedOptions,optionNames);
  const receipt=plain(untrustedReceipt,receiptNames);
  const requestFields=plain(untrustedRequest,requestNames);
  if(!raw||!receipt||!requestFields||
     !absolute(raw.sourcePath)||!absolute(raw.backupDirectory)||
     !absolute(raw.exportDirectory)||
     !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(raw.sourcePath))||
     typeof raw.userApproved!=='boolean')return block('INVALID_REQUEST');
  if(!raw.userApproved)return block('NOT_AUTHORIZED');
  const options:Options={
    sourcePath:raw.sourcePath,backupDirectory:raw.backupDirectory,
    exportDirectory:raw.exportDirectory,userApproved:true
  };
  if(insideProtectedBackup(options.backupDirectory,options.exportDirectory))
    return block('UNSAFE_DESTINATION');
  const request=requestFields as unknown as LiteralPatchRequest;
  const proposal=proposeLiteralSelectorPatch(request);
  if(proposal.status!=='CANDIDATE_ONLY')return block('REVIEW_REJECTED');
  const bytes=Buffer.from(proposal.candidateSource,'utf8');
  if(!bytes.length||bytes.length>MAX_SCRIPT_BYTES)return block('REVIEW_REJECTED');
  const nativeOptions={
    sourcePath:options.sourcePath,
    backupDirectory:options.backupDirectory,userApproved:true
  };
  const before=await verifyStagedCandidateReadOnly(request,receipt,nativeOptions);
  if(before.status!=='CANDIDATE_RECHECKED_READ_ONLY')
    return block('RECHECK_FAILED');
  if(before.candidateSha256!==proposal.candidateSha256||
     before.candidateByteLength!==bytes.length)return block('RECHECK_FAILED');

  // A manual export goes to a separate user-selected directory, not the
  // original scripts directory or the protected backup/checkpoint store.
  for(const path of [options.exportDirectory,options.backupDirectory,
                     dirname(options.sourcePath)]){
    if(await hasUnsafePathLink(path))return block('UNSAFE_DESTINATION');
  }
  const exportBefore=await lstat(options.exportDirectory,{bigint:true});
  const backupDir=await lstat(options.backupDirectory,{bigint:true});
  const sourceDir=await lstat(dirname(options.sourcePath),{bigint:true});
  if(!exportBefore.isDirectory()||exportBefore.isSymbolicLink()||
     sameDir(exportBefore,backupDir)||sameDir(exportBefore,sourceDir))
    return block('UNSAFE_DESTINATION');
  const name='UAH-Reviewed-'+proposal.candidateSha256.slice(0,12)+'-'+
    randomUUID()+'.user.js';
  const pending=join(options.exportDirectory,'.'+randomUUID()+'.pending');
  const final=join(options.exportDirectory,name);
  let pendingExists=false;
  let pendingIdentity:BigIntStats|undefined;
  try{
    const handle=await open(pending,'wx',0o600);
    pendingExists=true;
    try{
      await handle.writeFile(bytes);await handle.sync();
      pendingIdentity=await handle.stat({bigint:true});
    }
    finally{await handle.close();}
    if(await verifyExactCandidateBytesReadOnly(pending,bytes)!=='MATCH')
      return block('EXPORT_FAILED');
    if(await hasUnsafePathLink(options.exportDirectory))
      return block('UNSAFE_DESTINATION');
    const beforePublish=await lstat(options.exportDirectory,{bigint:true});
    if(!sameDir(exportBefore,beforePublish)||beforePublish.isSymbolicLink())
      return block('UNSAFE_DESTINATION');
    // No overwrite, never rename over an unknown file; unsupported hard links
    // cause a conservative failure instead of an unsafe fallback.
    await link(pending,final);
    // A failed publication must never unlink a foreign replacement at the
    // staging pathname. Confirm the source inode and both hard-link names
    // in the originally selected native export directory before retiring it.
    if(!pendingIdentity||!await removeOwnedStagingPending(
        pending,pendingIdentity,exportBefore,final))
      return block('EXPORT_FAILED');
    pendingExists=false;
    if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
      return block('EXPORT_FAILED');
    if(await hasUnsafePathLink(options.exportDirectory))
      return block('UNSAFE_DESTINATION');
    const afterExport=await lstat(options.exportDirectory,{bigint:true});
    if(!sameDir(exportBefore,afterExport)||afterExport.isSymbolicLink())
      return block('UNSAFE_DESTINATION');
    const after=await verifyStagedCandidateReadOnly(
      request,receipt,nativeOptions);
    if(after.status!=='CANDIDATE_RECHECKED_READ_ONLY'||
       after.candidateSha256!==proposal.candidateSha256)
      return block('RECHECK_FAILED');
    // Another process could change the exported bytes during rechecks.
    if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
      return block('EXPORT_FAILED');

    // TASK-011/012: accompany the manually reviewed patch with an independent
    // original-version recovery export. This is NOT a restore: the installed
    // userscript, native-selected source and Tampermonkey are never changed.
    // Source bytes come from the audited original AST request, not from a
    // caller-supplied backup pathname or a renderer request. They must still
    // match the separate verified backup checked above.
    const originalBytes=Buffer.from(request.source,'utf8');
    if(!originalBytes.length||originalBytes.length>MAX_SCRIPT_BYTES||
       createHash('sha256').update(originalBytes).digest('hex')!==proposal.originalSha256)
      return block('RECHECK_FAILED');
    const recoveryName='UAH-Original-'+proposal.originalSha256.slice(0,12)+'-'+
      randomUUID()+'.user.js';
    const recoveryPending=join(options.exportDirectory,'.'+randomUUID()+'.pending');
    const recoveryFinal=join(options.exportDirectory,recoveryName);
    let recoveryPendingExists=false;
    let recoveryPendingIdentity:BigIntStats|undefined;
    try{
      const handle=await open(recoveryPending,'wx',0o600);
      recoveryPendingExists=true;
      try{
        await handle.writeFile(originalBytes);await handle.sync();
        recoveryPendingIdentity=await handle.stat({bigint:true});
      }
      finally{await handle.close();}
      if(await verifyExactCandidateBytesReadOnly(recoveryPending,originalBytes)!=='MATCH')
        return block('EXPORT_FAILED');
      if(await hasUnsafePathLink(options.exportDirectory))
        return block('UNSAFE_DESTINATION');
      const recoveryDirBefore=await lstat(options.exportDirectory,{bigint:true});
      if(!sameDir(exportBefore,recoveryDirBefore)||
         recoveryDirBefore.isSymbolicLink())return block('UNSAFE_DESTINATION');
      // Hard-link publication is no-clobber and keeps the previously staged
      // candidate intact even if this recovery export fails.
      await link(recoveryPending,recoveryFinal);
      if(!recoveryPendingIdentity||!await removeOwnedStagingPending(
          recoveryPending,recoveryPendingIdentity,exportBefore,recoveryFinal))
        return block('EXPORT_FAILED');
      recoveryPendingExists=false;
      if(await verifyExactCandidateBytesReadOnly(recoveryFinal,originalBytes)!=='MATCH')
        return block('EXPORT_FAILED');
      const afterRecovery=await verifyStagedCandidateReadOnly(
        request,receipt,nativeOptions);
      if(afterRecovery.status!=='CANDIDATE_RECHECKED_READ_ONLY'||
         afterRecovery.candidateSha256!==proposal.candidateSha256||
         afterRecovery.originalSha256!==proposal.originalSha256)
        return block('RECHECK_FAILED');
      if(await hasUnsafePathLink(options.exportDirectory))
        return block('UNSAFE_DESTINATION');
      const recoveryDirAfter=await lstat(options.exportDirectory,{bigint:true});
      if(!sameDir(exportBefore,recoveryDirAfter)||
         recoveryDirAfter.isSymbolicLink()||
         await verifyExactCandidateBytesReadOnly(recoveryFinal,originalBytes)!=='MATCH'||
         await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
        return block('EXPORT_FAILED');
    }finally{
      if(recoveryPendingExists&&recoveryPendingIdentity)
        await removeOwnedStagingPending(
          recoveryPending,recoveryPendingIdentity,exportBefore);
      // Unknown replacements and published but unverified files remain for
      // explicit reconciliation; pathname alone grants no cleanup authority.
    }
    return Object.freeze({
      status:'EXPORTED_RUNTIME_UNVERIFIED' as const,
      exportFileName:name,recoveryExportFileName:recoveryName,
      candidateSha256:proposal.candidateSha256,
      byteLength:bytes.length,...noAuthority
    });
  }catch{return block('EXPORT_FAILED');}
  finally{
    if(pendingExists&&pendingIdentity)
      await removeOwnedStagingPending(pending,pendingIdentity,exportBefore);
    // Unknown replacements and published but unverified files are preserved.
  }
 }catch{
  // Do not leak user script bytes, absolute paths or native exception text.
  return block('EXPORT_FAILED');
 }
}
