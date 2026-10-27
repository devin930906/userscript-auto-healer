/**
 * TASK-011 / REQ-020/021 / TEST-020/021.
 * Persist a bounded audit checkpoint for an already staged candidate and its
 * separately verified backup. This is NOT an application/restore transaction,
 * Tampermonkey attestation, durable power-loss guarantee, or write approval.
 * Native-only: never expose arbitrary paths through renderer IPC.
 */
import {createHash,randomUUID} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import type {BigIntStats} from 'node:fs';
import {link,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,isAbsolute,join} from 'node:path';
import type {LiteralPatchRequest} from '../repair/patch-planner';
import {verifyStagedCandidateReadOnly} from './staged-candidate-recheck';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';
import {backupPrefix} from './verified-backup';
import {hasUnsafePathLink} from './path-boundary';
import {removeOwnedStagingPending} from './staging-pending-ownership';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'RECHECK_FAILED'|
  'UNSAFE_DESTINATION'|'CHECKPOINT_FAILED';
const noAuthority={
  automaticPatchAllowed:false as const,
  automaticRollbackAllowed:false as const,
  tampermonkeyVerified:false as const,
  businessVerified:false as const
};
export type RecoveryCheckpointResult=
  |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
  |Readonly<{status:'CHECKPOINT_STAGED_UNVERIFIED';
    checkpointFileName:string;checkpointSha256:string;
    originalSha256:string;candidateSha256:string
  }&typeof noAuthority>;
const block=(reason:Reason):Extract<RecoveryCheckpointResult,{status:'BLOCKED'}>=>
  Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});

const receiptFields=[
  'status','backupFileName','candidateFileName','originalSha256',
  'candidateSha256','candidateByteLength','automaticPatchAllowed',
  'automaticRollbackAllowed','tampermonkeyVerified','businessVerified'
] as const;
type Receipt={
  status:'CANDIDATE_STAGED_RUNTIME_UNVERIFIED';
  backupFileName:string;candidateFileName:string;
  originalSha256:string;candidateSha256:string;candidateByteLength:number;
  automaticPatchAllowed:false;automaticRollbackAllowed:false;
  tampermonkeyVerified:false;businessVerified:false;
};
type Options={sourcePath:string;backupDirectory:string;userApproved:boolean};
function values(input:unknown,names:readonly string[]):Record<string,unknown>|null{
  // A Proxy (including a revoked one) can run arbitrary ownKeys and
  // getPrototypeOf traps even before independent native consent is checked.
  // Reject it using Node's intrinsic predicate before any reflection.
  if(!input||typeof input!=='object'||Array.isArray(input)||
     nodeTypes.isProxy(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const desc=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(desc);
  if(keys.length!==names.length||keys.some(k=>typeof k!=='string')||
    names.some(k=>!Object.prototype.hasOwnProperty.call(desc,k)||
      !Object.prototype.hasOwnProperty.call(desc[k],'value')))return null;
  const result:Record<string,unknown>=Object.create(null);
  for(const name of names)result[name]=desc[name].value;
  return result;
}
function optionsFrom(input:unknown):Options|null{
  const v=values(input,['sourcePath','backupDirectory','userApproved']);
  if(!v||typeof v.sourcePath!=='string'||typeof v.backupDirectory!=='string'||
    v.sourcePath.length===0||v.sourcePath.length>4096||
    v.backupDirectory.length===0||v.backupDirectory.length>4096||
    v.sourcePath.includes('\0')||v.backupDirectory.includes('\0')||
    !isAbsolute(v.sourcePath)||!isAbsolute(v.backupDirectory)||
    !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(v.sourcePath))||
    typeof v.userApproved!=='boolean')return null;
  return {sourcePath:v.sourcePath,backupDirectory:v.backupDirectory,
    userApproved:v.userApproved};
}
function sameDirectory(a:BigIntStats,b:BigIntStats):boolean{
  return a.dev===b.dev&&a.ino===b.ino;
}
function checkpointPrefix(path:string):string{
  const suffix='.'+ '0'.repeat(36)+'.checkpoint.json';
  const max=255-suffix.length;
  let prefix='';
  for(const char of backupPrefix(path)){
    if(prefix.length+char.length>max)break;
    prefix+=char;
  }
  return prefix;
}

/** A checkpoint is intentionally non-authoritative even when independently
 * byte-checked: someone can edit source/backup/candidate after this call.
 * A real restore must re-authenticate native selection, hold a transaction
 * lock and maintain a durable recovery protocol; it cannot trust this JSON.
 */
export async function stageRecoveryCheckpointOnly(
  request:LiteralPatchRequest,untrustedReceipt:unknown,untrustedOptions:unknown
):Promise<RecoveryCheckpointResult>{
  try{
    const opts=optionsFrom(untrustedOptions);
    if(!opts)return block('INVALID_REQUEST');
    if(!opts.userApproved)return block('NOT_AUTHORIZED');
    const data=values(untrustedReceipt,receiptFields);
    // Snapshot all caller data before the first await: mutable serialized
    // requests and receipts must not switch identity between rechecks.
    const requestData=values(request,[
      'source','expectedSourceSha256','callOffset','method',
      'originalSelector','replacementSelector','faultEvidenceId'
    ]);
    if(!data||!requestData)return block('INVALID_REQUEST');
    const stableRequest=requestData as unknown as LiteralPatchRequest;
    const result=await verifyStagedCandidateReadOnly(stableRequest,data,opts);
    if(result.status!=='CANDIDATE_RECHECKED_READ_ONLY')
      return block('RECHECK_FAILED');
    // Recheck already validated the strict receipt schema; never copy fields
    // from a caller's prototype/getter or grant authority from JSON flags.
    const receipt=data as unknown as Receipt;
    if(await hasUnsafePathLink(opts.backupDirectory))
      return block('UNSAFE_DESTINATION');
    const dir=await lstat(opts.backupDirectory,{bigint:true});
    if(!dir.isDirectory()||dir.isSymbolicLink())
      return block('UNSAFE_DESTINATION');
    const record=Object.freeze({
      schemaVersion:1,
      status:'RECOVERY_CHECKPOINT_UNVERIFIED',
      sourcePathSha256:createHash('sha256').update(opts.sourcePath,'utf8').digest('hex'),
      originalSha256:result.originalSha256,
      candidateSha256:result.candidateSha256,
      candidateByteLength:result.candidateByteLength,
      backupFileName:receipt.backupFileName,
      candidateFileName:receipt.candidateFileName,
      ...noAuthority
    });
    const bytes=Buffer.from(JSON.stringify(record)+'\n','utf8');
    const expectedHash=createHash('sha256').update(bytes).digest('hex');
    const checkpointFileName=checkpointPrefix(opts.sourcePath)+'.'+
      randomUUID()+'.checkpoint.json';
    const final=join(opts.backupDirectory,checkpointFileName);
    const pending=join(opts.backupDirectory,'.'+randomUUID()+'.pending');
    let tempCreated=false;
    let pendingIdentity:BigIntStats|undefined;
    try{
      const file=await open(pending,'wx',0o600);
      tempCreated=true;
      try{
       await file.writeFile(bytes);
       await file.sync();
       pendingIdentity=await file.stat({bigint:true});
      }
      finally{await file.close();}
      if(await verifyExactCandidateBytesReadOnly(pending,bytes)!=='MATCH')
        return block('CHECKPOINT_FAILED');
      if(await hasUnsafePathLink(opts.backupDirectory))
        return block('UNSAFE_DESTINATION');
      const beforePublish=await lstat(opts.backupDirectory,{bigint:true});
      if(!beforePublish.isDirectory()||beforePublish.isSymbolicLink()||
         !sameDirectory(dir,beforePublish))return block('UNSAFE_DESTINATION');
      // Atomic no-overwrite publication within the same directory. Partial
      // .pending files are never named/treated as recoverable checkpoints.
      await link(pending,final);
      if(!pendingIdentity||!await removeOwnedStagingPending(
        pending,pendingIdentity,dir,final))return block('CHECKPOINT_FAILED');
      tempCreated=false;
      if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
        return block('CHECKPOINT_FAILED');
      if(await hasUnsafePathLink(opts.backupDirectory))
        return block('UNSAFE_DESTINATION');
      const afterPublish=await lstat(opts.backupDirectory,{bigint:true});
      if(!afterPublish.isDirectory()||afterPublish.isSymbolicLink()||
         !sameDirectory(dir,afterPublish))return block('UNSAFE_DESTINATION');
      // Bind the receipt to OUR published inode, not merely its filename or
      // SHA-256. An external editor can replace a file with identical bytes.
      // The earlier hard-link retirement legitimately changes ctime/nlink.
      const published=await lstat(final,{bigint:true});
      if(!pendingIdentity||!published.isFile()||published.isSymbolicLink()||
         published.nlink!==1n||published.dev!==pendingIdentity.dev||
         published.ino!==pendingIdentity.ino||
         published.size!==pendingIdentity.size||
         published.mtimeNs!==pendingIdentity.mtimeNs)
        return block('CHECKPOINT_FAILED');
      // Any stale disk file during publication invalidates this observation.
      // The record remains for explicit investigation, NEVER for auto-apply.
      const rechecked=await verifyStagedCandidateReadOnly(stableRequest,data,opts);
      if(rechecked.status!=='CANDIDATE_RECHECKED_READ_ONLY')
        return block('RECHECK_FAILED');
      // Rechecking source/backup/candidate is asynchronous. The published
      // checkpoint itself may have changed or been swapped during that await.
      // No stale success receipt: compare both exact bytes AND same file
      // identity after the final candidate check, without deleting it.
      if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH'||
         await hasUnsafePathLink(final)||
         await hasUnsafePathLink(opts.backupDirectory))
        return block('CHECKPOINT_FAILED');
      const last=await lstat(final,{bigint:true});
      const lastDirectory=await lstat(opts.backupDirectory,{bigint:true});
      if(!last.isFile()||last.isSymbolicLink()||last.nlink!==1n||
         last.dev!==published.dev||last.ino!==published.ino||
         last.size!==published.size||last.mtimeNs!==published.mtimeNs||
         last.ctimeNs!==published.ctimeNs||
         !lastDirectory.isDirectory()||lastDirectory.isSymbolicLink()||
         !sameDirectory(dir,lastDirectory))
        return block('CHECKPOINT_FAILED');
      return Object.freeze({
        status:'CHECKPOINT_STAGED_UNVERIFIED' as const,
        checkpointFileName,checkpointSha256:expectedHash,
        originalSha256:result.originalSha256,candidateSha256:result.candidateSha256,
        ...noAuthority
      });
    }catch{return block('CHECKPOINT_FAILED');}
    finally{
      if(tempCreated&&pendingIdentity)
       await removeOwnedStagingPending(pending,pendingIdentity,dir);
    }
  }catch{
    // Never leak full paths or source contents in error messages.
    return block('CHECKPOINT_FAILED');
  }
}


/** Reinspect a persisted checkpoint after losing the in-memory stage receipt.
 * A matching journal plus live disk bytes is still NOT write authorization,
 * recovery capability, Tampermonkey provenance, or business acceptance.
 */
export type CheckpointInspectionResult=
  |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
  |Readonly<{status:'CHECKPOINT_RECHECKED_READ_ONLY';
    checkpointSha256:string;originalSha256:string;candidateSha256:string
  }&typeof noAuthority>;

export async function inspectRecoveryCheckpointReadOnly(
  request:LiteralPatchRequest,checkpointFileName:unknown,
  untrustedOptions:unknown
):Promise<CheckpointInspectionResult>{
  try{
    const opts=optionsFrom(untrustedOptions);
    if(!opts)return block('INVALID_REQUEST');
    if(!opts.userApproved)return block('NOT_AUTHORIZED');
    if(typeof checkpointFileName!=='string')return block('INVALID_REQUEST');
    const uuid='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    const name=new RegExp('^(.+)\\.('+uuid+')\\.checkpoint\\.json$').exec(checkpointFileName);
    if(!name||name[1]!==checkpointPrefix(opts.sourcePath))
      return block('INVALID_REQUEST');
    if(await hasUnsafePathLink(opts.backupDirectory))
      return block('UNSAFE_DESTINATION');
    const folderBefore=await lstat(opts.backupDirectory,{bigint:true});
    if(!folderBefore.isDirectory()||folderBefore.isSymbolicLink())
      return block('UNSAFE_DESTINATION');
    const path=join(opts.backupDirectory,checkpointFileName);
    if(await hasUnsafePathLink(path))return block('UNSAFE_DESTINATION');
    const fileBefore=await lstat(path,{bigint:true});
    if(!fileBefore.isFile()||fileBefore.isSymbolicLink()||
      fileBefore.nlink!==1n||fileBefore.size<=0n||fileBefore.size>4096n)
      return block('CHECKPOINT_FAILED');
    const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    let bytes:Buffer;
    try{
      const opened=await handle.stat({bigint:true});
      if(!opened.isFile()||opened.nlink!==1n||
        opened.dev!==fileBefore.dev||opened.ino!==fileBefore.ino||
        opened.size!==fileBefore.size||opened.mtimeNs!==fileBefore.mtimeNs||
        opened.ctimeNs!==fileBefore.ctimeNs)
        return block('CHECKPOINT_FAILED');
      const buffer=Buffer.allocUnsafe(4097);
      let count=0;
      while(true){
        const {bytesRead}=await handle.read(buffer,count,4097-count,null);
        if(bytesRead===0)break;
        count+=bytesRead;
        if(count>4096)return block('CHECKPOINT_FAILED');
      }
      const after=await handle.stat({bigint:true});
      const named=await lstat(path,{bigint:true});
      if(named.isSymbolicLink()||!named.isFile()||named.nlink!==1n||
        after.dev!==fileBefore.dev||after.ino!==fileBefore.ino||
        after.size!==fileBefore.size||after.mtimeNs!==fileBefore.mtimeNs||
        after.ctimeNs!==fileBefore.ctimeNs||
        named.dev!==after.dev||named.ino!==after.ino||
        named.size!==after.size||named.mtimeNs!==after.mtimeNs||
        named.ctimeNs!==after.ctimeNs||BigInt(count)!==after.size)
        return block('CHECKPOINT_FAILED');
      bytes=Buffer.from(buffer.subarray(0,count));
    }finally{await handle.close();}
    const text=bytes.toString('utf8');
    let parsed:unknown;
    try{parsed=JSON.parse(text);}catch{return block('CHECKPOINT_FAILED');}
    const fields=values(parsed,[
      'schemaVersion','status','sourcePathSha256','originalSha256',
      'candidateSha256','candidateByteLength','backupFileName',
      'candidateFileName','automaticPatchAllowed','automaticRollbackAllowed',
      'tampermonkeyVerified','businessVerified'
    ]);
    if(!fields||JSON.stringify(parsed)+'\n'!==text||
       fields.schemaVersion!==1||
       fields.status!=='RECOVERY_CHECKPOINT_UNVERIFIED'||
       fields.sourcePathSha256!==createHash('sha256')
         .update(opts.sourcePath,'utf8').digest('hex')||
       fields.automaticPatchAllowed!==false||
       fields.automaticRollbackAllowed!==false||
       fields.tampermonkeyVerified!==false||fields.businessVerified!==false)
      return block('CHECKPOINT_FAILED');
    const receipt={
      status:'CANDIDATE_STAGED_RUNTIME_UNVERIFIED',
      backupFileName:fields.backupFileName,
      candidateFileName:fields.candidateFileName,
      originalSha256:fields.originalSha256,
      candidateSha256:fields.candidateSha256,
      candidateByteLength:fields.candidateByteLength,
      ...noAuthority
    };
    const stableRequest=values(request,[
      'source','expectedSourceSha256','callOffset','method',
      'originalSelector','replacementSelector','faultEvidenceId'
    ]);
    if(!stableRequest)return block('INVALID_REQUEST');
    const check=await verifyStagedCandidateReadOnly(
      stableRequest as unknown as LiteralPatchRequest,receipt,opts
    );
    if(check.status!=='CANDIDATE_RECHECKED_READ_ONLY')
      return block('RECHECK_FAILED');
    if(await verifyExactCandidateBytesReadOnly(path,bytes)!=='MATCH')
      return block('CHECKPOINT_FAILED');
    if(await hasUnsafePathLink(opts.backupDirectory))
      return block('UNSAFE_DESTINATION');
    const folderAfter=await lstat(opts.backupDirectory,{bigint:true});
    if(folderAfter.isSymbolicLink()||!folderAfter.isDirectory()||
       !sameDirectory(folderBefore,folderAfter))
      return block('UNSAFE_DESTINATION');
    // Candidate verification awaits independent disk I/O. The persisted
    // checkpoint pathname can be replaced with IDENTICAL bytes while that
    // check runs. Match the originally read inode and metadata, not only
    // the SHA-256, before returning any recovery observation.
    const fileAfter=await lstat(path,{bigint:true});
    if(!fileAfter.isFile()||fileAfter.isSymbolicLink()||
       fileAfter.nlink!==1n||
       fileAfter.dev!==fileBefore.dev||fileAfter.ino!==fileBefore.ino||
       fileAfter.size!==fileBefore.size||
       fileAfter.mtimeNs!==fileBefore.mtimeNs||
       fileAfter.ctimeNs!==fileBefore.ctimeNs||
       fileAfter.mode!==fileBefore.mode||
       await hasUnsafePathLink(path))
      return block('CHECKPOINT_FAILED');
    return Object.freeze({
      status:'CHECKPOINT_RECHECKED_READ_ONLY' as const,
      checkpointSha256:createHash('sha256').update(bytes).digest('hex'),
      originalSha256:check.originalSha256,candidateSha256:check.candidateSha256,
      ...noAuthority
    });
  }catch{return block('CHECKPOINT_FAILED');}
}
