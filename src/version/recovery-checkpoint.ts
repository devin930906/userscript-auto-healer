/**
 * TASK-011 / REQ-020/021 / TEST-020/021.
 * Persist a bounded audit checkpoint for an already staged candidate and its
 * separately verified backup. This is NOT an application/restore transaction,
 * Tampermonkey attestation, durable power-loss guarantee, or write approval.
 * Native-only: never expose arbitrary paths through renderer IPC.
 */
import {createHash,randomUUID} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import {link,lstat,open,unlink} from 'node:fs/promises';
import {basename,isAbsolute,join} from 'node:path';
import type {LiteralPatchRequest} from '../repair/patch-planner';
import {verifyStagedCandidateReadOnly} from './staged-candidate-recheck';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';
import {backupPrefix} from './verified-backup';
import {hasUnsafePathLink} from './path-boundary';

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
const block=(reason:Reason):RecoveryCheckpointResult=>
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
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
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
    if(!data)return block('INVALID_REQUEST');
    const result=await verifyStagedCandidateReadOnly(request,untrustedReceipt,opts);
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
    try{
      const file=await open(pending,'wx',0o600);
      tempCreated=true;
      try{await file.writeFile(bytes);await file.sync();}
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
      await unlink(pending);
      tempCreated=false;
      if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
        return block('CHECKPOINT_FAILED');
      if(await hasUnsafePathLink(opts.backupDirectory))
        return block('UNSAFE_DESTINATION');
      const afterPublish=await lstat(opts.backupDirectory,{bigint:true});
      if(!afterPublish.isDirectory()||afterPublish.isSymbolicLink()||
         !sameDirectory(dir,afterPublish))return block('UNSAFE_DESTINATION');
      // Any stale disk file during publication invalidates this observation.
      // The record remains for explicit investigation, NEVER for auto-apply.
      const rechecked=await verifyStagedCandidateReadOnly(request,untrustedReceipt,opts);
      if(rechecked.status!=='CANDIDATE_RECHECKED_READ_ONLY')
        return block('RECHECK_FAILED');
      return Object.freeze({
        status:'CHECKPOINT_STAGED_UNVERIFIED' as const,
        checkpointFileName,checkpointSha256:expectedHash,
        originalSha256:result.originalSha256,candidateSha256:result.candidateSha256,
        ...noAuthority
      });
    }catch{return block('CHECKPOINT_FAILED');}
    finally{
      if(tempCreated)await unlink(pending).catch(()=>{});
    }
  }catch{
    // Never leak full paths or source contents in error messages.
    return block('CHECKPOINT_FAILED');
  }
}
