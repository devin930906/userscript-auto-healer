/**
 * TASK-011 / REQ-020 / TEST-020: bounded discovery of persisted, untrusted
 * recovery checkpoints. Native-only; never expose filesystem paths through IPC.
 * A successful observation is NOT permission to apply or roll back a script.
 */
import type {BigIntStats} from 'node:fs';
import {lstat,opendir} from 'node:fs/promises';
import {basename,isAbsolute} from 'node:path';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../repair/patch-planner';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {backupPrefix} from './verified-backup';
import {hasUnsafePathLink} from './path-boundary';
import {inspectRecoveryCheckpointReadOnly} from './recovery-checkpoint';

const MAX_DIRECTORY_ENTRIES=512;
const MAX_CHECKPOINTS=64;
const UUID_V4='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const noAuthority={
  automaticPatchAllowed:false as const,
  automaticRollbackAllowed:false as const,
  tampermonkeyVerified:false as const,
  businessVerified:false as const
};
type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'UNSAFE_PATH'|
  'SOURCE_UNVERIFIED'|'UNSAFE_CHECKPOINT'|'TOO_MANY_ENTRIES'|'IO_FAILURE';
export type CheckpointInventoryResult=
  |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
  |Readonly<{status:'OBSERVED_CHECKPOINTS_READ_ONLY';checkpoints:ReadonlyArray<Readonly<{
    checkpointFileName:string;checkpointSha256:string;originalSha256:string;
    candidateSha256:string
  }>>}&typeof noAuthority>;
const deny=(reason:Reason):CheckpointInventoryResult=>
  Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});
const sameFile=(a:BigIntStats,b:BigIntStats)=>
  a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
  a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const sameDir=(a:BigIntStats,b:BigIntStats)=>
  a.dev===b.dev&&a.ino===b.ino;
function plainValues(input:unknown,names:readonly string[]):Record<string,unknown>|null{
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const d=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(d);
  if(keys.length!==names.length||keys.some(k=>typeof k!=='string')||
     names.some(k=>!Object.prototype.hasOwnProperty.call(d,k)||
       !Object.prototype.hasOwnProperty.call(d[k],'value')))return null;
  const result:Record<string,unknown>=Object.create(null);
  for(const n of names)result[n]=d[n].value;
  return result;
}
function checkpointPrefix(path:string):string{
  const suffix='.'+'0'.repeat(36)+'.checkpoint.json';
  const max=255-suffix.length;
  let prefix='';
  for(const character of backupPrefix(path)){
    if(prefix.length+character.length>max)break;
    prefix+=character;
  }
  return prefix;
}

/** Fail closed for malformed/tampered matching checkpoints and oversized
 * inventories. Ignore unrelated files. Every candidate is independently
 * revalidated against the live original, separate backup and staged bytes.
 * Entries can become stale immediately; a future transaction MUST recheck.
 */
export async function inspectRecoveryCheckpointInventoryReadOnly(
  untrustedRequest:unknown,untrustedOptions:unknown
):Promise<CheckpointInventoryResult>{
  try{
    const opts=plainValues(untrustedOptions,
      ['sourcePath','backupDirectory','userApproved']);
    if(!opts||typeof opts.sourcePath!=='string'||
       typeof opts.backupDirectory!=='string'||
       opts.sourcePath.length===0||opts.sourcePath.length>4096||
       opts.backupDirectory.length===0||opts.backupDirectory.length>4096||
       opts.sourcePath.includes('\0')||opts.backupDirectory.includes('\0')||
       !isAbsolute(opts.sourcePath)||!isAbsolute(opts.backupDirectory)||
       !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(opts.sourcePath))||
       typeof opts.userApproved!=='boolean')return deny('INVALID_REQUEST');
    if(!opts.userApproved)return deny('NOT_AUTHORIZED');
    const req=plainValues(untrustedRequest,[
      'source','expectedSourceSha256','callOffset','method',
      'originalSelector','replacementSelector','faultEvidenceId'
    ]);
    if(!req)return deny('INVALID_REQUEST');
    const request=req as unknown as LiteralPatchRequest;
    if(proposeLiteralSelectorPatch(request).status!=='CANDIDATE_ONLY')
      return deny('INVALID_REQUEST');
    const options={sourcePath:opts.sourcePath,
      backupDirectory:opts.backupDirectory,userApproved:true};
    if(await hasUnsafePathLink(options.sourcePath)||
       await hasUnsafePathLink(options.backupDirectory))
      return deny('UNSAFE_PATH');
    const sourceBefore=await lstat(options.sourcePath,{bigint:true});
    const dirBefore=await lstat(options.backupDirectory,{bigint:true});
    if(!sourceBefore.isFile()||sourceBefore.isSymbolicLink()||
       sourceBefore.nlink!==1n||!dirBefore.isDirectory()||
       dirBefore.isSymbolicLink())return deny('UNSAFE_PATH');
    const sourceCheck=await verifyApprovedSourceFingerprint({
      sourcePath:options.sourcePath,expectedSha256:request.expectedSourceSha256,
      userApproved:true
    });
    if(sourceCheck.status!=='MATCHED_READ_ONLY')
      return deny('SOURCE_UNVERIFIED');
    const prefix=checkpointPrefix(options.sourcePath)+'.';
    const namePattern=new RegExp('^'+UUID_V4+'\\.checkpoint\\.json$');
    const matches:string[]=[];
    let entries=0;
    const dir=await opendir(options.backupDirectory);
    for await(const entry of dir){
      if(++entries>MAX_DIRECTORY_ENTRIES)return deny('TOO_MANY_ENTRIES');
      if(entry.name.startsWith(prefix)&&
         namePattern.test(entry.name.slice(prefix.length))){
        matches.push(entry.name);
        if(matches.length>MAX_CHECKPOINTS)return deny('TOO_MANY_ENTRIES');
      }
    }
    matches.sort();
    const observed:Array<{
      checkpointFileName:string;checkpointSha256:string;
      originalSha256:string;candidateSha256:string
    }>=[];
    for(const name of matches){
      const inspected=await inspectRecoveryCheckpointReadOnly(
        request,name,options);
      if(inspected.status!=='CHECKPOINT_RECHECKED_READ_ONLY')
        return deny('UNSAFE_CHECKPOINT');
      observed.push(Object.freeze({
        checkpointFileName:name,checkpointSha256:inspected.checkpointSha256,
        originalSha256:inspected.originalSha256,
        candidateSha256:inspected.candidateSha256
      }));
    }
    if(await hasUnsafePathLink(options.sourcePath)||
       await hasUnsafePathLink(options.backupDirectory))
      return deny('UNSAFE_PATH');
    const sourceAfter=await lstat(options.sourcePath,{bigint:true});
    const dirAfter=await lstat(options.backupDirectory,{bigint:true});
    const sourceFinal=await verifyApprovedSourceFingerprint({
      sourcePath:options.sourcePath,expectedSha256:request.expectedSourceSha256,
      userApproved:true
    });
    if(!sameFile(sourceBefore,sourceAfter)||sourceAfter.nlink!==1n||
       sourceFinal.status!=='MATCHED_READ_ONLY')
      return deny('SOURCE_UNVERIFIED');
    if(!sameDir(dirBefore,dirAfter)||dirAfter.isSymbolicLink()||
       !dirAfter.isDirectory())return deny('UNSAFE_PATH');
    return Object.freeze({
      status:'OBSERVED_CHECKPOINTS_READ_ONLY' as const,
      checkpoints:Object.freeze(observed),...noAuthority
    });
  }catch{
    // Do not return native errors, private paths or script contents.
    return deny('IO_FAILURE');
  }
}
