/** TASK-011 / REQ-019/020/021 / TEST-019/020/021.
 * Revalidate a previously staged review-only selector patch against the
 * original .user.js, its independent backup and the candidate's actual bytes.
 * This is a native-only, non-mutating observation. Never expose arbitrary
 * paths via renderer IPC. An untrusted approval bool is NOT authenticated
 * consent, a verified receipt expires immediately, and no GM/business test
 * or write/restore authorization is inferred.
 */

import {basename,isAbsolute,join} from 'node:path';
import {lstat} from 'node:fs/promises';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import type {BigIntStats} from 'node:fs';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../repair/patch-planner';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';
import {backupPrefix} from './verified-backup';
import {hasUnsafePathLink} from './path-boundary';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';
import {NativeSourceLockError,withNativeSourceLock} from './native-source-lock';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'REVIEW_REJECTED'|
 'RECEIPT_MISMATCH'|'UNSAFE_PATH'|'SOURCE_UNVERIFIED'|
 'BACKUP_UNVERIFIED'|'CANDIDATE_CHANGED'|'CANDIDATE_MISMATCH'|
 'SOURCE_LOCKED'|'IO_FAILURE';
const flags={
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,
 businessVerified:false as const
};
export type CandidateRecheckResult=
 |Readonly<{status:'BLOCKED';reason:Reason}&typeof flags>
 |Readonly<{status:'CANDIDATE_RECHECKED_READ_ONLY';
     originalSha256:string;candidateSha256:string;candidateByteLength:number
   }&typeof flags>;
const deny=(reason:Reason):CandidateRecheckResult=>
 Object.freeze({status:'BLOCKED' as const,reason,...flags});
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CANDIDATE_NAME=new RegExp('^(.+)\\.('+UUID+')\\.candidate\\.user\\.js$');
const SHA=/^[0-9a-f]{64}$/;
type Options={sourcePath:string;backupDirectory:string;userApproved:boolean};
type Receipt={
 status:'CANDIDATE_STAGED_RUNTIME_UNVERIFIED';
 backupFileName:string;candidateFileName:string;
 originalSha256:string;candidateSha256:string;candidateByteLength:number;
 automaticPatchAllowed:false;automaticRollbackAllowed:false;
 tampermonkeyVerified:false;businessVerified:false
};
function record(input:unknown,required:readonly string[]):Record<string,unknown>|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const proto=Object.getPrototypeOf(input);
 if(proto!==Object.prototype&&proto!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const names=Reflect.ownKeys(descriptors);
 if(names.length!==required.length||names.some(n=>typeof n!=='string')||
    required.some(n=>!Object.prototype.hasOwnProperty.call(descriptors,n)||
      !Object.prototype.hasOwnProperty.call(descriptors[n],'value')))
   return null;
 const values:Record<string,unknown>=Object.create(null);
 for(const name of required)values[name]=descriptors[name].value;
 return values;
}
function validAbsolute(v:unknown):v is string{
 return typeof v==='string'&&v.length>0&&v.length<=4096&&
  !v.includes('\0')&&isAbsolute(v);
}
function sameDirectory(a:BigIntStats,b:BigIntStats):boolean{
 return a.dev===b.dev&&a.ino===b.ino;
}
function filenamePrefix(sourcePath:string):string{
 // Exact bounded naming algorithm from stageReviewedCandidateOnly.
 const suffix='.'+'0'.repeat(36)+'.candidate.user.js';
 const max=255-suffix.length;
 let value='';
 for(const character of backupPrefix(sourcePath)){
   if(value.length+character.length>max)break;
   value+=character;
 }
 return value;
}
function parse(input:unknown):Options|null{
 const obj=record(input,['sourcePath','backupDirectory','userApproved']);
 if(!obj||!validAbsolute(obj.sourcePath)||!validAbsolute(obj.backupDirectory)||
   typeof obj.userApproved!=='boolean')return null;
 if(!/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(obj.sourcePath)))return null;
 return {sourcePath:obj.sourcePath,backupDirectory:obj.backupDirectory,
   userApproved:obj.userApproved};
}
function receiptFrom(input:unknown):Receipt|null{
 const obj=record(input,[
   'status','backupFileName','candidateFileName','originalSha256',
   'candidateSha256','candidateByteLength','automaticPatchAllowed',
   'automaticRollbackAllowed','tampermonkeyVerified','businessVerified'
 ]);
 if(!obj||obj.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED'||
    typeof obj.backupFileName!=='string'||typeof obj.candidateFileName!=='string'||
    typeof obj.originalSha256!=='string'||!SHA.test(obj.originalSha256)||
    typeof obj.candidateSha256!=='string'||!SHA.test(obj.candidateSha256)||
    typeof obj.candidateByteLength!=='number'||
    !Number.isSafeInteger(obj.candidateByteLength)||
    obj.candidateByteLength<=0||obj.candidateByteLength>MAX_SCRIPT_BYTES||
    obj.automaticPatchAllowed!==false||obj.automaticRollbackAllowed!==false||
    obj.tampermonkeyVerified!==false||obj.businessVerified!==false)return null;
 return obj as Receipt;
}
/** Caller must still independently prove native user selection and any future
 * Tampermonkey/business approval. This call NEVER returns installation,
 * restoration or automatic patch permission.
 */
export async function verifyStagedCandidateReadOnly(
 request:LiteralPatchRequest,stagedReceipt:unknown,untrustedOptions:unknown
):Promise<CandidateRecheckResult>{
 try{
   const options=parse(untrustedOptions);
   if(!options)return deny('INVALID_REQUEST');
   if(!options.userApproved)return deny('NOT_AUTHORIZED');
   const receipt=receiptFrom(stagedReceipt);
   if(!receipt)return deny('INVALID_REQUEST');
   const reviewed=proposeLiteralSelectorPatch(request);
   if(reviewed.status!=='CANDIDATE_ONLY')return deny('REVIEW_REJECTED');
   const candidate=Buffer.from(reviewed.candidateSource,'utf8');
   if(!candidate.length||candidate.length>MAX_SCRIPT_BYTES||
      receipt.originalSha256!==reviewed.originalSha256||
      receipt.candidateSha256!==reviewed.candidateSha256||
      receipt.candidateByteLength!==candidate.length)
     return deny('RECEIPT_MISMATCH');
   const match=CANDIDATE_NAME.exec(receipt.candidateFileName);
   if(!match||match[1]!==filenamePrefix(options.sourcePath))
     return deny('RECEIPT_MISMATCH');
   if(await hasUnsafePathLink(options.sourcePath)||
      await hasUnsafePathLink(options.backupDirectory))
     return deny('UNSAFE_PATH');

   return await withNativeSourceLock(options.sourcePath,async()=>{
     if(await hasUnsafePathLink(options.backupDirectory))return deny('UNSAFE_PATH');
     const dir=await lstat(options.backupDirectory,{bigint:true});
     if(!dir.isDirectory()||dir.isSymbolicLink())return deny('UNSAFE_PATH');
     const source=await verifyApprovedSourceFingerprint({
       sourcePath:options.sourcePath,expectedSha256:receipt.originalSha256,
       userApproved:true
     });
     if(source.status!=='MATCHED_READ_ONLY')return deny('SOURCE_UNVERIFIED');
     const backup=await verifyBackupRecoverySource({
       sourcePath:options.sourcePath,backupDirectory:options.backupDirectory,
       backupFileName:receipt.backupFileName,
       expectedSha256:receipt.originalSha256,
       expectedByteLength:source.byteLength,userApproved:true
     });
     if(backup.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
       return deny('BACKUP_UNVERIFIED');
     const path=join(options.backupDirectory,receipt.candidateFileName);
     const checked=await verifyExactCandidateBytesReadOnly(path,candidate);
     if(checked==='CHANGED')return deny('CANDIDATE_CHANGED');
     if(checked==='MISMATCH')return deny('CANDIDATE_MISMATCH');
     if(await hasUnsafePathLink(options.backupDirectory))return deny('UNSAFE_PATH');
     const dirAfter=await lstat(options.backupDirectory,{bigint:true});
     if(!dirAfter.isDirectory()||dirAfter.isSymbolicLink()||
        !sameDirectory(dir,dirAfter))return deny('UNSAFE_PATH');
     const backupAgain=await verifyBackupRecoverySource({
       sourcePath:options.sourcePath,backupDirectory:options.backupDirectory,
       backupFileName:receipt.backupFileName,
       expectedSha256:receipt.originalSha256,
       expectedByteLength:source.byteLength,userApproved:true
     });
     if(backupAgain.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
       return deny('BACKUP_UNVERIFIED');
     const sourceAgain=await verifyApprovedSourceFingerprint({
       sourcePath:options.sourcePath,expectedSha256:receipt.originalSha256,
       userApproved:true
     });
     if(sourceAgain.status!=='MATCHED_READ_ONLY')
       return deny('SOURCE_UNVERIFIED');
     // The candidate may change during the asynchronous backup/source
     // rechecks. A stale initial byte check must never be returned as a
     // successful observation; this is still not durable write authority.
     const finalCandidate=await verifyExactCandidateBytesReadOnly(path,candidate);
     if(finalCandidate==='CHANGED')return deny('CANDIDATE_CHANGED');
     if(finalCandidate==='MISMATCH')return deny('CANDIDATE_MISMATCH');
     return Object.freeze({
       status:'CANDIDATE_RECHECKED_READ_ONLY' as const,
       originalSha256:receipt.originalSha256,
       candidateSha256:receipt.candidateSha256,
       candidateByteLength:receipt.candidateByteLength,...flags
     });
   });
 }catch(error){
   if(error instanceof NativeSourceLockError&&error.code==='SOURCE_LOCKED')
     return deny('SOURCE_LOCKED');
   // Do not leak absolute paths or user-script bytes.
   return deny('IO_FAILURE');
 }
}
